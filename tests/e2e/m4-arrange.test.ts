import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { Page } from 'playwright';
import { PX_PER_MM } from '../../src/model/geometry.js';
import { buildTree, defFromItem, flattenTree } from '../../src/compose/tree.js';
import * as ops from '../../src/model/ops.js';
import type { EditorDocument } from '../../src/model/types.js';
import { api, createProject, editorOp, frozenFrame, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const TOL = 0.1; // mm

async function boxCenter(page: Page, id: string) {
  const b = (await (await page.$(`[data-placement-box="${id}"]`))!.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, b };
}

async function dragBy(page: Page, from: { x: number; y: number }, dxPx: number, dyPx: number, alt: boolean) {
  await page.mouse.move(from.x, from.y);
  if (alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (dxPx * i) / steps, from.y + (dyPx * i) / steps);
  await page.mouse.up();
  if (alt) await page.keyboard.up('Alt');
  await settle(page);
}

async function setupBox(page: Page, rect: { x: number; y: number; w: number; h: number }) {
  await editorOp(page, 'setPlacementRect', 'pl-page', rect);
  await editorOp(page, 'updatePlacement', 'pl-page', { fit: 'scale' });
}

describe('M4: arranging in the editor', () => {
  it('drags land on the exact mm position (± 0.1 mm), with and without snapping', async () => {
    const id = await createProject(h, { type: 'fixture', name: '09-div-soup' });
    const { page } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await setupBox(page, { x: 40, y: 60, w: 60, h: 40 });
    const s = PX_PER_MM;

    // Unsnapped (Alt held): +20 mm, +10 mm.
    await dragBy(page, (await boxCenter(page, 'pl-page')), 20 * s, 10 * s, true);
    let p = (await getDoc(page)).placements[0]!;
    expect(Math.abs(p.xMm - 60)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(p.yMm - 70)).toBeLessThanOrEqual(TOL);

    // Snapped: left edge dropped 0.8 mm from the content-area edge snaps onto it.
    await dragBy(page, (await boxCenter(page, 'pl-page')), (15.8 - p.xMm) * s, 0, false);
    p = (await getDoc(page)).placements[0]!;
    expect(Math.abs(p.xMm - 15)).toBeLessThanOrEqual(TOL);

    // Resize from the bottom-right handle, unsnapped: +10 mm, +5 mm.
    const before = { ...p };
    const handle = (await (await page.$('[data-placement-box="pl-page"] [data-handle="se"]'))!.boundingBox())!;
    await dragBy(page, { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }, 10 * s, 5 * s, true);
    p = (await getDoc(page)).placements[0]!;
    expect(Math.abs(p.wMm - (before.wMm + 10))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(p.hMm - (before.hMm + 5))).toBeLessThanOrEqual(TOL);
    expect(Math.abs(p.xMm - before.xMm)).toBeLessThanOrEqual(1e-6);

    // Arrow keys nudge by 0.1 mm (1 mm with Shift).
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await settle(page);
    const n = (await getDoc(page)).placements[0]!;
    expect(n.xMm - p.xMm).toBeCloseTo(0.1, 6);
    expect(n.yMm - p.yMm).toBeCloseTo(1, 6);
    await page.close();
  }, 120_000);

  it('dragging the top margin line changes the margin, never the placements, and flags frames in the margin', async () => {
    const id = await createProject(h, { type: 'fixture', name: '09-div-soup' });
    const { page } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await setupBox(page, { x: 40, y: 25, w: 60, h: 40 });
    const before = (await getDoc(page)).placements;
    const hb = (await (await page.$('[data-testid="margin-top"]'))!.boundingBox())!;
    await dragBy(page, { x: hb.x + 300, y: hb.y + hb.height / 2 }, 0, 10 * PX_PER_MM, false);
    const d = await getDoc(page);
    expect(d.pageSetup.marginsMm.top).toBe(30);
    expect(d.placements).toEqual(before);
    expect(await page.$('[data-placement-box="pl-page"] .warn-badge')).not.toBeNull();
    await page.close();
  }, 120_000);

  it('shows the smallest text size on paper (16 px at 100 % = 12 pt; half size = 6 pt)', async () => {
    const id = await createProject(h, { type: 'fixture', name: '07-webfonts' });
    const { page } = await openEditor(h, id);
    await page.click('[data-placement-box="pl-page"]', { position: { x: 20, y: 20 } });
    await page.waitForSelector('[data-testid="point-size"]');
    expect(await page.textContent('[data-testid="point-size"]')).toContain('12 pt');
    const d = await getDoc(page);
    const def = d.components.page!;
    await editorOp(page, 'updatePlacement', 'pl-page', { fit: 'scale' });
    await editorOp(page, 'setPlacementRect', 'pl-page', { x: 15, y: 20, w: (def.widthPx / PX_PER_MM) / 2, h: 50 });
    expect(await page.textContent('[data-testid="point-size"]')).toContain('6 pt');
    await page.close();
  }, 120_000);

  it('dragging an element from the web pane onto a page places it at the drop point', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await settle(page);
    const web = await frozenFrame(page);
    const card = (await (await web.$('article.card'))!.boundingBox())!;
    const pageBox = (await (await page.$('.page'))!.boundingBox())!;
    const drop = { x: pageBox.x + 50 * PX_PER_MM, y: pageBox.y + 250 * PX_PER_MM };
    await page.mouse.move(card.x + 10, card.y + 10);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(card.x + 10 + ((drop.x - card.x - 10) * i) / 10, card.y + 10 + ((drop.y - card.y - 10) * i) / 10);
    await page.mouse.up();
    await page.waitForFunction(() => ((window as unknown as { __ve: { getDoc(): { placements: unknown[] } } }).__ve.getDoc().placements.length === 2), undefined, { timeout: 10_000 });
    await settle(page);
    const d = await getDoc(page);
    expect(d.placements).toHaveLength(2);
    const p = d.placements[1]!;
    expect(d.components[p.componentId]!.kind).toBe('card');
    expect(Math.abs(p.xMm - 50)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(p.yMm - 250)).toBeLessThanOrEqual(0.5);
    await page.close();
  }, 120_000);
});

/* ------------------------------------------------- export = editor geometry */

const COLOURS: Record<string, [number, number, number]> = { red: [255, 0, 0], green: [0, 160, 0], blue: [0, 0, 255] };

/** Sub-pixel bounding box (mm) of a solid colour in a 300 dpi page PNG. */
function colourBoxMm(png: PNG, rgb: [number, number, number], dpi = 300) {
  const cov = (x: number, y: number) => {
    const i = (png.width * y + x) * 4;
    // 1 on the colour, 0 on white; linear in between (anti-aliased edges).
    const parts = [0, 1, 2].map((k) => (255 - png.data[i + k]!) / Math.max(1, 255 - rgb[k]!)).filter((_, k) => rgb[k]! < 200);
    return Math.max(0, Math.min(1, parts.reduce((a, b) => a + b, 0) / parts.length));
  };
  const isCol = (x: number, y: number) => {
    const i = (png.width * y + x) * 4;
    return [0, 1, 2].every((k) => Math.abs(png.data[i + k]! - rgb[k]!) < 40);
  };
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = 0; y < png.height; y += 2) for (let x = 0; x < png.width; x += 2) if (isCol(x, y)) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const midY = Math.round((minY + maxY) / 2);
  const midX = Math.round((minX + maxX) / 2);
  const edge = (from: number, step: number, at: (k: number) => number) => {
    let k = from;
    while (at(k) > 0.02) k += step;
    k -= step; // last covered pixel
    return step < 0 ? k + (1 - at(k)) : k + at(k);
  };
  const toMm = (px: number) => (px / dpi) * 25.4;
  return {
    x: toMm(edge(minX, -1, (k) => cov(k, midY))),
    right: toMm(edge(maxX, 1, (k) => cov(k, midY))),
    y: toMm(edge(minY, -1, (k) => cov(midX, k))),
    bottom: toMm(edge(maxY, 1, (k) => cov(midX, k))),
  };
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('M4: export geometry equals the editor placements', () => {
  it('random layouts (fixed seeds): every frame lands within ± 0.1 mm in the 300 dpi export', async () => {
    const id = await createProject(h, {
      type: 'paste',
      html: '<div class="sw red"></div><div class="sw green"></div><div class="sw blue"></div>',
      css: 'body{margin:0;background:#fff}.sw{width:200px;height:100px;margin:0 0 20px}.red{background:rgb(255,0,0)}.green{background:rgb(0,160,0)}.blue{background:rgb(0,0,255)}',
    });
    const state = await api<{ document: EditorDocument; analysis: { nodes: Parameters<typeof buildTree>[0] } }>(h, 'GET', `/api/projects/${id}`);
    const items = flattenTree(buildTree(state.analysis.nodes, { ...state.document.decomposition, granularity: 3 })).filter((i) => i.node.bbox.w === 200);
    expect(items).toHaveLength(3);
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = rng(seed);
      let d = ops.deletePlacements(state.document, ['pl-page']);
      const expected: Array<{ colour: string; x: number; y: number; w: number; h: number }> = [];
      items.forEach((item, k) => {
        const w = 20 + r() * 60;
        const hh = w / 2; // same aspect as the 200 × 100 px swatch
        const x = 15 + r() * (180 - w);
        const y = 20 + k * 85 + r() * (80 - hh);
        d = ops.placeComponent(d, defFromItem(item), 'page-1', { xMm: x, yMm: y, wMm: w, hMm: hh, fit: 'scale' }, `p${k}`);
        expected.push({ colour: ['red', 'green', 'blue'][k]!, x, y, w, h: hh });
      });
      await api(h, 'PUT', `/api/projects/${id}/document`, { document: d });
      const png = PNG.sync.read(await api<Buffer>(h, 'POST', `/api/projects/${id}/export`, { format: 'png', pageId: 'page-1', dpi: 300 }));
      for (const e of expected) {
        const b = colourBoxMm(png, COLOURS[e.colour]!);
        expect(Math.abs(b.x - e.x), `seed ${seed} ${e.colour} x`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(b.y - e.y), `seed ${seed} ${e.colour} y`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(b.right - (e.x + e.w)), `seed ${seed} ${e.colour} right`).toBeLessThanOrEqual(TOL);
        expect(Math.abs(b.bottom - (e.y + e.h)), `seed ${seed} ${e.colour} bottom`).toBeLessThanOrEqual(TOL);
      }
    }
  }, 240_000);
});
