/**
 * N5: Combine and Export. Two sample graphs export to PDF with the right page count and exact A4 page boxes, and
 * match their golden page images; re-importing a changed page updates the export with its placements kept; the
 * Export node and a Layout's pages in the Editor tab export from the browser.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { api, createProject, openEditor, startHarness, type Harness } from './harness.js';
import { graphIdle, openNodes, selectNode } from './nodes-harness.js';
import { REPO, poppler, tmp, writeTmp } from '../helpers.js';
import { comparePng } from '../../src/golden/compare.js';
import { addSource, loadProject } from '../../src/server/projects.js';
import { exportNodePages, pagesOfNode } from '../../src/server/graph-run.js';
import { brochureGraph, flyerGraph } from '../sample-graphs.js';
import type { Graph } from '../../src/graph/index.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const UPDATE = process.env.GOLDEN_UPDATE === '1';
const GOLDEN = path.join(REPO, 'golden', 'graphs');
const DPI = 40;

/** Every page of a PDF as PNG (pdftoppm), with its page count and page box. */
function pdfPages(pdf: Buffer) {
  const file = writeTmp(pdf, 'out.pdf');
  const info = poppler('pdfinfo', ['-f', '1', '-l', '999', file]);
  const boxes = [...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+) pts/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const dir = tmp('ve-pdfpages-');
  poppler('pdftoppm', ['-r', String(DPI), '-png', file, path.join(dir, 'p')]);
  const pngs = readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => readFileSync(path.join(dir, f)));
  return { pages: pngs, boxes, text: poppler('pdftotext', ['-layout', file, '-']) };
}

function checkGolden(name: string, pages: Buffer[]) {
  const dir = path.join(GOLDEN, name);
  if (UPDATE || !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    pages.forEach((p, i) => writeFileSync(path.join(dir, `page-${i + 1}.png`), p));
    writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ pages: pages.length, dpi: DPI }, null, 2) + '\n');
    if (!UPDATE) throw new Error(`No golden pages for ${name}: written to golden/graphs/${name}; review and commit them`);
    return;
  }
  const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as { pages: number };
  expect(pages.length, `${name}: pages`).toBe(meta.pages);
  pages.forEach((p, i) => {
    const d = comparePng(readFileSync(path.join(dir, `page-${i + 1}.png`)), p);
    expect(d.sizeMismatch, `${name} page ${i + 1} size`).toBeFalsy();
    expect(d.ratio, `${name} page ${i + 1}`).toBeLessThan(0.005);
  });
}

const A4 = [595.276, 841.89];

describe('N5: export from the graph', () => {
  it('brochure: one A4 page, exact page box, the edited headline, matches its golden page', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { graph, exportId } = await brochureGraph(id);
    const pdf = await exportNodePages(await loadProject(id), graph, exportId, { format: 'pdf' });
    const out = pdfPages(pdf);
    expect(out.pages).toHaveLength(1);
    for (const b of out.boxes) expect(b).toEqual(A4);
    expect(out.text).toContain('Spring brochure');
    expect(out.text).not.toContain('Design that'); // the headline is large: it wraps after "Design that"
    checkGolden('brochure', out.pages);
  }, 180_000);

  it('flyer + article: a cover from two pages, then the article flowed; one document; matches its golden pages', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { graph, exportId } = await flyerGraph(id);
    const s = await loadProject(id);
    const v = await pagesOfNode(s, graph, exportId);
    const flowPages = (await pagesOfNode(s, graph, 'flow')).document.pages.length;
    expect(v.document.pages).toHaveLength(1 + flowPages);
    expect(Object.keys(v.captures).length).toBeGreaterThanOrEqual(3);
    const pdf = await exportNodePages(s, graph, exportId, { format: 'pdf' });
    const out = pdfPages(pdf);
    expect(out.pages).toHaveLength(1 + flowPages);
    for (const b of out.boxes) expect(b).toEqual(A4);
    expect(out.text).toContain('Spring fair');
    expect(out.text).toContain('Design that');
    checkGolden('flyer-article', out.pages);
  }, 300_000);

  it('re-importing a changed page updates the export, with its placement kept', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { graph, exportId, flyerSource } = await flyerGraph(id);
    let s = await loadProject(id);
    const before = (await pagesOfNode(s, graph, 'cover')).document.placements;
    // The flyer is re-imported with a new headline (same page id: the Web Source node keeps it).
    const changed = await addSource(s, { type: 'paste', html: '<main><section class="offer"><h2>Summer fair</h2><p>Saturday 10:00 to 16:00, on the green.</p><p class="note">Bring a friend.</p></section></main>', css: '', title: 'Flyer', replace: flyerSource });
    expect(changed.id).toBe(flyerSource);
    s = await loadProject(id);
    const g2: Graph = { ...graph, nodes: graph.nodes.map((x) => (x.id === 'flyer-src' ? { ...x, config: { ...(x.config as object), hash: changed.hash } } : x)) };
    const v = await pagesOfNode(s, g2, 'cover');
    expect(v.document.placements).toEqual(before);
    const text = pdfPages(await exportNodePages(s, g2, 'cover', { format: 'pdf' })).text;
    expect(text).toContain('Summer fair');
    expect(text).not.toContain('Spring fair');
    void exportId;
  }, 240_000);

  it('the Export node exports a PDF from the browser; a Layout’s pages export from the Editor tab', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { graph } = await brochureGraph(id);
    await api(h, 'PUT', `/api/projects/${id}/graph`, { stored: { version: 1, graph } });
    const context = await h.browser.newContext({ acceptDownloads: true, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${h.base}/project/${id}`);
    await page.waitForSelector('[data-testid="page-frame-1"]');
    await openNodes(page);
    await graphIdle(page);
    await selectNode(page, 'export');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('.nodes-app .inspector button:has-text("Export PDF")')]);
    expect(dl.suggestedFilename()).toBe('export.pdf');
    const pdf = readFileSync((await dl.path())!);
    expect(pdfPages(pdf).text).toContain('Spring brochure');
    // The Editor tab, on the brochure layout: its Export PDF exports the layout, not the project's pages.
    await selectNode(page, 'brochure');
    await page.click('.nodes-app .inspector button:has-text("Edit pages")');
    await page.waitForSelector('[data-testid="page-frame-1"]');
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('.toolbar button:has-text("Export PDF")')]);
    expect(dl2.suggestedFilename()).toBe('brochure.pdf');
    const text2 = pdfPages(readFileSync((await dl2.path())!)).text;
    expect(text2).toContain('Spring brochure');
    // The project's own pages are unchanged by any of this.
    const p = await api<{ document: { placements: unknown[] } }>(h, 'GET', `/api/projects/${id}`);
    expect(p.document.placements).toHaveLength(1);
    expect(errors).toEqual([]);
    await context.close();
  }, 180_000);
});
