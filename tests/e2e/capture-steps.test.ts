/**
 * "Capture this state": ticks of checkboxes and radio buttons (including
 * CSS-only toggles driven by labels and hidden inputs), drop-down choices and
 * scrolling are recorded in the live pane and replayed before capture.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Frame, Page } from 'playwright';
import { api, createProject, getDoc, openEditor, startHarness, type Harness } from './harness.js';
import { STATEFUL_PAGE } from './stateful-page.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

async function liveFrame(page: Page): Promise<Frame> {
  await page.click('[role="tab"]:has-text("Live")');
  const el = await page.waitForSelector('iframe[title="Live web page"]');
  const f = (await el.contentFrame())!;
  await f.waitForSelector('#more-label');
  return f;
}

async function captureAndRead(page: Page, id: string) {
  await page.click('button:has-text("Capture this state")');
  await page.waitForSelector('iframe[title="Frozen web page"]');
  await page.waitForFunction(() => !document.querySelector('.status'));
  return (await api<Buffer>(h, 'GET', `/api/projects/${id}/frozen`)).toString('utf8');
}

describe('Capture this state: checkboxes, radios, selects and scrolling', () => {
  it('records state, not clicks, for labels and hidden inputs, and replays it', async () => {
    const id = await createProject(h, { type: 'paste', ...STATEFUL_PAGE });
    const { page, errors } = await openEditor(h, id);
    const live = await liveFrame(page);
    await live.click('#more-label'); // a label for a hidden checkbox
    await live.click('#tab-b-label'); // a label for an invisible radio button
    await live.click('#wrapped'); // a checkbox inside its label
    await live.selectOption('#size', 'l');
    await page.waitForSelector('text=4 recorded steps');
    await page.click('[data-testid="recorded-steps"]');
    const listed = await page.$$eval('.steps li', (lis) => lis.map((l) => l.textContent));
    expect(listed).toEqual(['tick #more', 'tick #tab-b', 'tick #wrapped', 'choose "l" in #size']);

    const html = await captureAndRead(page, id);
    const doc = await getDoc(page);
    expect(doc.setupSteps).toEqual([
      { action: 'check', selector: '#more', checked: true },
      { action: 'check', selector: '#tab-b', checked: true },
      { action: 'check', selector: '#wrapped', checked: true },
      { action: 'select', selector: '#size', value: 'l' },
    ]);
    // The frozen page shows the toggled state.
    const frozen = await (await page.waitForSelector('iframe[title="Frozen web page"]')).contentFrame();
    expect(await frozen!.$eval('#more-box', (e) => getComputedStyle(e).display)).toBe('block');
    expect(await frozen!.$eval('#panel-b', (e) => getComputedStyle(e).display)).toBe('block');
    expect(await frozen!.$eval('#panel-a', (e) => getComputedStyle(e).display)).toBe('none');
    expect(await frozen!.textContent('#size-out')).toBe('l');
    expect(html).not.toMatch(/Recorded step failed/);
    const p = await api<{ analysis: { warnings: string[] } }>(h, 'GET', `/api/projects/${id}`);
    expect(p.analysis.warnings.filter((w) => w.startsWith('Recorded step'))).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('records scrolling and keeps what it revealed after returning to the top', async () => {
    const id = await createProject(h, { type: 'paste', ...STATEFUL_PAGE });
    const { page, errors } = await openEditor(h, id);
    const live = await liveFrame(page);
    // Several scroll events in a row are recorded as one step: where it ended up.
    for (const y of [400, 1200, 2200]) {
      await live.evaluate((y) => scrollTo(0, y), y);
      await page.waitForTimeout(60);
    }
    await page.waitForSelector('text=1 recorded step');
    expect(await page.textContent('[data-testid="recorded-steps"]')).toBe('1 recorded step');

    await captureAndRead(page, id);
    const d = await getDoc(page);
    expect(d.setupSteps).toEqual([{ action: 'scroll', selector: null, x: 0, y: 2200 }]);
    const frozen = (await (await page.waitForSelector('iframe[title="Frozen web page"]')).contentFrame())!;
    // Revealed by the IntersectionObserver, and not hidden again when the capture went back to the top.
    expect(await frozen.getAttribute('#late', 'class')).toContain('shown');
    expect(await frozen.$eval('#late', (e) => getComputedStyle(e).opacity)).toBe('1');
    // Set by the (requestAnimationFrame-throttled) scroll handler, and kept.
    expect(await frozen.getAttribute('#top', 'class')).toContain('scrolled');
    // The page itself is laid out from the top.
    const header = d.components.page ? (await api<{ analysis: { nodes: Array<{ tag: string; bbox: { y: number } }> } }>(h, 'GET', `/api/projects/${id}`)).analysis.nodes.find((n) => n.tag === 'header') : undefined;
    if (header) expect(header.bbox.y).toBeLessThan(50);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('unticking is recorded too, and old click-only steps still replay', async () => {
    const id = await createProject(h, { type: 'paste', ...STATEFUL_PAGE });
    const { page } = await openEditor(h, id);
    const live = await liveFrame(page);
    await live.click('#more-label');
    await live.click('#more-label');
    // Same control set twice: one step with the final state.
    await page.waitForSelector('text=1 recorded step');
    await page.click('[data-testid="recorded-steps"]');
    expect(await page.$$eval('.steps li', (lis) => lis.map((l) => l.textContent))).toEqual(['untick #more']);
    await page.close();

    // Documents saved before this change hold click steps only.
    const cur = await api<{ document: Record<string, unknown> }>(h, 'GET', `/api/projects/${id}`);
    await api(h, 'POST', `/api/projects/${id}/recapture`, { ...cur.document, setupSteps: [{ action: 'click', selector: '#tab-b-label' }] });
    const html = (await api<Buffer>(h, 'GET', `/api/projects/${id}/frozen`)).toString('utf8');
    expect(html).toMatch(/id="tab-b"[^>]*checked/);
  }, 120_000);
});
