import type { PDFDocumentProxy } from 'pdfjs-dist';
import { memo, useEffect, useRef, type RefObject } from 'react';
import { useInView } from '../../hooks/useInView';
import { usePdfPageRender } from '../../hooks/usePdfPageRender';
import { EMPTY_OBJECTS, editorStore } from '../../store/editorStore';
import type { PageInfo } from '../../types';
import { PageEditor } from '../../utils/fabric/PageEditor';
import { registerEditor, unregisterEditor } from '../../utils/fabric/editorRegistry';
import { onFontsChanged } from '../../utils/fonts';
import { getTextLines } from '../../utils/textExtraction';
import { Spinner } from '../common/Spinner';

interface PageViewProps {
  page: PageInfo;
  zoom: number;
  proxy: PDFDocumentProxy;
  scrollRootRef: RefObject<HTMLDivElement | null>;
}

/**
 * One page = a fixed-size placeholder (so scroll height is always correct)
 * that mounts the PDF.js bitmap and the Fabric overlay only while it is
 * near the viewport.
 */
export const PageView = memo(function PageView({ page, zoom, proxy, scrollRootRef }: PageViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inView = useInView(wrapRef, scrollRootRef, '800px 0px');
  const { rendered, error } = usePdfPageRender(canvasRef, proxy, page.index, zoom, inView);

  return (
    <div
      ref={wrapRef}
      data-page={page.index}
      className="relative shrink-0 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.12),0_8px_24px_-12px_rgba(15,23,42,0.25)]"
      style={{ width: page.width * zoom, height: page.height * zoom }}
    >
      {inView && (
        <canvas ref={canvasRef} data-pdf-canvas className="pointer-events-none absolute inset-0 h-full w-full select-none" />
      )}
      {inView && !rendered && !error && (
        <div className="absolute inset-0 flex items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-red-600">{error}</div>}
      {inView && <FabricLayer page={page} zoom={zoom} proxy={proxy} rendered={rendered} />}
      <span className="pointer-events-none absolute -bottom-0 left-1/2 hidden -translate-x-1/2 translate-y-full pt-0.5 text-[11px] font-medium text-slate-400 sm:block">
        {page.index + 1}
      </span>
    </div>
  );
});

/** Hosts the page's PageEditor and keeps it in sync with the store. */
function FabricLayer({ page, zoom, proxy, rendered }: { page: PageInfo; zoom: number; proxy: PDFDocumentProxy; rendered: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PageEditor | null>(null);
  const initialZoom = useRef(zoom);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const editor = new PageEditor(host, page, initialZoom.current);
    editorRef.current = editor;
    registerEditor(page.index, editor);

    const state = editorStore.getState();
    editor.setTool(state.tool);
    editor.setZoom(state.zoom);
    void editor.syncFromStore(state.objects[page.index] ?? EMPTY_OBJECTS);

    // Synchronous store subscription: tool changes must apply within the same event.
    const unsubscribe = editorStore.subscribe((s, prev) => {
      if (s.objects !== prev.objects) void editor.syncFromStore(s.objects[page.index] ?? EMPTY_OBJECTS);
      if (s.tool !== prev.tool) editor.setTool(s.tool);
      if (s.style !== prev.style) editor.onStyleChanged(s.style);
    });
    const offFonts = onFontsChanged(() => editor.refreshText());

    return () => {
      unsubscribe();
      offFonts();
      unregisterEditor(page.index, editor);
      editor.dispose();
      editorRef.current = null;
    };
  }, [page]);

  useEffect(() => {
    editorRef.current?.setZoom(zoom);
  }, [zoom]);

  // Once the bitmap is rendered (fonts resolved), make the original text editable.
  useEffect(() => {
    if (!rendered) return;
    let cancelled = false;
    void getTextLines(proxy, page).then((lines) => {
      if (!cancelled) editorRef.current?.setTextLines(lines);
    });
    return () => {
      cancelled = true;
    };
  }, [rendered, proxy, page]);

  return <div ref={hostRef} className="absolute inset-0" />;
}
