import { Util } from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { FontId, Matrix, PageInfo } from '../types';

/*
 * EDITING EXISTING TEXT
 *
 * A PDF has no notion of "paragraphs" — just positioned glyph runs. Like
 * iLovePDF we rebuild editable lines from PDF.js' text content:
 *
 *   getTextContent() items  ->  transform into display points  ->  group
 *   runs that share a baseline into lines  ->  TextLine (bbox, size, style)
 *
 * When the user clicks a line we put a transparent Textbox over it (original
 * glyphs stay put, like iLovePDF). The first real keystroke covers the printed
 * run and paints with the PDF's own FontFace (PDF.js `loadedName`). The subset
 * only has characters the file already used; new letters fall through to a
 * weight-400 alias of Times/Verdana Bold, then Noto. Never request CSS 700 on
 * that FontFace — the outlines already have the right weight, and asking for
 * 700 makes the browser skip it and look grey.
 */

/** A slice of a line that shares one weight and style ("Framework:" bold, the rest regular). */
export interface TextSpan {
  text: string;
  bold: boolean;
  italic: boolean;
  pdfFamily?: string;
  cssFamily?: string;
}

export interface TextLine {
  id: string;
  text: string;
  /** Same text split where bold / italic changes. One entry when the line is uniform. */
  spans: TextSpan[];
  /** Bounding box in display points (top-left origin). */
  left: number;
  top: number;
  width: number;
  height: number;
  /** Baseline y in display points. */
  baseline: number;
  fontSize: number;
  fontId: FontId;
  /** Weight shared by most of the line; the other spans override it per character. */
  bold: boolean;
  italic: boolean;
  smallCaps: boolean;
  /** PDF.js internal font name, for debugging. */
  fontName: string;
  /** FontFace family PDF.js registered (usually `g_d0_f1`). Exact printed glyphs. */
  pdfFamily?: string;
  /** Weight that FontFace was registered with (usually 400, even for bold outlines). */
  pdfFaceWeight?: string | number;
  /** Installed CSS family (e.g. "Times New Roman", "Verdana") when we can name it. */
  cssFamily?: string;
}

interface FontFlags {
  bold: boolean;
  italic: boolean;
  fontId: FontId;
  ascent: number;
  descent: number;
  /** Font is a small-caps face (e.g. CMCSC10); we emulate it with uppercase. */
  smallCaps: boolean;
  cssFamily?: string;
  pdfFamily?: string;
  pdfFaceWeight?: string | number;
}

interface Run {
  text: string;
  x: number;
  right: number;
  baseline: number;
  fontSize: number;
  fontName: string;
  flags: FontFlags;
  hasEOL: boolean;
  /** Same glyphs drawn twice (Word fake-bold). Treat the kept copy as bold. */
  fakeBold?: boolean;
}

const cache = new WeakMap<PDFDocumentProxy, Map<number, Promise<TextLine[]>>>();

export function getTextLines(proxy: PDFDocumentProxy, info: PageInfo): Promise<TextLine[]> {
  let perDoc = cache.get(proxy);
  if (!perDoc) cache.set(proxy, (perDoc = new Map()));
  let p = perDoc.get(info.index);
  if (!p) {
    p = extract(proxy, info)
      .then((result) => {
        // Font descriptors only exist once PDF.js has rendered the page; if
        // some were missing, keep the result for now but recompute next time.
        if (!result.complete) perDoc!.delete(info.index);
        return result.lines;
      })
      .catch((err) => {
        console.warn('Text extraction failed for page', info.index + 1, err);
        perDoc!.delete(info.index);
        return [];
      });
    perDoc.set(info.index, p);
  }
  return p;
}

/**
 * Max gap (in em) still treated as "the same word/line". A normal space is
 * ~0.25em; anything much wider is a column (name | roll-number) and must
 * stay a separate editable box so we don't smash the two together.
 */
const JOIN_GAP_EM = 0.55;
/** Gaps smaller than this are kerning / fake-bold overprint, not a new word. */
const KERNING_EM = 0.1;
/** Overlap larger than this with the same string is a duplicate draw. */
const DUP_OVERLAP_EM = 0.08;

async function extract(proxy: PDFDocumentProxy, info: PageInfo): Promise<{ lines: TextLine[]; complete: boolean }> {
  const page = await proxy.getPage(info.index + 1);
  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  const flagsCache = new Map<string, FontFlags>();
  const runs: Run[] = [];
  let complete = true;
  const vt = info.viewportTransform;
  const viewScaleX = Math.hypot(vt[0], vt[1]) || 1;

  for (const item of content.items as TextItem[]) {
    if (!('str' in item)) continue;
    // Keep real space runs (word gaps). Drop empty items unless they end a line.
    if (item.str.length === 0) {
      if (item.hasEOL && runs.length) runs[runs.length - 1].hasEOL = true;
      continue;
    }
    // user space -> display points (applies the page /Rotate and Y flip)
    const m = Util.transform(vt, item.transform) as Matrix;
    const [a, b, c, d, e, f] = m;
    // Only axis-aligned, upright text is editable in place.
    if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0 || d >= 0) continue;
    const fontSize = Math.hypot(c, d) || Math.abs(item.height) * viewScaleX;
    if (fontSize < 1) continue;
    let flags = flagsCache.get(item.fontName);
    if (!flags) {
      if (!page.commonObjs.has(item.fontName)) complete = false;
      flags = resolveFlags(page, item.fontName, content.styles[item.fontName]?.fontFamily, content.styles[item.fontName]);
      flagsCache.set(item.fontName, flags);
    }
    // item.width is in the same space as item.transform (user space). Map it
    // to display points with the same scale we applied to the origin.
    const srcScale = Math.hypot(item.transform[0], item.transform[1]) || 1;
    const displayWidth = item.width * ((Math.hypot(a, b) || viewScaleX) / srcScale);
    runs.push({
      text: item.str,
      x: e,
      right: e + displayWidth,
      baseline: f,
      fontSize,
      fontName: item.fontName,
      flags,
      hasEOL: item.hasEOL,
    });
  }

  runs.sort((p, q) => p.baseline - q.baseline || p.x - q.x);
  const lines: TextLine[] = [];
  let current: Run[] = [];

  const flush = () => {
    const kept = current.filter((r) => r.text.trim().length > 0);
    if (kept.length) lines.push(buildLine(kept, info.index, lines.length));
    current = [];
  };

  for (const run of runs) {
    const em = run.fontSize;
    const wideSpace = !run.text.trim() && run.right - run.x > em * JOIN_GAP_EM;
    // A wide space (tab / column gap) is a line break, not part of the text.
    if (wideSpace) {
      flush();
      continue;
    }

    const last = current[current.length - 1];
    if (last) {
      const sameBaseline = Math.abs(run.baseline - last.baseline) <= Math.max(last.fontSize, run.fontSize) * 0.28;
      const gap = run.x - last.right;

      // Fake-bold / overprint: the same (or contained) string drawn twice,
      // slightly offset. Keep one copy so we don't concatenate garbage.
      if (sameBaseline && gap < -em * DUP_OVERLAP_EM) {
        const aText = last.text.trim();
        const bText = run.text.trim();
        if (aText && bText && (aText === bText || aText.includes(bText) || bText.includes(aText))) {
          last.right = Math.max(last.right, run.right);
          last.hasEOL = last.hasEOL || run.hasEOL;
          last.fakeBold = true;
          continue;
        }
      }

      const close = gap <= em * JOIN_GAP_EM && gap > -em * 0.35;
      const sameStyle =
        run.flags.pdfFamily === last.flags.pdfFamily &&
        run.flags.bold === last.flags.bold &&
        run.flags.italic === last.flags.italic &&
        Math.abs(run.fontSize - last.fontSize) < 0.75;
      if (!(sameBaseline && close && sameStyle) || last.hasEOL) flush();
    }
    current.push(run);
  }
  flush();
  return { lines: lines.filter((l) => l.text.trim().length > 0), complete };
}

function buildLine(runs: Run[], pageIndex: number, n: number): TextLine {
  runs.sort((p, q) => p.x - q.x);
  const raw: TextSpan[] = [];
  let right = -Infinity;
  let left = Infinity;
  for (const r of runs) {
    if (!r.text.trim() && raw.length === 0) continue;
    let piece = r.text;
    const prev = raw[raw.length - 1];
    const gap = r.x - right;
    const em = r.fontSize;
    // Restore missing word spaces from the PDF's positioning. A gap around
    // one space (~0.25em) becomes one space; bigger (but still same-line)
    // gaps become a few spaces so names don't run into numbers.
    if (prev && gap > em * KERNING_EM && !/\s$/.test(prev.text) && !/^\s/.test(piece)) {
      const spaces = Math.max(1, Math.min(4, Math.round(gap / (em * 0.25))));
      piece = `${' '.repeat(spaces)}${piece}`;
    }
    const runBold = r.flags.bold || !!r.fakeBold;
    if (prev && prev.bold === runBold && prev.italic === r.flags.italic && prev.pdfFamily === r.flags.pdfFamily) {
      prev.text += piece;
    } else {
      raw.push({
        text: piece,
        bold: runBold,
        italic: r.flags.italic,
        pdfFamily: r.flags.pdfFamily,
        cssFamily: r.flags.cssFamily,
      });
    }
    left = Math.min(left, r.x);
    right = Math.max(right, r.right);
  }
  const spans = normalizeSpans(raw);
  const text = spans.map((s) => s.text).join('');
  const { bold, italic } = dominantStyle(spans);
  const first = runs[0];
  const fontSize = Math.max(...runs.map((r) => r.fontSize));
  const { ascent, descent } = first.flags;
  const baseline = first.baseline;
  const top = baseline - fontSize * ascent;
  const bottom = baseline + fontSize * descent;
  return {
    id: `p${pageIndex}-l${n}`,
    text,
    spans,
    left: Number.isFinite(left) ? left : first.x,
    top,
    width: Math.max(0, right - (Number.isFinite(left) ? left : first.x)),
    height: bottom - top,
    baseline,
    fontSize,
    fontId: first.flags.fontId,
    bold,
    italic,
    smallCaps: first.flags.smallCaps,
    fontName: first.fontName,
    cssFamily: first.flags.cssFamily,
    pdfFamily: first.flags.pdfFamily,
    pdfFaceWeight: first.flags.pdfFaceWeight,
  };
}

/** Collapse whitespace (including across span boundaries) and drop empty spans. */
function normalizeSpans(spans: TextSpan[]): TextSpan[] {
  const chars: Array<{ ch: string; bold: boolean; italic: boolean; pdfFamily?: string; cssFamily?: string }> = [];
  let prevSpace = true;
  for (const span of spans) {
    for (const ch of span.text) {
      if (/\s/.test(ch)) {
        if (prevSpace) continue;
        chars.push({ ch: ' ', bold: span.bold, italic: span.italic, pdfFamily: span.pdfFamily, cssFamily: span.cssFamily });
        prevSpace = true;
      } else {
        chars.push({ ch, bold: span.bold, italic: span.italic, pdfFamily: span.pdfFamily, cssFamily: span.cssFamily });
        prevSpace = false;
      }
    }
  }
  while (chars.length && chars[chars.length - 1].ch === ' ') chars.pop();
  const out: TextSpan[] = [];
  for (const c of chars) {
    const prev = out[out.length - 1];
    if (prev && prev.bold === c.bold && prev.italic === c.italic && prev.pdfFamily === c.pdfFamily) prev.text += c.ch;
    else out.push({ text: c.ch, bold: c.bold, italic: c.italic, pdfFamily: c.pdfFamily, cssFamily: c.cssFamily });
  }
  return out;
}

/** The style used for the text box itself: whichever covers more of the line. */
function dominantStyle(spans: TextSpan[]): { bold: boolean; italic: boolean } {
  let boldN = 0;
  let regularN = 0;
  let italicN = 0;
  let romanN = 0;
  for (const span of spans) {
    const n = span.text.replace(/\s/g, '').length;
    if (span.bold) boldN += n;
    else regularN += n;
    if (span.italic) italicN += n;
    else romanN += n;
  }
  return { bold: boldN > regularN, italic: italicN > romanN };
}

interface PdfJsFont {
  name?: string;
  bold?: boolean;
  italic?: boolean;
  black?: boolean;
  fallbackName?: string;
  loadedName?: string;
  ascent?: number;
  descent?: number;
  cssFontInfo?: { fontFamily?: string; fontWeight?: string | number; italicAngle?: string };
}

/**
 * Map a PDF font onto one of our bundled families. Uses the flags PDF.js
 * derives from the font descriptor (available once the page has rendered)
 * plus the PostScript name as a hint ("CMBX12" = Computer Modern bold, …).
 */
function resolveFlags(
  page: PDFPageProxy,
  fontName: string,
  fallbackFamily?: string,
  style?: { ascent?: number; descent?: number; fontFamily?: string },
): FontFlags {
  let font: PdfJsFont | undefined;
  try {
    if (page.commonObjs.has(fontName)) font = page.commonObjs.get(fontName) as PdfJsFont;
  } catch {
    font = undefined;
  }
  // Strip the subset tag ("ABCDEF+CMBX12" -> "cmbx12").
  const psName = (font?.name ?? '').replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const family = (font?.fallbackName ?? fallbackFamily ?? style?.fontFamily ?? '').toLowerCase();

  // LaTeX fonts: Computer Modern (cmr, cmbx, cmti, cmcsc, cmss, cmtt…),
  // Latin Modern (lmroman10-bold, lmsans, lmmono, lmromancaps…), SF (sfrm…).
  const isCM = /^cm[a-z]{1,4}\d/.test(psName);
  const isLM = /^lm(roman|sans|mono)/.test(psName);
  const isSF = /^sf(rm|bx|ti|sc|ss|tt)/.test(psName);

  const cssWeightRaw = font?.cssFontInfo?.fontWeight;
  const cssWeight = typeof cssWeightRaw === 'number' ? cssWeightRaw : parseInt(String(cssWeightRaw ?? ''), 10) || 0;
  const weightHint = /bold|black|heavy|semibold|demibold|extrabold|\bbd\b|boldmt|-bd(?:mt)?\b|-b\b|,b\b/;
  const bold =
    !!(font?.bold || font?.black) ||
    cssWeight >= 600 ||
    String(cssWeightRaw ?? '').toLowerCase() === 'bold' ||
    weightHint.test(psName) ||
    weightHint.test(family) ||
    /^(cmbx|cmb\d|cmssbx|cmbxti|cmbxsl|sfbx)/.test(psName) ||
    (isLM && /bold|demi/.test(psName));
  const italic =
    !!font?.italic ||
    /italic|oblique|-i\b|,i\b|it\d/.test(psName) ||
    /^(cmti|cmmi|cmsl|cmbxti|cmbxsl|cmssi|cmitt|sfti|sfsl)/.test(psName) ||
    (isLM && /italic|oblique/.test(psName));
  const smallCaps = /smallcaps|small-caps|caps\b|-sc\b|sc\d/.test(psName) || /^(cmcsc|cmbxsc|sfsc)/.test(psName) || /^lmromancaps/.test(psName);

  // A recognised LaTeX name is authoritative; otherwise fall back to PDF.js' guess.
  const latex = isCM || isLM || isSF;
  // Do not use family.includes('mono') — PDF.js labels some sans faces
  // (Verdana, Tahoma) as the generic "monospace", which would send them
  // to Roboto Mono and make roll-numbers look grey and wrong.
  const monoFromName = /mono|courier|consol|typewriter/.test(psName) || /^(cmtt|cmitt|sftt)/.test(psName) || /^lmmono/.test(psName);
  const sansFromName = /arial|helvetica|verdana|tahoma|geneva|calibri|segoe|trebuchet|candara|corbel|franklin|myriad|univers|frutiger|gill|futura/.test(psName);
  const serifFromName =
    /times|georgia|garamond|cambria|book|roman|minion|palatino|century|baskerville|nimbusrom|libertin|charter|utopia|constantia|texgyre(termes|pagella|schola|bonum)/.test(
      psName,
    );
  const mono = monoFromName || (!latex && !sansFromName && !serifFromName && /\bmonospace\b/.test(family));
  const sansLatex = /^(cmss|sfss)/.test(psName) || /^lmsans/.test(psName);
  const serif =
    !mono &&
    !sansFromName &&
    !sansLatex &&
    (serifFromName || ((isCM || isLM || isSF) && !sansLatex) || (family.includes('serif') && !family.includes('sans')));

  // Computer Modern / Latin Modern roman text gets the real Latin Modern
  // faces (metric-compatible with LaTeX output), including true small caps.
  const fontId: FontId =
    latex && !mono && !sansLatex
      ? smallCaps
        ? 'latin-modern-caps'
        : 'latin-modern'
      : mono
        ? 'roboto-mono'
        : serif
          ? 'noto-serif'
          : 'noto-sans';
  const ascent = clamp(font?.ascent ?? style?.ascent ?? 0.9, 0.6, 1.2);
  const descent = clamp(Math.abs(font?.descent ?? style?.descent ?? 0.22), 0.1, 0.45);
  const pdfFamily = font?.cssFontInfo?.fontFamily || font?.loadedName || fontName;
  const pdfFaceWeight = font?.cssFontInfo?.fontWeight ?? 400;
  return { bold, italic, fontId, ascent, descent, smallCaps, cssFamily: cssFamilyFromPs(psName), pdfFamily, pdfFaceWeight };
}

/** Map a PostScript name onto an installed CSS family when the OS likely has it. */
function cssFamilyFromPs(psName: string): string | undefined {
  if (/times/.test(psName)) return 'Times New Roman';
  if (/verdana/.test(psName)) return 'Verdana';
  if (/arial/.test(psName)) return 'Arial';
  if (/helvetica/.test(psName)) return 'Helvetica';
  if (/courier/.test(psName)) return 'Courier New';
  if (/georgia/.test(psName)) return 'Georgia';
  if (/garamond/.test(psName)) return 'Garamond';
  if (/palatino|bookantiqua/.test(psName)) return 'Palatino';
  if (/tahoma/.test(psName)) return 'Tahoma';
  if (/trebuchet/.test(psName)) return 'Trebuchet MS';
  if (/calibri/.test(psName)) return 'Calibri';
  if (/cambria/.test(psName)) return 'Cambria';
  if (/candara/.test(psName)) return 'Candara';
  if (/consolas/.test(psName)) return 'Consolas';
  if (/comic/.test(psName)) return 'Comic Sans MS';
  if (/impact/.test(psName)) return 'Impact';
  if (/symbol/.test(psName)) return 'Symbol';
  if (/wingding/.test(psName)) return 'Wingdings';
  return undefined;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface SampledColors {
  /** Dominant dark (ink) colour as #rrggbb. */
  ink: string;
  /** Dominant light (paper) colour as #rrggbb. */
  paper: string;
}

/**
 * Sample the rendered page bitmap under a line to recover its text colour
 * and background colour (PDF.js text content carries no colour info).
 */
export function sampleLineColors(canvas: HTMLCanvasElement, line: TextLine, pageWidth: number): SampledColors {
  const fallback = { ink: '#000000', paper: '#ffffff' };
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width) return fallback;
  const scale = canvas.width / pageWidth;
  const pad = Math.max(1, Math.ceil(line.fontSize * 0.08 * scale));
  const x = Math.max(0, Math.floor(line.left * scale) - pad);
  const y = Math.max(0, Math.floor(line.top * scale) - pad);
  const w = Math.min(canvas.width - x, Math.ceil(line.width * scale) + pad * 2);
  const h = Math.min(canvas.height - y, Math.ceil(line.height * scale) + pad * 2);
  if (w <= 0 || h <= 0) return fallback;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return fallback;
  }
  const dark = new Map<number, number>();
  const light = new Map<number, number>();
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    // Quantise to 16 levels so anti-aliased pixels vote for the same colour.
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    // Ignore mid-greys (anti-aliased glyph edges) so ink stays the true dark
    // of the printed text instead of a washed-out grey overlay.
    const bucket = lum < 140 ? dark : lum > 225 ? light : null;
    if (bucket) bucket.set(key, (bucket.get(key) ?? 0) + 1);
  }
  const pick = (m: Map<number, number>, def: string) => {
    let best = -1;
    let key = -1;
    m.forEach((count, k) => {
      if (count > best) {
        best = count;
        key = k;
      }
    });
    if (key < 0) return def;
    const r = ((key >> 8) & 15) * 17;
    const g = ((key >> 4) & 15) * 17;
    const b = (key & 15) * 17;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  };
  return { ink: normalizeInk(pick(dark, fallback.ink)), paper: normalizePaper(pick(light, fallback.paper)) };
}

/** Body text on a white page is black; grey ink makes the overlay look highlighted. */
function normalizeInk(hex: string): string {
  const n = hex.replace('#', '');
  if (n.length < 6) return '#000000';
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 40 ? '#000000' : hex;
}

/** Glyph anti-alias samples as off-white; a grey white-out looks like a highlight. */
function normalizePaper(hex: string): string {
  const n = hex.replace('#', '');
  if (n.length < 6) return '#ffffff';
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 230 ? '#ffffff' : hex;
}

/**
 * True when the printed glyphs are visually bold (Times Bold, Word fake-bold,
 * fill+stroke) even if the font name does not say so. Scans stem width at
 * x-height; Regular Times is ~0.08em, Bold ~0.14em.
 */
export function sampleLineLooksBold(canvas: HTMLCanvasElement, line: TextLine, pageWidth: number): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width || line.fontSize < 4) return false;
  const scale = canvas.width / pageWidth;
  const em = line.fontSize * scale;
  if (em < 4) return false;
  const x = Math.max(0, Math.floor(line.left * scale));
  const w = Math.min(canvas.width - x, Math.ceil(line.width * scale));
  if (w < 12) return false;
  const stems: number[] = [];
  for (const frac of [0.28, 0.38, 0.48]) {
    const y = Math.floor((line.baseline - line.fontSize * frac) * scale);
    if (y < 0 || y >= canvas.height) continue;
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(x, y, w, 1).data;
    } catch {
      continue;
    }
    let run = 0;
    for (let col = 0; col < w; col += 1) {
      const i = col * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 110) run += 1;
      else if (run) {
        stems.push(run);
        run = 0;
      }
    }
    if (run) stems.push(run);
  }
  const stemRuns = stems.filter((s) => s >= 1 && s <= em * 0.32);
  if (stemRuns.length >= 3) {
    stemRuns.sort((a, b) => a - b);
    const median = stemRuns[Math.floor(stemRuns.length / 2)];
    if (median / em >= 0.095) return true;
  }
  // Fallback: bold lines put more ink in the bbox than Regular Times.
  const y0 = Math.max(0, Math.floor((line.baseline - line.fontSize * 0.7) * scale));
  const y1 = Math.min(canvas.height, Math.ceil((line.baseline + line.fontSize * 0.05) * scale));
  const h = y1 - y0;
  if (h < 2 || w < 12) return false;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y0, w, h).data;
  } catch {
    return false;
  }
  let inked = 0;
  for (let i = 0; i < data.length; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 140) inked += 1;
  }
  return inked / (w * h) >= 0.13;
}

/**
 * Detect a drawn underline (e.g. a hyperlink) by scanning the strip just
 * below the baseline: a line is present when most columns contain ink.
 */
export function detectUnderline(canvas: HTMLCanvasElement, line: TextLine, pageWidth: number): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width) return false;
  const scale = canvas.width / pageWidth;
  const x = Math.max(0, Math.floor(line.left * scale));
  const w = Math.min(canvas.width - x, Math.ceil(line.width * scale));
  const y = Math.floor((line.baseline + line.fontSize * 0.04) * scale);
  const h = Math.max(1, Math.ceil(line.fontSize * 0.2 * scale));
  if (w < 4 || y < 0 || y + h > canvas.height) return false;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x, y, w, h).data;
  } catch {
    return false;
  }
  // Descenders also put ink below the baseline, but only in a few columns;
  // an underline covers (nearly) every column with a thin, dense row.
  let best = 0;
  for (let row = 0; row < h; row += 1) {
    let inked = 0;
    for (let col = 0; col < w; col += 1) {
      const i = (row * w + col) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < 160) inked += 1;
    }
    best = Math.max(best, inked / w);
  }
  return best > 0.85;
}
