import { Color } from 'fabric';
import { rgb, type RGB } from 'pdf-lib';

export interface ParsedColor {
  color: RGB;
  alpha: number;
}

/** Parse any CSS color Fabric understands into a pdf-lib RGB + alpha. `null` = draw nothing. */
export function parseColor(value: unknown): ParsedColor | null {
  if (typeof value !== 'string' || !value || value === 'transparent' || value === 'none') return null;
  const [r, g, b, a] = new Color(value).getSource();
  if (a <= 0) return null;
  return { color: rgb(r / 255, g / 255, b / 255), alpha: a };
}

/** Normalise a CSS color to #rrggbb for <input type="color">. */
export function toHex(value: unknown, fallback = '#000000'): string {
  if (typeof value !== 'string' || !value || value === 'transparent') return fallback;
  return `#${new Color(value).toHex().toLowerCase()}`;
}

export const SWATCHES = [
  '#111827',
  '#ffffff',
  '#e5322d',
  '#f97316',
  '#facc15',
  '#22c55e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#6b7280',
];
