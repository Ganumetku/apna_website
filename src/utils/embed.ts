import type { EditorToParentMessage, EmbedErrorCode, PdfSavedPayload } from '../types/embed';

/**
 * Embed mode is on only when this app is iframed with `?embed=1`.
 * Without that query the app is the standalone editor.
 */
export function isEmbedMode(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('embed') === '1';
}

/** Always allowed, so Toolwala and ToolGPT work even before a Vercel env var is set. */
const DEFAULT_PARENT_ORIGINS = [
  'https://toolwala.co',
  'https://www.toolwala.co',
  'https://toolgpt.in',
  'https://www.toolgpt.in',
];

/** Comma-separated parent origins that may talk to the editor. */
export function allowedOrigins(): string[] {
  const raw = import.meta.env.VITE_ALLOWED_ORIGINS ?? '';
  const origins = [...DEFAULT_PARENT_ORIGINS];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    try {
      const origin = new URL(trimmed).origin;
      if (!origins.includes(origin)) origins.push(origin);
    } catch {
      console.warn(`Ignoring invalid VITE_ALLOWED_ORIGINS entry: ${trimmed}`);
    }
  }
  return origins;
}

/** Optional second button in embed mode. Default off, but on when opened in a popup/tab. */
export function embedShowDownload(): boolean {
  if (typeof window !== 'undefined' && window.opener && !window.opener.closed) {
    return true;
  }
  return import.meta.env.VITE_EMBED_SHOW_DOWNLOAD === 'true';
}

/** Get parent iframe or opener window */
export function getHostWindow(): Window | null {
  if (typeof window === 'undefined') return null;
  if (window.parent && window.parent !== window) return window.parent;
  if (window.opener && !window.opener.closed) return window.opener;
  return null;
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
  const host = getHostWindow();
  if (!origin || !host) return false;
  host.postMessage(message, origin, transfer);
  return true;
}

/** Tell every allow-listed parent/opener that the editor can accept LOAD_PDF. */
export function announceReady(): void {
  const host = getHostWindow();
  if (!host) return;
  const message: EditorToParentMessage = { type: 'EDITOR_READY' };
  for (const origin of allowedOrigins()) {
    host.postMessage(message, origin);
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
