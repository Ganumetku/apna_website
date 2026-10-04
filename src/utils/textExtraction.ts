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
 * When the user clicks a line we cover the original with a white-out box and
 * place a Textbox with the same text, size, colour and a matching font
 * (serif / sans / mono + bold / italic). Fonts embedded in PDFs are almost
 * always *subsets* (only the glyphs actually used), so they cannot be reused
 * for typing new characters — substituting a full font is what every
 * in-browser editor, including iLovePDF, does.
 */

/** A slice of a line that shares one weight and style ("Framework:" bold, the rest regular). */
export interface TextSpan {
  text: string;
  bold: boolean;
  italic: boolean;
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
}

interface FontFlags {
  bold: boolean;
  italic: boolean;
  fontId: FontId;
  ascent: number;
  descent: number;
  /** Font is a small-caps face (e.g. CMCSC10); we emulate it with uppercase. */
  smallCaps: boolean;
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

async function extract(proxy: PDFDocumentProxy, info: PageInfo): Promise<{ lines: TextLine[]; complete: boolean }> {
  const page = await proxy.getPage(info.index + 1);
  const content = await page.getTextContent({ includeMarkedContent: false, disableNormalization: false });
  const flagsCache = new Map<string, FontFlags>();
  const runs: Run[] = [];
  let complete = true;

  for (const item of content.items as TextItem[]) {
    if (!('str' in item)) continue;
    if (!item.str.trim() && !item.hasEOL) continue;
    // user space -> display points (applies the page /Rotate and Y flip)
    const m = Util.transform(info.viewportTransform, item.transform) as Matrix;
    const [a, b, c, d, e, f] = m;
    // Only axis-aligned, upright text is editable in place.
    if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0 || d >= 0) continue;
    const fontSize = Math.hypot(c, d);
    if (fontSize < 1) continue;
    let flags = flagsCache.get(item.fontName);
    if (!flags) {
      if (!page.commonObjs.has(item.fontName)) complete = false;
      flags = resolveFlags(page, item.fontName, content.styles[item.fontName]?.fontFamily);
      flagsCache.set(item.fontName, flags);
    }
    runs.push({
      text: item.str,
      x: e,
      right: e + item.width,
      baseline: f,
      fontSize,
      fontName: item.fontName,
      flags,
      hasEOL: item.hasEOL,
    });
  }

  // Group runs on the same baseline that are close enough into a line.
  runs.sort((p, q) => p.baseline - q.baseline || p.x - q.x);
  const lines: TextLine[] = [];
  let current: Run[] = [];

  const flush = () => {
    if (current.length) lines.push(buildLine(current, info.index, lines.length));
    current = [];
  };

  for (const run of runs) {
    const last = current[current.length - 1];
    if (last) {
      const sameBaseline = Math.abs(run.baseline - last.baseline) <= Math.max(last.fontSize, run.fontSize) * 0.3;
      const gap = run.x - last.right;
      const close = gap <= Math.max(last.fontSize, run.fontSize) * 1.2 && gap > -last.fontSize * 0.5;
      // Bold and italic stay on the same line (a label like "Framework:" next to
      // regular text). Their difference is kept as spans, not as a line break.
      const sameStyle = run.flags.fontId === last.flags.fontId && Math.abs(run.fontSize - last.fontSize) < 0.75;
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
  for (const r of runs) {
    let piece = r.text;
    const prev = raw[raw.length - 1];
    // Insert a space when the PDF positions a word without one.
    if (prev && r.x - right > r.fontSize * 0.15 && !/\s$/.test(prev.text) && !/^\s/.test(piece)) piece = ` ${piece}`;
    if (prev && prev.bold === r.flags.bold && prev.italic === r.flags.italic) prev.text += piece;
    else raw.push({ text: piece, bold: r.flags.bold, italic: r.flags.italic });
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
    left: first.x,
    top,
    width: right - first.x,
    height: bottom - top,
    baseline,
    fontSize,
    fontId: first.flags.fontId,
    bold,
    italic,
    smallCaps: first.flags.smallCaps,
    fontName: first.fontName,
  };
}

/** Collapse whitespace (including across span boundaries) and drop empty spans. */
function normalizeSpans(spans: TextSpan[]): TextSpan[] {
  const chars: Array<{ ch: string; bold: boolean; italic: boolean }> = [];
  let prevSpace = true;
  for (const span of spans) {
    for (const ch of span.text) {
      if (/\s/.test(ch)) {
        if (prevSpace) continue;
        chars.push({ ch: ' ', bold: span.bold, italic: span.italic });
        prevSpace = true;
      } else {
        chars.push({ ch, bold: span.bold, italic: span.italic });
        prevSpace = false;
      }
    }
  }
  while (chars.length && chars[chars.length - 1].ch === ' ') chars.pop();
  const out: TextSpan[] = [];
  for (const c of chars) {
    const prev = out[out.length - 1];
    if (prev && prev.bold === c.bold && prev.italic === c.italic) prev.text += c.ch;
    else out.push({ text: c.ch, bold: c.bold, italic: c.italic });
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
  ascent?: number;
  descent?: number;
}

/**
 * Map a PDF font onto one of our bundled families. Uses the flags PDF.js
 * derives from the font descriptor (available once the page has rendered)
 * plus the PostScript name as a hint ("CMBX12" = Computer Modern bold, …).
 */
function resolveFlags(page: PDFPageProxy, fontName: string, fallbackFamily?: string): FontFlags {
  let font: PdfJsFont | undefined;
  try {
    if (page.commonObjs.has(fontName)) font = page.commonObjs.get(fontName) as PdfJsFont;
  } catch {
    font = undefined;
  }
  // Strip the subset tag ("ABCDEF+CMBX12" -> "cmbx12").
  const psName = (font?.name ?? '').replace(/^[A-Z]{6}\+/, '').toLowerCase();
  const family = (font?.fallbackName ?? fallbackFamily ?? '').toLowerCase();

  // LaTeX fonts: Computer Modern (cmr, cmbx, cmti, cmcsc, cmss, cmtt…),
  // Latin Modern (lmroman10-bold, lmsans, lmmono, lmromancaps…), SF (sfrm…).
  const isCM = /^cm[a-z]{1,4}\d/.test(psName);
  const isLM = /^lm(roman|sans|mono)/.test(psName);
  const isSF = /^sf(rm|bx|ti|sc|ss|tt)/.test(psName);

  const bold =
    !!(font?.bold || font?.black) ||
    /bold|black|heavy|semibold|demibold|-b\b|,b\b/.test(psName) ||
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
  const mono = /mono|courier|consol|typewriter/.test(psName) || /^(cmtt|cmitt|sftt)/.test(psName) || /^lmmono/.test(psName) || (!latex && family.includes('mono'));
  const sansLatex = /^(cmss|sfss)/.test(psName) || /^lmsans/.test(psName);
  const serif =
    !mono &&
    !sansLatex &&
    (((isCM || isLM || isSF) && !sansLatex) ||
      (family.includes('serif') && !family.includes('sans')) ||
      /times|georgia|garamond|cambria|book|roman|minion|palatino|century|baskerville|nimbusrom|libertin|charter|utopia|texgyre(termes|pagella|schola|bonum)/.test(
        psName,
      ));

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
  const ascent = clamp(font?.ascent ?? 0.9, 0.6, 1.2);
  const descent = clamp(Math.abs(font?.descent ?? 0.22), 0.1, 0.45);
  return { bold, italic, fontId, ascent, descent, smallCaps };
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
  const fallback = { ink: '#111111', paper: '#ffffff' };
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas.width) return fallback;
  const scale = canvas.width / pageWidth;
  const x = Math.max(0, Math.floor(line.left * scale));
  const y = Math.max(0, Math.floor(line.top * scale));
  const w = Math.min(canvas.width - x, Math.ceil(line.width * scale));
  const h = Math.min(canvas.height - y, Math.ceil(line.height * scale));
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
    const bucket = lum < 150 ? dark : lum > 225 ? light : null;
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
  return { ink: pick(dark, fallback.ink), paper: pick(light, fallback.paper) };
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
