import { editorStore } from '../../store/editorStore';
import type { PageEditor } from './PageEditor';

/**
 * Live Fabric editors keyed by page index. Only pages near the viewport are
 * mounted (lazy rendering), so this map is small even for 1000-page PDFs.
 */
const editors = new Map<number, PageEditor>();

export function registerEditor(pageIndex: number, editor: PageEditor) {
  editors.set(pageIndex, editor);
}

export function unregisterEditor(pageIndex: number, editor: PageEditor) {
  if (editors.get(pageIndex) === editor) editors.delete(pageIndex);
}

export function getEditor(pageIndex: number): PageEditor | undefined {
  return editors.get(pageIndex);
}

export function forEachEditor(cb: (editor: PageEditor) => void) {
  editors.forEach(cb);
}

/** The editor actions should target: the page with the selection, else the current page. */
export function getTargetEditor(): PageEditor | undefined {
  const { selection, currentPage } = editorStore.getState();
  return (selection && editors.get(selection.pageIndex)) || editors.get(currentPage);
}

/** Commit anything pending (open text edits, debounced style changes) on every page. */
export function flushAllEditors() {
  editors.forEach((e) => e.flush());
}
