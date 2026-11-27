/** Helpers for the Nodes tab (after Node CMS's tests/e2e/canvas.spec.ts). */
import type { Page } from 'playwright';
import type { Graph } from '../../src/graph/index.js';

export const nodeEl = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);

export async function openNodes(page: Page) {
  await page.click('[role="tab"]:has-text("Nodes")');
  await page.waitForSelector('.nodes-app .react-flow__node');
}

/** Fit the canvas and wait until it has stopped moving. */
export async function fitView(page: Page) {
  await page.locator('.react-flow__controls-fitview').click();
  let last = '';
  for (let i = 0; i < 50; i++) {
    const now = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform);
    if (now === last) return;
    last = now;
    await page.waitForTimeout(100);
  }
}

/** Drag from an output handle to an input handle. */
export async function connect(page: Page, from: string, fromPort: string, to: string, toPort: string) {
  const a = await nodeEl(page, from).locator(`.react-flow__handle.source[data-handleid="${fromPort}"]`).boundingBox();
  const b = await nodeEl(page, to).locator(`.react-flow__handle.target[data-handleid="${toPort}"]`).boundingBox();
  if (!a || !b) throw new Error('handle not visible');
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** The graph store's state (the module-level store the canvas reads). */
export const graphOfPage = (page: Page) =>
  page.evaluate(() => (window as unknown as { __veGraph: () => Graph }).__veGraph());

/** A summary of each node's result (see useTestHooks in NodesTab.tsx). */
export interface ResultSummary {
  status: string;
  message?: string;
  info: Record<string, unknown>;
  warnings: string[];
  /** Root element IDs of a components output. */
  items?: string[];
  overrides?: unknown[];
  capture?: { key: string; nodes: unknown[]; settings: unknown };
  pages?: { document: import('../../src/model/types.js').EditorDocument; captureKeys: string[]; overrides: number };
}

export const resultsOfPage = (page: Page) =>
  page.evaluate(() => (window as unknown as { __veResults: () => Record<string, ResultSummary> }).__veResults());

/** Wait until the graph has finished evaluating. */
export const graphIdle = (page: Page) => page.evaluate(() => (window as unknown as { __veGraphIdle: () => Promise<void> }).__veGraphIdle());

export const selectNode = async (page: Page, id: string) => {
  await nodeEl(page, id).locator('header').click();
  await page.waitForSelector(`.nodes-app .inspector .inspector-head`);
};

export const palette = (label: string) => `.nodes-app .palette button.palette-item:has(.palette-label:text-is("${label}"))`;

/** Add a node from the palette, connected after `from` (an output port), returning its id. */
export async function addAfter(page: Page, label: string, from: string, fromPort: string, toPort: string) {
  await page.click(palette(label));
  const id = (await graphOfPage(page)).nodes.at(-1)!.id;
  await page.evaluate((e) => (window as unknown as { __veConnect: (e: object) => void }).__veConnect(e), { source: from, sourcePort: fromPort, target: id, targetPort: toPort });
  await graphIdle(page);
  return id;
}

/** Connect two nodes through the store (dragging between handles is covered in N1). */
export const connectIds = (page: Page, source: string, sourcePort: string, target: string, targetPort: string) =>
  page.evaluate((e) => (window as unknown as { __veConnect: (e: object) => string | undefined }).__veConnect(e), { source, sourcePort, target, targetPort });
