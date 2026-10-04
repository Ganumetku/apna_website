import { useEffect } from 'react';
import { editorStore } from '../store/editorStore';
import { isLoadPdfMessage } from '../types/embed';
import {
  allowedOrigins,
  announceReady,
  getVerifiedParentOrigin,
  isEmbedMode,
  sendError,
  sendSaved,
  setVerifiedParentOrigin,
} from '../utils/embed';
import { HUGE_FILE_BYTES, formatBytes, hasPdfSignature } from '../utils/file';
import { confirmLargePdf, openPdfBytes } from '../utils/openPdf';

/**
 * Talks to the parent page when `?embed=1` is set.
 * Sends EDITOR_READY on mount, accepts LOAD_PDF, and exposes sendSaved / sendError
 * (the same functions editorActions uses, so Save & Continue and this hook share one origin).
 */
export function useParentBridge() {
  useEffect(() => {
    if (!isEmbedMode() || window.parent === window) return;

    announceReady();

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return;

      const trusted = getVerifiedParentOrigin();
      if (trusted && event.origin !== trusted) {
        sendError('INVALID_ORIGIN', 'Ignored a message from a different origin.');
        return;
      }
      if (!allowedOrigins().includes(event.origin)) return;

      setVerifiedParentOrigin(event.origin);
      if (!isLoadPdfMessage(event.data)) return;
      void loadFromParent(event.data.payload.buffer, event.data.payload.fileName);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return { sendSaved, sendError };
}

async function loadFromParent(buffer: ArrayBuffer, rawName: string) {
  const store = editorStore.getState();
  const fileName = rawName.trim() || 'document.pdf';
  const bytes = new Uint8Array(buffer);
  const namedPdf = fileName.toLowerCase().endsWith('.pdf');

  if (bytes.byteLength === 0 || (!namedPdf && !hasPdfSignature(bytes))) {
    const empty = bytes.byteLength === 0;
    const message = empty ? 'The selected file is empty.' : `"${fileName}" is not a PDF file.`;
    store.pushToast({ kind: 'error', title: empty ? 'Empty file' : 'That is not a PDF', message });
    sendError('NOT_A_PDF', message);
    return;
  }

  if (bytes.byteLength > HUGE_FILE_BYTES) {
    const message = `"${fileName}" is ${formatBytes(bytes.byteLength)}, which is over the ${formatBytes(HUGE_FILE_BYTES)} limit.`;
    store.pushToast({ kind: 'error', title: 'File is too large', message });
    sendError('TOO_LARGE', message);
    return;
  }

  if (!(await confirmLargePdf(fileName, bytes.byteLength))) {
    sendError('TOO_LARGE', 'Opening this large file was cancelled.');
    return;
  }

  const result = await openPdfBytes(bytes, fileName);
  if (result.ok) {
    const origin = getVerifiedParentOrigin();
    if (!origin) return;
    window.parent.postMessage({ type: 'PDF_LOADED', payload: { pages: result.pages } }, origin);
    return;
  }
  sendError(result.code, result.message);
}
