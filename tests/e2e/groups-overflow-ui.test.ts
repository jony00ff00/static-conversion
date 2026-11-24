import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { Page } from 'playwright';
import { PX_PER_MM } from '../../src/model/geometry.js';
import { buildTree, defFromItem, flattenTree } from '../../src/compose/tree.js';
import type { EditorDocument, Analysis } from '../../src/model/types.js';
import { api, componentFrames, createProject, editorOp, frozenFrame, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const s = PX_PER_MM; // zoom 100 %

async function dragBy(page: Page, from: { x: number; y: number }, dxPx: number, dyPx: number) {
  await page.mouse.move(from.x, from.y);
  await page.keyboard.down('Alt'); // no snapping
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + (dxPx * i) / 8, from.y + (dyPx * i) / 8);
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await settle(page);
}

const centre = async (page: Page, sel: string) => {
  const b = (await (await page.waitForSelector(sel)).boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** Brightness of the screen area just right of page 1 (the pasteboard). */
async function rightOfPage(page: Page) {
  const b = (await (await page.$('.page'))!.boundingBox())!;
  const png = PNG.sync.read(await page.screenshot({ clip: { x: b.x + b.width + 4, y: b.y + 260, width: 120, height: 200 } }));
  let dark = 0;
  for (let i = 0; i < png.data.length; i += 4) if (png.data[i]! + png.data[i + 1]! + png.data[i + 2]! < 600) dark++;
  return dark;
}

describe('Overflow beyond the page', () => {
  it('shows a frame running off the page, dimmed, with room around the page; and can be turned off', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await editorOp(page, 'updatePlacement', 'pl-page', { fit: 'scale' });
    expect(await page.$('[data-testid="overflow-frame-1"]')).toBeNull();

    // At x = 135 mm and 180 mm wide, it runs 105 mm past the 210 mm page.
    await editorOp(page, 'setPlacementRect', 'pl-page', { x: 135, y: 20, w: 180, h: 211 });
    const ov = await page.waitForSelector('[data-testid="overflow-frame-1"]');
    const pb = (await (await page.$('.page'))!.boundingBox())!;
    const ob = (await ov.boundingBox())!;
    expect(ob.x + ob.width - (pb.x + pb.width)).toBeCloseTo(105 * s, 0);
    expect(ob.y).toBeCloseTo(pb.y, 0);
    // The print pane scrolls far enough to show all of it.
    const reach = await page.$eval('.print-pane', (pane) => {
      const ghost = pane.querySelector('.overflow-frame')!.getBoundingClientRect();
      const r = pane.getBoundingClientRect();
      return { right: ghost.right - r.left + pane.scrollLeft, scrollWidth: pane.scrollWidth };
    });
    expect(reach.scrollWidth).toBeGreaterThanOrEqual(Math.floor(reach.right));
    // Content is visible outside the page.
    await settle(page);
    await page.waitForTimeout(300);
    const withOverflow = await rightOfPage(page);
    expect(withOverflow).toBeGreaterThan(50);

    await page.uncheck('input[aria-label="Show overflow"]');
    expect(await page.$('[data-testid="overflow-frame-1"]')).toBeNull();
    expect(await rightOfPage(page)).toBe(0);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('shows reflow content below a frame that is too short, inside the page', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await editorOp(page, 'setPlacementRect', 'pl-page', { x: 15, y: 20, w: 180, h: 100 });
    expect(await page.$('[data-testid="overflow-pl-page"]')).not.toBeNull();
    const ov = await page.waitForSelector('[data-testid="overflow-frame-1"]');
    const frame = (await ov.contentFrame())!;
    await frame.waitForSelector('iframe.ve-inner');
    const innerH = await frame.$eval('iframe.ve-inner', (f) => parseFloat((f as HTMLElement).style.height));
    expect(innerH).toBeGreaterThan(100 * s + 50);
    // Content fits within the page's height, so no extra room below it.
    const pb = (await (await page.$('.page'))!.boundingBox())!;
    const ob = (await ov.boundingBox())!;
    expect(ob.height).toBeCloseTo(pb.height, 0);
    await page.close();
  }, 120_000);
});

describe('Groups: resize and crop with one set of handles', () => {
  async function twoGrouped() {
    const id = await createProject(h, { type: 'fixture', name: '03-bootstrap' });
    const p = await api<{ analysis: Analysis; document: EditorDocument }>(h, 'GET', `/api/projects/${id}`);
    const flat = flattenTree(buildTree(p.analysis.nodes, p.document.decomposition));
    const cards = flat.filter((i) => i.node.kind === 'card').slice(0, 2);
    const { page, errors } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await editorOp(page, 'deletePlacements', ['pl-page']);
    await editorOp(page, 'placeComponent', defFromItem(cards[0]!), 'page-1', { xMm: 30, yMm: 40, wMm: 50, hMm: 40, fit: 'scale' }, 'pl-a');
    await editorOp(page, 'placeComponent', defFromItem(cards[1]!), 'page-1', { xMm: 100, yMm: 60, wMm: 50, hMm: 40, fit: 'scale' }, 'pl-b');
    await editorOp(page, 'group', ['pl-a', 'pl-b'], 'g1');
    await page.click('[data-placement-box="pl-b"]', { position: { x: 10, y: 10 } });
    await page.waitForSelector('[data-testid="group-box"]');
    return { page, errors };
  }

  it('selecting an item selects its group: one box, handles on the group only', async () => {
    const { page, errors } = await twoGrouped();
    expect(await page.$$('[data-placement-box] [data-handle]')).toHaveLength(0);
    expect(await page.$$('[data-group-handle]')).toHaveLength(8);
    const gb = (await (await page.$('[data-testid="group-box"]'))!.boundingBox())!;
    const pb = (await (await page.$('.page'))!.boundingBox())!;
    expect((gb.x - pb.x) / s).toBeCloseTo(30, 0);
    expect(gb.width / s).toBeCloseTo(120, 0);
    expect(gb.height / s).toBeCloseTo(60, 0);
    expect(await page.textContent('[data-testid="group-tools"]')).toContain('Group of 2');
    // The library row of the selected element stays in the list (it once shared a class with the floating highlight).
    expect(await page.$$eval('.lib-item', (els) => els.every((e) => getComputedStyle(e).position === 'static'))).toBe(true);
    expect(await page.$('.lib-item.current')).not.toBeNull();
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('dragging a group handle scales every item', async () => {
    const { page } = await twoGrouped();
    await dragBy(page, await centre(page, '[data-group-handle="se"]'), 60 * s, 30 * s);
    const d = await getDoc(page);
    const a = d.placements.find((p) => p.id === 'pl-a')!;
    const b = d.placements.find((p) => p.id === 'pl-b')!;
    // 120 → 180 mm wide (×1.5), 60 → 90 mm tall (×1.5), anchored at the top-left.
    expect(a.xMm).toBeCloseTo(30, 1);
    expect(a.wMm).toBeCloseTo(75, 1);
    expect(b.xMm).toBeCloseTo(135, 1);
    expect(b.yMm).toBeCloseTo(70, 1);
    expect(b.hMm).toBeCloseTo(60, 1);
    // One undo restores both.
    await page.keyboard.press('Control+Z');
    await settle(page);
    const u = await getDoc(page);
    expect(u.placements.find((p) => p.id === 'pl-b')!.xMm).toBeCloseTo(100, 6);
    expect(u.placements.find((p) => p.id === 'pl-a')!.wMm).toBeCloseTo(50, 6);
    await page.close();
  }, 120_000);

  it('in crop mode the handles trim the group and the content stays put', async () => {
    const { page, errors } = await twoGrouped();
    const textPos = async () => {
      const [fa] = await componentFrames(page);
      const el = (await fa!.$('[data-ve-root] *:not(script)'))!;
      return (await el.boundingBox())!;
    };
    const before = await textPos();
    await page.check('input[name="group-mode"] >> nth=1');
    await page.waitForSelector('.group-box.mode-crop');
    // Trim 10 mm off the left of the group.
    await dragBy(page, await centre(page, '[data-group-handle="w"]'), 10 * s, 0);
    const d = await getDoc(page);
    const a = d.placements.find((p) => p.id === 'pl-a')!;
    expect(a.xMm).toBeCloseTo(40, 1);
    expect(a.wMm).toBeCloseTo(40, 1);
    expect(a.fit).toBe('crop');
    expect(a.cropXPx).toBeGreaterThan(0);
    expect(d.placements.find((p) => p.id === 'pl-b')!.xMm).toBeCloseTo(100, 6);
    const after = await textPos();
    expect(Math.abs(after.x - before.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});

describe('Uploading an HTML file', () => {
  it('imports an .html file with its stylesheet chosen alongside it', async () => {
    const page = await h.browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${h.base}/`);
    await page.setInputFiles('input[aria-label="HTML or zip file"]', [
      { name: 'report.html', mimeType: 'text/html', buffer: Buffer.from('<!DOCTYPE html><html><head><link rel="stylesheet" href="css/site.css"></head><body><h1>Quarterly report</h1></body></html>') },
      { name: 'site.css', mimeType: 'text/css', buffer: Buffer.from('h1 { color: rgb(200, 0, 0); }') },
    ]);
    await page.waitForSelector('[data-testid="page-frame-1"]', { timeout: 60_000 });
    await settle(page);
    const web = await frozenFrame(page);
    expect(await web.textContent('h1')).toBe('Quarterly report');
    expect(await web.$eval('h1', (e) => getComputedStyle(e).color)).toBe('rgb(200, 0, 0)');
    expect(await page.textContent('.toolbar .title')).toBe('report.html');
    await page.close();
  }, 120_000);
});
