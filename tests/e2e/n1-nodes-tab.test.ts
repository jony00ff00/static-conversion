/**
 * N1: the Nodes tab, with the canvas copied from Node CMS: the default graph for an existing project, building a
 * graph by dragging, refused connections with their reason, undo / redo, and saving and opening graph files.
 * The Editor tab stays as it was.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createProject, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';
import { connect, fitView, graphIdle, graphOfPage, nodeEl, openNodes, resultsOfPage, selectNode } from './nodes-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const palette = (label: string) => `.nodes-app .palette button.palette-item:has(.palette-label:text-is("${label}"))`;

describe('N1: the Nodes tab', () => {
  it('opens an existing project as the default graph, linked to the Editor tab; the Editor tab is unchanged', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    const before = await getDoc(page);
    await openNodes(page);
    await graphIdle(page);
    const g = await graphOfPage(page);
    expect(g.nodes.map((n) => n.type)).toEqual(['webSource', 'capture', 'components', 'layout', 'export']);
    expect(g.edges).toHaveLength(4);
    const r = await resultsOfPage(page);
    for (const n of g.nodes) expect(r[n.id]!.status, n.id).toBe('ok');
    expect(await page.locator('.nodes-app .linked-pill').count()).toBe(4);
    expect(await nodeEl(page, 'layout').textContent()).toContain('1 page · 1 frame');
    // Back to the Editor tab: same document, pages still there.
    await page.click('[role="tab"]:has-text("Editor")');
    await page.waitForSelector('[data-testid="page-frame-1"]');
    await settle(page);
    expect(await getDoc(page)).toEqual(before);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('builds a graph by dragging from the palette and between handles; a wrong drop says why', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    // Drag a Capture node from the palette onto the canvas; click to add the others.
    const canvas = (await page.locator('.nodes-app .canvas').boundingBox())!;
    await page.locator(palette('Capture')).dragTo(page.locator('.nodes-app .react-flow__pane'), { targetPosition: { x: 200, y: canvas.height - 220 } });
    for (const label of ['Web Source', 'Components', 'Pick']) await page.click(palette(label));
    let g = await graphOfPage(page);
    expect(g.nodes.map((n) => n.id).slice(5)).toEqual(['capture-6', 'webSource-7', 'components-8', 'pick-9']);
    await fitView(page);
    await connect(page, 'webSource-7', 'files', 'capture-6', 'files');
    await connect(page, 'capture-6', 'capture', 'components-8', 'capture');
    await connect(page, 'capture-6', 'capture', 'pick-9', 'capture');
    g = await graphOfPage(page);
    expect(g.edges.slice(4).map((e) => `${e.source}.${e.sourcePort}→${e.target}.${e.targetPort}`)).toEqual([
      'webSource-7.files→capture-6.files',
      'capture-6.capture→components-8.capture',
      'capture-6.capture→pick-9.capture',
    ]);
    // A capture can't go into a Layout's components input.
    await connect(page, 'capture-6', 'capture', 'layout', 'components');
    await page.waitForSelector('.nodes-app [role="alert"]');
    expect(await page.textContent('.nodes-app [role="alert"]')).toContain('Cannot connect a capture output to a components input');
    expect((await graphOfPage(page)).edges).toHaveLength(7);
    // Until it has a page, the source waits and says what it needs.
    await graphIdle(page);
    expect((await resultsOfPage(page))['webSource-7']!.message).toBe('Import a page in this node');
    expect(await nodeEl(page, 'capture-6').textContent()).toContain('Waiting');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('undo and redo in the Nodes tab, separate from the Editor tab’s history', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id, { width: 1920, height: 1080 });
    const doc = await getDoc(page);
    await openNodes(page);
    await page.click(palette('Filter'));
    await page.click(palette('Edit'));
    expect((await graphOfPage(page)).nodes).toHaveLength(7);
    await page.locator('.nodes-app .react-flow__pane').click({ position: { x: 20, y: 300 } });
    await page.keyboard.press('Control+Z');
    expect((await graphOfPage(page)).nodes).toHaveLength(6);
    await page.click('.nodes-app button:has-text("Undo")');
    expect((await graphOfPage(page)).nodes).toHaveLength(5);
    await page.keyboard.press('Control+Y');
    expect((await graphOfPage(page)).nodes.map((n) => n.type)).toContain('filter');
    // Renaming in the inspector while typing is one undo step.
    await selectNode(page, 'filter-6');
    await page.fill('.nodes-app .inspector input[type="text"]', 'Cards only');
    expect((await graphOfPage(page)).nodes.find((n) => n.id === 'filter-6')!.name).toBe('Cards only');
    await page.click('[role="tab"]:has-text("Editor")');
    await page.waitForSelector('[data-testid="page-frame-1"]');
    expect(await getDoc(page)).toEqual(doc);
    await page.close();
  }, 120_000);

  it('the graph is saved with the project, and saves to and opens from a graph file', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const context = await h.browser.newContext({ acceptDownloads: true, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = undefined;
    });
    await page.goto(`${h.base}/project/${id}`);
    await page.waitForSelector('[data-testid="page-frame-1"]');
    await openNodes(page);
    await page.click(palette('Pick'));
    await page.click(palette('Note'));
    await page.waitForTimeout(900); // saved 600 ms after the last change
    await page.waitForSelector('.nodes-app .saved-label');
    const saved = await graphOfPage(page);
    // Reload: the graph comes back from the project.
    await page.reload();
    await page.waitForSelector('[data-testid="page-frame-1"]');
    await openNodes(page);
    const back = await graphOfPage(page);
    expect(back.nodes.map((n) => n.id)).toEqual(saved.nodes.map((n) => n.id));
    expect(back.notes).toHaveLength(1);
    // Save a graph file, change the graph, then open the file again.
    await page.click('.nodes-app button:has-text("Save graph file")');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('.nodes-app dialog button[type="submit"]')]);
    expect(download.suggestedFilename()).toBe('graph.web2print.json');
    const file = readFileSync((await download.path())!, 'utf8');
    expect(JSON.parse(file)).toMatchObject({ format: 'web2print-graph', version: 1 });
    page.once('dialog', (d) => void d.accept());
    await page.click('.nodes-app button:has-text("Reset graph")');
    expect((await graphOfPage(page)).nodes).toHaveLength(5);
    page.once('dialog', (d) => void d.accept());
    await page.setInputFiles('.nodes-app input[aria-label="Graph file"]', { name: 'graph.web2print.json', mimeType: 'application/json', buffer: Buffer.from(file) });
    await page.waitForFunction(() => (window as unknown as { __veGraph: () => { nodes: unknown[] } }).__veGraph().nodes.length === 6);
    const opened = await graphOfPage(page);
    expect(opened.nodes).toEqual(back.nodes);
    expect(opened.edges).toEqual(back.edges);
    await context.close();
  }, 120_000);
});
