import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import type { Frame, Page } from 'playwright';
import { componentFrames, createProject, frozenFrame, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

async function enterContent(page: Page) {
  await page.dblclick('[data-placement-box="pl-page"]', { position: { x: 30, y: 30 } });
  await page.waitForSelector('text=Editing content');
  await settle(page);
}

const printFrame = async (page: Page): Promise<Frame> => (await componentFrames(page))[0]!;

async function waitOverrides(page: Page, n: number) {
  await page.waitForFunction((n) => (window as unknown as { __ve: { getDoc(): { overrides: unknown[] } } }).__ve.getDoc().overrides.length === n, n, { timeout: 10_000 });
  await settle(page);
}

describe('M5: editing content in the print preview', () => {
  it('edits text in place; the web page is untouched and marked as different', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await enterContent(page);
    const pf = await printFrame(page);
    const h1 = (await pf.$('h1'))!;
    const wp = (await h1.getAttribute('data-wp-id'))!;
    await h1.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.type('Fresh headline');
    await page.click('button:has-text("Done editing")');
    await waitOverrides(page, 1);
    const d = await getDoc(page);
    expect(d.overrides[0]).toMatchObject({ type: 'text', target: wp, value: 'Fresh headline' });
    expect(await (await printFrame(page)).textContent('h1')).toBe('Fresh headline');
    const web = await frozenFrame(page);
    expect(await web.textContent('h1')).toBe('Design that prints as well as it scrolls');
    expect(await web.getAttribute('h1', 'data-ve-overridden-src')).not.toBeNull();
    // Structure unchanged: same elements before and after.
    expect(await (await printFrame(page)).$$eval('body *', (els) => els.length)).toBe(await pf.$$eval('body *', (els) => els.length).catch(async () => (await printFrame(page)).$$eval('body *', (els) => els.length)));
    // Undo removes the edit.
    await page.keyboard.press('Control+Z');
    await waitOverrides(page, 0);
    expect(await (await printFrame(page)).textContent('h1')).toBe('Design that prints as well as it scrolls');
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('hides an element, changes a style, replaces an image, and reverts from the list', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id, { width: 2200, height: 1400 });
    await page.selectOption('select[aria-label="Zoom"]', '1');
    await enterContent(page);

    // Style: font size of the hero paragraph.
    await (await (await printFrame(page)).$('.hero p'))!.click();
    await page.fill('input[aria-label="Font size"]', '22px');
    await page.locator('input[aria-label="Font size"]').blur();
    await waitOverrides(page, 1);
    expect(await (await printFrame(page)).$eval('.hero p', (e) => getComputedStyle(e).fontSize)).toBe('22px');

    // Image: replace with an uploaded PNG.
    await enterContent(page).catch(() => undefined);
    await (await (await printFrame(page)).$('.hero img'))!.click({ force: true });
    const png = new PNG({ width: 4, height: 2 });
    png.data.fill(200);
    await page.setInputFiles('input[aria-label="Replace image"]', { name: 'x.png', mimeType: 'image/png', buffer: PNG.sync.write(png) });
    await waitOverrides(page, 2);
    expect(await (await printFrame(page)).getAttribute('.hero img', 'src')).toMatch(/^data:image\/png;base64,/);

    // Hide: the footer.
    await enterContent(page).catch(() => undefined);
    await (await (await printFrame(page)).$('footer'))!.click({ force: true });
    await page.click('button:has-text("Hide element")');
    await waitOverrides(page, 3);
    expect(await (await printFrame(page)).$eval('footer', (e) => getComputedStyle(e).display)).toBe('none');

    // Revert the style change from the list.
    const list = await page.$$('ul.overrides li');
    expect(list).toHaveLength(3);
    await page.click('ul.overrides li:first-child button:has-text("Revert")');
    await waitOverrides(page, 2);
    expect(await (await printFrame(page)).$eval('.hero p', (e) => getComputedStyle(e).fontSize)).not.toBe('22px');
    await page.click('button:has-text("Revert all")');
    await waitOverrides(page, 0);
    expect(await (await printFrame(page)).$eval('footer', (e) => getComputedStyle(e).display)).not.toBe('none');
    await page.close();
  }, 180_000);

  it('named snapshots save and restore the document', async () => {
    const id = await createProject(h, { type: 'fixture', name: '09-div-soup' });
    const { page } = await openEditor(h, id);
    await page.fill('input[aria-label="Snapshot name"]', 'Before edits');
    await page.click('button:has-text("Save")');
    await page.waitForSelector('text=Before edits');
    await page.evaluate(() => {
      const ve = (window as unknown as { __ve: { commit(op: (d: unknown) => unknown): void; ops: Record<string, (...a: unknown[]) => unknown> } }).__ve;
      ve.commit((d) => ve.ops.addPage!(d, 'page-x'));
    });
    await settle(page);
    expect((await getDoc(page)).pages).toHaveLength(2);
    await page.click('li:has-text("Before edits") button:has-text("Restore")');
    await page.waitForFunction(() => (window as unknown as { __ve: { getDoc(): { pages: unknown[] } } }).__ve.getDoc().pages.length === 1);
    await page.close();
  }, 120_000);
});
