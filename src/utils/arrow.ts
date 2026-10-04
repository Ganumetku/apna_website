export interface Pt {
  x: number;
  y: number;
}

export interface ArrowGeometry {
  /** Where the shaft stops (slightly inside the head so caps don't poke out). */
  shaftEnd: Pt;
  tip: Pt;
  left: Pt;
  right: Pt;
}

/**
 * Arrow-head geometry shared by the on-screen renderer and the PDF exporter
 * so both produce the identical shape.
 */
export function arrowGeometry(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): ArrowGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const headLength = Math.min(Math.max(10, strokeWidth * 4), len * 0.6);
  const headHalfWidth = Math.max(5, strokeWidth * 1.8);
  const baseX = x2 - ux * headLength;
  const baseY = y2 - uy * headLength;
  const inset = Math.min(strokeWidth, headLength * 0.3);
  return {
    shaftEnd: { x: baseX + ux * inset, y: baseY + uy * inset },
    tip: { x: x2, y: y2 },
    left: { x: baseX - uy * headHalfWidth, y: baseY + ux * headHalfWidth },
    right: { x: baseX + uy * headHalfWidth, y: baseY - ux * headHalfWidth },
  };
}
