import type { PDFDocumentProxy } from 'pdfjs-dist';

/** 2D affine matrix in canvas / PDF order: [a, b, c, d, e, f]. */
export type Matrix = [number, number, number, number, number, number];

export type ToolType =
  | 'select'
  | 'text'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'whiteout'
  | 'eraser';

/** Semantic kind stored on every overlay object (independent of Fabric class). */
export type ObjectKind =
  | 'text'
  | 'image'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'arrow'
  | 'path'
  | 'highlight'
  | 'underline'
  | 'strike'
  | 'whiteout';

export type TextAlign = 'left' | 'center' | 'right';

export type FontId =
  | 'noto-sans'
  | 'noto-serif'
  | 'roboto-mono'
  | 'poppins'
  | 'noto-sans-devanagari'
  | 'latin-modern'
  | 'latin-modern-caps';

export interface StyleState {
  fontId: FontId;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  textAlign: TextAlign;
  textColor: string;
  strokeColor: string;
  /** `null` = no fill. */
  fillColor: string | null;
  highlightColor: string;
  whiteoutColor: string;
  strokeWidth: number;
  /** 0..1 */
  opacity: number;
}

export type StyleKey = keyof StyleState;

/**
 * Geometry of one PDF page in PDF points, as displayed (after /Rotate).
 * `viewportTransform` is PDF.js' viewport transform at scale 1: it maps PDF
 * user space (origin bottom-left, y up) to display space (origin top-left,
 * y down). Its inverse is what we use when exporting.
 */
export interface PageInfo {
  index: number;
  width: number;
  height: number;
  rotation: number;
  viewportTransform: Matrix;
}

/**
 * A Fabric object serialised with `toObject()`. All coordinates are in PDF
 * points in display space (top-left origin) — never in screen pixels.
 */
export type SerializedObject = Record<string, unknown> & {
  type: string;
  id: string;
  kind: ObjectKind;
  sourceLineId?: string;
};

export type PageObjects = Record<number, SerializedObject[]>;

export interface LoadedDocument {
  id: string;
  fileName: string;
  fileSize: number;
  /** Original, untouched bytes — used by pdf-lib on export. */
  bytes: Uint8Array;
  proxy: PDFDocumentProxy;
  pages: PageInfo[];
  password?: string;
}

export interface SelectionInfo {
  pageIndex: number;
  count: number;
  kinds: ObjectKind[];
  style: Partial<StyleState>;
  isEditingText: boolean;
}

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface ConfirmDialogState {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

export interface PasswordPromptState {
  fileName: string;
  incorrect: boolean;
  resolve: (password: string | null) => void;
}

export type ZoomMode = 'custom' | 'fit-width';
