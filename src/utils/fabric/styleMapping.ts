import type { FabricObject, Textbox } from 'fabric';
import type { ObjectKind, StyleKey, StyleState, TextAlign, ToolType } from '../../types';
import { toHex } from '../color';
import { fontDefFromStack, fontStack, isBold } from '../fonts';

/** Which properties-panel fields apply to each object kind. */
export const FIELDS_BY_KIND: Record<ObjectKind, StyleKey[]> = {
  text: ['fontId', 'fontSize', 'bold', 'italic', 'textAlign', 'textColor', 'opacity'],
  rect: ['fillColor', 'strokeColor', 'strokeWidth', 'opacity'],
  ellipse: ['fillColor', 'strokeColor', 'strokeWidth', 'opacity'],
  line: ['strokeColor', 'strokeWidth', 'opacity'],
  arrow: ['strokeColor', 'strokeWidth', 'opacity'],
  path: ['strokeColor', 'strokeWidth', 'opacity'],
  underline: ['strokeColor', 'strokeWidth', 'opacity'],
  strike: ['strokeColor', 'strokeWidth', 'opacity'],
  highlight: ['highlightColor', 'opacity'],
  whiteout: ['whiteoutColor'],
  image: ['opacity'],
};

export const KIND_LABELS: Record<ObjectKind, string> = {
  text: 'Text',
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  line: 'Line',
  arrow: 'Arrow',
  path: 'Drawing',
  underline: 'Underline',
  strike: 'Strikethrough',
  highlight: 'Highlight',
  whiteout: 'White-out',
  image: 'Image',
};

export function kindForTool(tool: ToolType): ObjectKind | null {
  switch (tool) {
    case 'text':
    case 'image':
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow':
    case 'highlight':
    case 'underline':
    case 'strike':
    case 'whiteout':
      return tool;
    case 'pen':
      return 'path';
    default:
      return null;
  }
}

/** Fields shared by every selected kind. */
export function fieldsForKinds(kinds: ObjectKind[]): StyleKey[] {
  if (!kinds.length) return [];
  return FIELDS_BY_KIND[kinds[0]].filter((f) => kinds.every((k) => FIELDS_BY_KIND[k].includes(f)));
}

/** Fabric object -> panel values. */
export function readStyle(obj: FabricObject): Partial<StyleState> {
  const opacity = obj.opacity ?? 1;
  switch (obj.kind) {
    case 'text': {
      const t = obj as Textbox;
      return {
        fontId: fontDefFromStack(t.fontFamily).id,
        fontSize: Math.round(t.fontSize * (t.scaleY ?? 1) * 10) / 10,
        bold: isBold(t.fontWeight),
        italic: t.fontStyle === 'italic',
        textAlign: (['left', 'center', 'right'].includes(t.textAlign) ? t.textAlign : 'left') as TextAlign,
        textColor: toHex(t.fill),
        opacity,
      };
    }
    case 'rect':
    case 'ellipse':
      return {
        fillColor: obj.fill && obj.fill !== 'transparent' ? toHex(obj.fill) : null,
        strokeColor: toHex(obj.stroke),
        strokeWidth: obj.strokeWidth,
        opacity,
      };
    case 'highlight':
      return { highlightColor: toHex(obj.fill), opacity };
    case 'whiteout':
      return { whiteoutColor: toHex(obj.fill, '#ffffff') };
    case 'image':
      return { opacity };
    default:
      return { strokeColor: toHex(obj.stroke), strokeWidth: obj.strokeWidth, opacity };
  }
}

/** Panel values -> Fabric object. Only keys valid for the object's kind are applied. */
export function applyStyle(obj: FabricObject, patch: Partial<StyleState>): void {
  const kind = obj.kind;
  if (!kind) return;
  const allowed = FIELDS_BY_KIND[kind];
  const has = (k: StyleKey) => allowed.includes(k) && k in patch;
  const props: Record<string, unknown> = {};

  if (has('opacity')) props.opacity = patch.opacity;
  if (has('strokeColor')) props.stroke = patch.strokeColor;
  if (has('strokeWidth')) props.strokeWidth = patch.strokeWidth;
  if (has('fillColor')) props.fill = patch.fillColor;
  if (has('highlightColor')) props.fill = patch.highlightColor;
  if (has('whiteoutColor')) props.fill = patch.whiteoutColor;

  if (kind === 'text') {
    const t = obj as Textbox;
    if (has('textColor')) props.fill = patch.textColor;
    if (has('fontId') && patch.fontId) props.fontFamily = fontStack(patch.fontId);
    if (has('bold')) props.fontWeight = patch.bold ? 700 : 400;
    if (has('italic')) props.fontStyle = patch.italic ? 'italic' : 'normal';
    if (has('textAlign')) props.textAlign = patch.textAlign;
    if (has('fontSize') && patch.fontSize) {
      // Font size is "what you see": fold any scale into the real font size.
      props.fontSize = patch.fontSize / (t.scaleY || 1);
    }
  }
  obj.set(props);
  if (kind === 'text') {
    const t = obj as Textbox;
    // A panel change applies to the whole box, so drop per-character overrides
    // (those are how a bold label next to regular text is preserved).
    if (has('bold')) t.removeStyle('fontWeight');
    if (has('italic')) t.removeStyle('fontStyle');
    if (has('fontId')) t.removeStyle('fontFamily');
    if (has('fontSize')) t.removeStyle('fontSize');
    if (has('textColor')) t.removeStyle('fill');
    t.initDimensions();
  }
  obj.setCoords();
}
