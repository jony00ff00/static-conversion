/**
 * Group resize/crop, the overflow view's composition, and placing loose
 * uploaded files where the page links them.
 */
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import * as ops from '../src/model/ops.js';
import { composeOverflowHtml, frameGeometry } from '../src/compose/page.js';
import { mmToPx } from '../src/model/geometry.js';
import { arrangeLooseFiles } from '../src/import/pure.js';
import type { Analysis, ComponentDef, EditorDocument } from '../src/model/types.js';

const analysis: Analysis = { captureWidthPx: 680, documentHeightPx: 1000, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] };
const def = (id: string, w = 200, h = 100): ComponentDef => ({ id, name: id, kind: 'card', rootWpId: id, widthPx: w, heightPx: h, bg: '#fff', minFontPx: 16 });

/** Two items, grouped: A at (20,30) 40×20 scale-fit, B at (80,50) 30×30 reflow. */
function grouped(): EditorDocument {
  let d = ops.deletePlacements(ops.newEditorDocument(analysis, 'body', 680), ['pl-page']);
  d = ops.placeComponent(d, def('a'), 'page-1', { xMm: 20, yMm: 30, wMm: 40, hMm: 20 }, 'A');
  d = ops.placeComponent(d, def('b'), 'page-1', { xMm: 80, yMm: 50, wMm: 30, hMm: 30, fit: 'reflow' }, 'B');
  return ops.group(d, ['A', 'B'], 'g1');
}
const P = (d: EditorDocument, id: string) => d.placements.find((p) => p.id === id)!;
const rectOf = (d: EditorDocument, id: string) => {
  const p = P(d, id);
  return { x: p.xMm, y: p.yMm, w: p.wMm, h: p.hMm };
};

/** Where a point of the component (layout px) lands on the page, in mm. */
function pagePoint(d: EditorDocument, id: string, lx: number, ly: number) {
  const p = P(d, id);
  const g = frameGeometry(p, d.components[p.componentId]!);
  return { x: p.xMm + ((lx - g.offsetX) * g.scale) / mmToPx(1), y: p.yMm + ((ly - g.offsetY) * g.scale) / mmToPx(1) };
}

describe('Groups: resize as one', () => {
  it('bounds cover every item in the group', () => {
    const d = grouped();
    expect(ops.boundsOf(d.placements)).toEqual({ x: 20, y: 30, w: 90, h: 50 });
  });

  it('scales positions and sizes with the box, from any item in the group', () => {
    const d = ops.resizeGroup(grouped(), ['B'], { x: 10, y: 10, w: 180, h: 100 }, 'scale');
    expect(rectOf(d, 'A')).toEqual({ x: 10, y: 10, w: 80, h: 40 });
    expect(rectOf(d, 'B')).toEqual({ x: 130, y: 50, w: 60, h: 60 });
    expect(ops.boundsOf(d.placements)).toEqual({ x: 10, y: 10, w: 180, h: 100 });
  });

  it('scales the content of cropped items with the box', () => {
    let d = ops.updatePlacement(grouped(), 'A', { fit: 'crop', cropXPx: 10, cropYPx: 5 });
    d = ops.resizeGroup(d, ['A'], { x: 20, y: 30, w: 180, h: 100 }, 'scale');
    expect(P(d, 'A').cropScale).toBeCloseTo(2, 9);
    expect(P(d, 'A').cropXPx).toBe(10);
  });

  it('refuses when an item is locked, and is undoable as one step', () => {
    const locked = ops.updatePlacement(grouped(), 'B', { locked: true });
    expect(() => ops.resizeGroup(locked, ['A'], { x: 0, y: 0, w: 10, h: 10 }, 'scale')).toThrow(/Unlock/);
    const h = new ops.History(grouped());
    h.apply((x) => ops.resizeGroup(x, ['A'], { x: 0, y: 0, w: 45, h: 25 }, 'scale'));
    expect(rectOf(h.undo(), 'A')).toEqual({ x: 20, y: 30, w: 40, h: 20 });
  });
});

describe('Groups: crop as one', () => {
  it('trims items to the box and keeps their content exactly where it was', () => {
    const d0 = grouped();
    // Points of each component, on the page, before cropping.
    const a0 = pagePoint(d0, 'A', 150, 60);
    const b0 = pagePoint(d0, 'B', 100, 100);
    // Trim 10 mm off the left and 15 mm off the top of the group.
    const d = ops.resizeGroup(d0, ['A'], { x: 30, y: 45, w: 80, h: 35 }, 'crop');
    expect(rectOf(d, 'A')).toEqual({ x: 30, y: 45, w: 30, h: 5 });
    expect(rectOf(d, 'B')).toEqual({ x: 80, y: 50, w: 30, h: 30 }); // inside the box: untouched
    expect(P(d, 'B').fit).toBe('reflow');
    expect(P(d, 'A').fit).toBe('crop');
    const a1 = pagePoint(d, 'A', 150, 60);
    expect(a1.x).toBeCloseTo(a0.x, 9);
    expect(a1.y).toBeCloseTo(a0.y, 9);
    expect(pagePoint(d, 'B', 100, 100)).toEqual(b0);
  });

  it('crops reflow items at the width they were laid out at', () => {
    const d = ops.resizeGroup(grouped(), ['A'], { x: 20, y: 30, w: 80, h: 50 }, 'crop');
    const b = P(d, 'B');
    expect(b.fit).toBe('crop');
    expect(b.cropLayoutPx).toBeCloseTo(mmToPx(30), 9); // the original frame width
    expect(b.wMm).toBeCloseTo(20, 9);
    expect(b.cropXPx ?? 0).toBe(0);
  });

  it('will not crop an item away completely', () => {
    expect(() => ops.resizeGroup(grouped(), ['A'], { x: 70, y: 30, w: 40, h: 50 }, 'crop')).toThrow(/remove "a" completely/);
  });
});

describe('Overflow view', () => {
  const page = () => ops.newEditorDocument(analysis, 'body', 680);
  const htmlFor = () => '<!DOCTYPE html><html><body><div data-ve-root>x</div></body></html>';

  it('is empty when everything fits on the page', () => {
    expect(composeOverflowHtml(page(), 'page-1', htmlFor)).toBeNull();
  });

  it('extends past the page for a frame that runs off it, and leaves room for it', () => {
    const d = ops.setPlacementRect(page(), 'pl-page', { x: 150, y: 250, w: 100, h: 80 });
    const r = composeOverflowHtml(d, 'page-1', htmlFor)!;
    expect(r.pad.l).toBe(0);
    expect(r.pad.t).toBe(0);
    expect(r.pad.r).toBeCloseTo(mmToPx(40), 6);
    expect(r.pad.b).toBeCloseTo(mmToPx(33), 6);
    const doc = parseHTML(r.html).document;
    const frame = doc.querySelector('.ve-frame')!;
    // The part already on the page is cut out of the dimmed layer.
    expect(frame.getAttribute('style')).toMatch(/clip-path:polygon\(evenodd/);
  });

  it('shows reflow content below a frame that is too short for it', () => {
    let d = ops.setPlacementRect(page(), 'pl-page', { x: 15, y: 20, w: 180, h: 50 });
    d = ops.updatePlacement(d, 'pl-page', { fit: 'reflow' });
    expect(composeOverflowHtml(d, 'page-1', htmlFor)).toBeNull(); // not measured yet
    const r = composeOverflowHtml(d, 'page-1', htmlFor, { 'pl-page': 1400 })!;
    expect(r.pad.b).toBeCloseTo(mmToPx(20) + 1400 - mmToPx(297), 6);
    const inner = parseHTML(r.html).document.querySelector('iframe.ve-inner')!;
    expect(inner.getAttribute('style')).toContain('height:1400px');
  });

  it('caps the space it takes around the page', () => {
    const d = ops.setPlacementRect(page(), 'pl-page', { x: 15, y: 280, w: 180, h: 900 });
    expect(composeOverflowHtml(d, 'page-1', htmlFor)!.pad.b).toBeCloseTo(mmToPx(120), 6);
  });
});

describe('Uploading loose files', () => {
  const enc = (s: string) => new TextEncoder().encode(s);
  it('puts each file where the HTML and CSS link it', () => {
    const files = {
      'page.html': enc('<link rel="stylesheet" href="css/site.css"><img src="./img/logo.png"><script src="https://cdn.example/x.js"></script>'),
      'site.css': enc('body{background:url("../img/bg.jpg")} @import "fonts.css";'),
      'fonts.css': enc(''),
      'logo.png': enc('png'),
      'bg.jpg': enc('jpg'),
      'notes.txt': enc('unused'),
    };
    expect(Object.keys(arrangeLooseFiles(files)).sort()).toEqual(['css/fonts.css', 'css/site.css', 'img/bg.jpg', 'img/logo.png', 'notes.txt', 'page.html']);
  });
});
