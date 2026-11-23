import { describe, expect, it } from 'vitest';
import * as ops from '../src/model/ops.js';
import { snapMove, snapResize, snapTargets } from '../src/model/snap.js';
import { contentRectMm, gridColumnsMm } from '../src/model/geometry.js';
import type { Analysis, ComponentDef, EditorDocument } from '../src/model/types.js';

const analysis: Analysis = { captureWidthPx: 680, documentHeightPx: 1000, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] };
const base = () => ops.newEditorDocument(analysis, 'body', 680);
const def = (id: string, w = 200, h = 100): ComponentDef => ({ id, name: id, kind: 'card', rootWpId: id, widthPx: w, heightPx: h, bg: '#fff', minFontPx: 16 });
const withBoxes = (): EditorDocument => {
  let d = ops.deletePlacements(base(), ['pl-page']);
  d = ops.placeComponent(d, def('a'), 'page-1', { xMm: 20, yMm: 30, wMm: 40, hMm: 20 }, 'A');
  d = ops.placeComponent(d, def('b'), 'page-1', { xMm: 80, yMm: 50, wMm: 30, hMm: 30 }, 'B');
  d = ops.placeComponent(d, def('c'), 'page-1', { xMm: 150, yMm: 90, wMm: 20, hMm: 10 }, 'C');
  return d;
};
const P = (d: EditorDocument, id: string) => d.placements.find((p) => p.id === id)!;

describe('M4: snapping', () => {
  const setup = base().pageSetup;
  const targets = snapTargets(setup, { grid: true, guides: [{ id: 'g', axis: 'x', posMm: 100 }] });

  it('snaps a moving box to content-area edges, centre and guides within the threshold', () => {
    const c = contentRectMm(setup);
    const plain = snapTargets(setup, { guides: [{ id: 'g', axis: 'x', posMm: 100 }] });
    const r = snapMove({ x: c.x + 0.8, y: c.y - 0.6, w: 30, h: 20 }, plain, 1.5);
    expect(r.rect.x).toBeCloseTo(c.x, 6);
    expect(r.rect.y).toBeCloseTo(c.y, 6);
    const centre = snapMove({ x: c.x + c.w / 2 - 15 + 0.7, y: 100, w: 30, h: 20 }, plain, 1.5);
    expect(centre.rect.x + 15).toBeCloseTo(c.x + c.w / 2, 6);
    const guide = snapMove({ x: 99.2, y: 200, w: 10, h: 10 }, plain, 1.5);
    expect(guide.rect.x).toBeCloseTo(100, 6);
  });

  it('does not snap beyond the threshold', () => {
    const r = snapMove({ x: 47.3, y: 133.3, w: 11, h: 7 }, snapTargets(setup), 1);
    expect(r.rect).toEqual({ x: 47.3, y: 133.3, w: 11, h: 7 });
    expect(r.snappedX).toBeNull();
  });

  it('snaps to grid column edges', () => {
    const col = gridColumnsMm(setup)[3]!;
    const r = snapMove({ x: col.x + 0.4, y: 120, w: 13, h: 9 }, targets, 1);
    expect(r.rect.x).toBeCloseTo(col.x, 6);
  });

  it('snaps only the dragged edges when resizing', () => {
    const c = contentRectMm(setup);
    const r = snapResize({ x: 30, y: 40, w: c.x + c.w - 30 - 0.9, h: 50 }, { right: true }, targets, 1.5);
    expect(r.x).toBe(30);
    expect(r.x + r.w).toBeCloseTo(c.x + c.w, 6);
    expect(r.h).toBe(50);
  });
});

describe('M4: placement operations', () => {
  it('moves by exact mm, including the whole group', () => {
    let d = ops.group(withBoxes(), ['A', 'B'], 'G');
    d = ops.movePlacements(d, ['A'], 1.3, -2.7);
    expect([P(d, 'A').xMm, P(d, 'A').yMm]).toEqual([21.3, 27.3]);
    expect([P(d, 'B').xMm, P(d, 'B').yMm]).toEqual([81.3, 47.3]);
    expect([P(d, 'C').xMm, P(d, 'C').yMm]).toEqual([150, 90]);
  });

  it('locked placements do not move or resize', () => {
    let d = ops.updatePlacement(withBoxes(), 'A', { locked: true });
    d = ops.movePlacements(d, ['A'], 5, 5);
    d = ops.setPlacementRect(d, 'A', { x: 0, y: 0, w: 1, h: 1 });
    expect([P(d, 'A').xMm, P(d, 'A').yMm, P(d, 'A').wMm]).toEqual([20, 30, 40]);
  });

  it('aligns to each other, or to the content area for one item', () => {
    const d = ops.align(withBoxes(), ['A', 'B', 'C'], 'left');
    expect(['A', 'B', 'C'].map((id) => P(d, id).xMm)).toEqual([20, 20, 20]);
    const r = ops.align(withBoxes(), ['A', 'B', 'C'], 'bottom');
    expect(['A', 'B', 'C'].map((id) => P(r, id).yMm + P(r, id).hMm)).toEqual([100, 100, 100]);
    const one = ops.align(withBoxes(), ['A'], 'hcenter');
    const c = contentRectMm(one.pageSetup);
    expect(P(one, 'A').xMm + 20).toBeCloseTo(c.x + c.w / 2, 6);
  });

  it('distributes with equal gaps', () => {
    const d = ops.distribute(withBoxes(), ['A', 'B', 'C'], 'x');
    const gap1 = P(d, 'B').xMm - (P(d, 'A').xMm + P(d, 'A').wMm);
    const gap2 = P(d, 'C').xMm - (P(d, 'B').xMm + P(d, 'B').wMm);
    expect(gap1).toBeCloseTo(gap2, 6);
  });

  it('front/back reorders z; delete removes', () => {
    let d = ops.sendToBack(withBoxes(), ['C']);
    expect(P(d, 'C').z).toBeLessThan(Math.min(P(d, 'A').z, P(d, 'B').z));
    d = ops.bringToFront(d, ['A']);
    expect(P(d, 'A').z).toBeGreaterThan(P(d, 'B').z);
    d = ops.deletePlacements(d, ['B']);
    expect(d.placements.map((p) => p.id).sort()).toEqual(['A', 'C']);
  });

  it('places at natural size (1 CSS px = 1/96 in), clamped to the content width', () => {
    const d = ops.placeComponent(base(), def('n', 378, 189), 'page-1', { xMm: 15, yMm: 20 }, 'N');
    expect(P(d, 'N').wMm).toBeCloseTo(100.0125, 3);
    expect(P(d, 'N').hMm).toBeCloseTo(50.006, 3);
    const big = ops.placeComponent(base(), def('w', 2000, 100), 'page-1', { xMm: 15, yMm: 20 }, 'W');
    expect(P(big, 'W').wMm).toBe(180);
  });

  it('pages: add, remove (with their placements), orientation', () => {
    let d = ops.addPage(withBoxes(), 'page-2');
    d = ops.placeComponent(d, def('x'), 'page-2', { xMm: 10, yMm: 10 }, 'X');
    d = ops.removePage(d, 'page-2');
    expect(d.pages.map((p) => p.id)).toEqual(['page-1']);
    expect(d.placements.some((p) => p.id === 'X')).toBe(false);
    expect(() => ops.removePage(d, 'page-1')).toThrow(/at least one page/);
    expect(ops.setOrientation(d, 'landscape').pageSetup.orientation).toBe('landscape');
  });
});

describe('M4: margins', () => {
  it('changing margins never moves placements', () => {
    const d = withBoxes();
    const m = ops.setMargins(d, { top: 33, right: 7, bottom: 12.5, left: 41 });
    expect(m.placements).toEqual(d.placements);
  });

  it('flags placements left in the margin', () => {
    const d = ops.setMargins(withBoxes(), { top: 20, right: 15, bottom: 20, left: 25 });
    expect(ops.placementsInMargin(d)).toEqual(['A']);
  });

  it('validates margins (≥ 0, content area ≥ 50 mm, 0.5 mm steps)', () => {
    const d = base();
    expect(() => ops.setMargins(d, { top: -1, right: 15, bottom: 20, left: 15 })).toThrow();
    expect(() => ops.setMargins(d, { top: 20, right: 81, bottom: 20, left: 80 })).toThrow(/at least 50/);
    expect(ops.setMargins(d, { top: 12.3, right: 15, bottom: 20, left: 15 }).pageSetup.marginsMm.top).toBe(12.5);
  });
});

describe('M4: undo/redo restores the document exactly', () => {
  it('for every arrange operation', () => {
    const start = withBoxes();
    const steps: Array<(d: EditorDocument) => EditorDocument> = [
      (d) => ops.movePlacements(d, ['A'], 3, 4),
      (d) => ops.setPlacementRect(d, 'B', { x: 1, y: 2, w: 3, h: 4 }),
      (d) => ops.updatePlacement(d, 'C', { rotationDeg: 15, fit: 'crop' }),
      (d) => ops.align(d, ['A', 'B'], 'top'),
      (d) => ops.distribute(d, ['A', 'B', 'C'], 'y'),
      (d) => ops.group(d, ['A', 'C'], 'g1'),
      (d) => ops.bringToFront(d, ['B']),
      (d) => ops.setMargins(d, { top: 10, right: 10, bottom: 10, left: 10 }),
      (d) => ops.addPage(d, 'p2'),
      (d) => ops.addGuide(d, 'y', 42, 'gd'),
      (d) => ops.deletePlacements(d, ['C']),
    ];
    const h = new ops.History(start);
    const snapshots = [JSON.stringify(start)];
    for (const op of steps) {
      h.apply(op);
      snapshots.push(JSON.stringify(h.present));
    }
    for (let i = steps.length - 1; i >= 0; i--) {
      h.undo();
      expect(JSON.stringify(h.present)).toBe(snapshots[i]);
    }
    for (let i = 1; i <= steps.length; i++) {
      h.redo();
      expect(JSON.stringify(h.present)).toBe(snapshots[i]);
    }
  });
});
