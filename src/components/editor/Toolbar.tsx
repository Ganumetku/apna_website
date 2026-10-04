import {
  ArrowUpRight,
  Circle,
  Eraser,
  Highlighter,
  ImagePlus,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  Slash,
  Square,
  Strikethrough,
  Type,
  Underline,
  type LucideIcon,
} from 'lucide-react';
import { Fragment } from 'react';
import { useEditorStore } from '../../store/editorStore';
import type { ToolType } from '../../types';
import { IconButton } from './IconButton';

interface ToolDef {
  tool: ToolType;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

const GROUPS: ToolDef[][] = [
  [{ tool: 'select', label: 'Select', icon: MousePointer2, shortcut: 'V' }],
  [
    { tool: 'text', label: 'Text', icon: Type, shortcut: 'T' },
    { tool: 'image', label: 'Image', icon: ImagePlus, shortcut: 'I' },
  ],
  [
    { tool: 'rect', label: 'Rectangle', icon: Square, shortcut: 'R' },
    { tool: 'ellipse', label: 'Circle', icon: Circle, shortcut: 'O' },
    { tool: 'line', label: 'Line', icon: Slash, shortcut: 'L' },
    { tool: 'arrow', label: 'Arrow', icon: ArrowUpRight, shortcut: 'A' },
    { tool: 'pen', label: 'Draw', icon: PenLine, shortcut: 'P' },
  ],
  [
    { tool: 'highlight', label: 'Highlight', icon: Highlighter, shortcut: 'H' },
    { tool: 'underline', label: 'Underline', icon: Underline, shortcut: 'U' },
    { tool: 'strike', label: 'Strikethrough', icon: Strikethrough, shortcut: 'K' },
    { tool: 'whiteout', label: 'White-out', icon: RectangleHorizontal, shortcut: 'W' },
    { tool: 'eraser', label: 'Eraser', icon: Eraser, shortcut: 'E' },
  ],
];

const HINTS: Partial<Record<ToolType, string>> = {
  select: 'Click any text in the document to edit it · drag objects to move them',
  text: 'Click existing text to edit it, or click an empty area to add new text',
  rect: 'Drag to draw a rectangle (Shift = square)',
  ellipse: 'Drag to draw an ellipse (Shift = circle)',
  line: 'Drag to draw a line (Shift = snap 45°)',
  arrow: 'Drag to draw an arrow (Shift = snap 45°)',
  pen: 'Draw freely with mouse, pen or finger',
  highlight: 'Drag over text to highlight it',
  underline: 'Drag along text to underline it',
  strike: 'Drag along text to strike it through',
  whiteout: 'Drag to cover content with a white box',
  eraser: 'Click or drag over objects you added to erase them',
};

export function Toolbar({ onPickImage }: { onPickImage: () => void }) {
  const tool = useEditorStore((s) => s.tool);
  const setTool = useEditorStore((s) => s.setTool);
  const hint = HINTS[tool];

  return (
    <div className="relative z-20 shrink-0 border-b border-slate-200 bg-white">
      <div className="no-scrollbar flex items-center gap-1 overflow-x-auto px-2 py-1.5 sm:justify-center">
        {GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <span className="mx-1 h-6 w-px shrink-0 bg-slate-200" />}
            {group.map((t) => (
              <IconButton
                key={t.tool}
                label={t.label}
                shortcut={t.shortcut}
                active={tool === t.tool}
                className="lg:w-auto lg:px-2.5"
                onClick={() => (t.tool === 'image' ? onPickImage() : setTool(t.tool))}
              >
                <t.icon className="h-[18px] w-[18px]" />
                <span className="hidden text-sm font-medium xl:inline">{t.label}</span>
              </IconButton>
            ))}
          </Fragment>
        ))}
      </div>
      {hint && (
        <div className="pointer-events-none absolute top-full left-1/2 mt-2 -translate-x-1/2 rounded-full bg-slate-900/85 px-3 py-1 text-xs font-medium whitespace-nowrap text-white shadow-lg">
          {hint}
        </div>
      )}
    </div>
  );
}
