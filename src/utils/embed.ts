import type { EditorToParentMessage, EmbedErrorCode, PdfSavedPayload } from '../types/embed';

/**
 * Embed mode is on only when this app is iframed with `?embed=1`.
 * Without that query the app is the standalone editor.
 */
export function isEmbedMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('embed') === '1';
}

/** Comma-separated parent origins that may talk to the editor. */
export function allowedOrigins(): string[] {
  const raw = import.meta.env.VITE_ALLOWED_ORIGINS ?? '';
  const origins: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      origins.push(new URL(trimmed).origin);
    } catch {
      console.warn(`Ignoring invalid VITE_ALLOWED_ORIGINS entry: ${trimmed}`);
    }
  }
  return origins;
}

/** Optional second button in embed mode. Default off. Set VITE_EMBED_SHOW_DOWNLOAD=true. */
export function embedShowDownload(): boolean {
  return import.meta.env.VITE_EMBED_SHOW_DOWNLOAD === 'true';
}

/**
 * Origin of the parent that has already passed the allow-list.
 * Outbound messages use only this origin (never "*").
 * EDITOR_READY is the exception: it is posted once per allow-listed origin
 * before any parent message has arrived, and the browser drops the copies
 * whose targetOrigin does not match the real parent.
 */
let verifiedParentOrigin: string | null = null;

export function getVerifiedParentOrigin(): string | null {
  return verifiedParentOrigin;
}

export function setVerifiedParentOrigin(origin: string): void {
  verifiedParentOrigin = origin;
}

export function postToParent(message: EditorToParentMessage, transfer: Transferable[] = []): boolean {
  const origin = verifiedParentOrigin;
  if (!origin || window.parent === window) return false;
  window.parent.postMessage(message, origin, transfer);
  return true;
}

/** Tell every allow-listed parent that the editor can accept LOAD_PDF. */
export function announceReady(): void {
  if (typeof window === 'undefined' || window.parent === window) return;
  const message: EditorToParentMessage = { type: 'EDITOR_READY' };
  for (const origin of allowedOrigins()) {
    window.parent.postMessage(message, origin);
  }
}

export function sendSaved(payload: PdfSavedPayload): boolean {
  return postToParent({ type: 'PDF_SAVED', payload }, [payload.buffer]);
}

export function sendError(code: EmbedErrorCode, message: string): boolean {
  return postToParent({ type: 'ERROR', payload: { code, message } });
}

/** A standalone ArrayBuffer safe to transfer (pdf-lib's Uint8Array may be a view). */
export function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
