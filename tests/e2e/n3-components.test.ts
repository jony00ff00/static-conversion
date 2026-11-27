/**
 * N3: Components, Pick, Edit and Filter nodes. Picking by CSS selector and by clicking in the preview gives the
 * same components; an Edit node's content edit matches the one the Editor tab makes (M5); changing the level of
 * detail updates every node after it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Frame, Page } from 'playwright';
import { componentFrames, createProject, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';
import { graphIdle, graphOfPage, openNodes, resultsOfPage, selectNode } from './nodes-harness.js';
import type { Override } from '../../src/model/types.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const palette = (label: string) => `.nodes-app .palette button.palette-item:has(.palette-label:text-is("${label}"))`;
const previewFrame = async (page: Page, title: string): Promise<Frame> => (await (await page.waitForSelector(`.nodes-app .preview iframe[title="${title}"]`)).contentFrame())!;

/** Add a node of this type fed from `from` (an output port), returning its id. */
async function addAfter(page: Page, label: string, from: string, fromPort: string, toPort: string) {
  await page.click(palette(label));
  const id = (await graphOfPage(page)).nodes.at(-1)!.id;
  await page.evaluate((e) => (window as unknown as { __veConnect: (e: object) => void }).__veConnect(e), { source: from, sourcePort: fromPort, target: id, targetPort: toPort });
  await graphIdle(page);
  return id;
}

const items = async (page: Page, id: string) => (await resultsOfPage(page))[id]!.items ?? [];

describe('N3: component nodes', () => {
  it('picking by selector and by clicking in the preview give the same components', async () => {
    const id = await createProject(h, { type: 'fixture', name: '03-bootstrap' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    const pick = await addAfter(page, 'Pick', 'capture', 'capture', 'capture');
    await selectNode(page, pick);
    await page.fill('.nodes-app .inspector input[placeholder=".card, header"]', '.card');
    await graphIdle(page);
    const bySelector = await items(page, pick);
    expect(bySelector).toHaveLength(6);
    // The picks are outlined in the preview.
    const frame = await previewFrame(page, 'Pick components');
    expect(await frame.$$eval('[data-ve-outline]', (els) => els.length)).toBe(6);
    // Clear, then click the same cards in the preview, on each card's edge (a click picks the smallest
    // component under the pointer, as dragging from the Editor tab's web page does).
    await page.fill('.nodes-app .inspector input[placeholder=".card, header"]', '');
    await graphIdle(page);
    const clickCard = async (i: number) => {
      const f = await previewFrame(page, 'Pick components');
      await (await f.$$('.card'))[i]!.click({ position: { x: 2, y: 2 } });
      await graphIdle(page);
    };
    for (let i = 0; i < 6; i++) await clickCard(i);
    expect(await items(page, pick)).toEqual(bySelector);
    expect((await graphOfPage(page)).nodes.find((n) => n.id === pick)!.config).toMatchObject({ selector: '', wpIds: bySelector });
    // Clicking a picked one again takes it out.
    await clickCard(0);
    expect(await items(page, pick)).toEqual(bySelector.slice(1));
    // "Similar" brings back the rest of the row.
    await page.click('.nodes-app .inspector label:has-text("Also pick similar ones")');
    await graphIdle(page);
    expect(await items(page, pick)).toEqual(bySelector);
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('an Edit node’s text edit is the same edit the Editor tab makes (M5)', async () => {
    // In the Editor tab (M5): edit the headline of the whole page.
    const a = await createProject(h, { type: 'fixture', name: '01-static' });
    const ed = await openEditor(h, a, { width: 2200, height: 1400 });
    await ed.page.selectOption('select[aria-label="Zoom"]', '1');
    await ed.page.dblclick('[data-placement-box="pl-page"]', { position: { x: 30, y: 30 } });
    await ed.page.waitForSelector('text=Editing content');
    await settle(ed.page);
    await (await (await componentFrames(ed.page))[0]!.$('h1'))!.click();
    await ed.page.keyboard.press('Control+A');
    await ed.page.keyboard.type('Fresh headline');
    await ed.page.click('button:has-text("Done editing")');
    await ed.page.waitForFunction(() => (window as unknown as { __ve: { getDoc(): { overrides: unknown[] } } }).__ve.getDoc().overrides.length === 1);
    const m5 = (await getDoc(ed.page)).overrides[0] as Extract<Override, { type: 'text' }>;
    await ed.page.close();

    // In the Nodes tab of a fresh project: an Edit node after Components, the same edit.
    const b = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, b, { width: 1920, height: 1080 });
    await openNodes(page);
    const edit = await addAfter(page, 'Edit', 'components', 'components', 'components');
    await selectNode(page, edit);
    await page.selectOption('.nodes-app select[aria-label="Component to edit"]', 'page');
    let frame = await previewFrame(page, 'Component to edit');
    await frame.waitForSelector('h1');
    await frame.click('h1');
    await page.fill('.nodes-app textarea[aria-label="Text"]', 'Fresh headline');
    await page.locator('.nodes-app textarea[aria-label="Text"]').blur();
    await graphIdle(page);
    const out = (await resultsOfPage(page))[edit]!.overrides as Override[];
    expect(out).toHaveLength(1);
    const { id: _a, ...mine } = out[0]!;
    const { id: _b, ...theirs } = m5;
    void _a, _b;
    expect(mine).toEqual(theirs);
    // The edited component shows the new text; the web page doesn't change.
    frame = await previewFrame(page, 'Component to edit');
    await frame.waitForFunction(() => document.querySelector('h1')?.textContent === 'Fresh headline');
    await selectNode(page, 'capture');
    expect(await (await previewFrame(page, 'Frozen page')).textContent('h1')).toBe('Design that prints as well as it scrolls');
    // Style and hide edits, then reverting from the inspector.
    await selectNode(page, edit);
    await page.selectOption('.nodes-app select[aria-label="Component to edit"]', 'page');
    frame = await previewFrame(page, 'Component to edit');
    await frame.click('.hero p');
    await page.fill('.nodes-app input[aria-label="Font size"]', '22px');
    await page.locator('.nodes-app input[aria-label="Font size"]').blur();
    await graphIdle(page);
    frame = await previewFrame(page, 'Component to edit');
    await frame.waitForFunction(() => getComputedStyle(document.querySelector('.hero p')!).fontSize === '22px');
    await page.click('.nodes-app [data-testid="edits"] li:first-child button:has-text("Revert")');
    await graphIdle(page);
    expect(((await resultsOfPage(page))[edit]!.overrides as Override[]).map((o) => o.type)).toEqual(['style']);
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);

  it('changing the level of detail updates the nodes after it; Filter keeps, orders and counts', async () => {
    const id = await createProject(h, { type: 'fixture', name: '03-bootstrap' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    const lib = await addAfter(page, 'Components', 'capture', 'capture', 'capture');
    const flt = await addAfter(page, 'Filter', lib, 'components', 'components');
    await selectNode(page, flt);
    await page.click('.nodes-app .inspector .kinds label:has-text("card")');
    await graphIdle(page);
    const r2 = await resultsOfPage(page);
    expect(r2[lib]!.info).toMatchObject({ detail: 2 });
    const cards2 = r2[flt]!.info.kept as number;
    expect(cards2).toBeGreaterThanOrEqual(6); // the six offers (and card-like parts inside them)
    // Detail 1: only top-level components (the six offers are, their inner parts are not), so fewer cards.
    await selectNode(page, lib);
    await page.locator('.nodes-app input[aria-label="Detail"]').fill('1');
    await graphIdle(page);
    const r1 = await resultsOfPage(page);
    expect(r1[lib]!.info).toMatchObject({ detail: 1 });
    expect((r1[lib]!.items ?? []).length).toBeLessThan((r2[lib]!.items ?? []).length);
    expect(r1[flt]!.info.kept).toBeLessThan(cards2);
    expect(r1[flt]!.info.kept).toBeGreaterThan(0);
    // Detail 3: the cards again, and their parts.
    await page.locator('.nodes-app input[aria-label="Detail"]').fill('3');
    await graphIdle(page);
    const r3 = await resultsOfPage(page);
    expect((r3[lib]!.items ?? []).length).toBeGreaterThanOrEqual((r2[lib]!.items ?? []).length);
    expect(r3[flt]!.info.kept).toBeGreaterThanOrEqual(cards2);
    // The capture before it never re-ran.
    expect(r3.capture!.capture!.key).toBe(r1.capture!.capture!.key);
    // Keep the first 2, reversed.
    await selectNode(page, flt);
    await page.selectOption('.nodes-app .inspector select', 'reverse');
    await page.fill('.nodes-app input[aria-label="Keep the first"]', '2');
    await graphIdle(page);
    const rf = await resultsOfPage(page);
    expect(rf[flt]!.items).toEqual((r3[flt]!.items ?? []).slice().reverse().slice(0, 2));
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);
});
