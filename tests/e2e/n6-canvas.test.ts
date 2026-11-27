/**
 * N6: starter graphs; groups (collapsed to one box with their outside connections, moved as one), notes and the
 * minimap; a 40-node graph edits without re-capturing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { createProject, openEditor, startHarness, type Harness } from './harness.js';
import { graphIdle, graphOfPage, nodeEl, openNodes, resultsOfPage } from './nodes-harness.js';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
}, 120_000);
afterAll(async () => h?.close());

const lastRan = (page: Page) => page.evaluate(() => (window as unknown as { __veLastRan: () => string[] }).__veLastRan());
const evaluations = (page: Page) => page.evaluate(() => (window as unknown as { __veStore: () => { getState(): { evaluations: number } } }).__veStore().getState().evaluations);

describe('N6: starters, groups, notes, minimap', () => {
  it('a starter adds its nodes in a named group with a note, as one undo step', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    await page.selectOption('.nodes-app select[aria-label="Add a starter graph"]', 'brochure');
    let g = await graphOfPage(page);
    expect(g.nodes.map((n) => n.type).slice(5)).toEqual(['pick', 'edit', 'layout', 'export']);
    expect(g.groups).toEqual([expect.objectContaining({ name: 'Brochure', nodeIds: g.nodes.slice(5).map((n) => n.id) })]);
    expect(g.notes![0]!.text).toMatch(/^Brochure: /);
    expect(await page.textContent(`.react-flow__node[data-id="note:${g.notes![0]!.id}"]`)).toContain('Brochure:');
    // It starts from the project page's capture: give the Pick a selector and the Layout has components.
    const [pick, , layout] = g.nodes.slice(5).map((n) => n.id) as [string, string, string];
    await page.evaluate((pick) => {
      const w = window as unknown as { __veStore: () => { getState(): { updateConfig(id: string, f: (c: object) => object): void } } };
      w.__veStore().getState().updateConfig(pick, (c) => ({ ...c, selector: '.card' }));
    }, pick);
    await graphIdle(page);
    expect((await resultsOfPage(page))[layout]!.info).toMatchObject({ components: 3 });
    // The flyer starter too.
    await page.selectOption('.nodes-app select[aria-label="Add a starter graph"]', 'flyer');
    await graphIdle(page);
    g = await graphOfPage(page);
    expect(g.groups!.map((x) => x.name)).toEqual(['Brochure', 'Flyer + article']);
    const r = await resultsOfPage(page);
    const flow = g.nodes.find((n) => n.name === 'Article')!.id;
    expect(r[flow]!.status).toBe('ok'); // the project page, flowed
    expect(r[g.nodes.find((n) => n.name === 'Flyer page')!.id]!.message).toBe('Import a page in this node');
    // One undo takes the whole starter away.
    await page.locator('.nodes-app .react-flow__pane').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('Control+Z');
    g = await graphOfPage(page);
    expect(g.groups!.map((x) => x.name)).toEqual(['Brochure']);
    expect(g.nodes).toHaveLength(9);
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);

  it('a collapsed group is one box with its outside connections; it expands and moves as one; nothing re-runs', async () => {
    const id = await createProject(h, { type: 'fixture', name: '01-static' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    await page.selectOption('.nodes-app select[aria-label="Add a starter graph"]', 'brochure');
    await graphIdle(page);
    const g = await graphOfPage(page);
    const group = g.groups![0]!;
    const members = group.nodeIds;
    await page.locator('.react-flow__controls-fitview').click();
    await page.waitForTimeout(400);
    const runs = await evaluations(page);
    // Collapse from the group's inspector (the starter selected it).
    await page.click('.nodes-app .inspector button:has-text("Collapse")');
    await page.waitForTimeout(300);
    const box = page.locator(`.react-flow__node[data-id="group:${group.id}"]`);
    expect(await box.getAttribute('class')).toContain('is-collapsed');
    for (const m of members) expect(await nodeEl(page, m).isVisible()).toBe(false);
    // Its outside connection (from the project Capture) goes to the box's handle for that port.
    expect(await box.locator(`.react-flow__handle[data-handleid="in|${members[0]}|capture"]`).count()).toBe(1);
    expect(await page.locator('.react-flow__edge').count()).toBe(g.edges.length - 3); // the 3 inside the group are hidden
    await page.waitForTimeout(400);
    expect(await evaluations(page)).toBe(runs); // grouping never re-runs anything
    // Expand, then drag the frame by its header: every member moves by the same amount.
    await page.click('.nodes-app .inspector button:has-text("Expand")');
    await page.waitForTimeout(300);
    for (const m of members) expect(await nodeEl(page, m).isVisible()).toBe(true);
    const before = (await graphOfPage(page)).nodes.filter((n) => members.includes(n.id)).map((n) => n.position!);
    const head = (await page.locator(`.react-flow__node[data-id="group:${group.id}"] .group-frame-head`).boundingBox())!;
    await page.mouse.move(head.x + 20, head.y + head.height / 2);
    await page.mouse.down();
    await page.mouse.move(head.x + 120, head.y + head.height / 2 + 60, { steps: 10 });
    await page.mouse.up();
    const after = (await graphOfPage(page)).nodes.filter((n) => members.includes(n.id)).map((n) => n.position!);
    const dx = after[0]!.x - before[0]!.x;
    const dy = after[0]!.y - before[0]!.y;
    expect(Math.abs(dx)).toBeGreaterThan(20);
    after.forEach((p, i) => {
      expect(p.x - before[i]!.x).toBeCloseTo(dx, 3);
      expect(p.y - before[i]!.y).toBeCloseTo(dy, 3);
    });
    await page.waitForTimeout(400);
    expect(await evaluations(page)).toBe(runs); // nor does moving
    // The minimap draws every node, in its type's colour.
    const fills = await page.$$eval('.nodes-app .minimap .react-flow__minimap-node', (els) => els.map((e) => e.getAttribute('fill') ?? (e as SVGElement).style.fill));
    expect(fills.length).toBeGreaterThanOrEqual(9);
    expect(fills.some((f) => /^(#2563eb|rgb\(37, 99, 235\))$/i.test(f))).toBe(true); // a Capture node, in its colour
    expect(errors).toEqual([]);
    await page.close();
  }, 120_000);
});

describe('N6: performance', () => {
  it('a 40-node graph: editing one node re-runs only what follows it, quickly, and never re-captures', async () => {
    const id = await createProject(h, { type: 'fixture', name: '03-bootstrap' });
    const { page, errors } = await openEditor(h, id, { width: 1920, height: 1080 });
    await openNodes(page);
    // 5 default nodes + 2 captures with their own widths + 11 Pick → Edit → Filter chains = 40 nodes.
    await page.evaluate(() => {
      type S = { addNode(t: string, p?: { x: number; y: number }): string; connect(e: object): string | undefined; updateConfig(id: string, f: (c: object) => object): void };
      const st = (window as unknown as { __veStore: () => { getState(): S } }).__veStore().getState();
      const caps = ['capture'];
      for (const w of [600, 900]) {
        const c = st.addNode('capture', { x: 260, y: 200 + w });
        st.connect({ source: 'source', sourcePort: 'files', target: c, targetPort: 'files' });
        st.updateConfig(c, (x) => ({ ...x, captureWidthPx: w }));
        caps.push(c);
      }
      const selectors = ['.card', 'header', 'h1', '.card-title', 'nav', '.alert', 'p', 'h5', '.badge', 'main', 'footer'];
      selectors.forEach((sel, i) => {
        const p = st.addNode('pick', { x: 520, y: i * 140 });
        st.updateConfig(p, (x) => ({ ...x, selector: sel }));
        st.connect({ source: caps[i % caps.length], sourcePort: 'capture', target: p, targetPort: 'capture' });
        const e = st.addNode('edit', { x: 780, y: i * 140 });
        st.connect({ source: p, sourcePort: 'components', target: e, targetPort: 'components' });
        const f = st.addNode('filter', { x: 1040, y: i * 140 });
        st.connect({ source: e, sourcePort: 'components', target: f, targetPort: 'components' });
      });
    });
    await graphIdle(page);
    const g = await graphOfPage(page);
    expect(g.nodes).toHaveLength(40);
    const filter = g.nodes.filter((n) => n.type === 'filter')[3]!.id;
    // Edit one Filter: only it re-runs, in well under a second; no capture runs again.
    const ms = await page.evaluate(async (filter) => {
      const w = window as unknown as { __veStore: () => { getState(): { updateConfig(id: string, f: (c: object) => object): void; evaluate(): Promise<void> } } };
      const t = performance.now();
      w.__veStore().getState().updateConfig(filter, (c) => ({ ...c, first: 1 }));
      await w.__veStore().getState().evaluate();
      return performance.now() - t;
    }, filter);
    // Only the edited Filter runs again, plus nodes still waiting (a Pick whose selector matches nothing on this
    // page): waiting results are never cached, by design, and cost nothing. No capture runs again.
    const ran = await lastRan(page);
    const r0 = await resultsOfPage(page);
    expect(ran).toContain(filter);
    for (const id of ran) if (id !== filter) expect(r0[id]!.status, id).toBe('waiting');
    expect(ran.filter((id) => g.nodes.find((n) => n.id === id)!.type === 'capture')).toEqual([]);
    expect(ms).toBeLessThan(1000);
    const runs = await evaluations(page);
    // Moving every node re-runs nothing.
    await page.evaluate(() => {
      const st = (window as unknown as { __veStore: () => { getState(): { graph: { nodes: Array<{ id: string; position?: { x: number; y: number } }> }; moveNodes(p: Record<string, { x: number; y: number }>): void } } }).__veStore().getState();
      st.moveNodes(Object.fromEntries(st.graph.nodes.map((n) => [n.id, { x: (n.position?.x ?? 0) + 10, y: n.position?.y ?? 0 }])));
    });
    await page.waitForTimeout(400);
    expect(await evaluations(page)).toBe(runs); // no evaluation ran
    const r = await resultsOfPage(page);
    expect(Object.values(r).filter((x) => x.status === 'error')).toEqual([]);
    expect(errors).toEqual([]);
    await page.close();
  }, 180_000);
});
