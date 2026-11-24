import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';
import type { Frame, Page } from 'playwright';
import { comparePng } from '../../src/golden/compare.js';
import { api, componentFrames, createProject, frozenFrame, openEditor, settle, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

type Box = { x: number; y: number; width: number; height: number };
const near = (a: Box, b: { x: number; y: number; w: number; h: number }, tol = 1) =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.width - b.w) <= tol && Math.abs(a.height - b.h) <= tol;

const highlights = (page: Page) =>
  page.evaluate(() => {
    const r = (el: Element) => {
      const b = el.getBoundingClientRect();
      return { x: b.left, y: b.top, w: b.width, h: b.height };
    };
    return {
      web: Array.from(document.querySelectorAll('[data-testid="hl-web"]')).map(r),
      print: Array.from(document.querySelectorAll('[data-testid="hl-print"]')).map(r),
    };
  });

/** Stamped, visible leaf-ish elements in a frame (excluding html/head/body). */
async function candidates(f: Frame, max: number) {
  const ids = await f.$$eval('body [data-wp-id]', (els) =>
    els
      .filter((e) => {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        return r.width >= 4 && r.height >= 4 && cs.visibility !== 'hidden' && !e.closest('[data-ve-hide]');
      })
      .map((e) => e.getAttribute('data-wp-id')!),
  );
  return ids.slice(0, max);
}

describe('M2: side-by-side preview', () => {
  it.each(['02-tailwind', '03-bootstrap', '08-long-article'])(
    '%s: clicking an element in the web pane highlights it in both panes (±1 px)',
    async (fixture) => {
      const id = await createProject(h, { type: 'fixture', name: fixture });
      const { page, errors } = await openEditor(h, id);
      await page.selectOption('select[aria-label="Zoom"]', '1');
      await settle(page);
      const web = await frozenFrame(page);
      const ids = await candidates(web, 40);
      expect(ids.length).toBeGreaterThanOrEqual(30);
      let checked = 0;
      for (const wp of ids) {
        const el = await web.$(`[data-wp-id="${wp}"]`);
        await el!.scrollIntoViewIfNeeded();
        const wb = (await el!.boundingBox())!;
        await page.mouse.click(wb.x + Math.min(3, wb.width / 2), wb.y + Math.min(3, wb.height / 2));
        await page.waitForTimeout(30);
        const hl = await highlights(page);
        // The click may land on a child element: check whichever the editor selected.
        const selId = await page.evaluate(() => (window as unknown as { __ve: { getSelectedWpId(): string | null } }).__ve.getSelectedWpId());
        expect(selId).not.toBeNull();
        const target = await web.$(`[data-wp-id="${selId}"]`);
        const tb = (await target!.boundingBox())!;
        expect(hl.web.length).toBe(1);
        expect(near(tb, hl.web[0]!)).toBe(true);
        // The same element in the print pane.
        const prints: Box[] = [];
        for (const cf of await componentFrames(page)) {
          const pe = await cf.$(`[data-wp-id="${selId}"]`);
          const pb = pe && (await pe.boundingBox());
          const fb = await (await cf.frameElement()).evaluate((node) => {
            const f = node as Element;
            const r = f.closest('.ve-frame')!.getBoundingClientRect();
            const pr = (f.ownerDocument!.defaultView!.frameElement as Element).getBoundingClientRect();
            return { x: pr.left + r.left, y: pr.top + r.top, w: r.width, h: r.height };
          });
          const visible = pb && pb.width > 0 && pb.height > 0 && pb.y < fb.y + fb.h && pb.y + pb.height > fb.y;
          if (visible) {
            const x = Math.max(pb!.x, fb.x);
            const y = Math.max(pb!.y, fb.y);
            prints.push({ x, y, width: Math.min(pb!.x + pb!.width, fb.x + fb.w) - x, height: Math.min(pb!.y + pb!.height, fb.y + fb.h) - y });
          }
        }
        if (hl.print.length !== prints.length || !prints.every((pb) => hl.print.some((r) => near(pb, r)))) console.log('PRINT MISMATCH', selId, JSON.stringify(prints), JSON.stringify(hl.print));
        if (prints.length) {
          expect(hl.print.length).toBe(prints.length);
          for (const pb of prints) expect(hl.print.some((r) => near(pb, r))).toBe(true);
        }
        checked++;
      }
      expect(checked).toBeGreaterThanOrEqual(20);
      expect(errors).toEqual([]);
      await page.close();
    },
    180_000,
  );

  it('clicking an element in the print pane highlights the same element in the web pane', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id);
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await settle(page);
    const [cf] = await componentFrames(page);
    const leaves = await cf!.$$eval('body [data-wp-id]', (els) =>
      els.filter((e) => e.children.length === 0 && e.getBoundingClientRect().width > 8 && e.getBoundingClientRect().height > 8).map((e) => e.getAttribute('data-wp-id')!),
    );
    expect(leaves.length).toBeGreaterThanOrEqual(10);
    const web = await frozenFrame(page);
    let same = 0;
    let tried = 0;
    for (const wp of leaves.slice(0, 30)) {
      const pb = (await (await cf!.$(`[data-wp-id="${wp}"]`))!.boundingBox())!;
      if (pb.y + pb.height / 2 > 990) continue; // below the window
      await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
      await page.waitForTimeout(60);
      const selId = await page.evaluate(() => (window as unknown as { __ve: { getSelectedWpId(): string | null } }).__ve.getSelectedWpId());
      if (selId === wp) same++;
      const we = await web.$(`[data-wp-id="${selId}"]`);
      const wb = (await we!.boundingBox())!;
      const hl = await highlights(page);
      expect(hl.web.length).toBe(1);
      if (!near(wb, hl.web[0]!)) console.log('MISMATCH', wp, selId, wb, hl.web[0]);
      expect(near(wb, hl.web[0]!)).toBe(true);
      tried++;
    }
    // The clicked element itself is selected (not a parent or neighbour).
    expect(same / tried).toBeGreaterThanOrEqual(0.9);
    await page.close();
  }, 120_000);

  it('"Capture this state" replays clicks made in the live pane', async () => {
    const id = await createProject(h, { type: 'fixture', name: '10-interactive' });
    // Turn off the expand preset so only the clicked tab is open.
    const cur = await api<{ document: { presets: Record<string, boolean> } }>(h, 'GET', `/api/projects/${id}`);
    await api(h, 'POST', `/api/projects/${id}/recapture`, { presets: { ...cur.document.presets, expandInteractive: false } });
    const { page } = await openEditor(h, id);
    await page.click('[role="tab"]:has-text("Live")');
    const liveEl = await page.waitForSelector('iframe[title="Live web page"]');
    const live = (await liveEl.contentFrame())!;
    await live.waitForSelector('#t2');
    await live.click('#t2');
    await page.waitForSelector('text=1 recorded step');
    await page.click('button:has-text("Capture this state")');
    await page.waitForSelector('iframe[title="Frozen web page"]');
    await page.waitForFunction(() => !document.querySelector('.status'));
    const frozen = await api<Buffer>(h, 'GET', `/api/projects/${id}/frozen`);
    const html = frozen.toString('utf8');
    expect(html).toMatch(/id="p2"[^>]*>1200 W/);
    expect(html).not.toMatch(/id="p2"[^>]*hidden/);
    expect(html).toMatch(/id="p1"[^>]*hidden/);
    await page.close();
  }, 120_000);

  it('the editor page matches the server Proof (< 1 % of pixels)', async () => {
    for (const fixture of ['01-static', '05-canvas-chart', '07-webfonts']) {
      const id = await createProject(h, { type: 'fixture', name: fixture });
      const { page } = await openEditor(h, id, { width: 2600, height: 1400 });
      await page.selectOption('select[aria-label="Zoom"]', '1');
      await settle(page);
      // Hide the editing overlay (frame outlines, margin lines) and capture the page itself.
      await page.addStyleTag({ content: '.overlay, .hl { display: none !important }' });
      const editorPng = await (await page.$('.page'))!.screenshot();
      const proof = await api<Buffer>(h, 'POST', `/api/projects/${id}/proof`, { pageId: 'page-1' });
      const a = PNG.sync.read(editorPng);
      const b = PNG.sync.read(proof);
      const w = Math.min(a.width, b.width);
      const hh = Math.min(a.height, b.height);
      const crop = (p: PNG) => {
        const out = new PNG({ width: w, height: hh });
        PNG.bitblt(p, out, 0, 0, w, hh, 0, 0);
        return PNG.sync.write(out);
      };
      // Colour tolerance 0.2 (not 0.1): nested frames in the editor anti-alias
      // glyph edges a little differently from the server's top-level render.
      // Wrong fonts, offsets or missing content change far more than 1 %.
      const d = comparePng(crop(a), crop(b), { threshold: 0.2 });
      console.log(`editor vs proof ${fixture}: ${(d.ratio * 100).toFixed(3)} %`);
      expect(d.ratio, fixture).toBeLessThan(0.01);
      await page.close();
    }
  }, 180_000);

  it('100 % zoom shows A4 at 793.7 × 1122.5 px and the ruler measures 3.7795 px/mm', async () => {
    const id = await createProject(h, { type: 'fixture', name: '09-div-soup' });
    const { page } = await openEditor(h, id);
    await page.selectOption('select[aria-label="Zoom"]', '1');
    const pb = (await (await page.$('.page'))!.boundingBox())!;
    expect(pb.width).toBeCloseTo(793.7, 0);
    expect(pb.height).toBeCloseTo(1122.5, 0);
    const xs = await page.$$eval('[data-testid="ruler-x"] line', (ls) => ls.map((l) => Number(l.getAttribute('x1'))));
    const perMm = (xs[100]! - xs[0]!) / 100;
    expect(Math.abs(perMm - 3.7795) / 3.7795).toBeLessThan(0.005);
    await page.close();
  }, 60_000);

  it('editor loads without console errors and has no critical accessibility violations', async () => {
    const id = await createProject(h, { type: 'fixture', name: '02-tailwind' });
    const { page, errors } = await openEditor(h, id);
    const require = createRequire(import.meta.url);
    await page.addScriptTag({ content: readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8') });
    const result = (await page.evaluate(async () => {
      const axe = (window as unknown as { axe: { run(ctx: unknown, opts: unknown): Promise<{ violations: Array<{ id: string; impact: string; nodes: unknown[] }> }> } }).axe;
      return axe.run({ exclude: [['iframe']] }, { resultTypes: ['violations'] });
    })) as { violations: Array<{ id: string; impact: string }> };
    const critical = result.violations.filter((v) => v.impact === 'critical');
    expect(critical.map((v) => v.id)).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);
});
