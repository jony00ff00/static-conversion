import { CSS_PX_PER_INCH, MM_PER_INCH, PRINT_DEFAULTS } from '../config/printDefaults.js';
import type { PageSetup } from '../schema/document.js';

export const PX_PER_MM = CSS_PX_PER_INCH / MM_PER_INCH; // 3.7795…
export const mmToPx = (mm: number) => mm * PX_PER_MM;
export const pxToMm = (px: number) => px / PX_PER_MM;
export const pxToPt = (px: number) => px * 0.75;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function trimMm(setup: Pick<PageSetup, 'orientation'>) {
  const { widthMm: w, heightMm: h } = PRINT_DEFAULTS;
  return setup.orientation === 'portrait' ? { width: w, height: h } : { width: h, height: w };
}

export function contentRectMm(setup: Pick<PageSetup, 'orientation' | 'marginsMm'>): Rect {
  const t = trimMm(setup);
  const m = setup.marginsMm;
  return { x: m.left, y: m.top, w: t.width - m.left - m.right, h: t.height - m.top - m.bottom };
}

/** Column grid inside the content area (placeholders: 12 columns, 5 mm gutter). */
export const GRID = { columns: 12, gutterMm: 5 } as const;

export function gridColumnsMm(setup: Pick<PageSetup, 'orientation' | 'marginsMm'>) {
  const c = contentRectMm(setup);
  const colW = (c.w - GRID.gutterMm * (GRID.columns - 1)) / GRID.columns;
  return Array.from({ length: GRID.columns }, (_, i) => {
    const x = c.x + i * (colW + GRID.gutterMm);
    return { x, w: colW };
  });
}

export const round = (n: number, step = 0.01) => Math.round(n / step) * step;

export function rectsOverlap(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Is `inner` inside `outer` (with a small tolerance)? */
export function rectInside(inner: Rect, outer: Rect, tol = 0.01) {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.w <= outer.x + outer.w + tol &&
    inner.y + inner.h <= outer.y + outer.h + tol
  );
}
