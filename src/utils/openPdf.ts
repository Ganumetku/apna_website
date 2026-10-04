import type { EmbedErrorCode } from '../types/embed';
import { editorStore } from '../store/editorStore';
import { HUGE_FILE_BYTES, LARGE_FILE_BYTES, LARGE_PAGE_COUNT, formatBytes, hasPdfSignature, isPdfFile } from './file';
import { PdfLoadError, loadPdf } from './pdfjs';

export type OpenPdfResult = { ok: true; pages: number } | { ok: false; code: EmbedErrorCode; message: string };

/**
 * Same large-file prompt the file picker uses. Returns false when the user cancels.
 * Files at or under LARGE_FILE_BYTES skip the prompt.
 */
export async function confirmLargePdf(fileName: string, size: number): Promise<boolean> {
  if (size <= LARGE_FILE_BYTES) return true;
  const store = editorStore.getState();
  const huge = size > HUGE_FILE_BYTES;
  return store.confirm({
    title: huge ? 'Very large file' : 'Large file',
    message: `"${fileName}" is ${formatBytes(size)}. Everything is processed on your device, so ${
      huge ? 'this may use a lot of memory and could crash the tab on phones or older computers' : 'loading and saving may take a little longer'
    }. Continue?`,
    confirmLabel: 'Open anyway',
    cancelLabel: 'Cancel',
    danger: huge,
  });
}

/**
 * Validate, warn and open a user-selected file. All failure modes end in a
 * friendly toast instead of an exception.
 */
export async function openPdfFile(file: File): Promise<boolean> {
  const store = editorStore.getState();

  if (!isPdfFile(file)) {
    store.pushToast({ kind: 'error', title: 'That is not a PDF', message: `"${file.name}" is not a PDF file.` });
    return false;
  }
  if (file.size === 0) {
    store.pushToast({ kind: 'error', title: 'Empty file', message: 'The selected file is empty.' });
    return false;
  }
  if (!(await confirmLargePdf(file.name, file.size))) return false;

  store.setLoading({ message: 'Reading file…' });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await openPdfBytes(bytes, file.name);
    return result.ok;
  } catch (err) {
    store.setLoading(null);
    store.pushToast(
      { kind: 'error', title: 'Could not open PDF', message: err instanceof Error ? err.message : String(err) },
      8000,
    );
    return false;
  }
}

/**
 * Open PDF bytes that are already in memory (file picker or parent LOAD_PDF).
 * Shows the same toasts as the file picker, including the password dialog.
 */
export async function openPdfBytes(bytes: Uint8Array, fileName: string): Promise<OpenPdfResult> {
  const store = editorStore.getState();
  store.setLoading({ message: 'Opening PDF…' });
  try {
    if (!hasPdfSignature(bytes)) {
      throw new PdfLoadError('This file is corrupted or is not a real PDF (missing %PDF header).', 'invalid');
    }
    const doc = await loadPdf(bytes, fileName, bytes.byteLength, {
      askPassword: (incorrect) => {
        store.setLoading(null);
        return store.askPassword(fileName, incorrect).then((pw) => {
          if (pw !== null) store.setLoading({ message: 'Unlocking…' });
          return pw;
        });
      },
    });
    if (doc.pages.length === 0) throw new PdfLoadError('This PDF has no pages.', 'invalid');
    store.openDocument(doc);
    if (doc.pages.length > LARGE_PAGE_COUNT) {
      store.pushToast({
        kind: 'info',
        title: `${doc.pages.length} pages`,
        message: 'Large document: pages render as you scroll to keep things fast.',
      });
    }
    return { ok: true, pages: doc.pages.length };
  } catch (err) {
    store.setLoading(null);
    if (err instanceof PdfLoadError && err.code === 'password-cancelled') {
      const message = 'This PDF is password-protected.';
      store.pushToast({ kind: 'info', title: 'Cancelled', message });
      return { ok: false, code: 'PASSWORD_REQUIRED', message };
    }
    const message = err instanceof Error ? err.message : String(err);
    store.pushToast({ kind: 'error', title: 'Could not open PDF', message }, 8000);
    return { ok: false, code: 'CORRUPTED', message };
  }
}
