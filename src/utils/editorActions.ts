import { editorStore } from '../store/editorStore';
import type { StyleState } from '../types';
import { exportPdf } from './exportPdf';
import { sendError, sendSaved, toTransferableBuffer } from './embed';
import { editedFileName, downloadBytes, prepareImage } from './file';
import { ensureFont } from './fonts';
import { flushAllEditors, getEditor, getTargetEditor } from './fabric/editorRegistry';

/*
 * Imperative actions shared by the toolbar, keyboard shortcuts and the
 * properties panel. They talk to the live Fabric editor when the page is
 * mounted and fall back to the store otherwise.
 */

const PASTE_OFFSET = 12;

export function undo() {
  flushAllEditors();
  editorStore.getState().undo();
}

export function redo() {
  flushAllEditors();
  editorStore.getState().redo();
}

export function deleteSelected(): boolean {
  return getTargetEditor()?.deleteSelection() ?? false;
}

export function copySelected(): boolean {
  const editor = getTargetEditor();
  if (!editor?.hasSelection() || editor.isEditingText()) return false;
  editorStore.getState().setClipboard(editor.getSelectedSerialized());
  return true;
}

export function cutSelected(): boolean {
  if (!copySelected()) return false;
  return deleteSelected();
}

export async function pasteClipboard(): Promise<boolean> {
  const { clipboard, currentPage, selection, doc } = editorStore.getState();
  if (!clipboard?.length || !doc) return false;
  const pageIndex = selection?.pageIndex ?? currentPage;
  const editor = getEditor(pageIndex);
  if (editor) {
    await editor.addSerialized(clipboard, PASTE_OFFSET);
  }
  return true;
}

export async function duplicateSelected(): Promise<boolean> {
  const editor = getTargetEditor();
  if (!editor?.hasSelection() || editor.isEditingText()) return false;
  await editor.addSerialized(editor.getSelectedSerialized(), PASTE_OFFSET);
  return true;
}

export function selectAllOnPage() {
  getEditor(editorStore.getState().currentPage)?.selectAll();
}

export function nudgeSelected(dx: number, dy: number): boolean {
  return getTargetEditor()?.nudge(dx, dy) ?? false;
}

export function bringForward() {
  getTargetEditor()?.bringForward();
}

export function sendBackward() {
  getTargetEditor()?.sendBackward();
}

/**
 * Change a style from the properties panel: updates the defaults for new
 * objects and, if something is selected, the selected objects too.
 */
export function changeStyle(patch: Partial<StyleState>) {
  const store = editorStore.getState();
  const sel = store.selection;
  // A highlight's translucency is its own thing; don't leak it into the global default opacity.
  const defaultsPatch = { ...patch };
  if (sel?.kinds.includes('highlight') && 'opacity' in defaultsPatch) delete defaultsPatch.opacity;
  store.setStyle(defaultsPatch);

  const next = { ...store.style, ...sel?.style, ...patch };
  if ('fontId' in patch || 'bold' in patch || 'italic' in patch) {
    void ensureFont(next.fontId, next.bold, next.italic);
  }
  if (sel) getEditor(sel.pageIndex)?.applyStyle(patch);
}

export async function addImageFromFile(file: File) {
  const store = editorStore.getState();
  if (!file.type.startsWith('image/')) {
    store.pushToast({ kind: 'error', title: 'Unsupported file', message: 'Please choose a PNG, JPG, WebP or GIF image.' });
    return;
  }
  const editor = getEditor(store.selection?.pageIndex ?? store.currentPage) ?? getTargetEditor();
  if (!editor) {
    store.pushToast({ kind: 'warning', title: 'Scroll to a page first', message: 'Images are added to the page in view.' });
    return;
  }
  try {
    const { dataUrl } = await prepareImage(file);
    await editor.addImage(dataUrl);
  } catch (err) {
    store.pushToast({ kind: 'error', title: 'Could not add image', message: (err as Error).message });
  }
}

type BuiltPdf = { bytes: Uint8Array; flattened: boolean; fileName: string };

/** Shared by Download and Save & Continue. Null when there is nothing to export or one is already running. */
async function buildExport(): Promise<BuiltPdf | null> {
  const store = editorStore.getState();
  const doc = store.doc;
  if (!doc || store.exporting) return null;
  flushAllEditors();
  store.setExporting(true);
  try {
    const { objects } = editorStore.getState();
    const { bytes, flattened } = await exportPdf(doc, objects);
    return { bytes, flattened, fileName: editedFileName(doc.fileName) };
  } catch (err) {
    console.error(err);
    const message = (err as Error).message || 'Unknown error';
    store.pushToast({ kind: 'error', title: 'Export failed', message }, 8000);
    throw new Error(message);
  } finally {
    store.setExporting(false);
  }
}

function notifyExported(flattened: boolean, via: 'download' | 'parent') {
  const store = editorStore.getState();
  if (flattened) {
    store.pushToast(
      {
        kind: 'warning',
        title: via === 'download' ? 'Downloaded as a flattened PDF' : 'Saved as a flattened PDF',
        message:
          'This PDF is encrypted or malformed, so pages were saved as images with your edits on top. Text in the original pages is no longer selectable.',
      },
      9000,
    );
    return;
  }
  store.pushToast({
    kind: 'success',
    title: 'Your PDF is ready',
    message: via === 'download' ? 'The edited file has been downloaded.' : 'The edited file was sent back. You can continue on the site.',
  });
}

export async function exportAndDownload() {
  try {
    const built = await buildExport();
    if (!built) return;
    downloadBytes(built.bytes, built.fileName);
    editorStore.getState().markSaved();
    notifyExported(built.flattened, 'download');
  } catch {
    // buildExport already toasted.
  }
}

/** Embed mode: same export as Download, then hand the bytes to the parent page. */
export async function exportAndSendToParent() {
  try {
    const built = await buildExport();
    if (!built) return;
    const buffer = toTransferableBuffer(built.bytes);
    const sent = sendSaved({ buffer, fileName: built.fileName, flattened: built.flattened });
    if (!sent) {
      const message = 'The parent page is not connected, so the PDF could not be sent.';
      sendError('EXPORT_FAILED', message);
      editorStore.getState().pushToast({ kind: 'error', title: 'Export failed', message }, 8000);
      return;
    }
    editorStore.getState().markSaved();
    notifyExported(built.flattened, 'parent');
  } catch (err) {
    sendError('EXPORT_FAILED', err instanceof Error ? err.message : 'Export failed');
  }
}
