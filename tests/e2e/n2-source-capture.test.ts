/**
 * N2: Web Source and Capture nodes. Importing another page into a Web Source node, capturing it with the node's
 * own settings, the preview following the selection (frozen page, Live view), and "Capture this state" on a
 * Capture node. A Capture node with the project's settings finds exactly what the Editor tab's capture found, for
 * every test page.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { api, createProject, getDoc, openEditor, startHarness, type Harness } from './harness.js';
import { graphIdle, graphOfPage, nodeEl, openNodes, resultsOfPage, selectNode } from './nodes-harness.js';
import { STATEFUL_PAGE } from './stateful-page.js';
import { listFixtures } from '../../src/golden/fixtures.js';
import type { Analysis, EditorDocument } from '../../src/model/types.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const palette = (label: string) => `.nodes-app .palette button.palette-item:has(.palette-label:text-is("${label}"))`;
const previewFrame = async (page: Page, title: string) => (await (await page.waitForSelector(`.nodes-app .preview iframe[title="${title}"]`)).contentFrame())!;

/** Add Web Source → Capture, connected, and import pasted code into the source. */
async function addPastedSource(page: Page, html: string, css = '') {
  await page.click(palette('Web Source'));
  await page.click(palette('Capture'));
  const g = await graphOfPage(page);
  const [src, cap] = g.nodes.slice(-2).map((n) => n.id) as [string, string];
  await page.evaluate(({ src, cap }) => {
    // Connecting by dragging is covered in N1; here the store's connect is enough.
    (window as unknown as { __veConnect: (e: object) => void }).__veConnect({ source: src, sourcePort: 'files', target: cap, targetPort: 'files' });
  }, { src, cap });
  await selectNode(page, src);
  await page.click('.nodes-app .inspector summary:has-text("Or paste code")');
  await page.fill('.nodes-app textarea[aria-label="Pasted HTML"]', html);
  await page.fill('.nodes-app textarea[aria-label="Pasted CSS"]', css);
  await page.click('.nodes-app button:has-text("Import pasted code")');
  await page.waitForSelector('.nodes-app [data-testid="source-page"] strong');
  return { src, cap };
}

describe('N2: Web Source and Capture nodes', () => {
  it('imports another page, captures it with the node’s settings and shows the frozen page', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    const { src, cap } = await addPastedSource(page, '<header><h1>Flyer</h1></header><main><p class="lead">Spring fair on Saturday</p></main>', '.lead { color: rgb(0, 120, 0); }');
    await graphIdle(page);
    expect(await nodeEl(page, src).textContent()).toContain('Pasted page');
    const r = (await resultsOfPage(page))[cap]!;
    expect(r.status).toBe('ok');
    expect(r.info.width).toBe('680 px');
    // The preview follows the selection: the Capture node shows its frozen page, styles and all.
    await selectNode(page, cap);
    const frozen = await previewFrame(page, 'Frozen page');
    await frozen.waitForSelector('.lead');
    expect(await frozen.textContent('.lead')).toBe('Spring fair on Saturday');
    expect(await frozen.$eval('.lead', (e) => getComputedStyle(e).color)).toBe('rgb(0, 120, 0)');
    expect(await frozen.$$eval('script', (s) => s.length)).toBe(0);
    // A different capture width re-captures; moving the node does not.
    await page.fill('.nodes-app input[aria-label="Capture width (px)"]', '900');
    await page.locator('.nodes-app input[aria-label="Capture width (px)"]').blur();
    await page.waitForFunction((cap) => (window as unknown as { __veResults: () => Record<string, { info: { width?: string } }> }).__veResults()[cap]?.info.width === '900 px', cap);
    // The Web Source previews the page running live.
    await selectNode(page, src);
    const live = await previewFrame(page, 'Live page: Pasted page');
    await live.waitForSelector('h1');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('Capture this state on an unlinked Capture node records into the node; on the linked one, into the project', async () => {
    const id = await createProject(h, { type: 'paste', ...STATEFUL_PAGE });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    // Linked (default graph): the steps go to the project, re-capturing it for both tabs.
    await selectNode(page, 'capture');
    await page.click('.nodes-app .preview [role="tab"]:has-text("Live")');
    const live = await previewFrame(page, 'Live page: Pasted page');
    await live.waitForSelector('#more-label');
    await live.click('#more-label');
    await page.waitForSelector('.nodes-app [data-testid="node-recorded-steps"]:has-text("1 recorded step")');
    await page.click('.nodes-app .preview button:has-text("Capture this state")');
    await page.waitForFunction(() => !document.querySelector('.toolbar .status'), undefined, { timeout: 60_000 });
    await page.waitForSelector('.nodes-app [data-testid="capture-steps"]');
    expect(await page.textContent('.nodes-app [data-testid="capture-steps"]')).toBe('tick #more');
    await page.click('[role="tab"]:has-text("Editor")');
    await page.waitForSelector('[data-testid="page-frame-1"]');
    expect((await getDoc(page)).setupSteps).toEqual([{ action: 'check', selector: '#more', checked: true }]);
    // Unlinked: the steps stay in the node and only its capture changes.
    await openNodes(page);
    await selectNode(page, 'capture');
    await page.click('.nodes-app .inspector label:has-text("Use the Editor tab’s capture")');
    let g = await graphOfPage(page);
    expect(g.nodes.find((n) => n.id === 'capture')!.config).toMatchObject({ linked: false, setupSteps: [{ action: 'check', selector: '#more', checked: true }] });
    await page.click('.nodes-app .preview [role="tab"]:has-text("Live")');
    const live2 = await previewFrame(page, 'Live page: Pasted page');
    await live2.waitForSelector('#tab-b-label');
    await live2.click('#tab-b-label');
    await page.waitForSelector('.nodes-app [data-testid="node-recorded-steps"]:has-text("1 recorded step")');
    await page.click('.nodes-app .preview button:has-text("Capture this state")');
    g = await graphOfPage(page);
    expect((g.nodes.find((n) => n.id === 'capture')!.config as { setupSteps: unknown[] }).setupSteps).toHaveLength(2);
    await graphIdle(page);
    const frozen = await previewFrame(page, 'Frozen page');
    await frozen.waitForSelector('#panel-b');
    expect(await frozen.$eval('#panel-b', (e) => getComputedStyle(e).display)).toBe('block');
    expect(await frozen.$eval('#more-box', (e) => getComputedStyle(e).display)).toBe('block');
    await page.click('[role="tab"]:has-text("Editor")');
    await page.waitForSelector('[data-testid="page-frame-1"]');
    expect((await getDoc(page)).setupSteps).toHaveLength(1); // the project kept its own
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('a Capture node with the project’s settings finds exactly what the Editor tab’s capture found (12 test pages)', async () => {
    for (const name of listFixtures()) {
      const id = await createProject(h, { type: 'fixture', name });
      const p = await api<{ analysis: Analysis; document: EditorDocument }>(h, 'GET', `/api/projects/${id}`);
      const d = p.document;
      const c = await api<{ analysis: Analysis; frozenHtml: string }>(h, 'POST', `/api/projects/${id}/sources/main/capture`, {
        captureWidthPx: d.captureWidthPx,
        presets: d.presets,
        setupSteps: d.setupSteps,
        rules: d.decomposition.rules,
      });
      expect(c.analysis.nodes, name).toEqual(p.analysis.nodes);
      expect(c.analysis.documentHeightPx, name).toBe(p.analysis.documentHeightPx);
      const frozen = (await api<Buffer>(h, 'GET', `/api/projects/${id}/frozen`)).toString('utf8');
      expect(c.frozenHtml === frozen, `${name}: frozen HTML`).toBe(true);
    }
  }, 600_000);
});
