/**
 * Two sample graphs, exported to PDF and compared with golden page images (N5):
 * - brochure: the project page's hero and cards picked, the headline edited, laid out by hand on one page;
 * - flyer: a second page (pasted) and the project's hero on a cover, then a long article (a third page) flowed
 *   over as many pages as it needs, combined into one document.
 * The layouts are built here with fixed positions once the components are known, as a person would in the Editor tab.
 */
import * as ops from '../src/model/ops.js';
import { emptyLayout, type Graph, type GraphNode, type PagesValue } from '../src/graph/index.js';
import { addSource, loadProject, type ProjectState } from '../src/server/projects.js';
import { evaluateGraph } from '../src/server/graph-run.js';
import type { ComponentDef, EditorDocument } from '../src/model/types.js';

const n = (id: string, type: string, config: unknown, x = 0, y = 0): GraphNode => ({ id, type, config, position: { x, y } });
const e = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}-${target}-${targetPort}`, source, sourcePort, target, targetPort });
const linked = {
  source: n('source', 'webSource', { sourceId: 'main', title: '', entry: '', hash: '' }),
  capture: n('capture', 'capture', { linked: true, captureWidthPx: 680, presets: { hideChrome: true, expandInteractive: true, printMedia: false, linkUrls: false }, setupSteps: [], rules: [] }),
};
const defaultCapture = (sourceId: string, title: string, entry: string, hash: string, id: string) => [
  n(`${id}-src`, 'webSource', { sourceId, title, entry, hash }),
  n(`${id}-cap`, 'capture', { linked: false, captureWidthPx: 680, presets: { hideChrome: true, expandInteractive: true, printMedia: false, linkUrls: false }, setupSteps: [], rules: [] }),
];

/** The layout's available components, by a predicate on their name or kind. */
async function available(s: ProjectState, graph: Graph, layoutId: string): Promise<PagesValue> {
  const r = (await evaluateGraph(s, graph)).results[layoutId]!;
  if (r.status !== 'ok') throw new Error(`${layoutId}: ${r.message}`);
  return r.outputs.pages as PagesValue;
}

/** Lay the nodes out left to right by depth, so they can be seen and clicked on the canvas. */
function arrange(graph: Graph): Graph {
  const depth = new Map<string, number>();
  const d = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    const ins = graph.edges.filter((x) => x.target === id);
    const v = ins.length ? 1 + Math.max(...ins.map((x) => d(x.source))) : 0;
    depth.set(id, v);
    return v;
  };
  const rows = new Map<number, number>();
  return {
    ...graph,
    nodes: graph.nodes.map((x) => {
      const col = d(x.id);
      const row = rows.get(col) ?? 0;
      rows.set(col, row + 1);
      return { ...x, position: { x: col * 260, y: row * 170 } };
    }),
  };
}

const withLayout = (graph: Graph, id: string, document: EditorDocument): Graph => ({
  ...graph,
  nodes: graph.nodes.map((x) => (x.id === id ? { ...x, config: { linked: false, document } } : x)),
});

function place(doc: EditorDocument, def: ComponentDef, rect: { x: number; y: number; w: number; h?: number }, fit: 'scale' | 'reflow' = 'scale') {
  return ops.placeComponent(doc, def, 'page-1', { xMm: rect.x, yMm: rect.y, wMm: rect.w, hMm: rect.h, fit }, `pl-${def.id.replace(/[^\w-]/g, '')}`);
}

/** Brochure (project: fixture 01-static). Export node: "export". */
export async function brochureGraph(projectId: string): Promise<{ graph: Graph; exportId: string }> {
  const s = await loadProject(projectId);
  let graph: Graph = {
    nodes: [
      linked.source,
      linked.capture,
      n('hero', 'pick', { selector: '.hero', wpIds: [], similar: false }),
      n('cards', 'pick', { selector: '.card', wpIds: [], similar: false }),
      n('edit', 'edit', { overrides: [] }),
      n('brochure', 'layout', { linked: false, document: null }),
      n('export', 'export', {}),
    ],
    edges: [
      e('source', 'files', 'capture', 'files'),
      e('capture', 'capture', 'hero', 'capture'),
      e('capture', 'capture', 'cards', 'capture'),
      e('hero', 'components', 'edit', 'components'),
      e('edit', 'components', 'brochure', 'components'),
      e('cards', 'components', 'brochure', 'components'),
      e('brochure', 'pages', 'export', 'pages'),
    ],
  };
  const v = await available(s, graph, 'brochure');
  const hero = v.available.find((c) => c.kind !== 'page' && v.capture.analysis.nodes.find((x) => x.wpId === c.rootWpId)?.tag === 'section')!;
  const cards = v.available.filter((c) => c.id !== hero.id);
  // The headline, edited for print.
  const h1 = v.capture.frozenHtml.match(/<h1[^>]*data-wp-id="([a-z0-9]+)"/)![1]!;
  graph = { ...graph, nodes: graph.nodes.map((x) => (x.id === 'edit' ? { ...x, config: { overrides: [{ id: 'ov-h1', componentId: hero.id, type: 'text', target: h1, value: 'Spring brochure', original: '' }] } } : x)) };
  let doc = emptyLayout(undefined, 680);
  doc = place(doc, hero, { x: 15, y: 20, w: 180 });
  cards.slice(0, 3).forEach((c, i) => (doc = place(doc, c, { x: 15 + i * 61, y: 120, w: 56 })));
  return { graph: arrange(withLayout(graph, 'brochure', doc)), exportId: 'export' };
}

export const FLYER_HTML = `<main><section class="offer"><h2>Spring fair</h2><p>Saturday 10:00 to 16:00, on the green.</p><p class="note">Bring a friend.</p></section></main>`;
export const FLYER_CSS = `body{font-family:sans-serif;margin:0}.offer{padding:24px;background:#fef3c7;border:3px solid #d97706}.offer h2{font-size:40px;margin:0 0 8px;color:#92400e}`;

/** Flyer + article (project: fixture 01-static; adds a pasted page and the long-article test page). */
export async function flyerGraph(projectId: string, flyerHtml = FLYER_HTML): Promise<{ graph: Graph; exportId: string; flyerSource: string }> {
  let s = await loadProject(projectId);
  const flyer = await addSource(s, { type: 'paste', html: flyerHtml, css: FLYER_CSS, title: 'Flyer' });
  const article = await addSource(s, { type: 'fixture', name: '08-long-article' });
  s = await loadProject(projectId);
  let graph: Graph = {
    nodes: [
      linked.source,
      linked.capture,
      n('hero', 'pick', { selector: '.hero', wpIds: [], similar: false }),
      ...defaultCapture(flyer.id, flyer.title, flyer.entry, flyer.hash, 'flyer'),
      n('offer', 'pick', { selector: '.offer', wpIds: [], similar: false }),
      n('cover', 'layout', { linked: false, document: null }),
      ...defaultCapture(article.id, article.title, article.entry, article.hash, 'article'),
      n('article-lib', 'components', { linked: false, granularity: 1, split: [], promoted: [], demoted: [], merged: [] }),
      n('flow', 'flow', { which: 'first' }),
      n('combine', 'combine', {}),
      n('export', 'export', {}),
    ],
    edges: [
      e('source', 'files', 'capture', 'files'),
      e('capture', 'capture', 'hero', 'capture'),
      e('flyer-src', 'files', 'flyer-cap', 'files'),
      e('flyer-cap', 'capture', 'offer', 'capture'),
      e('offer', 'components', 'cover', 'components'),
      e('hero', 'components', 'cover', 'components'),
      e('article-src', 'files', 'article-cap', 'files'),
      e('article-cap', 'capture', 'article-lib', 'capture'),
      e('article-lib', 'components', 'flow', 'components'),
      e('cover', 'pages', 'combine', 'pages'),
      e('flow', 'pages', 'combine', 'pages'),
      e('combine', 'document', 'export', 'document'),
    ],
  };
  const v = await available(s, graph, 'cover');
  const offer = v.available.find((c) => c.captureKey !== v.capture.key || c.name.toLowerCase().includes('offer') || c.name.includes('Spring'))!;
  const hero = v.available.find((c) => c.id !== offer.id)!;
  let doc = emptyLayout(undefined, 680);
  doc = place(doc, offer, { x: 15, y: 20, w: 180 });
  doc = place(doc, hero, { x: 15, y: 150, w: 180 });
  graph = withLayout(graph, 'cover', doc);
  return { graph: arrange(graph), exportId: 'export', flyerSource: flyer.id };
}
