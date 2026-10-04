import { useEditorStore } from '../../store/editorStore';
import { Spinner } from './Spinner';

export function LoadingOverlay() {
  const loading = useEditorStore((s) => s.loading);
  const exporting = useEditorStore((s) => s.exporting);
  const message = exporting ? 'Building your PDF…' : loading?.message;
  if (!message) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-white/70 backdrop-blur-sm">
      <div className="rounded-2xl bg-white px-10 py-8 shadow-xl ring-1 ring-slate-900/5">
        <Spinner label={message} />
      </div>
    </div>
  );
}
