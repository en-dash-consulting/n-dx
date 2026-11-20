/**
 * Zone-box geometry the Zones diagram shares between the layout that sizes
 * the boxes (`zones-model.ts`), the diagram that draws their rows (`zones.ts`)
 * and its edge hooks (`hooks/use-file-edges.ts`, `hooks/use-subzone-edges.ts`):
 * the row metrics of an expanded zone box, where an edge leaves or meets a
 * box, and the curve drawn between two points. One copy of the row metrics
 * keeps every edge on the row it belongs to.
 *
 * A leaf beside zone-types.ts rather than in hooks/: the layout reaches it
 * without the hooks barrel, which would close an import cycle back through
 * `visualization/` and `components/`.
 */

import type { BoxRect } from "./zone-types.js";

/** Height of a zone box with nothing expanded; rows start just above its bottom. */
export const BOX_H_COLLAPSED = 80;
/** Height of one file row in an expanded box. */
export const FILE_ROW_H = 22;
/** File rows an expanded box shows before it says how many more there are. */
export const FILE_ROWS_MAX = 15;

/** The point where the line from `box`'s center toward (tx, ty) crosses its border. */
export function boxEdgeAnchor(box: BoxRect, tx: number, ty: number): { x: number; y: number } {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const hw = box.w / 2;
  const hh = box.h / 2;

  const sx = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const sy = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy);

  return { x: cx + dx * s, y: cy + dy * s };
}

/** `y` kept 4px inside `box`'s top and bottom edges. */
export function clampToBox(box: BoxRect, y: number): number {
  return Math.max(box.y + 4, Math.min(y, box.y + box.h - 4));
}

/**
 * The cubic Bézier from (fromX, fromY) to (toX, toY): it leaves and arrives
 * horizontally, its control points 40% and 60% of the way across.
 */
export function edgeCurve(fromX: number, fromY: number, toX: number, toY: number): string {
  const dx = toX - fromX;
  const cp1x = fromX + dx * 0.4;
  const cp2x = fromX + dx * 0.6;
  return `M ${fromX} ${fromY} C ${cp1x} ${fromY} ${cp2x} ${toY} ${toX} ${toY}`;
}
