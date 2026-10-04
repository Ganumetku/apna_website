import { Ellipse, FabricImage, Line, Rect, Textbox } from 'fabric';
import type { FabricObject } from 'fabric';
import type { ObjectKind, PageInfo, StyleState } from '../../types';
import { fontStack } from '../fonts';
import { newId } from '../id';
import { ArrowLine } from './setup';

/*
 * All factories take coordinates in PDF display points (see coordinates.ts).
 * Objects use a top-left origin so that drag-to-create math stays simple;
 * the exporter does not care because it uses the full transform matrix.
 */

const base = (kind: ObjectKind) => ({ id: newId(), kind, originX: 'left' as const, originY: 'top' as const });

export const HIGHLIGHT_OPACITY = 0.4;

export function createText(x: number, y: number, style: StyleState, page: PageInfo): Textbox {
  const width = Math.max(60, Math.min(240, page.width - x - 8));
  return new Textbox('', {
    ...base('text'),
    left: x,
    top: y,
    width,
    fontFamily: fontStack(style.fontId),
    fontSize: style.fontSize,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textAlign: style.textAlign,
    fill: style.textColor,
    opacity: style.opacity,
    lineHeight: 1.2,
    splitByGrapheme: false,
    editingBorderColor: '#e5322d',
    cursorColor: '#e5322d',
  });
}

export type BoxKind = 'rect' | 'ellipse' | 'highlight' | 'whiteout';

export function createBox(kind: BoxKind, x: number, y: number, style: StyleState): Rect | Ellipse {
  if (kind === 'ellipse') {
    return new Ellipse({
      ...base('ellipse'),
      left: x,
      top: y,
      rx: 0.5,
      ry: 0.5,
      fill: style.fillColor,
      stroke: style.strokeColor,
      strokeWidth: style.strokeWidth,
      opacity: style.opacity,
      strokeUniform: false,
    });
  }
  if (kind === 'highlight') {
    return new Rect({ ...base('highlight'), left: x, top: y, width: 1, height: 1, fill: style.highlightColor, strokeWidth: 0, stroke: null, opacity: HIGHLIGHT_OPACITY });
  }
  if (kind === 'whiteout') {
    return new Rect({ ...base('whiteout'), left: x, top: y, width: 1, height: 1, fill: style.whiteoutColor, strokeWidth: 0, stroke: null, opacity: 1 });
  }
  return new Rect({
    ...base('rect'),
    left: x,
    top: y,
    width: 1,
    height: 1,
    fill: style.fillColor,
    stroke: style.strokeColor,
    strokeWidth: style.strokeWidth,
    opacity: style.opacity,
  });
}

export type LineKind = 'line' | 'arrow' | 'underline' | 'strike';

export function createLine(kind: LineKind, x: number, y: number, style: StyleState): Line {
  const Ctor = kind === 'arrow' ? ArrowLine : Line;
  const isMarkup = kind === 'underline' || kind === 'strike';
  const line = new Ctor([x, y, x, y], {
    ...base(kind),
    originX: 'center',
    originY: 'center',
    stroke: isMarkup && kind === 'strike' ? '#dc2626' : style.strokeColor,
    strokeWidth: isMarkup ? Math.max(1, Math.min(style.strokeWidth, 3)) : style.strokeWidth,
    strokeLineCap: isMarkup ? 'butt' : 'round',
    opacity: style.opacity,
    padding: 6,
  });
  // The arrow head extends past the line's bounding box; caching would clip it.
  if (kind === 'arrow') line.objectCaching = false;
  return line;
}

export async function createImage(dataUrl: string, page: PageInfo): Promise<FabricImage> {
  const img = await FabricImage.fromURL(dataUrl);
  const maxW = page.width * 0.6;
  const maxH = page.height * 0.6;
  const scale = Math.min(1, maxW / img.width, maxH / img.height);
  img.set({
    ...base('image'),
    scaleX: scale,
    scaleY: scale,
    left: (page.width - img.width * scale) / 2,
    top: (page.height - img.height * scale) / 2,
  });
  return img;
}

/** Give a freshly enlivened/pasted object a new identity. */
export function reidentify(obj: FabricObject): void {
  obj.id = newId();
}
