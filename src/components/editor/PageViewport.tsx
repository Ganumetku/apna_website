import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { clampZoom, useEditorStore } from '../../store/editorStore';
import { PageView } from './PageView';

const PAGE_GAP = 16;

const paddingFor = (width: number) => (width < 640 ? 8 : 28);

/**
 * Scrollable column of pages. Handles fit-width, zoom anchoring, Ctrl+wheel
 * and pinch zoom, the current-page indicator and scroll-to-page requests.
 */
export function PageViewport() {
  const doc = useEditorStore((s) => s.doc!);
  const zoom = useEditorStore((s) => s.zoom);
  const zoomMode = useEditorStore((s) => s.zoomMode);
  const scrollRequest = useEditorStore((s) => s.scrollRequest);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setCurrentPage = useEditorStore((s) => s.setCurrentPage);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevZoom = useRef(zoom);

  const maxPageWidth = useMemo(() => Math.max(...doc.pages.map((p) => p.width)), [doc]);

  // Top offset (px) of each page at the current zoom — used for page tracking and navigation.
  const pageTops = useMemo(() => {
    const pad = paddingFor(scrollRef.current?.clientWidth ?? window.innerWidth);
    const tops: number[] = [];
    let y = pad;
    for (const p of doc.pages) {
      tops.push(y);
      y += p.height * zoom + PAGE_GAP;
    }
    return tops;
  }, [doc, zoom]);

  // Fit-width: recompute whenever the container resizes (rotation, panels toggling…).
  useLayoutEffect(() => {
    if (zoomMode !== 'fit-width') return;
    const el = scrollRef.current;
    if (!el) return;
    const fit = () => {
      const pad = paddingFor(el.clientWidth);
      const z = clampZoom((el.clientWidth - pad * 2) / maxPageWidth);
      // On wide screens a full-width A4 page is huge; cap like other viewers do.
      setZoom(Math.min(z, 1.75), 'fit-width');
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [zoomMode, maxPageWidth, setZoom]);

  // Keep the point at the centre of the viewport fixed while zooming.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const ratio = zoom / prevZoom.current;
    prevZoom.current = zoom;
    if (!el || ratio === 1) return;
    const cx = el.scrollLeft + el.clientWidth / 2;
    const cy = el.scrollTop + el.clientHeight / 2;
    el.scrollLeft = cx * ratio - el.clientWidth / 2;
    el.scrollTop = cy * ratio - el.clientHeight / 2;
  }, [zoom]);

  // Current page = the last page whose top is above the upper third of the viewport.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const probe = el.scrollTop + el.clientHeight / 3;
        let lo = 0;
        let hi = pageTops.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (pageTops[mid] <= probe) lo = mid;
          else hi = mid - 1;
        }
        setCurrentPage(lo);
      });
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener('scroll', onScroll);
    };
  }, [pageTops, setCurrentPage]);

  // Read tops through a ref: navigation should react to new requests, not to zoom changes.
  const pageTopsRef = useRef(pageTops);
  useLayoutEffect(() => {
    pageTopsRef.current = pageTops;
  }, [pageTops]);

  useEffect(() => {
    if (!scrollRequest) return;
    const el = scrollRef.current;
    const top = pageTopsRef.current[scrollRequest.page];
    if (el && top !== undefined) el.scrollTo({ top: top - 8, behavior: 'smooth' });
  }, [scrollRequest]);

  // Ctrl/Cmd + wheel (and trackpad pinch, which browsers report the same way) zooms.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { zoom: z } = useEditorStore.getState();
      setZoom(clampZoom(z * Math.exp(-e.deltaY * 0.01)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoom]);

  // Two-finger pinch zoom on touch screens.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let start: { dist: number; zoom: number } | null = null;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { dist: dist(e.touches), zoom: useEditorStore.getState().zoom };
    };
    const onMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 2) return;
      e.preventDefault();
      setZoom(clampZoom(start.zoom * (dist(e.touches) / start.dist)));
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [setZoom]);

  const pad = paddingFor(scrollRef.current?.clientWidth ?? window.innerWidth);

  return (
    <div ref={scrollRef} className="scrollbar-thin relative min-h-0 flex-1 overflow-auto" style={{ touchAction: 'pan-x pan-y' }}>
      <div className="flex w-max min-w-full flex-col items-center" style={{ padding: pad, paddingBottom: pad + 72, gap: PAGE_GAP }}>
        {doc.pages.map((page) => (
          <PageView key={`${doc.id}-${page.index}`} page={page} zoom={zoom} proxy={doc.proxy} scrollRootRef={scrollRef} />
        ))}
      </div>
    </div>
  );
}
