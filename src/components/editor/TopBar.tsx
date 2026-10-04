import { Download, PanelLeft, Redo2, Save, SlidersHorizontal, Undo2, X } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import { exportAndDownload, exportAndSendToParent, redo, undo } from '../../utils/editorActions';
import { embedShowDownload, isEmbedMode } from '../../utils/embed';
import { formatBytes } from '../../utils/file';
import { Logo } from '../common/Logo';
import { IconButton } from './IconButton';

export function TopBar() {
  const doc = useEditorStore((s) => s.doc!);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const dirty = useEditorStore((s) => s.dirty);
  const exporting = useEditorStore((s) => s.exporting);
  const sidebarOpen = useEditorStore((s) => s.sidebarOpen);
  const panelOpen = useEditorStore((s) => s.panelOpen);
  const setSidebarOpen = useEditorStore((s) => s.setSidebarOpen);
  const setPanelOpen = useEditorStore((s) => s.setPanelOpen);
  const embed = isEmbedMode();
  const showDownload = !embed || embedShowDownload();

  const close = async () => {
    const store = useEditorStore.getState();
    if (store.dirty) {
      const ok = await store.confirm({
        title: 'Discard your edits?',
        message: embed
          ? 'You have changes that have not been sent back. Closing this document will discard them.'
          : 'You have changes that have not been downloaded. Closing this document will discard them.',
        confirmLabel: 'Discard & close',
        danger: true,
      });
      if (!ok) return;
    }
    store.closeDocument();
  };

  return (
    <header className="z-30 flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-2 sm:gap-2 sm:px-3">
      <IconButton label="Close document" onClick={close}>
        <X className="h-5 w-5" />
      </IconButton>
      {!embed && (
        <div className="hidden sm:block">
          <Logo compact />
        </div>
      )}
      <IconButton label="Pages" active={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>
        <PanelLeft className="h-5 w-5" />
      </IconButton>

      <div className="min-w-0 flex-1 px-1">
        <p className="truncate text-sm font-semibold text-slate-900" title={doc.fileName}>
          {doc.fileName}
          {dirty && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brand-500 align-middle" title="Unsaved changes" />}
        </p>
        <p className="hidden truncate text-xs text-slate-500 sm:block">
          {doc.pages.length} {doc.pages.length === 1 ? 'page' : 'pages'} · {formatBytes(doc.fileSize)}
        </p>
      </div>

      <IconButton label="Undo" shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo}>
        <Undo2 className="h-5 w-5" />
      </IconButton>
      <IconButton label="Redo" shortcut="Ctrl+Y" disabled={!canRedo} onClick={redo}>
        <Redo2 className="h-5 w-5" />
      </IconButton>
      <IconButton label="Properties" active={panelOpen} onClick={() => setPanelOpen(!panelOpen)}>
        <SlidersHorizontal className="h-5 w-5" />
      </IconButton>

      {showDownload && (
        <button
          type="button"
          onClick={() => void exportAndDownload()}
          disabled={exporting}
          className={
            embed
              ? 'ml-1 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:opacity-60'
              : 'ml-1 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-bold text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 disabled:opacity-60 sm:px-5'
          }
        >
          <Download className="h-4 w-4" />
          <span className={embed ? 'hidden sm:inline' : 'hidden sm:inline'}>Download</span>
        </button>
      )}
      {embed && (
        <button
          type="button"
          onClick={() => void exportAndSendToParent()}
          disabled={exporting}
          className="ml-1 inline-flex h-10 items-center gap-2 rounded-lg bg-brand-500 px-3 text-sm font-bold whitespace-nowrap text-white shadow-sm shadow-brand-500/30 transition hover:bg-brand-600 disabled:opacity-60 sm:px-5"
        >
          <Save className="h-4 w-4" />
          <span className="hidden sm:inline">Save & Continue</span>
        </button>
      )}
    </header>
  );
}
