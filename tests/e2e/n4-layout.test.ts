/**
 * N4: Layout, Flow and Page Setup nodes; the Editor tab edits a Layout node's pages; one undo history across the
 * two tabs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { Page } from 'playwright';
import { api, componentFrames, createProject, editorOp, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';
import { addAfter, connectIds, graphIdle, graphOfPage, openNodes, palette, resultsOfPage, selectNode } from './nodes-harness.js';
import { comparePng } from '../../src/golden/compare.js';
import type { EditorDocument } from '../../src/model/types.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const shotPage = async (page: Page) => {
  await settle(page);
  await page.waitForTimeout(300);
  return (await page.$('.page'))!.screenshot();
};

/** From the Nodes tab, open a Layout node's pages in the Editor tab. */
async function editLayout(page: Page, id: string) {
  await selectNode(page, id);
  await page.click('.nodes-app .inspector button:has-text("Edit pages")');
  await page.waitForSelector('[data-testid="page-frame-1"]');
  await settle(page);
}

describe('N4: layouts in the graph', () => {
  it('a separate layout copied from the project draws the same pages (< 0.5 % of pixels)', async () => {
    for (const fixture of ['01-static', '03-bootstrap', '05-canvas-chart']) {
      const id = await createProject(h, { type: 'fixture', name: fixture });
      const { page, errors } = await openEditor(h, id, { width: 1600, height: 1200 });
      await page.selectOption('select[aria-label="Zoom"]', '1');
      const before = await shotPage(page);
      const projectDoc = await getDoc(page);
      await openNodes(page);
      await selectNode(page, 'layout');
      await page.click('.nodes-app .inspector button:has-text("Make a separate layout")');
      await graphIdle(page);
      await editLayout(page, 'layout');
      expect(await page.inputValue('select[aria-label="Pages to edit"]')).toBe('layout');
      await page.selectOption('select[aria-label="Zoom"]', '1');
      const after = await shotPage(page);
      const d = comparePng(before, after);
      expect(d.ratio, fixture).toBeLessThan(0.005);
      // It is a copy: the project's own pages are untouched, and back on them the Editor shows them again.
      expect((await getDoc(page)).placements).toEqual(projectDoc.placements);
      await page.selectOption('select[aria-label="Pages to edit"]', 'project');
      await settle(page);
      expect(await getDoc(page)).toEqual(projectDoc);
      expect(errors).toEqual([]);
      await page.close();
    }
  }, 300_000);

  it('the Editor tab places components from two pages on a Layout node; it is saved in the graph', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    // Another page, pasted into a Web Source → Capture → Pick ".offer".
    await page.click(palette('Web Source'));
    const src = (await graphOfPage(page)).nodes.at(-1)!.id;
    const cap = await addAfter(page, 'Capture', src, 'files', 'files');
    await selectNode(page, src);
    await page.click('.nodes-app .inspector summary:has-text("Or paste code")');
    await page.fill('.nodes-app textarea[aria-label="Pasted HTML"]', '<section class="offer"><h2>Spring fair</h2><p>Saturday at ten</p></section>');
    await page.click('.nodes-app button:has-text("Import pasted code")');
    await page.waitForSelector('.nodes-app [data-testid="source-page"] strong');
    const pick = await addAfter(page, 'Pick', cap, 'capture', 'capture');
    await selectNode(page, pick);
    await page.fill('.nodes-app .inspector input[placeholder=".card, header"]', '.offer');
    // The project's own headline, picked too.
    const pick2 = await addAfter(page, 'Pick', 'capture', 'capture', 'capture');
    await selectNode(page, pick2);
    await page.fill('.nodes-app .inspector input[placeholder=".card, header"]', '.hero h1');
    // A new Layout fed by both.
    const lay = await addAfter(page, 'Layout', pick2, 'components', 'components');
    await connectIds(page, pick, 'components', lay, 'components');
    await graphIdle(page);
    const r = (await resultsOfPage(page))[lay]!;
    expect(r.status).toBe('ok');
    expect(r.info).toMatchObject({ pages: 1, frames: 0, components: 2 });
    await editLayout(page, lay);
    // Its library is its inputs.
    await page.waitForSelector('[data-testid="layout-library"]');
    const names = await page.$$eval('.lib-item .lib-name', (els) => els.map((e) => e.textContent));
    expect(names).toHaveLength(2);
    // Place both from the library.
    for (const name of names) {
      const row = `.lib-item:has(.lib-name:text-is("${name}"))`;
      await page.hover(row); // its buttons show on hover
      await page.click(`${row} button[title="Place on page"]`);
    }
    await settle(page);
    const doc = await getDoc(page);
    expect(doc.placements).toHaveLength(2);
    expect(Object.values(doc.components).map((c) => !!c.captureKey).sort()).toEqual([true, true]);
    const frames = await componentFrames(page);
    const texts = await Promise.all(frames.map((f) => f.textContent('body')));
    expect(texts.join(' ')).toContain('Spring fair');
    expect(texts.join(' ')).toContain('Design that prints as well as it scrolls');
    // Saved in the graph, not in the project's pages.
    await graphIdle(page);
    const g = await graphOfPage(page);
    expect((g.nodes.find((n) => n.id === lay)!.config as { document: EditorDocument }).document.placements).toHaveLength(2);
    expect((await api<{ document: EditorDocument }>(h, 'GET', `/api/projects/${id}`)).document.placements.map((p) => p.id)).toEqual(['pl-page']);
    // Move a frame: the layout changes, and the Nodes tab's preview of it follows.
    await editorOp(page, 'setPlacementRect', doc.placements[0]!.id, { x: 20, y: 30, w: 100, h: 40 });
    await graphIdle(page);
    expect((await resultsOfPage(page))[lay]!.pages!.document.placements[0]).toMatchObject({ xMm: 20, yMm: 30, wMm: 100, hMm: 40 });
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('a Page Setup node sets the layout’s orientation and margins', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    const lay = await addAfter(page, 'Layout', 'components', 'components', 'components');
    await page.click(palette('Page Setup'));
    const ps = (await graphOfPage(page)).nodes.at(-1)!.id;
    await connectIds(page, ps, 'setup', lay, 'setup');
    await selectNode(page, ps);
    await page.selectOption('.nodes-app .inspector select', 'landscape');
    await page.fill('.nodes-app input[aria-label="left margin (mm)"]', '30');
    await graphIdle(page);
    const d = (await resultsOfPage(page))[lay]!.pages!.document;
    expect(d.pageSetup.orientation).toBe('landscape');
    expect(d.pageSetup.marginsMm.left).toBe(30);
    await editLayout(page, lay);
    const box = (await (await page.$('.page'))!.boundingBox())!;
    expect(box.width).toBeGreaterThan(box.height); // landscape in the Editor tab too
    await page.close();
  }, 120_000);

  it('a Flow node paginates exactly like "Flow onto pages" on the server', async () => {
    const id = await createProject(h, { type: 'fixture', name: '08-long-article' });
    const project = await api<{ document: EditorDocument }>(h, 'GET', `/api/projects/${id}`);
    const server = await api<{ document: EditorDocument; chainId: string }>(h, 'POST', `/api/projects/${id}/paginate`, {
      componentId: 'page',
      pageId: 'page-1',
      document: { ...project.document, placements: [] },
    });
    const serverSlices = server.document.chains.find((c) => c.id === server.chainId)!.slices.map((s) => [s.startPx, s.endPx]);
    expect(serverSlices.length).toBeGreaterThan(3);
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    const flow = await addAfter(page, 'Flow', 'components', 'components', 'components');
    await graphIdle(page);
    const r = (await resultsOfPage(page))[flow]!;
    expect(r.status).toBe('ok');
    const chain = r.pages!.document.chains[0]!;
    expect(chain.slices.map((s) => [s.startPx, s.endPx])).toEqual(serverSlices);
    expect(r.pages!.document.pages).toHaveLength(serverSlices.length);
    expect(chain.slices.every((s) => !s.overflow)).toBe(true);
    // The preview shows the pages.
    await selectNode(page, flow);
    await page.waitForSelector('.nodes-app .preview iframe[title="Page 1"]');
    expect(await page.$$('.nodes-app .preview iframe[title^="Page "]')).toHaveLength(serverSlices.length);
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('one undo history: Undo in either tab undoes the latest step, wherever it was made', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    const start = (await getDoc(page)).placements[0]!;
    // 1. Move the frame in the Editor tab.
    await editorOp(page, 'setPlacementRect', 'pl-page', { x: 30, y: 40, w: 150, h: 200 });
    // 2. Add a node in the Nodes tab.
    await openNodes(page);
    await page.click(palette('Filter'));
    expect((await graphOfPage(page)).nodes).toHaveLength(6);
    // Undo in the Nodes tab: the node goes (the latest step).
    await page.locator('.nodes-app .react-flow__pane').click({ position: { x: 20, y: 300 } });
    await page.keyboard.press('Control+Z');
    expect((await graphOfPage(page)).nodes).toHaveLength(5);
    // Undo again in the Nodes tab: the Editor tab's frame move is undone.
    await page.click('.nodes-app button:has-text("Undo")');
    await page.click('[role="tab"]:has-text("Editor")');
    await page.waitForSelector('[data-testid="page-frame-1"]');
    expect((await getDoc(page)).placements[0]).toMatchObject({ xMm: start.xMm, yMm: start.yMm, wMm: start.wMm, hMm: start.hMm });
    // Redo twice from the Editor tab: the move, then the node.
    await page.click('button[aria-label="Redo"]');
    expect((await getDoc(page)).placements[0]).toMatchObject({ xMm: 30, yMm: 40 });
    await page.keyboard.press('Control+Y');
    expect((await graphOfPage(page)).nodes).toHaveLength(6);
    // Undo from the Editor tab undoes the Nodes tab's step.
    await page.click('button[aria-label="Undo"]');
    expect((await graphOfPage(page)).nodes).toHaveLength(5);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});

export { PNG };
