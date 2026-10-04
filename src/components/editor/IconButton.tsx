import clsx from 'clsx';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut?: string;
  active?: boolean;
  children: ReactNode;
  showLabel?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, shortcut, active, children, className, showLabel, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      {...props}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg text-slate-600 transition',
        'hover:bg-slate-100 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-35',
        'focus-visible:ring-2 focus-visible:ring-brand-200 focus-visible:outline-none',
        showLabel ? 'h-9 px-2.5 text-sm font-medium' : 'h-9 w-9',
        active && 'bg-brand-50 text-brand-600 ring-1 ring-brand-200 hover:bg-brand-50 hover:text-brand-600',
        className,
      )}
    >
      {children}
      {showLabel && <span>{label}</span>}
    </button>
  );
});
