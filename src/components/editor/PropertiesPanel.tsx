import clsx from 'clsx';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Ban,
  Bold,
  Copy,
  Italic,
  Minus,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useEditorStore } from '../../store/editorStore';
import type { FontId, ObjectKind, StyleKey, StyleState, TextAlign } from '../../types';
import { SWATCHES } from '../../utils/color';
import { bringForward, changeStyle, deleteSelected, duplicateSelected, sendBackward } from '../../utils/editorActions';
import { KIND_LABELS, fieldsForKinds, kindForTool } from '../../utils/fabric/styleMapping';
import { FONT_FAMILIES, getFontDef } from '../../utils/fonts';

const TOOL_TITLES: Partial<Record<string, string>> = {
  text: 'Text tool',
  rect: 'Rectangle tool',
  ellipse: 'Circle tool',
  line: 'Line tool',
  arrow: 'Arrow tool',
  pen: 'Draw tool',
  highlight: 'Highlighter',
  underline: 'Underline tool',
  strike: 'Strikethrough tool',
  whiteout: 'White-out tool',
};

export function PropertiesPanel() {
  const open = useEditorStore((s) => s.panelOpen);
  const setOpen = useEditorStore((s) => s.setPanelOpen);
  const selection = useEditorStore((s) => s.selection);
  const tool = useEditorStore((s) => s.tool);
  const style = useEditorStore((s) => s.style);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  if (!open) return null;

  const toolKind = kindForTool(tool);
  const kinds: ObjectKind[] = selection ? selection.kinds : toolKind && toolKind !== 'image' ? [toolKind] : [];
  let fields = fieldsForKinds(kinds);
  // A new highlight always starts translucent; opacity is only editable once it exists.
  if (!selection && toolKind === 'highlight') fields = fields.filter((f) => f !== 'opacity');
  const values: StyleState = { ...style, ...selection?.style };
  const has = (k: StyleKey) => fields.includes(k);
  const set = (patch: Partial<StyleState>) => changeStyle(patch);

  const title = selection
    ? selection.count > 1
      ? `${selection.count} objects`
      : KIND_LABELS[selection.kinds[0]]
    : (TOOL_TITLES[tool] ?? 'Properties');

  const body = (
    <div className="space-y-5 p-4">
      {has('fontId') && (
        <Field label="Font">
          <select
            value={values.fontId}
            onChange={(e) => set({ fontId: e.target.value as FontId })}
            className="h-9 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm focus:border-brand-500 focus:outline-none"
            style={{ fontFamily: `"${getFontDef(values.fontId).family}"` }}
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.id} value={f.id} style={{ fontFamily: `"${f.family}"` }}>
                {f.label}
              </option>
            ))}
          </select>
        </Field>
      )}

      {has('fontSize') && (
        <Field label="Size">
          <div className="flex items-center gap-1.5">
            <StepButton label="Smaller" onClick={() => set({ fontSize: Math.max(4, Math.round(values.fontSize - 1)) })}>
              <Minus className="h-4 w-4" />
            </StepButton>
            <input
              type="number"
              min={4}
              max={400}
              value={values.fontSize}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 4 && n <= 400) set({ fontSize: n });
              }}
              className="h-9 w-full min-w-0 rounded-lg border border-slate-300 px-2 text-center text-sm tabular-nums focus:border-brand-500 focus:outline-none"
            />
            <StepButton label="Larger" onClick={() => set({ fontSize: Math.min(400, Math.round(values.fontSize + 1)) })}>
              <Plus className="h-4 w-4" />
            </StepButton>
          </div>
        </Field>
      )}

      {(has('bold') || has('textAlign')) && (
        <Field label="Style">
          <div className="flex gap-2">
            <Segmented>
              <SegButton label="Bold" active={values.bold} onClick={() => set({ bold: !values.bold })}>
                <Bold className="h-4 w-4" />
              </SegButton>
              <SegButton label="Italic" active={values.italic} onClick={() => set({ italic: !values.italic })}>
                <Italic className="h-4 w-4" />
              </SegButton>
            </Segmented>
            <Segmented>
              {(
                [
                  ['left', AlignLeft],
                  ['center', AlignCenter],
                  ['right', AlignRight],
                ] as [TextAlign, typeof AlignLeft][]
              ).map(([align, Icon]) => (
                <SegButton key={align} label={`Align ${align}`} active={values.textAlign === align} onClick={() => set({ textAlign: align })}>
                  <Icon className="h-4 w-4" />
                </SegButton>
              ))}
            </Segmented>
          </div>
        </Field>
      )}

      {has('textColor') && (
        <Field label="Text color">
          <ColorPicker value={values.textColor} onChange={(c) => c && set({ textColor: c })} />
        </Field>
      )}
      {has('highlightColor') && (
        <Field label="Highlight color">
          <ColorPicker
            value={values.highlightColor}
            swatches={['#facc15', '#a3e635', '#67e8f9', '#f9a8d4', '#fdba74', '#c4b5fd']}
            onChange={(c) => c && set({ highlightColor: c })}
          />
        </Field>
      )}
      {has('whiteoutColor') && (
        <Field label="Cover color">
          <ColorPicker
            value={values.whiteoutColor}
            swatches={['#ffffff', '#f8fafc', '#fefce8', '#f5f5f4', '#000000']}
            onChange={(c) => c && set({ whiteoutColor: c })}
          />
        </Field>
      )}
      {has('strokeColor') && (
        <Field label={kinds.some((k) => k === 'rect' || k === 'ellipse') ? 'Border color' : 'Color'}>
          <ColorPicker value={values.strokeColor} onChange={(c) => c && set({ strokeColor: c })} />
        </Field>
      )}
      {has('fillColor') && (
        <Field label="Fill">
          <ColorPicker value={values.fillColor} allowNone onChange={(c) => set({ fillColor: c })} />
        </Field>
      )}
      {has('strokeWidth') && (
        <Field label="Thickness" value={`${values.strokeWidth} pt`}>
          <input
            type="range"
            min={0.5}
            max={20}
            step={0.5}
            value={values.strokeWidth}
            onChange={(e) => set({ strokeWidth: Number(e.target.value) })}
            className="w-full"
          />
        </Field>
      )}
      {has('opacity') && (
        <Field label="Opacity" value={`${Math.round(values.opacity * 100)}%`}>
          <input
            type="range"
            min={5}
            max={100}
            step={1}
            value={Math.round(values.opacity * 100)}
            onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
            className="w-full"
          />
        </Field>
      )}

      {has('fontId') && (
        <p className="rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-500">
          Hindi / Devanagari (हिन्दी) works with every font. Pick <b>Poppins</b> or <b>Noto Sans Devanagari</b> for a native Devanagari design.
        </p>
      )}

      {selection && (
        <div className="grid grid-cols-2 gap-2 border-t border-slate-200 pt-4">
          <ActionButton onClick={() => void duplicateSelected()} icon={<Copy className="h-4 w-4" />} label="Duplicate" />
          <ActionButton onClick={() => deleteSelected()} icon={<Trash2 className="h-4 w-4" />} label="Delete" danger />
          <ActionButton onClick={bringForward} icon={<ArrowUpToLine className="h-4 w-4" />} label="Forward" />
          <ActionButton onClick={sendBackward} icon={<ArrowDownToLine className="h-4 w-4" />} label="Backward" />
        </div>
      )}

      {!selection && fields.length === 0 && <EmptyHelp />}
    </div>
  );

  if (isDesktop) {
    return (
      <aside className="scrollbar-thin w-72 shrink-0 overflow-y-auto border-l border-slate-200 bg-white" aria-label="Properties">
        <div className="sticky top-0 z-10 flex h-11 items-center border-b border-slate-100 bg-white px-4 text-sm font-semibold text-slate-900">
          {title}
        </div>
        {body}
      </aside>
    );
  }

  return (
    <div className="animate-sheet-in absolute inset-x-0 bottom-0 z-40 max-h-[55%] overflow-y-auto rounded-t-2xl bg-white shadow-[0_-8px_30px_rgba(15,23,42,0.18)]">
      <div className="sticky top-0 z-10 flex h-11 items-center justify-between border-b border-slate-100 bg-white px-4">
        <span className="text-sm font-semibold text-slate-900">{title}</span>
        <button className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" onClick={() => setOpen(false)} aria-label="Close properties">
          <X className="h-4 w-4" />
        </button>
      </div>
      {body}
    </div>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-500">
        <span>{label}</span>
        {value && <span className="font-medium text-slate-700 tabular-nums">{value}</span>}
      </div>
      {children}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
  allowNone,
  swatches = SWATCHES,
}: {
  value: string | null;
  onChange: (c: string | null) => void;
  allowNone?: boolean;
  swatches?: string[];
}) {
  const current = value?.toLowerCase() ?? null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowNone && (
        <button
          type="button"
          title="No fill"
          aria-label="No fill"
          onClick={() => onChange(null)}
          className={clsx(
            'flex h-7 w-7 items-center justify-center rounded-full bg-white text-slate-400 ring-1 ring-slate-300',
            current === null && 'ring-2 ring-brand-500 ring-offset-1',
          )}
        >
          <Ban className="h-4 w-4" />
        </button>
      )}
      {swatches.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          aria-label={`Color ${c}`}
          onClick={() => onChange(c)}
          className={clsx('h-7 w-7 rounded-full ring-1 ring-slate-900/15', current === c && 'ring-2 ring-brand-500 ring-offset-1')}
          style={{ background: c }}
        />
      ))}
      <label
        className="relative h-7 w-7 cursor-pointer overflow-hidden rounded-full ring-1 ring-slate-900/15"
        title="Custom color"
        style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}
      >
        <input
          type="color"
          value={current ?? '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Custom color"
        />
      </label>
    </div>
  );
}

function Segmented({ children }: { children: ReactNode }) {
  return <div className="flex overflow-hidden rounded-lg ring-1 ring-slate-300">{children}</div>;
}

function SegButton({ label, active, onClick, children }: { label: string; active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={clsx(
        'flex h-9 w-9 items-center justify-center border-r border-slate-200 last:border-r-0',
        active ? 'bg-brand-50 text-brand-600' : 'bg-white text-slate-600 hover:bg-slate-50',
      )}
    >
      {children}
    </button>
  );
}

function StepButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function ActionButton({ onClick, icon, label, danger }: { onClick: () => void; icon: ReactNode; label: string; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'flex h-9 items-center justify-center gap-1.5 rounded-lg text-sm font-medium ring-1 transition',
        danger ? 'text-red-600 ring-red-200 hover:bg-red-50' : 'text-slate-700 ring-slate-300 hover:bg-slate-50',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EmptyHelp() {
  const rows: [string, string][] = [
    ['Delete', 'Delete selection'],
    ['Ctrl Z / Ctrl Y', 'Undo / redo'],
    ['Ctrl C / Ctrl V', 'Copy / paste'],
    ['Ctrl D', 'Duplicate'],
    ['Arrows', 'Nudge (Shift = 10pt)'],
    ['Esc', 'Deselect'],
  ];
  return (
    <div className="space-y-4 text-sm text-slate-600">
      <p>
        <b className="text-slate-800">Click any text in the document</b> to edit it in place — it keeps its size, colour and style. Or pick a
        tool from the toolbar to add something new.
      </p>
      <dl className="space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2">
            <dt>
              <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 ring-1 ring-slate-200">{k}</kbd>
            </dt>
            <dd className="text-right text-xs text-slate-500">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
