import clsx from 'clsx';

export function Spinner({ label, className }: { label?: string; className?: string }) {
  return (
    <div className={clsx('flex flex-col items-center gap-3 text-slate-500', className)} role="status">
      <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-brand-100 border-t-brand-500" />
      {label && <span className="text-sm font-medium">{label}</span>}
    </div>
  );
}
