import { cache } from 'fabric';
import type { FontId } from '../types';

import notoSansRegular from '@expo-google-fonts/noto-sans/400Regular/NotoSans_400Regular.ttf?url';
import notoSansBold from '@expo-google-fonts/noto-sans/700Bold/NotoSans_700Bold.ttf?url';
import notoSansItalic from '@expo-google-fonts/noto-sans/400Regular_Italic/NotoSans_400Regular_Italic.ttf?url';
import notoSansBoldItalic from '@expo-google-fonts/noto-sans/700Bold_Italic/NotoSans_700Bold_Italic.ttf?url';
import notoSerifRegular from '@expo-google-fonts/noto-serif/400Regular/NotoSerif_400Regular.ttf?url';
import notoSerifBold from '@expo-google-fonts/noto-serif/700Bold/NotoSerif_700Bold.ttf?url';
import notoSerifItalic from '@expo-google-fonts/noto-serif/400Regular_Italic/NotoSerif_400Regular_Italic.ttf?url';
import notoSerifBoldItalic from '@expo-google-fonts/noto-serif/700Bold_Italic/NotoSerif_700Bold_Italic.ttf?url';
import robotoMonoRegular from '@expo-google-fonts/roboto-mono/400Regular/RobotoMono_400Regular.ttf?url';
import robotoMonoBold from '@expo-google-fonts/roboto-mono/700Bold/RobotoMono_700Bold.ttf?url';
import robotoMonoItalic from '@expo-google-fonts/roboto-mono/400Regular_Italic/RobotoMono_400Regular_Italic.ttf?url';
import robotoMonoBoldItalic from '@expo-google-fonts/roboto-mono/700Bold_Italic/RobotoMono_700Bold_Italic.ttf?url';
import poppinsRegular from '@expo-google-fonts/poppins/400Regular/Poppins_400Regular.ttf?url';
import poppinsBold from '@expo-google-fonts/poppins/700Bold/Poppins_700Bold.ttf?url';
import poppinsItalic from '@expo-google-fonts/poppins/400Regular_Italic/Poppins_400Regular_Italic.ttf?url';
import poppinsBoldItalic from '@expo-google-fonts/poppins/700Bold_Italic/Poppins_700Bold_Italic.ttf?url';
import devanagariRegular from '@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf?url';
import devanagariBold from '@expo-google-fonts/noto-sans-devanagari/700Bold/NotoSansDevanagari_700Bold.ttf?url';
// Latin Modern = OpenType version of LaTeX's Computer Modern (GUST Font License).
import lmRomanRegular from '../assets/fonts/latin-modern/lmroman10-regular.otf?url';
import lmRomanBold from '../assets/fonts/latin-modern/lmroman10-bold.otf?url';
import lmRomanItalic from '../assets/fonts/latin-modern/lmroman10-italic.otf?url';
import lmRomanBoldItalic from '../assets/fonts/latin-modern/lmroman10-bolditalic.otf?url';
import lmCapsRegular from '../assets/fonts/latin-modern/lmromancaps10-regular.otf?url';
import lmCapsOblique from '../assets/fonts/latin-modern/lmromancaps10-oblique.otf?url';

/*
 * FONT STRATEGY
 * The exact same TTF files are (a) registered in the browser via FontFace so
 * Fabric measures and draws text with them, and (b) embedded into the PDF
 * with pdf-lib + fontkit. Same glyphs, same metrics => the exported text
 * wraps and aligns like it did on screen.
 *
 * Families without Devanagari glyphs get "Noto Sans Devanagari" as a CSS
 * fallback; the exporter mirrors that by splitting text into runs and
 * drawing Devanagari runs with the fallback font.
 */

export type VariantKey = 'regular' | 'bold' | 'italic' | 'boldItalic';

export interface FontFamilyDef {
  id: FontId;
  label: string;
  /** CSS family name registered with FontFace. */
  family: string;
  /** Has its own Devanagari (Hindi, Marathi, Nepali…) glyphs. */
  devanagari: boolean;
  /**
   * Whether fontkit's subsetter can be used on export. It silently drops
   * glyphs from the large multi-script Noto Sans / Noto Serif files, so those
   * are embedded whole (pdf-lib flate-compresses them, ≈300 KB per face).
   * Note pdf-lib only runs OpenType shaping (needed for Devanagari conjuncts)
   * when subsetting, so Devanagari runs are always drawn with a subset-safe font.
   */
  subsetSafe: boolean;
  /** Glyphs are already small caps (lowercase input renders as small capitals). */
  smallCaps?: boolean;
  files: Partial<Record<VariantKey, string>> & { regular: string };
  /** Hint shown in the font picker. */
  sample?: string;
}

export const FONT_FAMILIES: FontFamilyDef[] = [
  {
    id: 'noto-sans',
    label: 'Noto Sans',
    family: 'Noto Sans',
    devanagari: false,
    subsetSafe: false,
    files: { regular: notoSansRegular, bold: notoSansBold, italic: notoSansItalic, boldItalic: notoSansBoldItalic },
  },
  {
    id: 'noto-serif',
    label: 'Noto Serif',
    family: 'Noto Serif',
    devanagari: false,
    subsetSafe: false,
    files: { regular: notoSerifRegular, bold: notoSerifBold, italic: notoSerifItalic, boldItalic: notoSerifBoldItalic },
  },
  {
    id: 'roboto-mono',
    label: 'Roboto Mono',
    family: 'Roboto Mono',
    devanagari: false,
    subsetSafe: true,
    files: { regular: robotoMonoRegular, bold: robotoMonoBold, italic: robotoMonoItalic, boldItalic: robotoMonoBoldItalic },
  },
  {
    id: 'latin-modern',
    label: 'Latin Modern (LaTeX)',
    family: 'Latin Modern Roman',
    devanagari: false,
    subsetSafe: false,
    files: { regular: lmRomanRegular, bold: lmRomanBold, italic: lmRomanItalic, boldItalic: lmRomanBoldItalic },
  },
  {
    id: 'latin-modern-caps',
    label: 'Latin Modern Small Caps',
    family: 'Latin Modern Roman Caps',
    devanagari: false,
    subsetSafe: false,
    smallCaps: true,
    files: { regular: lmCapsRegular, italic: lmCapsOblique },
  },
  {
    id: 'poppins',
    label: 'Poppins (Latin + हिन्दी)',
    family: 'Poppins',
    devanagari: true,
    subsetSafe: true,
    files: { regular: poppinsRegular, bold: poppinsBold, italic: poppinsItalic, boldItalic: poppinsBoldItalic },
  },
  {
    id: 'noto-sans-devanagari',
    label: 'Noto Sans Devanagari (हिन्दी)',
    family: 'Noto Sans Devanagari',
    devanagari: true,
    subsetSafe: true,
    files: { regular: devanagariRegular, bold: devanagariBold },
  },
];

export const DEVANAGARI_FALLBACK_ID: FontId = 'noto-sans-devanagari';
/** Browsers synthesise a missing italic face with roughly a 14° oblique (tan ≈ 0.25). */
export const SYNTHETIC_ITALIC_SKEW = 0.25;

const byId = new Map(FONT_FAMILIES.map((f) => [f.id, f]));
const byFamily = new Map(FONT_FAMILIES.map((f) => [f.family.toLowerCase(), f]));

export function getFontDef(id: FontId): FontFamilyDef {
  return byId.get(id) ?? FONT_FAMILIES[0];
}

/** CSS font-family stack stored on Fabric text objects. */
export function fontStack(id: FontId): string {
  const def = getFontDef(id);
  const fallback = getFontDef(DEVANAGARI_FALLBACK_ID);
  return def.devanagari ? `"${def.family}"` : `"${def.family}", "${fallback.family}"`;
}

/**
 * Overlay stack for a PDF line. The PDF.js FontFace (`g_d0_f*`) comes first so
 * glyphs that exist in the subset match the printed page exactly. New letters
 * fall through to the OS face (Times New Roman, Verdana, …) then Noto.
 */
export function overlayFontStack(id: FontId, cssFamily?: string, pdfFamily?: string): string {
  const fallback = fontStack(id);
  const parts: string[] = [];
  const pdf = pdfFamily?.trim();
  const css = cssFamily?.trim();
  if (pdf) parts.push(`"${pdf}"`);
  if (css && css.toLowerCase() !== pdf?.toLowerCase()) parts.push(`"${css}"`);
  parts.push(fallback);
  return parts.join(', ');
}

/** Wait until PDF.js has registered the page's FontFace. */
export async function loadPdfFace(family: string | undefined, size = 16): Promise<void> {
  const name = family?.trim();
  if (!name) return;
  const px = `${Math.max(12, Math.round(size))}px`;
  try {
    await Promise.all([document.fonts.load(`${px} "${name}"`), document.fonts.load(`normal 400 ${px} "${name}"`)]);
    cache.clearFontCache(name);
  } catch {
    /* OS / Noto fallback still works */
  }
}

/** Load the OS face at the weight/style the overlay will actually paint. */
export function loadCssFamily(cssFamily: string, bold: boolean, italic: boolean, size = 16): Promise<void> {
  const name = cssFamily.trim();
  if (!name) return Promise.resolve();
  const weight = bold ? '700' : '400';
  const style = italic ? 'italic' : 'normal';
  const px = `${Math.max(12, Math.round(size))}px`;
  return Promise.all([
    document.fonts.load(`${style} ${weight} ${px} "${name}"`),
    document.fonts.load(`${weight} ${px} "${name}"`),
    document.fonts.load(`${style} ${px} "${name}"`),
  ])
    .then(() => {
      cache.clearFontCache(name);
    })
    .catch(() => undefined);
}

/** Inverse of `fontStack`: first bundled family in the CSS stack. */
export function fontDefFromStack(stack: unknown): FontFamilyDef {
  if (typeof stack !== 'string') return FONT_FAMILIES[0];
  for (const part of stack.split(',')) {
    const name = part.trim().replace(/^["']|["']$/g, '').toLowerCase();
    const found = byFamily.get(name);
    if (found) return found;
  }
  return FONT_FAMILIES[0];
}

export interface ResolvedVariant {
  url: string;
  key: VariantKey;
  /** The family has no italic face; draw the regular face with a skew. */
  syntheticItalic: boolean;
}

export function resolveVariant(def: FontFamilyDef, bold: boolean, italic: boolean): ResolvedVariant {
  const wanted: VariantKey = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
  const chain: VariantKey[] =
    wanted === 'boldItalic' ? ['boldItalic', 'bold', 'italic', 'regular'] : wanted === 'italic' ? ['italic', 'regular'] : [wanted, 'regular'];
  for (const key of chain) {
    const url = def.files[key];
    if (url) {
      const hasItalic = key === 'italic' || key === 'boldItalic';
      return { url, key, syntheticItalic: italic && !hasItalic };
    }
  }
  return { url: def.files.regular, key: 'regular', syntheticItalic: italic };
}

/* ---------------------------------------------------------------- browser */

const faceLoads = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** Notified whenever a new face finishes loading so Fabric can re-measure text. */
export function onFontsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function loadFace(def: FontFamilyDef, key: VariantKey): Promise<void> {
  const url = def.files[key];
  if (!url) return Promise.resolve();
  const cacheKey = `${def.id}:${key}`;
  let promise = faceLoads.get(cacheKey);
  if (!promise) {
    const face = new FontFace(def.family, `url(${url})`, {
      weight: key === 'bold' || key === 'boldItalic' ? '700' : '400',
      style: key === 'italic' || key === 'boldItalic' ? 'italic' : 'normal',
      display: 'block',
    });
    promise = face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded);
        // Fabric caches glyph widths per family; stale widths break wrapping.
        cache.clearFontCache(def.family);
        listeners.forEach((cb) => cb());
      })
      .catch((err) => {
        faceLoads.delete(cacheKey);
        console.warn(`Font ${def.family} (${key}) failed to load`, err);
      });
    faceLoads.set(cacheKey, promise);
  }
  return promise;
}

/** Make sure the face (and the Devanagari fallback) used by a text style is ready. */
export function ensureFont(id: FontId, bold: boolean, italic: boolean): Promise<void> {
  const def = getFontDef(id);
  const loads = [loadFace(def, resolveVariant(def, bold, italic).key)];
  if (!def.devanagari) {
    const fb = getFontDef(DEVANAGARI_FALLBACK_ID);
    loads.push(loadFace(fb, resolveVariant(fb, bold, italic).key));
  }
  return Promise.all(loads).then(() => undefined);
}

/** Load the faces needed by the given serialized text objects. */
export function ensureFontsForObjects(objects: Array<Record<string, unknown>>): Promise<void> {
  const loads: Promise<void>[] = [];
  for (const o of objects) {
    if (o.kind !== 'text') continue;
    const def = fontDefFromStack(o.fontFamily);
    const baseBold = isBold(o.fontWeight);
    const baseItalic = o.fontStyle === 'italic';
    loads.push(ensureFont(def.id, baseBold, baseItalic));
    // Serialized Fabric styles are ranges: { start, end, style }.
    if (Array.isArray(o.styles)) {
      for (const range of o.styles) {
        const style = (range as { style?: Record<string, unknown> }).style;
        if (!style) continue;
        const id = typeof style.fontFamily === 'string' ? fontDefFromStack(style.fontFamily).id : def.id;
        loads.push(
          ensureFont(
            id,
            style.fontWeight !== undefined ? isBold(style.fontWeight) : baseBold,
            style.fontStyle !== undefined ? style.fontStyle === 'italic' : baseItalic,
          ),
        );
      }
    }
  }
  return Promise.all(loads).then(() => undefined);
}

/**
 * Warm the default family's faces and the Devanagari fallback in the
 * background. Other families (≈0.1–0.6 MB per face) load when first picked.
 */
export function preloadFonts(id: FontId): void {
  const run = () => {
    for (const def of [getFontDef(id), getFontDef(DEVANAGARI_FALLBACK_ID)]) {
      (Object.keys(def.files) as VariantKey[]).forEach((k) => void loadFace(def, k));
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
}

export function isBold(weight: unknown): boolean {
  if (typeof weight === 'number') return weight >= 600;
  if (typeof weight === 'string') return weight === 'bold' || weight === 'bolder' || Number(weight) >= 600;
  return false;
}

/* ---------------------------------------------------------------- export */

const byteCache = new Map<string, Promise<ArrayBuffer>>();

export function getFontBytes(url: string): Promise<ArrayBuffer> {
  let p = byteCache.get(url);
  if (!p) {
    p = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`Failed to fetch font ${url}`);
      return r.arrayBuffer();
    });
    p.catch(() => byteCache.delete(url));
    byteCache.set(url, p);
  }
  return p;
}

const DEVANAGARI_RE = /[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]/;
/** Characters that inherit the font of their neighbours (spaces, joiners, punctuation, digits). */
const NEUTRAL_RE = /[\s\u200B-\u200D\u2060\p{P}\p{N}]/u;

export interface TextRun {
  text: string;
  devanagari: boolean;
}

/**
 * Split a line into script runs. Devanagari is always shaped on its own:
 * fontkit's Indic shaper mis-orders matras when Latin text is in the same
 * layout call, and the run may also need a different (fallback) font.
 * Neutral characters (spaces, digits, punctuation) stick to the surrounding
 * run to avoid needless font switches.
 */
export function splitRuns(line: string): TextRun[] {
  if (!DEVANAGARI_RE.test(line)) return line ? [{ text: line, devanagari: false }] : [];
  const runs: TextRun[] = [];
  for (const ch of line) {
    const last = runs[runs.length - 1];
    const neutral = NEUTRAL_RE.test(ch);
    const devanagari = neutral && last ? last.devanagari : DEVANAGARI_RE.test(ch);
    if (last && last.devanagari === devanagari) last.text += ch;
    else runs.push({ text: ch, devanagari });
  }
  return runs;
}

/** The font to draw a run with: Devanagari needs a shaping-capable (subset-safe) Devanagari font. */
export function fontForRun(def: FontFamilyDef, run: TextRun): FontFamilyDef {
  if (!run.devanagari) return def;
  return def.devanagari && def.subsetSafe ? def : getFontDef(DEVANAGARI_FALLBACK_ID);
}
