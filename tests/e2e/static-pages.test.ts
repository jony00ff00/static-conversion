/**
 * The browser-only build (GitHub Pages): built into a temporary folder and
 * served under /static-conversion/, like Pages does.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Page } from 'playwright';
import { createStaticServer, STATIC_PREFIX } from '../../scripts/serve-static.js';
import { componentFrames, frozenFrame, getDoc, settle } from './harness.js';
import { STATEFUL_PAGE } from './stateful-page.js';
import { graphIdle, graphOfPage, openNodes, resultsOfPage, selectNode } from './nodes-harness.js';

let server: Server | undefined;
let browser: Browser | undefined;
let base: string;

beforeAll(async () => {
  const out = mkdtempSync(path.join(tmpdir(), 've-static-'));
  execFileSync('npx', ['tsx', 'scripts/build-static.ts', out], { stdio: 'pipe' });
  server = createStaticServer(out);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${STATIC_PREFIX}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
});

async function open() {
  const page = await browser!.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Blocked script execution in')) errors.push(m.text());
  });
  await page.goto(base);
  await page.waitForSelector('[data-testid="static-notice"]');
  return { page, errors };
}

async function waitForEditor(page: Page) {
  await page.waitForSelector('[data-testid="page-frame-1"]', { timeout: 60_000 });
  await settle(page);
  return getDoc(page);
}

async function importFixture(page: Page, name: string) {
  await page.click(`[data-fixture="${name}"]`);
  return waitForEditor(page);
}

const PASTE_JS = "document.getElementById('out').textContent = new Date().toISOString() + ' ' + Math.random().toFixed(6);";

async function importPaste(page: Page) {
  await page.fill('textarea[aria-label="HTML"]', '<main><h1>Report</h1><p id="out"></p></main>');
  await page.fill('textarea[aria-label="JavaScript"]', PASTE_JS);
  await page.click('button:has-text("Import pasted code")');
  await waitForEditor(page);
  return (await frozenFrame(page)).textContent('#out');
}

describe('Static build (GitHub Pages)', () => {
  it('imports a test page in the browser and shows both previews', async () => {
    const { page, errors } = await open();
    const doc = await importFixture(page, '01-static');
    expect(page.url()).toMatch(/#\/project\/p-/);
    expect(doc.placements.map((p) => p.id)).toEqual(['pl-page']);
    const web = await frozenFrame(page);
    expect(await web.textContent('h1')).toBe('Design that prints as well as it scrolls');
    expect(await web.$$eval('script', (s) => s.length)).toBe(0);
    const [print] = await componentFrames(page);
    expect(await print!.textContent('h1')).toBe('Design that prints as well as it scrolls');
    // Images load through the service worker.
    expect(await print!.$eval('.hero img', (i) => (i as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    // Projects persist in the browser.
    await page.goto(base);
    await page.waitForSelector('a:has-text("01-static")');
    await page.close();
  }, 120_000);

  it('freezes pasted JavaScript output with a fixed clock and seeded random numbers', async () => {
    const a = await open();
    const text = await importPaste(a.page);
    expect(text).toMatch(/^2026-01-01T00:00:00\.000Z 0\.\d{6}$/);
    const b = await open();
    expect(await importPaste(b.page)).toBe(text);
    expect(a.errors).toEqual([]);
    await a.page.close();
    await b.page.close();
  }, 120_000);

  it('freezes canvas charts and replaces cross-origin iframes with placeholders', async () => {
    const { page } = await open();
    await importFixture(page, '05-canvas-chart');
    const web = await frozenFrame(page);
    expect(await web.$$('canvas')).toHaveLength(0);
    expect(await web.$$eval('img', (imgs) => imgs.filter((i) => (i as HTMLImageElement).src.startsWith('data:image/png')).length)).toBeGreaterThan(0);
    await page.goto(base);
    await page.waitForSelector('[data-fixture="12-cross-origin-iframe"]');
    await importFixture(page, '12-cross-origin-iframe');
    const web2 = await frozenFrame(page);
    expect(await web2.$$('iframe')).toHaveLength(0);
    expect(await web2.textContent('body')).toContain('Embedded content unavailable');
    await page.close();
  }, 120_000);

  it('flows a long article onto linked pages, measured in the browser', async () => {
    const { page, errors } = await open();
    await importFixture(page, '08-long-article');
    await page.click('[data-placement-box="pl-page"]', { position: { x: 30, y: 30 } });
    await page.click('button:has-text("Flow onto pages")');
    await page.waitForFunction(() => (window as unknown as { __ve: { getDoc(): { pages: unknown[] } } }).__ve.getDoc().pages.length > 3, undefined, { timeout: 60_000 });
    await settle(page);
    const d = await getDoc(page);
    const chain = d.chains[0]!;
    expect(chain.placementIds).toHaveLength(d.pages.length);
    expect(chain.slices.every((s) => !s.overflow)).toBe(true);
    for (let i = 1; i < chain.slices.length; i++) expect(chain.slices[i]!.startPx).toBe(chain.slices[i - 1]!.endPx);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('exports through the print dialog with A4 pages, and hides Proof', async () => {
    const { page } = await open();
    await importFixture(page, '01-static');
    await page.evaluate(() => {
      const w = window as unknown as { __vePrintHook(html: string): void; __printed?: string };
      w.__vePrintHook = (html) => {
        w.__printed = html;
      };
    });
    await page.click('button:has-text("Print / Save PDF")');
    const handle = await page.waitForFunction(() => (window as unknown as { __printed?: string }).__printed);
    expect(await handle.jsonValue()).toContain('size: 210mm 297mm');
    expect(await page.$('button:has-text("Proof")')).toBeNull();
    await page.close();
  }, 120_000);

  it('imports an uploaded .html file and shows overflow beyond the page', async () => {
    const { page, errors } = await open();
    await page.setInputFiles('input[aria-label="HTML or zip file"]', [
      { name: 'flyer.html', mimeType: 'text/html', buffer: Buffer.from('<!DOCTYPE html><html><head><link rel="stylesheet" href="styles/flyer.css"></head><body><h1>Spring fair</h1><p>Saturday</p></body></html>') },
      { name: 'flyer.css', mimeType: 'text/css', buffer: Buffer.from('h1 { color: rgb(0, 120, 0); }') },
    ]);
    await waitForEditor(page);
    const web = await frozenFrame(page);
    expect(await web.$eval('h1', (e) => getComputedStyle(e).color)).toBe('rgb(0, 120, 0)');
    await page.evaluate(() => {
      const ve = (window as unknown as { __ve: { commit(op: (d: unknown) => unknown): void; ops: Record<string, (...a: unknown[]) => unknown> } }).__ve;
      ve.commit((d) => ve.ops.setPlacementRect!(d, 'pl-page', { x: 150, y: 20, w: 180, h: 60 }));
    });
    await page.waitForSelector('[data-testid="overflow-frame-1"]');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('captures ticked checkboxes, radio tabs and scrolling from the live preview', async () => {
    const { page, errors } = await open();
    await page.fill('textarea[aria-label="HTML"]', STATEFUL_PAGE.html);
    await page.fill('textarea[aria-label="CSS"]', STATEFUL_PAGE.css);
    await page.fill('textarea[aria-label="JavaScript"]', STATEFUL_PAGE.js);
    await page.click('button:has-text("Import pasted code")');
    await waitForEditor(page);
    await page.click('[role="tab"]:has-text("Live")');
    const live = (await (await page.waitForSelector('iframe[title="Live web page"]')).contentFrame())!;
    await live.waitForSelector('#more-label');
    await live.click('#more-label');
    await live.click('#tab-b-label');
    await live.evaluate(() => scrollTo(0, 2200));
    await page.waitForSelector('text=3 recorded steps');
    await page.click('button:has-text("Capture this state")');
    await page.waitForSelector('iframe[title="Frozen web page"]');
    await page.waitForFunction(() => !document.querySelector('.status'));
    await settle(page);
    const d = await getDoc(page);
    expect(d.setupSteps).toEqual([
      { action: 'check', selector: '#more', checked: true },
      { action: 'check', selector: '#tab-b', checked: true },
      { action: 'scroll', selector: null, x: 0, y: 2200 },
    ]);
    const web = await frozenFrame(page);
    expect(await web.$eval('#more-box', (e) => getComputedStyle(e).display)).toBe('block');
    expect(await web.$eval('#panel-b', (e) => getComputedStyle(e).display)).toBe('block');
    expect(await web.getAttribute('#late', 'class')).toContain('shown');
    expect(await web.getAttribute('#top', 'class')).toContain('scrolled');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('Nodes tab: the default graph, a page added and captured in the browser, and picking by selector', async () => {
    const { page, errors } = await open();
    await importFixture(page, '01-static');
    await openNodes(page);
    await graphIdle(page);
    let r = await resultsOfPage(page);
    for (const id of ['source', 'capture', 'components', 'layout', 'export']) expect(r[id]!.status, id).toBe('ok');
    // Another page, pasted into a new Web Source and captured with its own settings (in a hidden iframe).
    const palette = (label: string) => `.nodes-app .palette button.palette-item:has(.palette-label:text-is("${label}"))`;
    await page.click(palette('Web Source'));
    await page.click(palette('Capture'));
    await page.click(palette('Pick'));
    const [src, cap, pick] = (await graphOfPage(page)).nodes.slice(-3).map((n) => n.id) as [string, string, string];
    await page.evaluate(
      ({ src, cap, pick }) => {
        const c = (window as unknown as { __veConnect: (e: object) => void }).__veConnect;
        c({ source: src, sourcePort: 'files', target: cap, targetPort: 'files' });
        c({ source: cap, sourcePort: 'capture', target: pick, targetPort: 'capture' });
      },
      { src, cap, pick },
    );
    await selectNode(page, src);
    await page.click('.nodes-app .inspector summary:has-text("Or paste code")');
    await page.fill('.nodes-app textarea[aria-label="Pasted HTML"]', '<section class="offer"><h2>Bread</h2></section><section class="offer"><h2>Milk</h2></section>');
    await page.click('.nodes-app button:has-text("Import pasted code")');
    await page.waitForSelector('.nodes-app [data-testid="source-page"] strong');
    await selectNode(page, pick);
    await page.fill('.nodes-app .inspector input[placeholder=".card, header"]', '.offer');
    await graphIdle(page);
    r = await resultsOfPage(page);
    expect(r[cap]!.status).toBe('ok');
    expect(r[pick]!.items).toHaveLength(2);
    const frame = (await (await page.waitForSelector('.nodes-app .preview iframe[title="Pick components"]')).contentFrame())!;
    await frame.waitForSelector('h2');
    expect(await frame.$$eval('[data-ve-outline]', (els) => els.length)).toBe(2);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('turns off importing from a web address, with an explanation', async () => {
    const { page } = await open();
    expect(await page.isDisabled('button:has-text("Import from URL")')).toBe(true);
    expect(await page.textContent('main')).toContain('needs the local version');
    await page.close();
  }, 60_000);
});
