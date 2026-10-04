/**
 * iframe postMessage protocol between Toolwala (parent) and this editor.
 * Buffers are transferred, not copied: the sender must not use them afterwards.
 */

export const EMBED_ERROR_CODES = [
  'INVALID_ORIGIN',
  'NOT_A_PDF',
  'CORRUPTED',
  'PASSWORD_REQUIRED',
  'TOO_LARGE',
  'EXPORT_FAILED',
] as const;

export type EmbedErrorCode = (typeof EMBED_ERROR_CODES)[number];

export interface LoadPdfPayload {
  buffer: ArrayBuffer;
  fileName: string;
}

export interface PdfSavedPayload {
  buffer: ArrayBuffer;
  fileName: string;
  flattened: boolean;
}

export interface EmbedErrorPayload {
  code: EmbedErrorCode;
  message: string;
}

export interface LoadPdfMessage {
  type: 'LOAD_PDF';
  payload: LoadPdfPayload;
}

/** Messages the parent page may send. */
export type ParentToEditorMessage = LoadPdfMessage;

/** Messages this editor sends to the parent page. */
export type EditorToParentMessage =
  | { type: 'EDITOR_READY' }
  | { type: 'PDF_LOADED'; payload: { pages: number } }
  | { type: 'PDF_SAVED'; payload: PdfSavedPayload }
  | { type: 'ERROR'; payload: EmbedErrorPayload };

export function isLoadPdfMessage(data: unknown): data is LoadPdfMessage {
  if (!data || typeof data !== 'object') return false;
  const msg = data as { type?: unknown; payload?: unknown };
  if (msg.type !== 'LOAD_PDF' || !msg.payload || typeof msg.payload !== 'object') return false;
  const payload = msg.payload as { buffer?: unknown; fileName?: unknown };
  return payload.buffer instanceof ArrayBuffer && typeof payload.fileName === 'string';
}
