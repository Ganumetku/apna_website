export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2 select-none">
      <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
      {!compact && (
        <span className="text-lg font-extrabold tracking-tight text-slate-900">
          Edit<span className="text-brand-500">PDF</span>
        </span>
      )}
    </div>
  );
}
