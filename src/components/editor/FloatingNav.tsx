import clsx from 'clsx';
import { ChevronDown, ChevronUp, MoveHorizontal, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useState } from 'react';
import { MAX_ZOOM, MIN_ZOOM, useEditorStore } from '../../store/editorStore';
import { IconButton } from './IconButton';

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5];

const nextStep = (z: number) => ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM;
const prevStep = (z: number) => [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM;

/** Zoom controls + page navigation, floating over the bottom of the page view. */
export function FloatingNav() {
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const setZoom = useEditorStore((s) => s.setZoom);
  const currentPage = useEditorStore((s) => s.currentPage);
  const pageCount = useEditorStore((s) => s.doc?.pages.length ?? 0);
  const goTo = useEditorStore((s) => s.requestScrollToPage);
  const [pageInput, setPageInput] = useState(String(currentPage + 1));

  useEffect(() => setPageInput(String(currentPage + 1)), [currentPage]);

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10);
    if (Number.isFinite(n)) goTo(n - 1);
    else setPageInput(String(currentPage + 1));
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center px-2 sm:bottom-5">
      <div className="pointer-events-auto flex items-center gap-0.5 rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-slate-900/10 backdrop-blur">
        <IconButton label="Zoom out" shortcut="Ctrl+-" onClick={() => setZoom(prevStep(zoom))} disabled={zoom <= MIN_ZOOM}>
          <ZoomOut className="h-4 w-4" />
        </IconButton>
        <select
          aria-label="Zoom level"
          className="h-9 w-[4.5rem] cursor-pointer appearance-none rounded-lg bg-transparent text-center text-sm font-semibold text-slate-700 tabular-nums hover:bg-slate-100 focus:outline-none"
          value="current"
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'fit') setZoom(zoom, 'fit-width');
            else setZoom(Number(v));
          }}
        >
          <option value="current" hidden>
            {Math.round(zoom * 100)}%
          </option>
          <option value="fit">Fit width</option>
          {ZOOM_STEPS.map((s) => (
            <option key={s} value={s}>
              {s * 100}%
            </option>
          ))}
        </select>
        <IconButton label="Zoom in" shortcut="Ctrl++" onClick={() => setZoom(nextStep(zoom))} disabled={zoom >= MAX_ZOOM}>
          <ZoomIn className="h-4 w-4" />
        </IconButton>
        <IconButton
          label="Fit width"
          shortcut="Ctrl+0"
          active={zoomMode === 'fit-width'}
          className="hidden sm:inline-flex"
          onClick={() => setZoom(zoom, 'fit-width')}
        >
          <MoveHorizontal className="h-4 w-4" />
        </IconButton>

        <span className="mx-1 h-6 w-px bg-slate-200" />

        <IconButton label="Previous page" onClick={() => goTo(currentPage - 1)} disabled={currentPage <= 0}>
          <ChevronUp className="h-4 w-4" />
        </IconButton>
        <div className="flex items-center gap-1 px-1 text-sm text-slate-600 tabular-nums">
          <input
            aria-label="Current page"
            inputMode="numeric"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
            onBlur={commitPageInput}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className={clsx(
              'h-8 rounded-md border border-slate-200 bg-white text-center font-semibold text-slate-800 focus:border-brand-500 focus:outline-none',
              pageCount >= 100 ? 'w-12' : 'w-9',
            )}
          />
          <span>/ {pageCount}</span>
        </div>
        <IconButton label="Next page" onClick={() => goTo(currentPage + 1)} disabled={currentPage >= pageCount - 1}>
          <ChevronDown className="h-4 w-4" />
        </IconButton>
      </div>
    </div>
  );
}
