import type { PageSetup } from '../schema/document.js';
import { contentRectMm, gridColumnsMm, trimMm, type Rect } from './geometry.js';
import type { Guide } from './types.js';

export interface SnapTarget {
  axis: 'x' | 'y';
  posMm: number;
  kind: 'page' | 'content' | 'center' | 'guide' | 'grid' | 'object';
}

/** Every line a moving box can snap to on a page. */
export function snapTargets(
  setup: Pick<PageSetup, 'orientation' | 'marginsMm'>,
  opts: { guides?: Guide[]; grid?: boolean; others?: Rect[] } = {},
): SnapTarget[] {
  const t = trimMm(setup);
  const c = contentRectMm(setup);
  const out: SnapTarget[] = [
    { axis: 'x', posMm: 0, kind: 'page' },
    { axis: 'x', posMm: t.width, kind: 'page' },
    { axis: 'y', posMm: 0, kind: 'page' },
    { axis: 'y', posMm: t.height, kind: 'page' },
    { axis: 'x', posMm: c.x, kind: 'content' },
    { axis: 'x', posMm: c.x + c.w, kind: 'content' },
    { axis: 'y', posMm: c.y, kind: 'content' },
    { axis: 'y', posMm: c.y + c.h, kind: 'content' },
    { axis: 'x', posMm: c.x + c.w / 2, kind: 'center' },
    { axis: 'y', posMm: c.y + c.h / 2, kind: 'center' },
  ];
  for (const g of opts.guides ?? []) out.push({ axis: g.axis, posMm: g.posMm, kind: 'guide' });
  if (opts.grid) {
    for (const col of gridColumnsMm(setup)) {
      out.push({ axis: 'x', posMm: col.x, kind: 'grid' }, { axis: 'x', posMm: col.x + col.w, kind: 'grid' });
    }
  }
  for (const r of opts.others ?? []) {
    out.push(
      { axis: 'x', posMm: r.x, kind: 'object' },
      { axis: 'x', posMm: r.x + r.w, kind: 'object' },
      { axis: 'x', posMm: r.x + r.w / 2, kind: 'object' },
      { axis: 'y', posMm: r.y, kind: 'object' },
      { axis: 'y', posMm: r.y + r.h, kind: 'object' },
      { axis: 'y', posMm: r.y + r.h / 2, kind: 'object' },
    );
  }
  return out;
}

export interface SnapResult {
  rect: Rect;
  snappedX: SnapTarget | null;
  snappedY: SnapTarget | null;
}

/**
 * Snap a moving rect: its left, centre and right edges (and top, middle,
 * bottom) are tested against the targets; the closest within `thresholdMm` wins.
 */
export function snapMove(rect: Rect, targets: SnapTarget[], thresholdMm: number): SnapResult {
  const best = (axis: 'x' | 'y', edges: number[]) => {
    let hit: { delta: number; t: SnapTarget } | null = null;
    for (const t of targets) {
      if (t.axis !== axis) continue;
      for (const e of edges) {
        const d = t.posMm - e;
        if (Math.abs(d) <= thresholdMm && (!hit || Math.abs(d) < Math.abs(hit.delta))) hit = { delta: d, t };
      }
    }
    return hit;
  };
  const hx = best('x', [rect.x, rect.x + rect.w / 2, rect.x + rect.w]);
  const hy = best('y', [rect.y, rect.y + rect.h / 2, rect.y + rect.h]);
  return {
    rect: { ...rect, x: rect.x + (hx?.delta ?? 0), y: rect.y + (hy?.delta ?? 0) },
    snappedX: hx?.t ?? null,
    snappedY: hy?.t ?? null,
  };
}

/** Snap the moving edges of a resize (only the edges being dragged). */
export function snapResize(
  rect: Rect,
  handle: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean },
  targets: SnapTarget[],
  thresholdMm: number,
): Rect {
  const near = (axis: 'x' | 'y', v: number) => {
    let best: number | null = null;
    for (const t of targets) {
      if (t.axis === axis && Math.abs(t.posMm - v) <= thresholdMm && (best === null || Math.abs(t.posMm - v) < Math.abs(best - v))) best = t.posMm;
    }
    return best ?? v;
  };
  let { x, y, w, h } = rect;
  if (handle.left) {
    const nx = near('x', x);
    w += x - nx;
    x = nx;
  }
  if (handle.right) w = near('x', x + w) - x;
  if (handle.top) {
    const ny = near('y', y);
    h += y - ny;
    y = ny;
  }
  if (handle.bottom) h = near('y', y + h) - y;
  return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
}
