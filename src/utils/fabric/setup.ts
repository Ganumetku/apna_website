import { FabricObject, IText, InteractiveFabricObject, Line, classRegistry } from 'fabric';
import type { ObjectKind } from '../../types';
import { arrowGeometry } from '../arrow';

declare module 'fabric' {
  interface FabricObject {
    id?: string;
    kind?: ObjectKind;
    /** Set on objects that replace an original text line of the PDF (see textExtraction.ts). */
    sourceLineId?: string;
    /** Original PDF line text; if the user doesn't change it we restore the printed glyphs. */
    sourceOriginalText?: string;
    /** Weight/style of the printed line; typing must not drop them to Regular. */
    sourceFontWeight?: number | string;
    sourceFontStyle?: string;
    /** Overlay is using the PDF's own FontFace; do not fake-bold it. */
    sourcePdfFace?: boolean;
  }
  interface SerializedObjectProps {
    id?: string;
    kind?: ObjectKind;
    sourceLineId?: string;
    sourceOriginalText?: string;
    sourceFontWeight?: number | string;
    sourceFontStyle?: string;
    sourcePdfFace?: boolean;
  }
}

/** Extra props written by `toObject()` so they survive undo/redo and lazy page mounting. */
FabricObject.customProperties = ['id', 'kind', 'sourceLineId', 'sourceOriginalText', 'sourceFontWeight', 'sourceFontStyle', 'sourcePdfFace'];

// Selection handles: brand colours + large touch targets for mobile.
Object.assign(InteractiveFabricObject.ownDefaults, {
  borderColor: '#e5322d',
  cornerColor: '#ffffff',
  cornerStrokeColor: '#e5322d',
  cornerStyle: 'circle',
  transparentCorners: false,
  cornerSize: 11,
  touchCornerSize: 32,
  borderScaleFactor: 1.5,
  padding: 3,
});

/**
 * A Line with a filled arrow head. Geometry comes from `arrowGeometry`, which
 * the PDF exporter reuses so the head looks identical in the output.
 */
export class ArrowLine extends Line {
  static type = 'ArrowLine';

  _render(ctx: CanvasRenderingContext2D) {
    const p = this.calcLinePoints();
    const g = arrowGeometry(p.x1, p.y1, p.x2, p.y2, this.strokeWidth);
    const color = typeof this.stroke === 'string' ? this.stroke : '#000000';
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineTo(g.shaftEnd.x, g.shaftEnd.y);
    ctx.lineWidth = this.strokeWidth;
    ctx.lineCap = this.strokeLineCap;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(g.tip.x, g.tip.y);
    ctx.lineTo(g.left.x, g.left.y);
    ctx.lineTo(g.right.x, g.right.y);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
}

classRegistry.setClass(ArrowLine);

/*
 * Fabric puts the hidden <textarea> used for text input in <body> with
 * `position: absolute` at the caret's *document* position. Inside our
 * scrollable page column that makes focusing it scroll the whole app.
 * Pin it with `position: fixed` at the caret's *viewport* position instead:
 * focus never scrolls, and mobile keyboards / IMEs still open at the caret.
 */
type TextareaInternals = {
  canvas?: { upperCanvasEl: HTMLCanvasElement; _offset: { left: number; top: number } };
  hiddenTextarea: HTMLTextAreaElement | null;
  _calcTextareaPosition(): { left: string; top: string; fontSize?: string; charHeight?: number };
  initHiddenTextarea(): void;
};
const itextProto = IText.prototype as unknown as TextareaInternals;
const calcTextareaPosition = itextProto._calcTextareaPosition;
itextProto._calcTextareaPosition = function (this: TextareaInternals) {
  const pos = calcTextareaPosition.call(this);
  if (!this.canvas) return pos;
  const rect = this.canvas.upperCanvasEl.getBoundingClientRect();
  const { left, top } = this.canvas._offset;
  return {
    ...pos,
    left: `${parseFloat(pos.left) - left + rect.left}px`,
    top: `${parseFloat(pos.top) - top + rect.top}px`,
  };
};
const initHiddenTextarea = itextProto.initHiddenTextarea;
itextProto.initHiddenTextarea = function (this: TextareaInternals) {
  initHiddenTextarea.call(this);
  if (this.hiddenTextarea) this.hiddenTextarea.style.position = 'fixed';
};

export const FABRIC_READY = true;
