import { useEffect, useState, type RefObject } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';

const MAX_PIXELS = 16_000_000;

/**
 * Render one PDF page into `canvasRef` at `cssScale` (CSS px per PDF point).
 *
 * Renders off-screen first and blits when done, so zooming never flashes a
 * blank page: until the sharp bitmap is ready the old one is just stretched
 * by CSS. Re-renders are debounced while the user is zooming.
 */
export function usePdfPageRender(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  proxy: PDFDocumentProxy,
  pageIndex: number,
  cssScale: number,
  enabled: boolean,
  debounceMs = 120,
): { rendered: boolean; error: string | null } {
  const [rendered, setRendered] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setRendered(false);
      return;
    }
    let cancelled = false;
    let task: RenderTask | null = null;

    const timer = window.setTimeout(async () => {
      try {
        const page = await proxy.getPage(pageIndex + 1);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let scale = cssScale * dpr;
        const base = page.getViewport({ scale: 1 });
        if (base.width * base.height * scale * scale > MAX_PIXELS) {
          scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
        }
        const viewport = page.getViewport({ scale });
        const off = document.createElement('canvas');
        off.width = Math.ceil(viewport.width);
        off.height = Math.ceil(viewport.height);
        task = page.render({ canvas: off, viewport, background: '#ffffff' });
        await task.promise;
        if (cancelled) return;
        const target = canvasRef.current;
        if (!target) return;
        target.width = off.width;
        target.height = off.height;
        target.getContext('2d')?.drawImage(off, 0, 0);
        off.width = off.height = 0;
        setRendered(true);
        setError(null);
      } catch (err) {
        if (cancelled || (err as { name?: string })?.name === 'RenderingCancelledException') return;
        console.error(err);
        setError('This page could not be rendered.');
      }
    }, rendered ? debounceMs : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
    // `rendered` is intentionally not a dependency: it only picks the debounce delay.
  }, [proxy, pageIndex, cssScale, enabled, canvasRef, debounceMs]);

  return { rendered, error };
}
