import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProject, editorOp, getDoc, openEditor, settle, startHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

describe('M6: fit and flow in the editor', () => {
  it('shows the overflow badge exactly when content is taller than a reflow frame', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page } = await openEditor(h, id);
    // The whole page (800 px tall) in a 100 mm frame: overflows.
    await editorOp(page, 'setPlacementRect', 'pl-page', { x: 15, y: 20, w: 180, h: 100 });
    expect(await page.$('[data-testid="overflow-pl-page"]')).not.toBeNull();
    // A frame taller than the content: no badge.
    await editorOp(page, 'setPlacementRect', 'pl-page', { x: 15, y: 20, w: 180, h: 257 });
    await settle(page);
    expect(await page.$('[data-testid="overflow-pl-page"]')).toBeNull();
    await page.close();
  }, 120_000);

  it('"Flow onto pages" paginates a long component into linked frames on new pages', async () => {
    const id = await createProject(h, { type: 'fixture', name: '08-long-article' });
    const { page, errors } = await openEditor(h, id);
    await page.click('[data-placement-box="pl-page"]', { position: { x: 30, y: 30 } });
    await page.click('button:has-text("Flow onto pages")');
    await page.waitForFunction(() => (window as unknown as { __ve: { getDoc(): { pages: unknown[] } } }).__ve.getDoc().pages.length > 3, undefined, { timeout: 60_000 });
    await settle(page);
    const d = await getDoc(page);
    expect(d.chains).toHaveLength(1);
    const chain = d.chains[0]!;
    expect(chain.placementIds).toHaveLength(d.pages.length);
    expect(chain.slices.every((s) => !s.overflow)).toBe(true);
    // Consecutive slices continue exactly where the previous one ended.
    for (let i = 1; i < chain.slices.length; i++) expect(chain.slices[i]!.startPx).toBe(chain.slices[i - 1]!.endPx);
    expect(await page.$$('.chain-badge')).toHaveLength(d.pages.length);
    expect(await page.$$('.page-frame')).toHaveLength(d.pages.length);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});
