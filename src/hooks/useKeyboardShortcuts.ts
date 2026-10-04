import { useEffect } from 'react';
import { clampZoom, editorStore } from '../store/editorStore';
import type { ToolType } from '../types';
import {
  addImageFromFile,
  copySelected,
  cutSelected,
  deleteSelected,
  duplicateSelected,
  nudgeSelected,
  pasteClipboard,
  redo,
  selectAllOnPage,
  undo,
} from '../utils/editorActions';
import { forEachEditor, getTargetEditor } from '../utils/fabric/editorRegistry';

const TOOL_KEYS: Record<string, ToolType> = {
  v: 'select',
  t: 'text',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  p: 'pen',
  h: 'highlight',
  u: 'underline',
  k: 'strike',
  w: 'whiteout',
  e: 'eraser',
};

/** Ignore shortcuts while the user types in an input, textarea (incl. Fabric's hidden one) or contenteditable. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

const isEditingText = () => getTargetEditor()?.isEditingText() ?? false;

export function useKeyboardShortcuts(onPickImage: () => void) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const store = editorStore.getState();
      if (!store.doc || store.confirmDialog || store.passwordPrompt) return;
      if (isTypingTarget(e.target) || isEditingText()) {
        if (e.key === 'Escape' && isEditingText()) forEachEditor((ed) => ed.discard());
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod) {
        switch (key) {
          case 'z':
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
            return;
          case 'y':
            e.preventDefault();
            redo();
            return;
          case 'c':
            if (copySelected()) e.preventDefault();
            return;
          case 'x':
            if (cutSelected()) e.preventDefault();
            return;
          case 'd':
            e.preventDefault();
            void duplicateSelected();
            return;
          case 'a':
            e.preventDefault();
            selectAllOnPage();
            return;
          case '=':
          case '+':
            e.preventDefault();
            store.setZoom(clampZoom(store.zoom * 1.2));
            return;
          case '-':
            e.preventDefault();
            store.setZoom(clampZoom(store.zoom / 1.2));
            return;
          case '0':
            e.preventDefault();
            store.setZoom(store.zoom, 'fit-width');
            return;
          default:
            return;
        }
      }

      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          if (deleteSelected()) e.preventDefault();
          return;
        case 'Escape':
          forEachEditor((ed) => ed.discard());
          store.setTool('select');
          return;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          if (nudgeSelected(dx, dy)) e.preventDefault();
          else if (!store.selection && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
            store.requestScrollToPage(store.currentPage + (e.key === 'ArrowRight' ? 1 : -1));
          }
          return;
        }
        case 'PageDown':
          e.preventDefault();
          store.requestScrollToPage(store.currentPage + 1);
          return;
        case 'PageUp':
          e.preventDefault();
          store.requestScrollToPage(store.currentPage - 1);
          return;
        default:
          break;
      }

      if (!e.altKey && !e.shiftKey) {
        if (key === 'i') {
          onPickImage();
          return;
        }
        const tool = TOOL_KEYS[key];
        if (tool) store.setTool(tool);
      }
    };

    // Ctrl/Cmd+V: an image on the OS clipboard wins, else paste our own objects.
    const onPaste = (e: ClipboardEvent) => {
      const store = editorStore.getState();
      if (!store.doc || isTypingTarget(e.target) || isEditingText()) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void addImageFromFile(file);
        return;
      }
      if (store.clipboard?.length) {
        e.preventDefault();
        void pasteClipboard();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('paste', onPaste);
    };
  }, [onPickImage]);
}
