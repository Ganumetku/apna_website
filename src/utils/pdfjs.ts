import { GlobalWorkerOptions, PasswordResponses, getDocument } from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { LoadedDocument, Matrix, PageInfo } from '../types';
import { newId } from './id';

GlobalWorkerOptions.workerSrc = workerUrl;

const ASSET_BASE = `${import.meta.env.BASE_URL}pdfjs/`;

export class PdfLoadError extends Error {
  constructor(
    message: string,
    readonly code: 'invalid' | 'password-cancelled' | 'unknown',
  ) {
    super(message);
    this.name = 'PdfLoadError';
  }
}

export interface LoadOptions {
  /** Called when the PDF needs a password. Return `null` to cancel. */
  askPassword: (incorrect: boolean) => Promise<string | null>;
  onProgress?: (fraction: number) => void;
}

/**
 * Load a PDF with PDF.js and collect page geometry.
 *
 * Note: PDF.js transfers the buffer it receives to its worker (detaching it),
 * so we always hand it a copy and keep the original bytes for pdf-lib.
 */
export async function loadPdf(
  bytes: Uint8Array,
  fileName: string,
  fileSize: number,
  { askPassword, onProgress }: LoadOptions,
): Promise<LoadedDocument> {
  const task = getDocument({
    data: bytes.slice(),
    cMapUrl: `${ASSET_BASE}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${ASSET_BASE}standard_fonts/`,
    wasmUrl: `${ASSET_BASE}wasm/`,
    iccUrl: `${ASSET_BASE}iccs/`,
    isEvalSupported: false,
    enableXfa: false,
  });

  let password: string | undefined;
  let cancelled = false;

  task.onPassword = (updatePassword: (pw: string) => void, reason: number) => {
    const incorrect = reason === PasswordResponses.INCORRECT_PASSWORD;
    void askPassword(incorrect).then((pw) => {
      if (pw === null) {
        cancelled = true;
        void task.destroy();
        return;
      }
      password = pw;
      updatePassword(pw);
    });
  };
  if (onProgress) {
    task.onProgress = ({ loaded, total }: { loaded: number; total: number }) => {
      if (total > 0) onProgress(loaded / total);
    };
  }

  let proxy: PDFDocumentProxy;
  try {
    proxy = await task.promise;
  } catch (err) {
    if (cancelled) throw new PdfLoadError('Password entry was cancelled.', 'password-cancelled');
    const name = (err as { name?: string })?.name;
    if (name === 'InvalidPDFException' || name === 'FormatError') {
      throw new PdfLoadError('This file appears to be corrupted or is not a valid PDF.', 'invalid');
    }
    if (name === 'PasswordException') {
      throw new PdfLoadError('Password entry was cancelled.', 'password-cancelled');
    }
    throw new PdfLoadError(`Could not open this PDF: ${(err as Error)?.message ?? 'unknown error'}`, 'unknown');
  }

  const pages = await collectPageInfo(proxy);
  return { id: newId(), fileName, fileSize, bytes, proxy, pages, password };
}

async function collectPageInfo(proxy: PDFDocumentProxy): Promise<PageInfo[]> {
  const pages: PageInfo[] = new Array(proxy.numPages);
  const BATCH = 32;
  for (let start = 0; start < proxy.numPages; start += BATCH) {
    const end = Math.min(proxy.numPages, start + BATCH);
    await Promise.all(
      Array.from({ length: end - start }, async (_, k) => {
        const index = start + k;
        const page = await proxy.getPage(index + 1);
        // Scale 1 => 1 viewport unit == 1 PDF point. Includes /Rotate and
        // the CropBox offset, so this is exactly what the user sees.
        const viewport = page.getViewport({ scale: 1 });
        pages[index] = {
          index,
          width: viewport.width,
          height: viewport.height,
          rotation: viewport.rotation,
          viewportTransform: viewport.transform as Matrix,
        };
      }),
    );
  }
  return pages;
}
