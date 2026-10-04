import clsx from 'clsx';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { memo, useEffect, useRef, type RefObject } from 'react';
import { useInView } from '../../hooks/useInView';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePdfPageRender } from '../../hooks/usePdfPageRender';
import { useEditorStore } from '../../store/editorStore';
import type { PageInfo } from '../../types';

const THUMB_WIDTH = 120;

export function ThumbnailSidebar() {
  const doc = useEditorStore((s) => s.doc!);
  const open = useEditorStore((s) => s.sidebarOpen);
  const setOpen = useEditorStore((s) => s.setSidebarOpen);
  const currentPage = useEditorStore((s) => s.currentPage);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active thumbnail visible as the user scrolls the document.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-thumb="${currentPage}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [currentPage, open]);

  if (!open) return null;

  return (
    <>
      {!isDesktop && <div className="absolute inset-0 z-30 bg-slate-900/30" onClick={() => setOpen(false)} />}
      <aside
        className={clsx(
          'flex w-44 shrink-0 flex-col border-r border-slate-200 bg-slate-50',
          !isDesktop && 'absolute inset-y-0 left-0 z-40 shadow-xl',
        )}
        aria-label="Pages"
      >
        <div className="flex h-10 shrink-0 items-center justify-between px-3 text-xs font-semibold tracking-wide text-slate-500 uppercase">
          Pages <span className="font-medium normal-case">{doc.pages.length}</span>
        </div>
        <div ref={listRef} className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-3 pb-6">
          {doc.pages.map((page) => (
            <Thumbnail
              key={`${doc.id}-${page.index}`}
              page={page}
              proxy={doc.proxy}
              rootRef={listRef}
              active={page.index === currentPage}
              onSelect={() => {
                useEditorStore.getState().requestScrollToPage(page.index);
                if (!isDesktop) setOpen(false);
              }}
            />
          ))}
        </div>
      </aside>
    </>
  );
}

interface ThumbnailProps {
  page: PageInfo;
  proxy: PDFDocumentProxy;
  rootRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  onSelect: () => void;
}

const Thumbnail = memo(function Thumbnail({ page, proxy, rootRef, active, onSelect }: ThumbnailProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inView = useInView(ref, rootRef, '300px 0px');
  const scale = THUMB_WIDTH / page.width;
  const { rendered } = usePdfPageRender(canvasRef, proxy, page.index, scale, inView, 0);
  const edited = useEditorStore((s) => (s.objects[page.index]?.length ?? 0) > 0);

  return (
    <button
      ref={ref}
      type="button"
      data-thumb={page.index}
      onClick={onSelect}
      className="group flex w-full flex-col items-center gap-1.5"
      aria-label={`Go to page ${page.index + 1}`}
      aria-current={active ? 'page' : undefined}
    >
      <div
        className={clsx(
          'relative overflow-hidden rounded bg-white shadow-sm ring-2 transition',
          active ? 'ring-brand-500' : 'ring-transparent group-hover:ring-slate-300',
        )}
        style={{ width: THUMB_WIDTH, height: page.height * scale }}
      >
        {inView && <canvas ref={canvasRef} className="h-full w-full" />}
        {!rendered && <div className="absolute inset-0 animate-pulse bg-slate-100" />}
        {edited && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-brand-500 ring-2 ring-white" title="Edited" />}
      </div>
      <span className={clsx('text-xs font-medium', active ? 'text-brand-600' : 'text-slate-500')}>{page.index + 1}</span>
    </button>
  );
});
