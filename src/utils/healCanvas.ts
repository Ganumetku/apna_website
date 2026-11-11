import { Textbox } from 'fabric';
import './fabric/setup';
import { editorStore } from '../store/editorStore';
import { getEditor } from './fabric/editorRegistry';
import { healLineOnCanvas } from './textExtraction';

/**
 * Heals all edited/replaced original text lines on a rendered PDF canvas
 * (both offscreen render buffer and live page canvas) so original printed
 * text glyphs never reappear underneath during zoom or page re-renders.
 */
export function healCanvasForPage(canvas: HTMLCanvasElement, pageIndex: number, pageWidth: number): void {
  const editor = getEditor(pageIndex);
  const liveObjs = editor ? editor.canvas.getObjects() : [];
  const storeObjs = editorStore.getState().objects[pageIndex] ?? [];

  const healedLines = new Set<string>();

  // 1. Process live editor objects if editor is mounted
  for (const obj of liveObjs) {
    if (obj instanceof Textbox && obj.sourceLineId) {
      const isEdited = obj.sourcePainted || (obj.sourceOriginalText !== undefined && obj.text !== obj.sourceOriginalText);
      if (!isEdited || healedLines.has(obj.sourceLineId)) continue;
      healedLines.add(obj.sourceLineId);

      const line = editor?.getTextLines().find((l) => l.id === obj.sourceLineId);
      const lineInfo = line || {
        left: obj.sourceLineLeft ?? obj.left,
        top: obj.sourceLineTop ?? obj.top,
        width: obj.sourceLineWidth ?? (obj.sourceCoverWidth ?? obj.getScaledWidth()),
        height: obj.sourceLineHeight ?? obj.getScaledHeight(),
        fontSize: obj.fontSize,
        baseline: obj.sourceBaseline,
      };

      healLineOnCanvas(canvas, lineInfo, pageWidth);
    }
  }

  // 2. Process store objects (for pages not yet mounted or unmounted)
  for (const obj of storeObjs) {
    if (obj.kind === 'text') {
      const tb = obj as unknown as {
        sourceLineId?: string;
        sourceOriginalText?: string;
        text?: string;
        sourcePainted?: boolean;
        sourceLineLeft?: number;
        sourceLineTop?: number;
        sourceLineWidth?: number;
        sourceLineHeight?: number;
        sourceBaseline?: number;
        sourceCoverWidth?: number;
        left?: number;
        top?: number;
        width?: number;
        height?: number;
        fontSize?: number;
        scaleX?: number;
        scaleY?: number;
      };

      if (!tb.sourceLineId || healedLines.has(tb.sourceLineId)) continue;
      const isEdited = tb.sourcePainted || (tb.sourceOriginalText !== undefined && tb.text !== tb.sourceOriginalText);
      if (!isEdited) continue;
      healedLines.add(tb.sourceLineId);

      const lineInfo = {
        left: tb.sourceLineLeft ?? tb.left ?? 0,
        top: tb.sourceLineTop ?? tb.top,
        width: tb.sourceLineWidth ?? (tb.sourceCoverWidth ?? ((tb.width ?? 0) * (tb.scaleX ?? 1))),
        height: tb.sourceLineHeight ?? ((tb.height ?? 0) * (tb.scaleY ?? 1)),
        fontSize: tb.fontSize ?? 12,
        baseline: tb.sourceBaseline,
      };

      healLineOnCanvas(canvas, lineInfo, pageWidth);
    }
  }
}
