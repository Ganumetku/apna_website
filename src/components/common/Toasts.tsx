import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useEditorStore } from '../../store/editorStore';
import type { ToastKind } from '../../types';

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const COLORS: Record<ToastKind, string> = {
  info: 'text-sky-600',
  success: 'text-emerald-600',
  warning: 'text-amber-600',
  error: 'text-red-600',
};

export function Toasts() {
  const toasts = useEditorStore((s) => s.toasts);
  const dismiss = useEditorStore((s) => s.dismissToast);

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[110] flex flex-col items-center gap-2 px-3 sm:inset-x-auto sm:top-auto sm:right-4 sm:bottom-4 sm:items-end">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl bg-white p-4 shadow-lg ring-1 ring-slate-900/10"
          >
            <Icon className={clsx('mt-0.5 h-5 w-5 shrink-0', COLORS[t.kind])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-900">{t.title}</p>
              {t.message && <p className="mt-0.5 text-sm text-slate-600">{t.message}</p>}
            </div>
            <button className="rounded p-0.5 text-slate-400 hover:text-slate-600" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
