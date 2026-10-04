import { create } from 'zustand';
import type {
  ConfirmDialogState,
  LoadedDocument,
  PageObjects,
  PasswordPromptState,
  SelectionInfo,
  SerializedObject,
  StyleState,
  Toast,
  ToolType,
  ZoomMode,
} from '../types';
import { newId } from '../utils/id';

const HISTORY_LIMIT = 100;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;

/** Shared empty array so "no objects" keeps a stable identity across renders. */
export const EMPTY_OBJECTS: SerializedObject[] = [];

export const DEFAULT_STYLE: StyleState = {
  fontId: 'noto-sans',
  fontSize: 16,
  bold: false,
  italic: false,
  textAlign: 'left',
  textColor: '#111827',
  strokeColor: '#2563eb',
  fillColor: null,
  highlightColor: '#facc15',
  whiteoutColor: '#ffffff',
  strokeWidth: 2,
  opacity: 1,
};

interface EditorState {
  doc: LoadedDocument | null;
  loading: { message: string } | null;

  /** Overlay objects per page index, in PDF points. The single source of truth. */
  objects: PageObjects;
  past: PageObjects[];
  future: PageObjects[];
  dirty: boolean;

  tool: ToolType;
  style: StyleState;
  selection: SelectionInfo | null;
  clipboard: SerializedObject[] | null;

  zoom: number;
  zoomMode: ZoomMode;
  currentPage: number;
  /** Bumping `nonce` asks the page viewport to scroll to `page`. */
  scrollRequest: { page: number; nonce: number } | null;

  sidebarOpen: boolean;
  panelOpen: boolean;
  exporting: boolean;

  toasts: Toast[];
  confirmDialog: ConfirmDialogState | null;
  passwordPrompt: PasswordPromptState | null;

  setLoading: (loading: { message: string } | null) => void;
  openDocument: (doc: LoadedDocument) => void;
  closeDocument: () => void;

  /** Replace one page's objects and record an undo step. */
  commitPage: (pageIndex: number, objects: SerializedObject[]) => void;
  undo: () => void;
  redo: () => void;
  markSaved: () => void;

  setTool: (tool: ToolType) => void;
  setStyle: (patch: Partial<StyleState>) => void;
  setSelection: (selection: SelectionInfo | null) => void;
  setClipboard: (objects: SerializedObject[] | null) => void;

  setZoom: (zoom: number, mode?: ZoomMode) => void;
  setCurrentPage: (page: number) => void;
  requestScrollToPage: (page: number) => void;

  setSidebarOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
  setExporting: (exporting: boolean) => void;

  pushToast: (toast: Omit<Toast, 'id'>, durationMs?: number) => void;
  dismissToast: (id: string) => void;
  confirm: (opts: Omit<ConfirmDialogState, 'resolve'>) => Promise<boolean>;
  closeConfirm: (ok: boolean) => void;
  askPassword: (fileName: string, incorrect: boolean) => Promise<string | null>;
  closePasswordPrompt: (password: string | null) => void;
}

export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const isDesktop = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches;

export const useEditorStore = create<EditorState>()((set, get) => ({
  doc: null,
  loading: null,
  objects: {},
  past: [],
  future: [],
  dirty: false,
  tool: 'select',
  style: DEFAULT_STYLE,
  selection: null,
  clipboard: null,
  zoom: 1,
  zoomMode: 'fit-width',
  currentPage: 0,
  scrollRequest: null,
  sidebarOpen: isDesktop(),
  panelOpen: isDesktop(),
  exporting: false,
  toasts: [],
  confirmDialog: null,
  passwordPrompt: null,

  setLoading: (loading) => set({ loading }),

  openDocument: (doc) => {
    const prev = get().doc;
    if (prev && prev.proxy !== doc.proxy) void prev.proxy.destroy();
    set({
      doc,
      loading: null,
      objects: {},
      past: [],
      future: [],
      dirty: false,
      tool: 'select',
      selection: null,
      currentPage: 0,
      zoomMode: 'fit-width',
      scrollRequest: null,
      sidebarOpen: isDesktop(),
      panelOpen: isDesktop(),
    });
  },

  closeDocument: () => {
    const prev = get().doc;
    if (prev) void prev.proxy.destroy();
    set({ doc: null, objects: {}, past: [], future: [], dirty: false, selection: null, tool: 'select' });
  },

  commitPage: (pageIndex, pageObjects) => {
    const { objects, past } = get();
    if (objects[pageIndex] === pageObjects) return;
    const nextPast = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past.slice();
    nextPast.push(objects);
    set({
      objects: { ...objects, [pageIndex]: pageObjects },
      past: nextPast,
      future: [],
      dirty: true,
    });
  },

  undo: () => {
    const { past, future, objects } = get();
    if (!past.length) return;
    const previous = past[past.length - 1];
    set({ objects: previous, past: past.slice(0, -1), future: [objects, ...future], dirty: true });
  },

  redo: () => {
    const { past, future, objects } = get();
    if (!future.length) return;
    const [next, ...rest] = future;
    set({ objects: next, past: [...past, objects], future: rest, dirty: true });
  },

  markSaved: () => set({ dirty: false }),

  setTool: (tool) => set({ tool }),
  setStyle: (patch) => set({ style: { ...get().style, ...patch } }),
  setSelection: (selection) => set({ selection }),
  setClipboard: (clipboard) => set({ clipboard }),

  setZoom: (zoom, mode = 'custom') => set({ zoom: clampZoom(zoom), zoomMode: mode }),
  setCurrentPage: (currentPage) => {
    if (get().currentPage !== currentPage) set({ currentPage });
  },
  requestScrollToPage: (page) => {
    const count = get().doc?.pages.length ?? 0;
    const target = Math.max(0, Math.min(count - 1, page));
    set({ scrollRequest: { page: target, nonce: Date.now() + Math.random() }, currentPage: target });
  },

  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setExporting: (exporting) => set({ exporting }),

  pushToast: (toast, durationMs = 4500) => {
    const id = newId();
    set({ toasts: [...get().toasts, { ...toast, id }] });
    if (durationMs > 0) window.setTimeout(() => get().dismissToast(id), durationMs);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      get().confirmDialog?.resolve(false);
      set({ confirmDialog: { ...opts, resolve } });
    }),
  closeConfirm: (ok) => {
    const dialog = get().confirmDialog;
    set({ confirmDialog: null });
    dialog?.resolve(ok);
  },

  askPassword: (fileName, incorrect) =>
    new Promise<string | null>((resolve) => {
      get().passwordPrompt?.resolve(null);
      set({ passwordPrompt: { fileName, incorrect, resolve } });
    }),
  closePasswordPrompt: (password) => {
    const prompt = get().passwordPrompt;
    set({ passwordPrompt: null });
    prompt?.resolve(password);
  },
}));

export const editorStore = useEditorStore;
