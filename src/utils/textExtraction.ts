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

  // 1. Identify paper (background) color.
  // Perimeter pixels (outer edges of the padded box) have minimal/no glyph ink
  // and represent the true background (paper, watermark, table cell, or shading).
  const paperBins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const addPaper = (r: number, g: number, b: number, weight: number) => {
    // 32 levels per channel (5 bits)
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let bin = paperBins.get(key);
    if (!bin) {
      bin = { count: 0, r: 0, g: 0, b: 0 };
      paperBins.set(key, bin);
    }
    bin.count += weight;
    bin.r += r * weight;
    bin.g += g * weight;
    bin.b += b * weight;
  };

  for (let row = 0; row < h; row += 1) {
    const isPerimRow = row < 2 || row >= h - 2;
    for (let col = 0; col < w; col += 1) {
      const idx = (row * w + col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const isPerim = isPerimRow || col < 2 || col >= w - 2;
      addPaper(r, g, b, isPerim ? 4 : 1);
    }
  }

  let bestPaper: { count: number; r: number; g: number; b: number } | null = null;
  for (const bin of paperBins.values()) {
    if (!bestPaper || bin.count > bestPaper.count) bestPaper = bin;
  }

  let pr = 255;
  let pg = 255;
  let pb = 255;
  if (bestPaper && bestPaper.count > 0) {
    pr = Math.round(bestPaper.r / bestPaper.count);
    pg = Math.round(bestPaper.g / bestPaper.count);
    pb = Math.round(bestPaper.b / bestPaper.count);
    // Snap to pure white only if extremely close to pure white (avoid tinting white pages)
    if (pr >= 252 && pg >= 252 && pb >= 252) {
      pr = 255;
      pg = 255;
      pb = 255;
    }
  }
  const paper = `#${[pr, pg, pb].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

  // 2. Identify ink (text) color.
  // Look for pixels in the box that contrast significantly with the chosen background.
  const inkBins = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      const idx = (row * w + col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const distSq = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      // Distance threshold excludes subtle paper grain and light watermark transitions
      if (distSq > 2000) {
        // Higher contrast pixels get higher weight so dark ink beats faint watermark noise
        const weight = Math.min(10, Math.max(1, Math.floor(distSq / 1000)));
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let bin = inkBins.get(key);
        if (!bin) {
          bin = { count: 0, r: 0, g: 0, b: 0 };
          inkBins.set(key, bin);
        }
        bin.count += weight;
        bin.r += r * weight;
        bin.g += g * weight;
        bin.b += b * weight;
      }
    }
  }

  let bestInk: { count: number; r: number; g: number; b: number } | null = null;
  for (const bin of inkBins.values()) {
    if (!bestInk || bin.count > bestInk.count) bestInk = bin;
  }

  let ink = fallback.ink;
  if (bestInk && bestInk.count > 0) {
    let ir = Math.round(bestInk.r / bestInk.count);
    let ig = Math.round(bestInk.g / bestInk.count);
    let ib = Math.round(bestInk.b / bestInk.count);
    const lum = 0.299 * ir + 0.587 * ig + 0.114 * ib;
    // Snap dark neutral ink to clean black
    if (lum < 40 && Math.max(ir, ig, ib) - Math.min(ir, ig, ib) < 15) {
      ir = 0;
      ig = 0;
      ib = 0;
    }
    ink = `#${[ir, ig, ib].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }

  return { ink, paper };
}

/**
 * Remove/heal original printed glyphs on the underlying PDF canvas so the
 * background (paper, watermark, table cell) is left completely clean with
 * zero shadows, ghost outlines, or crosshatching artifacts.
 */
export function healLineOnCanvas(
  canvas: HTMLCanvasElement,
  line: { left: number; top?: number; width: number; height?: number; fontSize: number; baseline?: number },
  pageWidth: number,
  paperColorHint?: string,
): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width) return;
  const scale = canvas.width / pageWidth;
  const padX = Math.max(3, Math.ceil(line.fontSize * 0.25 * scale));
  const padY = Math.max(3, Math.ceil(line.fontSize * 0.25 * scale));

  const boxTop = line.top !== undefined ? line.top : (line.baseline ?? line.fontSize) - line.fontSize * 0.85;
  const boxHeight = line.height !== undefined ? line.height : line.fontSize * 1.25;

  const x = Math.max(0, Math.floor(line.left * scale) - padX);
  const y = Math.max(0, Math.floor(boxTop * scale) - padY);
  const w = Math.min(canvas.width - x, Math.ceil(line.width * scale) + padX * 2);
  const h = Math.min(canvas.height - y, Math.ceil(boxHeight * scale) + padY * 2);
  if (w <= 0 || h <= 0) return;

  let imgData: ImageData;
  try {
    imgData = ctx.getImageData(x, y, w, h);
  } catch {
    return;
  }
  const data = imgData.data;

  // 1. Determine dominant paper (background) color from perimeter pixels
  let pr = 255;
  let pg = 255;
  let pb = 255;
  let hasValidPaperHint = false;

  if (paperColorHint && paperColorHint.startsWith('#') && paperColorHint.length >= 7) {
    const hr = parseInt(paperColorHint.slice(1, 3), 16);
    const hg = parseInt(paperColorHint.slice(3, 5), 16);
    const hb = parseInt(paperColorHint.slice(5, 7), 16);
    if (!Number.isNaN(hr) && !Number.isNaN(hg) && !Number.isNaN(hb)) {
      pr = hr;
      pg = hg;
      pb = hb;
      hasValidPaperHint = true;
    }
  }

  const perimBins = new Map<number, { count: number; r: number; g: number; b: number }>();
  const perimThickness = Math.max(2, Math.min(6, Math.floor(padY * 0.75)));
  let perimCount = 0;

  for (let row = 0; row < h; row += 1) {
    const isPerimRow = row < perimThickness || row >= h - perimThickness;
    for (let col = 0; col < w; col += 1) {
      const isPerim = isPerimRow || col < perimThickness || col >= w - perimThickness;
      if (isPerim) {
        perimCount += 1;
        const idx = (row * w + col) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let bin = perimBins.get(key);
        if (!bin) {
          bin = { count: 0, r: 0, g: 0, b: 0 };
          perimBins.set(key, bin);
        }
        bin.count += 1;
        bin.r += r;
        bin.g += g;
        bin.b += b;
      }
    }
  }

  let bestBin: { count: number; r: number; g: number; b: number } | null = null;
  for (const bin of perimBins.values()) {
    if (!bestBin || bin.count > bestBin.count) bestBin = bin;
  }

  if (bestBin && bestBin.count > 0) {
    const sampledR = Math.round(bestBin.r / bestBin.count);
    const sampledG = Math.round(bestBin.g / bestBin.count);
    const sampledB = Math.round(bestBin.b / bestBin.count);

    if (!hasValidPaperHint || (pr === 255 && pg === 255 && pb === 255 && bestBin.count > perimCount * 0.3)) {
      pr = sampledR;
      pg = sampledG;
      pb = sampledB;
    }
  }

  if (pr >= 252 && pg >= 252 && pb >= 252) {
    pr = 255;
    pg = 255;
    pb = 255;
  }

  // 2. Check if the background is uniform (solid color)
  let uniformMatches = 0;
  for (let row = 0; row < h; row += 1) {
    const isPerimRow = row < perimThickness || row >= h - perimThickness;
    for (let col = 0; col < w; col += 1) {
      if (isPerimRow || col < perimThickness || col >= w - perimThickness) {
        const idx = (row * w + col) * 4;
        const distSq = (data[idx] - pr) ** 2 + (data[idx + 1] - pg) ** 2 + (data[idx + 2] - pb) ** 2;
        if (distSq <= 400) uniformMatches += 1;
      }
    }
  }
  const isUniformBg = perimCount > 0 && uniformMatches / perimCount >= 0.7;

  // 3. Mark ink pixels that contrast with the background
  const isInk = new Uint8Array(w * h);
  const bgLum = 0.299 * pr + 0.587 * pg + 0.114 * pb;

  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      const idx = (row * w + col) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const distSq = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (distSq >= 225 || Math.abs(lum - bgLum) >= 12) {
        isInk[row * w + col] = 1;
      }
    }
  }

  // 4. Dilate ink mask to completely consume subpixel anti-aliasing edges and font shadows
  const dilateRadius = Math.max(1, Math.min(2, Math.round(scale * 0.8)));
  const dilatedMask = new Uint8Array(w * h);
  for (let row = 0; row < h; row += 1) {
    for (let col = 0; col < w; col += 1) {
      if (isInk[row * w + col]) {
        for (let dr = -dilateRadius; dr <= dilateRadius; dr += 1) {
          const nr = row + dr;
          if (nr < 0 || nr >= h) continue;
          for (let dc = -dilateRadius; dc <= dilateRadius; dc += 1) {
            const nc = col + dc;
            if (nc >= 0 && nc < w) {
              dilatedMask[nr * w + nc] = 1;
            }
          }
        }
      }
    }
  }

  // 5. Clean / Inpaint
  if (isUniformBg) {
    // Solid background: fill ink + anti-aliased edge with the pure paper color
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        if (dilatedMask[row * w + col]) {
          const idx = (row * w + col) * 4;
          data[idx] = pr;
          data[idx + 1] = pg;
          data[idx + 2] = pb;
          data[idx + 3] = 255;
        }
      }
    }
  } else {
    // Non-uniform background (watermark / texture): 4-directional inverse-distance weighting
    for (let row = 0; row < h; row += 1) {
      for (let col = 0; col < w; col += 1) {
        const idx = row * w + col;
        if (dilatedMask[idx]) {
          let lCol = col - 1;
          while (lCol >= 0 && dilatedMask[row * w + lCol]) lCol -= 1;
          let rCol = col + 1;
          while (rCol < w && dilatedMask[row * w + rCol]) rCol += 1;

          let tRow = row - 1;
          while (tRow >= 0 && dilatedMask[tRow * w + col]) tRow -= 1;
          let bRow = row + 1;
          while (bRow < h && dilatedMask[bRow * w + col]) bRow += 1;

          let sumR = 0;
          let sumG = 0;
          let sumB = 0;
          let sumW = 0;

          if (lCol >= 0) {
            const d = col - lCol;
            const wgt = 1 / d;
            const p = (row * w + lCol) * 4;
            sumR += data[p] * wgt;
            sumG += data[p + 1] * wgt;
            sumB += data[p + 2] * wgt;
            sumW += wgt;
          }
          if (rCol < w) {
            const d = rCol - col;
            const wgt = 1 / d;
            const p = (row * w + rCol) * 4;
            sumR += data[p] * wgt;
            sumG += data[p + 1] * wgt;
            sumB += data[p + 2] * wgt;
            sumW += wgt;
          }
          if (tRow >= 0) {
            const d = row - tRow;
            const wgt = 1 / d;
            const p = (tRow * w + col) * 4;
            sumR += data[p] * wgt;
            sumG += data[p + 1] * wgt;
            sumB += data[p + 2] * wgt;
            sumW += wgt;
          }
          if (bRow < h) {
            const d = bRow - row;
            const wgt = 1 / d;
            const p = (bRow * w + col) * 4;
            sumR += data[p] * wgt;
            sumG += data[p + 1] * wgt;
            sumB += data[p + 2] * wgt;
            sumW += wgt;
          }

          const pIdx = idx * 4;
          if (sumW > 0) {
            data[pIdx] = Math.round(sumR / sumW);
            data[pIdx + 1] = Math.round(sumG / sumW);
            data[pIdx + 2] = Math.round(sumB / sumW);
          } else {
            data[pIdx] = pr;
            data[pIdx + 1] = pg;
            data[pIdx + 2] = pb;
          }
          data[pIdx + 3] = 255;
        }
      }
    }
  }

  ctx.putImageData(imgData, x, y);
}

/**
 * Extract a high-res image patch of the healed canvas under a line,
 * preserving watermarks, background patterns, or table cell shading for export.
 */
export function extractCanvasPatch(
  canvas: HTMLCanvasElement,
  line: { left: number; top?: number; width: number; height?: number; fontSize: number; baseline?: number },
  pageWidth: number,
): string | null {
  if (!canvas.width || !canvas.height) return null;
  const scale = canvas.width / pageWidth;
  const padX = Math.max(2, Math.ceil(line.fontSize * 0.12 * scale));
  const padY = Math.max(2, Math.ceil(line.fontSize * 0.12 * scale));

  const boxTop = line.top !== undefined ? line.top : (line.baseline ?? line.fontSize) - line.fontSize * 0.85;
  const boxHeight = line.height !== undefined ? line.height : line.fontSize * 1.25;

  const x = Math.max(0, Math.floor(line.left * scale) - padX);
  const y = Math.max(0, Math.floor(boxTop * scale) - padY);
  const w = Math.min(canvas.width - x, Math.ceil(line.width * scale) + padX * 2);
  const h = Math.min(canvas.height - y, Math.ceil(boxHeight * scale) + padY * 2);
  if (w <= 0 || h <= 0) return null;

  try {
    const patchCanvas = document.createElement('canvas');
    patchCanvas.width = w;
    patchCanvas.height = h;
    const pctx = patchCanvas.getContext('2d');
    if (!pctx) return null;
    pctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    return patchCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
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
