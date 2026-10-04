// fontkit's Indic (Devanagari) shaper is compiled with Babel's regenerator
// and expects a global `regeneratorRuntime`; without it Hindi text throws.
import 'regenerator-runtime/runtime';
import fontkit from '@pdf-lib/fontkit';
import { util, type FabricObject, type Line, type Path, type Textbox, type Ellipse, type FabricImage } from 'fabric';
import {
  BlendMode,
  EncryptedPDFError,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  concatTransformationMatrix,
  popGraphicsState,
  pushGraphicsState,
  setCharacterSpacing,
  setLineJoin,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import type { LoadedDocument, Matrix, PageObjects, SerializedObject } from '../types';
import { arrowGeometry } from './arrow';
import { parseColor } from './color';
import { displayToUserSpace, flipYMatrix, objectToUserSpace } from './coordinates';
import { dataUrlToBytes } from './file';
import {
  SYNTHETIC_ITALIC_SKEW,
  ensureFontsForObjects,
  fontDefFromStack,
  fontForRun,
  getFontBytes,
  isBold,
  resolveVariant,
  splitRuns,
  type FontFamilyDef,
} from './fonts';
import './fabric/setup';

/*
 * EXPORT PIPELINE
 *
 *   serialized objects (PDF display points)
 *     -> util.enlivenObjects()          real Fabric instances, off-screen
 *     -> obj.calcTransformMatrix()      object-local -> display points
 *     -> × inverse(viewport.transform)  display points -> PDF user space
 *     -> `q <matrix> cm … Q`            draw the object in its LOCAL frame
 *
 * Fabric's local frame is centred on the object with y pointing DOWN. Shapes
 * that are symmetric (rects, ellipses, lines, paths) can be drawn there
 * directly. Text and images are inherently "y up" in PDF, so for those we
 * add one more local flip ([1 0 0 -1 x y]) right before drawing.
 */

export interface ExportResult {
  bytes: Uint8Array;
  /** True when the source could not be edited in place (e.g. encrypted) and pages were rasterised. */
  flattened: boolean;
}

export type ExportProgress = (done: number, total: number) => void;

const RASTER_SCALE = 2; // ≈144 dpi for the flattened fallback
const MAX_RASTER_PIXELS = 16_000_000;

export async function exportPdf(doc: LoadedDocument, objects: PageObjects, onProgress?: ExportProgress): Promise<ExportResult> {
  const all = Object.values(objects).flat();
  // Text layout must be computed with the real fonts, exactly as on screen.
  await ensureFontsForObjects(all);
  await document.fonts.ready;

  let pdfDoc: PDFDocument;
  let flattened = false;
  try {
    pdfDoc = await PDFDocument.load(doc.bytes, { updateMetadata: false });
  } catch (err) {
    // pdf-lib cannot decrypt, and it is stricter than PDF.js with broken
    // files. In both cases fall back to rebuilding the PDF from rendered pages.
    if (!(err instanceof EncryptedPDFError)) console.warn('pdf-lib could not parse the file, flattening instead', err);
    pdfDoc = await PDFDocument.create();
    flattened = true;
  }
  pdfDoc.registerFontkit(fontkit);
  const fonts = new FontEmbedder(pdfDoc);
  const images = new Map<string, Promise<PDFImage>>();

  const total = doc.pages.length;
  for (let i = 0; i < total; i += 1) {
    const info = doc.pages[i];
    let page: PDFPage;
    let toUser: Matrix;

    if (flattened) {
      page = await addRasterPage(pdfDoc, doc, i);
      toUser = flipYMatrix(info.height);
    } else {
      page = pdfDoc.getPage(i);
      toUser = displayToUserSpace(info);
    }

    const serialized = objects[i];
    if (serialized?.length) {
      // Wraps the page's existing content in q…Q so any graphics state it
      // leaves behind (an unbalanced `cm`, say) cannot shift our drawings.
      page.node.normalize();
      const live = await util.enlivenObjects<FabricObject>(serialized as unknown as Record<string, unknown>[]);
      for (const obj of live) {
        await drawObject(page, obj, toUser, { fonts, images, pdfDoc });
      }
    }
    onProgress?.(i + 1, total);
    // Yield so the progress UI can repaint on big documents.
    if (i % 5 === 4) await new Promise((r) => setTimeout(r, 0));
  }

  pdfDoc.setProducer('Edit PDF Engine (pdf-lib)');
  pdfDoc.setModificationDate(new Date());
  const bytes = await pdfDoc.save({ useObjectStreams: true });
  return { bytes, flattened };
}

/* ------------------------------------------------------------------ objects */

interface DrawContext {
  pdfDoc: PDFDocument;
  fonts: FontEmbedder;
  images: Map<string, Promise<PDFImage>>;
}

async function drawObject(page: PDFPage, obj: FabricObject, toUser: Matrix, ctx: DrawContext) {
  if (!obj.visible || (obj.opacity ?? 1) <= 0) return;

  // The single most important line of the exporter: object-local -> PDF user space.
  const m = objectToUserSpace(toUser, obj.calcTransformMatrix() as Matrix);

  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...m));
  try {
    switch (obj.kind) {
      case 'rect':
      case 'highlight':
      case 'whiteout':
        drawRect(page, obj);
        break;
      case 'ellipse':
        drawEllipse(page, obj as Ellipse);
        break;
      case 'line':
      case 'underline':
      case 'strike':
        drawLine(page, obj as Line);
        break;
      case 'arrow':
        drawArrow(page, obj as Line);
        break;
      case 'path':
        drawPath(page, obj as Path);
        break;
      case 'text':
        await drawText(page, obj as Textbox, ctx.fonts);
        break;
      case 'image':
        await drawImage(page, obj as FabricImage, ctx);
        break;
      default:
        break;
    }
  } finally {
    page.pushOperators(popGraphicsState());
  }
}

function paint(obj: FabricObject) {
  const opacity = obj.opacity ?? 1;
  const fill = parseColor(obj.fill);
  const stroke = obj.strokeWidth > 0 ? parseColor(obj.stroke) : null;
  return { opacity, fill, stroke };
}

function lineCap(obj: FabricObject): LineCapStyle {
  if (obj.strokeLineCap === 'round') return LineCapStyle.Round;
  if (obj.strokeLineCap === 'square') return LineCapStyle.Projecting;
  return LineCapStyle.Butt;
}

/** Rects (and highlight / white-out). Local box is centred: [-w/2, w/2] × [-h/2, h/2]. */
function drawRect(page: PDFPage, obj: FabricObject) {
  const { opacity, fill, stroke } = paint(obj);
  if (!fill && !stroke) return;
  const w = obj.width;
  const h = obj.height;
  page.drawRectangle({
    x: -w / 2,
    y: -h / 2,
    width: w,
    height: h,
    color: fill?.color,
    opacity: fill ? fill.alpha * opacity : undefined,
    borderColor: stroke?.color,
    borderOpacity: stroke ? stroke.alpha * opacity : undefined,
    borderWidth: stroke ? obj.strokeWidth : 0,
    // Highlighter ink multiplies with the page so text underneath stays crisp.
    blendMode: obj.kind === 'highlight' ? BlendMode.Multiply : undefined,
  });
}

function drawEllipse(page: PDFPage, obj: Ellipse) {
  const { opacity, fill, stroke } = paint(obj);
  if (!fill && !stroke) return;
  page.drawEllipse({
    x: 0,
    y: 0,
    xScale: obj.rx,
    yScale: obj.ry,
    color: fill?.color,
    opacity: fill ? fill.alpha * opacity : undefined,
    borderColor: stroke?.color,
    borderOpacity: stroke ? stroke.alpha * opacity : undefined,
    borderWidth: stroke ? obj.strokeWidth : 0,
  });
}

function drawLine(page: PDFPage, obj: Line) {
  const stroke = parseColor(obj.stroke);
  if (!stroke) return;
  const p = obj.calcLinePoints();
  page.drawLine({
    start: { x: p.x1, y: p.y1 },
    end: { x: p.x2, y: p.y2 },
    thickness: obj.strokeWidth,
    color: stroke.color,
    opacity: stroke.alpha * (obj.opacity ?? 1),
    lineCap: lineCap(obj),
  });
}

function drawArrow(page: PDFPage, obj: Line) {
  const stroke = parseColor(obj.stroke);
  if (!stroke) return;
  const p = obj.calcLinePoints();
  const g = arrowGeometry(p.x1, p.y1, p.x2, p.y2, obj.strokeWidth);
  const opacity = stroke.alpha * (obj.opacity ?? 1);
  page.drawLine({
    start: { x: p.x1, y: p.y1 },
    end: g.shaftEnd,
    thickness: obj.strokeWidth,
    color: stroke.color,
    opacity,
    lineCap: lineCap(obj),
  });
  drawSvgInLocalFrame(page, `M ${g.tip.x} ${g.tip.y} L ${g.left.x} ${g.left.y} L ${g.right.x} ${g.right.y} Z`, {
    color: stroke.color,
    opacity,
  });
}

/** Free-hand pen strokes. Fabric path coords are absolute; subtract pathOffset to get the local frame. */
function drawPath(page: PDFPage, obj: Path) {
  const stroke = parseColor(obj.stroke);
  const fill = parseColor(obj.fill);
  if (!stroke && !fill) return;
  const ox = obj.pathOffset.x;
  const oy = obj.pathOffset.y;
  const d = obj.path
    .map((seg) => {
      const [cmd, ...nums] = seg as unknown as [string, ...number[]];
      const coords = nums.map((n, i) => (i % 2 === 0 ? n - ox : n - oy));
      return `${cmd} ${coords.join(' ')}`;
    })
    .join(' ');
  page.pushOperators(setLineJoin(obj.strokeLineJoin === 'round' ? LineJoinStyle.Round : LineJoinStyle.Miter));
  drawSvgInLocalFrame(page, d, {
    color: fill?.color,
    opacity: fill ? fill.alpha * (obj.opacity ?? 1) : undefined,
    borderColor: stroke?.color,
    borderWidth: stroke ? obj.strokeWidth : 0,
    borderOpacity: stroke ? stroke.alpha * (obj.opacity ?? 1) : undefined,
    borderLineCap: lineCap(obj),
  });
}

/**
 * pdf-lib's drawSvgPath assumes SVG's y-down space and flips with
 * scale(1,-1). Our local frame is already y-down, so pre-flip to cancel it.
 */
function drawSvgInLocalFrame(page: PDFPage, d: string, options: Parameters<PDFPage['drawSvgPath']>[1]) {
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, -1, 0, 0));
  page.drawSvgPath(d, { x: 0, y: 0, ...options });
  page.pushOperators(popGraphicsState());
}

/**
 * Text: replay Fabric's own line layout (wrapped lines + baseline math from
 * Text._renderTextCommon / _renderChars) so line breaks match the screen.
 * Horizontal alignment is recomputed with the embedded font's metrics.
 */
async function drawText(page: PDFPage, obj: Textbox, fonts: FontEmbedder) {
  const fill = parseColor(obj.fill);
  if (!fill || !obj.text) return;
  const opacity = fill.alpha * (obj.opacity ?? 1);
  const def = fontDefFromStack(obj.fontFamily);
  const size = obj.fontSize;

  // Fabric internals (stable across v5–v7): `_textLines` holds the wrapped
  // lines as grapheme arrays, `getHeightOfLineImpl` the unscaled line height.
  // `getCompleteStyleDeclaration` includes per-character bold/italic.
  const t = obj as unknown as {
    _textLines: string[][];
    _fontSizeFraction: number;
    getHeightOfLineImpl(i: number): number;
    getCompleteStyleDeclaration(lineIndex: number, charIndex: number): {
      fontWeight?: string | number;
      fontStyle?: string;
      fontSize?: number;
      fontFamily?: string;
    };
  };
  const left = -obj.width / 2;
  let lineTop = -obj.height / 2;

  for (let i = 0; i < t._textLines.length; i += 1) {
    const graphemes = t._textLines[i];
    const lineImpl = t.getHeightOfLineImpl(i);
    // Same baseline as Fabric: top + lineHeightImpl × (1 − _fontSizeFraction).
    const baseline = lineTop + lineImpl * (1 - t._fontSizeFraction);
    lineTop += obj.getHeightOfLine(i);

    let end = graphemes.length;
    while (end > 0 && /^\s$/u.test(graphemes[end - 1])) end -= 1;
    if (end === 0) continue;

    // Group graphemes that share a face, then split each group by script.
    type Piece = { text: string; bold: boolean; italic: boolean; size: number; family: string };
    const pieces: Piece[] = [];
    for (let c = 0; c < end; c += 1) {
      const style = t.getCompleteStyleDeclaration(i, c);
      const pieceBold = isBold(style.fontWeight);
      const pieceItalic = style.fontStyle === 'italic';
      const pieceSize = style.fontSize || size;
      const pieceFamily = style.fontFamily || def.family;
      const last = pieces[pieces.length - 1];
      if (last && last.bold === pieceBold && last.italic === pieceItalic && last.size === pieceSize && last.family === pieceFamily) {
        last.text += graphemes[c];
      } else {
        pieces.push({ text: graphemes[c], bold: pieceBold, italic: pieceItalic, size: pieceSize, family: pieceFamily });
      }
    }

    const runs = (
      await Promise.all(
        pieces.flatMap((piece) => {
          const pieceDef = fontDefFromStack(piece.family);
          return splitRuns(piece.text).map(async (run) => {
            const embedded = await fonts.get(fontForRun(pieceDef, run), piece.bold, piece.italic);
            const glyphs = [...run.text].length;
            // Letter-spacing (Fabric: 1/1000 em of this run's size) -> PDF `Tc`.
            const spacing = ((obj.charSpacing ?? 0) / 1000) * piece.size;
            return {
              ...run,
              ...embedded,
              size: piece.size,
              spacing,
              glyphs,
              width: embedded.font.widthOfTextAtSize(run.text, piece.size) + spacing * glyphs,
            };
          });
        }),
      )
    ).flat();

    // Like Fabric, the trailing spacing does not count towards the line width.
    const trail = runs.length ? runs[runs.length - 1].spacing : 0;
    const lineWidth = runs.reduce((sum, r) => sum + r.width, 0) - trail;
    let x = left;
    if (obj.textAlign === 'center') x += (obj.width - lineWidth) / 2;
    else if (obj.textAlign === 'right') x += obj.width - lineWidth;
    const lineStart = x;

    for (const run of runs) {
      // Flip back to y-up at the run's baseline, then (optionally) skew for a synthetic italic.
      page.pushOperators(
        pushGraphicsState(),
        concatTransformationMatrix(1, 0, 0, -1, x, baseline),
        concatTransformationMatrix(1, 0, run.syntheticItalic ? SYNTHETIC_ITALIC_SKEW : 0, 1, 0, 0),
      );
      if (run.spacing) page.pushOperators(setCharacterSpacing(run.spacing));
      page.drawText(run.text, { x: 0, y: 0, size: run.size, font: run.font, color: fill.color, opacity });
      page.pushOperators(popGraphicsState());
      x += run.width;
    }

    // Text decorations, mirroring Fabric's _renderTextDecoration: a bar of
    // fontSize/15 at baseline + 0.10 em (underline) / − 0.315 em (strike).
    // We are in the object's y-down local space here, so no flip is needed.
    const thickness = size / 15;
    const decorations: Array<[boolean | undefined, number]> = [
      [obj.underline, 0.1],
      [obj.linethrough, -0.315],
    ];
    for (const [on, offset] of decorations) {
      if (!on) continue;
      page.drawRectangle({
        x: lineStart,
        y: baseline + offset * size,
        width: lineWidth,
        height: thickness,
        color: fill.color,
        opacity,
        borderWidth: 0,
      });
    }
  }
}

async function drawImage(page: PDFPage, obj: FabricImage, ctx: DrawContext) {
  const src = obj.getSrc();
  if (!src) return;
  let embedded = ctx.images.get(src);
  if (!embedded) {
    embedded = (async () => {
      const { bytes, mime } = src.startsWith('data:') ? dataUrlToBytes(src) : await fetchBytes(src);
      return mime === 'image/jpeg' || mime === 'image/jpg' ? ctx.pdfDoc.embedJpg(bytes) : ctx.pdfDoc.embedPng(bytes);
    })();
    ctx.images.set(src, embedded);
  }
  const image = await embedded;
  const w = obj.width;
  const h = obj.height;
  // Images are drawn y-up from their bottom-left corner: flip the local frame first.
  page.pushOperators(concatTransformationMatrix(1, 0, 0, -1, 0, 0));
  page.drawImage(image, { x: -w / 2, y: -h / 2, width: w, height: h, opacity: obj.opacity ?? 1 });
}

async function fetchBytes(url: string) {
  const res = await fetch(url);
  const blob = await res.blob();
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

/* -------------------------------------------------------------------- fonts */

class FontEmbedder {
  private cache = new Map<string, Promise<PDFFont>>();
  constructor(private pdfDoc: PDFDocument) {}

  async get(def: FontFamilyDef, bold: boolean, italic: boolean): Promise<{ font: PDFFont; syntheticItalic: boolean }> {
    const variant = resolveVariant(def, bold, italic);
    let font = this.cache.get(variant.url);
    if (!font) {
      // See FontFamilyDef.subsetSafe for why subsetting is per-font.
      font = getFontBytes(variant.url).then((bytes) => this.pdfDoc.embedFont(bytes, { subset: def.subsetSafe }));
      this.cache.set(variant.url, font);
    }
    return { font: await font, syntheticItalic: variant.syntheticItalic };
  }
}

/* ------------------------------------------------------------ raster fallback */

async function addRasterPage(pdfDoc: PDFDocument, doc: LoadedDocument, index: number): Promise<PDFPage> {
  const info = doc.pages[index];
  const pdfPage = await doc.proxy.getPage(index + 1);
  let scale = RASTER_SCALE;
  const pixels = info.width * info.height * scale * scale;
  if (pixels > MAX_RASTER_PIXELS) scale = Math.sqrt(MAX_RASTER_PIXELS / (info.width * info.height));
  const viewport = pdfPage.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  await pdfPage.render({ canvas, viewport, background: '#ffffff' }).promise;
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Rasterisation failed'))), 'image/jpeg', 0.9),
  );
  canvas.width = canvas.height = 0;
  const image = await pdfDoc.embedJpg(new Uint8Array(await blob.arrayBuffer()));
  const page = pdfDoc.addPage([info.width, info.height]);
  page.drawImage(image, { x: 0, y: 0, width: info.width, height: info.height });
  return page;
}

export function countObjects(objects: PageObjects): number {
  return Object.values(objects).reduce((n, arr: SerializedObject[]) => n + arr.length, 0);
}
