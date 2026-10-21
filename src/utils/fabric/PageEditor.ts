import { ActiveSelection, Canvas, Color, PencilBrush, Rect, Textbox, util } from 'fabric';
import type { Ellipse, FabricObject, Line, Path, TPointerEvent, TPointerEventInfo } from 'fabric';
import { EMPTY_OBJECTS, editorStore } from '../../store/editorStore';
import type { ObjectKind, PageInfo, SerializedObject, StyleState, ToolType } from '../../types';
import {
  ensureFont,
  ensureFontsForObjects,
  getFontDef,
  isBold,
  loadOverlayWeightFace,
  loadPdfFace,
  overlayFontStack,
} from '../fonts';
import { newId } from '../id';
import { detectUnderline, sampleLineColors, sampleLineLooksBold, type TextLine, type TextSpan } from '../textExtraction';
import { createBox, createImage, createLine, createText, reidentify, type BoxKind, type LineKind } from './objectFactory';
import { forEachEditor } from './editorRegistry';
import { applyStyle, readStyle } from './styleMapping';
import './setup';

const ERASER_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='%23111827' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21'/%3E%3Cpath d='M22 21H7'/%3E%3Cpath d='m5 11 9 9'/%3E%3C/svg%3E\") 4 20, crosshair";

/** Max backing-store pixels for the overlay; iOS Safari refuses canvases above ~16.7M px. */
const MAX_CANVAS_PIXELS = 16_000_000;

type Draft =
  | { type: 'box'; kind: BoxKind; startX: number; startY: number; obj: Rect | Ellipse }
  | { type: 'line'; kind: LineKind; startX: number; startY: number; obj: Line };

const SHAPE_TOOLS_RETURN_TO_SELECT: ReadonlySet<ToolType> = new Set(['rect', 'ellipse', 'line', 'arrow', 'whiteout']);

const isLightPaper = (hex: string) => {
  const n = hex.replace('#', '');
  if (n.length < 6) return true;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 210;
};

/** Stable JSON fingerprint that skips large image payloads. */
const fingerprint = (objs: SerializedObject[]) =>
  JSON.stringify(objs, (k, v) => (k === 'src' && typeof v === 'string' ? `${v.length}:${v.slice(-32)}` : v));

/**
 * Owns the Fabric canvas for one PDF page.
 *
 * The Fabric viewportTransform is [zoom,0,0,zoom,0,0], so every object
 * coordinate is in PDF display points regardless of zoom. Zooming only
 * changes the canvas size and viewport — objects are never rescaled.
 *
 * Data flow: user action -> Fabric -> `commit()` serialises the page into the
 * store (one undo step). Undo/redo replace the store array, and
 * `syncFromStore()` rebuilds the canvas when the array identity changes.
 */
export class PageEditor {
  readonly canvas: Canvas;
  private tool: ToolType = 'select';
  private lastSynced: SerializedObject[] | null = null;
  private loadToken = 0;
  private loading = false;
  private disposed = false;
  private draft: Draft | null = null;
  private erasing = false;
  private erasedAny = false;
  private commitTimer: number | undefined;
  /** Editable lines of the original PDF text (see textExtraction.ts). */
  private textLines: TextLine[] = [];
  private hoverRect: Rect | null = null;
  private hoveredLine: TextLine | null = null;
  private convertingLine = false;

  constructor(
    host: HTMLElement,
    readonly page: PageInfo,
    zoom: number,
  ) {
    const el = document.createElement('canvas');
    host.appendChild(el);
    this.canvas = new Canvas(el, {
      width: page.width * zoom,
      height: page.height * zoom,
      preserveObjectStacking: true,
      // Pointer events unify mouse, touch and stylus (Apple Pencil, Wacom).
      enablePointerEvents: true,
      enableRetinaScaling: this.retinaAllowed(zoom),
      stopContextMenu: true,
      targetFindTolerance: 6,
      selectionColor: 'rgba(229, 50, 45, 0.08)',
      selectionBorderColor: '#e5322d',
      selectionLineWidth: 1,
      containerClass: 'fabric-page-layer',
    });
    this.canvas.setZoom(zoom);
    this.bindEvents();
    this.updateTouchAction();
  }

  /* ------------------------------------------------------------ lifecycle */

  private retinaAllowed(zoom: number) {
    const dpr = window.devicePixelRatio || 1;
    return this.page.width * this.page.height * zoom * zoom * dpr * dpr <= MAX_CANVAS_PIXELS;
  }

  setZoom(zoom: number) {
    this.canvas.enableRetinaScaling = this.retinaAllowed(zoom);
    this.canvas.setDimensions({ width: this.page.width * zoom, height: this.page.height * zoom });
    this.canvas.setZoom(zoom);
    this.canvas.calcOffset();
    this.canvas.requestRenderAll();
  }

  dispose() {
    if (this.disposed) return;
    this.flush();
    this.disposed = true;
    const sel = editorStore.getState().selection;
    if (sel?.pageIndex === this.page.index) editorStore.getState().setSelection(null);
    // Remove only our own nodes: under StrictMode a new editor may already share the host.
    const { wrapperEl, lowerCanvasEl } = this.canvas;
    void this.canvas.dispose().finally(() => {
      wrapperEl?.remove();
      lowerCanvasEl.remove();
    });
  }

  /** Rebuild the canvas from the store when the page's array changed (undo/redo, paste on unmounted page…). */
  async syncFromStore(objs: SerializedObject[] = EMPTY_OBJECTS) {
    if (objs === this.lastSynced || this.disposed) return;
    this.lastSynced = objs;
    const token = ++this.loadToken;
    this.loading = true;
    try {
      await ensureFontsForObjects(objs);
      const live = await util.enlivenObjects<FabricObject>(objs as unknown as Record<string, unknown>[]);
      if (token !== this.loadToken || this.disposed) return;
      this.canvas.discardActiveObject();
      this.canvas.remove(...this.canvas.getObjects());
      this.hoverRect = null;
      this.hoveredLine = null;
      for (const obj of live) {
        this.applyFlags(obj);
        this.canvas.add(obj);
      }
      this.canvas.requestRenderAll();
    } finally {
      if (token === this.loadToken) this.loading = false;
    }
  }

  serialize(): SerializedObject[] {
    return this.canvas.toObject().objects as unknown as SerializedObject[];
  }

  /** Push the current canvas state into the store as one undo step. */
  commit() {
    window.clearTimeout(this.commitTimer);
    this.commitTimer = undefined;
    if (this.loading || this.disposed) return;
    const objs = this.serialize();
    if (this.lastSynced && fingerprint(objs) === fingerprint(this.lastSynced)) return;
    this.lastSynced = objs;
    editorStore.getState().commitPage(this.page.index, objs);
  }

  /** Coalesce rapid changes (slider drags, arrow-key nudges) into one undo step. */
  scheduleCommit(delay = 400) {
    window.clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.commit(), delay);
  }

  /** Exit text editing and commit anything pending. */
  flush() {
    if (this.disposed) return;
    const active = this.canvas.getActiveObject();
    if (active instanceof Textbox && active.isEditing) active.exitEditing();
    if (this.commitTimer !== undefined) this.commit();
  }

  /* ----------------------------------------------------------------- tools */

  setTool(tool: ToolType) {
    if (tool === this.tool) return;
    this.tool = tool;
    const c = this.canvas;
    if (tool !== 'select') this.discard();
    c.isDrawingMode = tool === 'pen';
    c.selection = tool === 'select';
    c.skipTargetFind = !(tool === 'select' || tool === 'eraser' || tool === 'text');
    c.defaultCursor = this.defaultCursor();
    if (tool === 'pen') this.configureBrush(editorStore.getState().style);
    this.setHoveredLine(null);
    c.getObjects().forEach((o) => this.applyFlags(o));
    this.updateTouchAction();
    c.requestRenderAll();
  }

  private defaultCursor() {
    const t = this.tool;
    return t === 'select' ? 'default' : t === 'eraser' ? ERASER_CURSOR : t === 'text' ? 'text' : 'crosshair';
  }

  /* ------------------------------------------------- existing PDF text */

  setTextLines(lines: TextLine[]) {
    this.textLines = lines;
  }

  private canEditOriginalText() {
    return (this.tool === 'select' || this.tool === 'text') && !this.loading;
  }

  /** Lines already replaced by an editable box are hidden from hit-testing. */
  private lineAt(x: number, y: number): TextLine | null {
    if (!this.textLines.length) return null;
    const taken = new Set<string>();
    for (const o of this.canvas.getObjects()) if (o.sourceLineId) taken.add(o.sourceLineId);
    const pad = 2;
    for (let i = this.textLines.length - 1; i >= 0; i -= 1) {
      const l = this.textLines[i];
      if (taken.has(l.id)) continue;
      if (x >= l.left - pad && x <= l.left + l.width + pad && y >= l.top - pad && y <= l.top + l.height + pad) return l;
    }
    return null;
  }

  private setHoveredLine(line: TextLine | null) {
    if (line === this.hoveredLine) return;
    this.hoveredLine = line;
    const c = this.canvas;
    if (!line) {
      if (this.hoverRect) {
        c.remove(this.hoverRect);
        this.hoverRect = null;
        c.requestRenderAll();
      }
      c.setCursor(this.defaultCursor());
      return;
    }
    if (!this.hoverRect) {
      this.hoverRect = new Rect({
        fill: 'rgba(229, 50, 45, 0.08)',
        stroke: '#e5322d',
        strokeWidth: 1,
        strokeUniform: true,
        originX: 'left',
        originY: 'top',
        selectable: false,
        evented: false,
        excludeFromExport: true, // never serialised into the store
        objectCaching: false,
      });
      c.add(this.hoverRect);
    }
    this.hoverRect.set({ left: line.left - 1, top: line.top - 1, width: line.width + 2, height: line.height + 2 });
    this.hoverRect.setCoords();
    c.setCursor('text');
    c.requestRenderAll();
  }

  /**
   * Click-to-edit like iLovePDF: keep the printed glyphs until the user
   * actually types. The Textbox is a transparent caret/selection overlay;
   * white-out + ink paint happen on the first real change.
   */
  private async editOriginalLine(line: TextLine, e: TPointerEvent) {
    if (this.convertingLine) return;
    this.convertingLine = true;
    this.setHoveredLine(null);
    try {
      const caps = line.smallCaps && !getFontDef(line.fontId).smallCaps;
      const spans: TextSpan[] = (line.spans.length ? line.spans : [{ text: line.text, bold: line.bold, italic: line.italic }]).map(
        (span) => ({ ...span, text: caps ? span.text.toUpperCase() : span.text }),
      );
      const pdfCanvas = document.querySelector<HTMLCanvasElement>(`[data-page="${this.page.index}"] canvas[data-pdf-canvas]`);
      const colors = pdfCanvas ? sampleLineColors(pdfCanvas, line, this.page.width) : { ink: '#000000', paper: '#ffffff' };
      const underline = pdfCanvas ? detectUnderline(pdfCanvas, line, this.page.width) : false;
      const paper = isLightPaper(colors.paper) ? '#ffffff' : colors.paper;
      const pdfFamily = line.pdfFamily || line.fontName;
      const pdfFace = !!pdfFamily;
      const visualBold = line.bold || spans.some((s) => s.bold) || !!(pdfCanvas && sampleLineLooksBold(pdfCanvas, line, this.page.width));
      const visualItalic = line.italic || spans.some((s) => s.italic);
      await Promise.all(spans.map((span) => ensureFont(line.fontId, span.bold, span.italic)));
      await loadPdfFace(pdfFamily, line.fontSize);
      await loadOverlayWeightFace(line.cssFamily, visualBold, visualItalic, line.fontId);
      await document.fonts.ready;
      if (this.disposed) return;

      const text = spans.map((span) => span.text).join('');
      // Always paint the PDF FontFace at its registered weight (400). Visual
      // bold is in the outlines / the weight-400 OS fallback, never CSS 700.
      const fontWeight = pdfFace ? 'normal' : visualBold ? 'bold' : 'normal';
      const fontStyle = pdfFace ? 'normal' : visualItalic ? 'italic' : 'normal';
      const padX = Math.max(1, line.fontSize * 0.08);
      const coverTop = line.baseline - line.fontSize * 0.82;
      const coverHeight = line.baseline + line.fontSize * 0.24 - coverTop;
      const tb = new Textbox(text, {
        id: newId(),
        kind: 'text',
        sourceLineId: line.id,
        sourceOriginalText: text,
        sourceFontWeight: fontWeight,
        sourceFontStyle: fontStyle,
        sourcePdfFace: pdfFace,
        sourceInk: colors.ink,
        sourcePaper: paper,
        sourceVisualBold: visualBold,
        sourceCssFamily: line.cssFamily,
        sourceCoverDx: -padX,
        sourceCoverDy: 0,
        sourceCoverWidth: line.width + padX * 2,
        sourceCoverHeight: coverHeight,
        sourcePainted: false,
        originX: 'left',
        originY: 'top',
        left: line.left,
        fontFamily: overlayFontStack(line.fontId, line.cssFamily, pdfFamily, visualBold, visualItalic),
        fontSize: line.fontSize,
        fontWeight,
        fontStyle,
        fill: 'rgba(0,0,0,0)',
        backgroundColor: '',
        stroke: null,
        strokeWidth: 0,
        underline,
        lineHeight: 1,
        splitByGrapheme: false,
        padding: 0,
        lockRotation: true,
        selectionColor: 'rgba(229, 50, 45, 0.22)',
        editingBorderColor: '#e5322d',
        cursorColor: '#e5322d',
        width: Math.max(2, line.width),
        objectCaching: false,
      });
      this.applySpanStyles(tb, spans, line, visualBold, visualItalic);
      this.fitOverlayToOriginal(tb, line.width);
      tb.set({ width: Math.max(tb.width + Math.max(6, line.fontSize * 0.35), line.width + 4) });
      tb.initDimensions();
      const internals = tb as unknown as { _fontSizeFraction: number; getHeightOfLineImpl(i: number): number };
      const baselineOffset = internals.getHeightOfLineImpl(0) * (1 - internals._fontSizeFraction);
      const top = line.baseline - baselineOffset;
      tb.set({ top, sourceCoverDy: coverTop - top });

      const c = this.canvas;
      c.add(tb);
      editorStore.getState().setTool('select');
      this.applyFlags(tb);
      c.setActiveObject(tb);
      tb.enterEditing(e);
      tb.hiddenTextarea?.focus();
      c.requestRenderAll();
    } finally {
      this.convertingLine = false;
    }
  }

  /** Per-run faces so a bold label next to regular text keeps both. */
  private applySpanStyles(tb: Textbox, spans: TextSpan[], line: TextLine, visualBold: boolean, visualItalic: boolean) {
    if (spans.length <= 1) return;
    const chars: Record<number, Record<string, unknown>> = {};
    let i = 0;
    for (const span of spans) {
      const family = overlayFontStack(
        line.fontId,
        span.cssFamily || line.cssFamily,
        span.pdfFamily || line.pdfFamily,
        span.bold || visualBold,
        span.italic || visualItalic,
      );
      for (const _ch of span.text) {
        chars[i] = { fontFamily: family, fontWeight: 'normal', fontStyle: 'normal' };
        i += 1;
      }
    }
    tb.set('styles', { 0: chars });
  }

  /** Cover the printed glyphs and paint ink — only after the words change. */
  private materializeOverlay(tb: Textbox) {
    if (!tb.sourceLineId || tb.sourcePainted) return;
    tb.sourcePainted = true;
    if (!this.coverFor(tb)) {
      const cover = new Rect({
        id: newId(),
        kind: 'whiteout',
        sourceLineId: tb.sourceLineId,
        originX: 'left',
        originY: 'top',
        left: tb.left + (tb.sourceCoverDx ?? 0),
        top: tb.top + (tb.sourceCoverDy ?? 0),
        width: tb.sourceCoverWidth ?? tb.getScaledWidth(),
        height: tb.sourceCoverHeight ?? tb.fontSize,
        fill: tb.sourcePaper || '#ffffff',
        stroke: null,
        strokeWidth: 0,
        selectable: false,
        evented: false,
        objectCaching: false,
      });
      const c = this.canvas;
      c.add(cover);
      const tbIndex = c.getObjects().indexOf(tb);
      while (c.getObjects().indexOf(cover) > tbIndex && tbIndex >= 0) c.sendObjectBackwards(cover);
    }
    tb.set({ fill: tb.sourceInk || '#000000', backgroundColor: '', stroke: null, strokeWidth: 0 });
    this.pinOverlayFace(tb);
    this.syncCoverToText(tb);
  }

  private coverFor(tb: Textbox) {
    return this.canvas.getObjects().find((o) => o.kind === 'whiteout' && o.sourceLineId === tb.sourceLineId) ?? null;
  }

  private coversForLine(lineId: string) {
    return this.canvas.getObjects().filter((o) => o.kind === 'whiteout' && o.sourceLineId === lineId);
  }

  /** Keep the white-out glued under the overlay, and at least as wide as the new words. */
  private syncCoverToText(tb: Textbox) {
    const cover = this.coverFor(tb);
    if (!cover) return;
    const pad = Math.max(2, tb.fontSize * 0.16);
    const minW = tb.sourceCoverWidth ?? 0;
    cover.set({
      left: tb.left + (tb.sourceCoverDx ?? 0),
      top: tb.top + (tb.sourceCoverDy ?? 0),
      width: Math.max(minW, tb.getScaledWidth() + pad),
      height: tb.sourceCoverHeight ?? cover.height,
    });
    cover.setCoords();
  }

  /**
   * Fabric can drop object-level weight when a character is replaced. Put
   * the printed line's face back so one keystroke cannot thin the row.
   */
  private pinOverlayFace(tb: Textbox) {
    if (!tb.sourceLineId || tb.sourceFontWeight == null) return;
    const fontWeight = tb.sourcePdfFace ? 'normal' : isBold(tb.sourceFontWeight) ? 'bold' : 'normal';
    const fontStyle = tb.sourcePdfFace ? 'normal' : tb.sourceFontStyle === 'italic' ? 'italic' : 'normal';
    const next: Record<string, unknown> = { fontWeight, fontStyle, stroke: null, strokeWidth: 0 };
    if (tb.sourcePainted) next.fill = tb.sourceInk || (typeof tb.fill === 'string' && tb.fill ? tb.fill : '#000000');
    tb.set(next);
  }

  /**
   * Keep the overlay on the original footprint. Prefer the PDF's own face
   * (scale ≈ 1). Only squeeze when a substitute font is wider, via scaleX
   * so the space in "Pankaj Sharma" stays a space.
   */
  private fitOverlayToOriginal(tb: Textbox, targetWidth: number) {
    const width = Math.max(2, targetWidth);
    tb.set({ charSpacing: 0, scaleX: 1, width: Math.max(width * 4, 800) });
    tb.initDimensions();
    const natural = Math.max(2, tb.calcTextWidth());
    const ratio = width / natural;
    let sx = 1;
    if (!tb.sourcePdfFace) {
      sx = Math.abs(ratio - 1) < 0.02 ? 1 : Math.max(0.7, Math.min(1.25, ratio));
      if (isBold(tb.fontWeight) && sx < 0.97) sx = 0.97;
    }
    tb.set({ width: natural, scaleX: sx });
    tb.initDimensions();
  }

  onStyleChanged(style: StyleState) {
    if (this.tool === 'pen') this.configureBrush(style);
  }

  private configureBrush(style: StyleState) {
    const brush = new PencilBrush(this.canvas);
    const color = new Color(style.strokeColor);
    color.setAlpha(style.opacity);
    brush.color = color.toRgba();
    brush.width = style.strokeWidth;
    brush.decimate = 0.6;
    brush.strokeLineCap = 'round';
    brush.strokeLineJoin = 'round';
    this.canvas.freeDrawingBrush = brush;
  }

  private applyFlags(obj: FabricObject) {
    const t = this.tool;
    // White-out boxes that hide original PDF glyphs must stay put — dragging
    // them would uncover the printed text underneath the overlay.
    const lockCover = obj.kind === 'whiteout' && !!obj.sourceLineId;
    obj.set({
      selectable: !lockCover && t === 'select',
      evented: !lockCover && (t === 'select' || t === 'eraser' || (t === 'text' && obj.kind === 'text')),
      hoverCursor: t === 'eraser' ? ERASER_CURSOR : t === 'text' ? 'text' : 'move',
    });
  }

  /**
   * On touch devices, let one-finger drags scroll the document unless the
   * user is drawing or has something selected (then drags move it).
   */
  private updateTouchAction() {
    const pannable = this.tool === 'select' && !this.canvas.getActiveObject();
    this.canvas.allowTouchScrolling = pannable;
    const style = pannable ? 'pan-x pan-y' : 'none';
    this.canvas.upperCanvasEl.style.touchAction = style;
    this.canvas.lowerCanvasEl.style.touchAction = style;
  }

  /* ---------------------------------------------------------------- events */

  private bindEvents() {
    const c = this.canvas;
    c.on('mouse:down', (opt) => this.onPointerDown(opt));
    c.on('mouse:move', (opt) => this.onPointerMove(opt));
    c.on('mouse:up', () => this.onPointerUp());
    c.on('mouse:out', ({ target }) => {
      if (!target) this.setHoveredLine(null);
    });

    c.on('object:moving', ({ target }) => {
      if (target instanceof Textbox && target.sourceLineId) this.syncCoverToText(target);
    });
    c.on('object:scaling', ({ target }) => {
      if (target instanceof Textbox && target.sourceLineId) this.syncCoverToText(target);
    });
    c.on('object:modified', ({ target }) => {
      if (target) this.normalizeTextScale(target);
      if (target instanceof Textbox && target.sourceLineId) this.syncCoverToText(target);
      this.commit();
      this.emitSelection();
    });
    c.on('path:created', ({ path }) => {
      const style = editorStore.getState().style;
      (path as Path).set({ id: newId(), kind: 'path', stroke: style.strokeColor, opacity: style.opacity });
      this.applyFlags(path);
      this.commit();
    });
    c.on('text:editing:entered', () => this.emitSelection());
    c.on('text:editing:exited', ({ target }) => {
      if (target instanceof Textbox && target.sourceLineId) {
        this.pinOverlayFace(target);
        if (target.sourceOriginalText !== undefined && target.text === target.sourceOriginalText) {
          // Clicked but didn't change the words: drop the caret overlay so
          // the printed PDF glyphs stay exactly as they were.
          c.remove(target, ...this.coversForLine(target.sourceLineId));
          this.emitSelection();
          return;
        }
        this.materializeOverlay(target);
        this.syncCoverToText(target);
        if (!target.text.trim()) {
          c.remove(target);
          this.commit();
          this.emitSelection();
          return;
        }
        c.discardActiveObject();
        this.commit();
        this.emitSelection();
        return;
      }
      if (target && !target.text.trim()) c.remove(target);
      this.commit();
      this.emitSelection();
    });
    c.on('text:changed', ({ target }) => {
      if (target instanceof Textbox && target.sourceLineId) {
        this.pinOverlayFace(target);
        if (target.sourceOriginalText !== undefined && target.text !== target.sourceOriginalText) {
          this.materializeOverlay(target);
        }
        target.set({ width: Math.max(this.page.width * 2, 800), scaleX: 1 });
        target.initDimensions();
        const fitted = Math.max(target.calcTextWidth() + 8, target.fontSize * 0.8);
        const visualCap = Math.max(8, this.page.width - target.left - 2);
        let sx = 1;
        if (fitted > visualCap) sx = Math.max(0.7, visualCap / fitted);
        target.set({ width: fitted, scaleX: sx });
        target.initDimensions();
        target.setCoords();
        this.syncCoverToText(target);
      }
      this.emitSelection();
    });

    const onSelect = () => {
      forEachEditor((e) => e !== this && e.discard());
      this.emitSelection();
      this.updateTouchAction();
    };
    c.on('selection:created', onSelect);
    c.on('selection:updated', onSelect);
    c.on('selection:cleared', () => {
      this.emitSelection();
      this.updateTouchAction();
    });
  }

  private scenePoint(opt: TPointerEventInfo<TPointerEvent>) {
    return {
      x: Math.min(this.page.width, Math.max(0, opt.scenePoint.x)),
      y: Math.min(this.page.height, Math.max(0, opt.scenePoint.y)),
    };
  }

  private onPointerDown(opt: TPointerEventInfo<TPointerEvent>) {
    if (this.loading) return;
    const store = editorStore.getState();
    const style = store.style;
    const { x, y } = this.scenePoint(opt);
    const c = this.canvas;

    // Click on a line of the original PDF text (and not on one of our
    // objects): make it editable, iLovePDF-style.
    if (this.canEditOriginalText() && !opt.target) {
      const line = this.lineAt(x, y);
      if (line) {
        const active = c.getActiveObject();
        if (active instanceof Textbox && active.isEditing && active.sourceLineId === line.id) return;
        if (active) {
          if (active instanceof Textbox && active.isEditing) active.exitEditing();
          else this.discard();
        }
        void this.editOriginalLine(line, opt.e);
        return;
      }
    }

    switch (this.tool) {
      case 'text': {
        if (opt.target instanceof Textbox) {
          store.setTool('select');
          c.setActiveObject(opt.target);
          opt.target.enterEditing(opt.e);
          return;
        }
        const tb = createText(x, Math.max(0, y - style.fontSize * 0.6), style, this.page);
        this.applyFlags(tb);
        tb.set({ selectable: true, evented: true });
        c.add(tb);
        c.setActiveObject(tb);
        tb.enterEditing();
        tb.hiddenTextarea?.focus();
        store.setTool('select');
        return;
      }
      case 'rect':
      case 'ellipse':
      case 'highlight':
      case 'whiteout': {
        const obj = createBox(this.tool, x, y, style);
        obj.set({ selectable: false, evented: false });
        c.add(obj);
        this.draft = { type: 'box', kind: this.tool, startX: x, startY: y, obj };
        return;
      }
      case 'line':
      case 'arrow':
      case 'underline':
      case 'strike': {
        const obj = createLine(this.tool, x, y, style);
        obj.set({ selectable: false, evented: false });
        c.add(obj);
        this.draft = { type: 'line', kind: this.tool, startX: x, startY: y, obj };
        return;
      }
      case 'eraser':
        this.erasing = true;
        this.erasedAny = false;
        this.erase(opt.target);
        return;
      default:
        return;
    }
  }

  private onPointerMove(opt: TPointerEventInfo<TPointerEvent>) {
    if (this.erasing) {
      this.erase(opt.target);
      return;
    }
    const d = this.draft;
    if (!d) {
      // Hover feedback over editable original text.
      if (this.canEditOriginalText() && !opt.target && !this.canvas.getActiveObject()) {
        const { x, y } = this.scenePoint(opt);
        this.setHoveredLine(this.lineAt(x, y));
      } else {
        this.setHoveredLine(null);
      }
      return;
    }
    const { x, y } = this.scenePoint(opt);
    const shift = 'shiftKey' in opt.e && opt.e.shiftKey;

    if (d.type === 'box') {
      let w = Math.abs(x - d.startX);
      let h = Math.abs(y - d.startY);
      if (shift && (d.kind === 'rect' || d.kind === 'ellipse')) w = h = Math.max(w, h);
      const left = x < d.startX ? d.startX - w : d.startX;
      const top = y < d.startY ? d.startY - h : d.startY;
      if (d.kind === 'ellipse') (d.obj as Ellipse).set({ left, top, rx: w / 2, ry: h / 2 });
      else d.obj.set({ left, top, width: w, height: h });
    } else {
      let x2 = x;
      let y2 = y;
      if (d.kind === 'underline' || d.kind === 'strike') {
        y2 = d.startY; // text markup is always horizontal
      } else if (shift) {
        // Snap to 45° increments.
        const angle = Math.round(Math.atan2(y - d.startY, x - d.startX) / (Math.PI / 4)) * (Math.PI / 4);
        const len = Math.hypot(x - d.startX, y - d.startY);
        x2 = d.startX + Math.cos(angle) * len;
        y2 = d.startY + Math.sin(angle) * len;
      }
      d.obj.set({ x2, y2 });
    }
    d.obj.setCoords();
    this.canvas.requestRenderAll();
  }

  private onPointerUp() {
    if (this.erasing) {
      this.erasing = false;
      if (this.erasedAny) this.commit();
      return;
    }
    const d = this.draft;
    if (!d) return;
    this.draft = null;
    const obj = d.obj;

    // A click without a drag creates a sensibly sized default object.
    if (d.type === 'box') {
      const tiny = obj.width < 4 && obj.height < 4;
      if (tiny) {
        const sizes: Record<BoxKind, [number, number]> = { rect: [120, 80], ellipse: [90, 90], highlight: [140, 16], whiteout: [140, 28] };
        const [w, h] = sizes[d.kind];
        if (d.kind === 'ellipse') (obj as Ellipse).set({ rx: w / 2, ry: h / 2 });
        else obj.set({ width: w, height: h });
      }
    } else {
      const line = obj as Line;
      if (Math.hypot(line.x2 - line.x1, line.y2 - line.y1) < 4) line.set({ x2: line.x1 + 120, y2: line.y1 });
    }
    obj.setCoords();

    const store = editorStore.getState();
    if (SHAPE_TOOLS_RETURN_TO_SELECT.has(this.tool)) {
      store.setTool('select');
      this.applyFlags(obj);
      obj.set({ selectable: true, evented: true });
      this.canvas.setActiveObject(obj);
    } else {
      this.applyFlags(obj);
    }
    this.canvas.requestRenderAll();
    this.commit();
  }

  private erase(target: FabricObject | undefined) {
    if (!target || !target.kind) return;
    this.canvas.remove(target);
    this.erasedAny = true;
    this.canvas.requestRenderAll();
  }

  /** Corner-scaling a textbox should change its font size, not stretch glyphs. */
  private normalizeTextScale(target: FabricObject) {
    if (!(target instanceof Textbox)) return;
    const sx = target.scaleX ?? 1;
    const sy = target.scaleY ?? 1;
    if (Math.abs(sx - 1) < 1e-3 && Math.abs(sy - 1) < 1e-3) return;
    // Overlays of original PDF lines use scaleX to match the printed width.
    // Keep that squeeze; only fold a vertical resize into the font size.
    if (target.sourceLineId) {
      if (Math.abs(sy - 1) > 1e-3) {
        target.set({ fontSize: Math.max(4, Math.round(target.fontSize * sy * 10) / 10), scaleY: 1 });
        target.initDimensions();
      }
      target.setCoords();
      this.syncCoverToText(target);
      this.canvas.requestRenderAll();
      return;
    }
    target.set({
      fontSize: Math.max(4, Math.round(target.fontSize * sy * 10) / 10),
      width: target.width * sx,
      scaleX: 1,
      scaleY: 1,
    });
    target.initDimensions();
    target.setCoords();
    this.canvas.requestRenderAll();
  }

  /* ------------------------------------------------------------- selection */

  private emitSelection() {
    if (this.disposed) return;
    const store = editorStore.getState();
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) {
      if (store.selection?.pageIndex === this.page.index) store.setSelection(null);
      return;
    }
    const kinds = [...new Set(objs.map((o) => o.kind).filter((k): k is ObjectKind => !!k))];
    const active = this.canvas.getActiveObject();
    store.setSelection({
      pageIndex: this.page.index,
      count: objs.length,
      kinds,
      style: readStyle(objs[0]),
      isEditingText: active instanceof Textbox && active.isEditing,
    });
  }

  hasSelection() {
    return this.canvas.getActiveObjects().length > 0;
  }

  isEditingText() {
    const active = this.canvas.getActiveObject();
    return active instanceof Textbox && active.isEditing;
  }

  discard() {
    if (this.disposed || !this.canvas.getActiveObject()) return;
    const active = this.canvas.getActiveObject();
    if (active instanceof Textbox && active.isEditing) active.exitEditing();
    this.canvas.discardActiveObject();
    this.canvas.requestRenderAll();
  }

  private select(objs: FabricObject[]) {
    const c = this.canvas;
    c.discardActiveObject();
    if (objs.length === 1) c.setActiveObject(objs[0]);
    else if (objs.length > 1) c.setActiveObject(new ActiveSelection(objs, { canvas: c }));
    c.requestRenderAll();
  }

  selectAll() {
    if (this.tool !== 'select') editorStore.getState().setTool('select');
    this.select(this.canvas.getObjects().filter((o) => !!o.kind));
  }

  /* --------------------------------------------------------------- actions */

  /** Serialized copies of the selected objects (absolute coordinates, even inside a multi-selection). */
  getSelectedSerialized(): SerializedObject[] {
    const ids = new Set(this.canvas.getActiveObjects().map((o) => o.id));
    return this.serialize().filter((o) => ids.has(o.id));
  }

  deleteSelection(): boolean {
    if (this.isEditingText()) return false;
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return false;
    const extras: FabricObject[] = [];
    for (const o of objs) {
      if (o instanceof Textbox && o.sourceLineId) extras.push(...this.coversForLine(o.sourceLineId));
    }
    this.canvas.discardActiveObject();
    this.canvas.remove(...objs, ...extras);
    this.canvas.requestRenderAll();
    this.commit();
    return true;
  }

  async addSerialized(objs: SerializedObject[], offset: number) {
    if (!objs.length) return;
    await ensureFontsForObjects(objs);
    const live = await util.enlivenObjects<FabricObject>(objs as unknown as Record<string, unknown>[]);
    if (this.disposed) return;
    if (this.tool !== 'select') editorStore.getState().setTool('select');
    for (const obj of live) {
      reidentify(obj);
      obj.set({ left: obj.left + offset, top: obj.top + offset });
      obj.set({ selectable: true, evented: true });
      this.canvas.add(obj);
      obj.setCoords();
    }
    this.select(live);
    this.commit();
  }

  async addImage(dataUrl: string) {
    const img = await createImage(dataUrl, this.page);
    if (this.disposed) return;
    editorStore.getState().setTool('select');
    img.set({ selectable: true, evented: true });
    this.canvas.add(img);
    this.select([img]);
    this.commit();
  }

  applyStyle(patch: Partial<StyleState>) {
    const objs = this.canvas.getActiveObjects();
    if (!objs.length) return;
    objs.forEach((o) => {
      applyStyle(o, patch);
      if (o instanceof Textbox && o.sourceLineId) {
        if ('bold' in patch) {
          o.sourceFontWeight = patch.bold ? 'bold' : 'normal';
          o.sourceVisualBold = !!patch.bold;
          o.sourcePdfFace = false;
        }
        if ('italic' in patch) {
          o.sourceFontStyle = patch.italic ? 'italic' : 'normal';
          o.sourcePdfFace = false;
        }
        if ('fontId' in patch) o.sourcePdfFace = false;
      }
    });
    this.canvas.getActiveObject()?.setCoords();
    this.canvas.requestRenderAll();
    this.scheduleCommit();
    this.emitSelection();
  }

  nudge(dx: number, dy: number): boolean {
    const active = this.canvas.getActiveObject();
    if (!active || this.isEditingText()) return false;
    active.set({ left: active.left + dx, top: active.top + dy });
    active.setCoords();
    this.canvas.requestRenderAll();
    this.scheduleCommit();
    return true;
  }

  bringForward() {
    this.canvas.getActiveObjects().forEach((o) => this.canvas.bringObjectForward(o));
    this.canvas.requestRenderAll();
    this.commit();
  }

  sendBackward() {
    this.canvas.getActiveObjects().forEach((o) => this.canvas.sendObjectBackwards(o));
    this.canvas.requestRenderAll();
    this.commit();
  }

  /** Called after a web font finishes loading: re-measure text with the real glyphs. */
  refreshText() {
    if (this.disposed) return;
    for (const o of this.canvas.getObjects()) {
      if (o instanceof Textbox) {
        o.initDimensions();
        o.setCoords();
        o.dirty = true;
      }
    }
    this.canvas.requestRenderAll();
  }
}
