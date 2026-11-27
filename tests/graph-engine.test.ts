/**
 * N0: the node graph engine (copied from Node CMS, adapted): connections, loops, cached evaluation, and
 * projects saved before graphs existed opening as the default graph.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import {
  GraphEvaluator,
  REGISTRY,
  connect,
  defaultGraph,
  edgeError,
  graphOf,
  topologicalSort,
  type CaptureValue,
  type ComponentSet,
  type EvalContext,
  type Graph,
  type GraphServices,
  type PagesValue,
} from '../src/graph/index.js';
import { composePageHtml } from '../src/compose/page.js';
import { isolateComponent } from '../src/compose/isolate.js';
import * as ops from '../src/model/ops.js';
import type { Analysis, AnalysisNode } from '../src/model/types.js';

const node = (wpId: string, extra: Partial<AnalysisNode>): AnalysisNode => ({
  wpId,
  parentWpId: null,
  depth: 1,
  tag: 'section',
  kind: 'section',
  name: wpId,
  score: 1,
  bbox: { x: 0, y: 0, w: 680, h: 100 },
  bg: '#fff',
  repeatKey: null,
  minFontPx: 16,
  atomic: false,
  ...extra,
});

export const FROZEN = `<!DOCTYPE html><html><head></head><body data-wp-id="body">
<header data-wp-id="hdr"><h1 data-wp-id="h1">Title</h1></header>
<section data-wp-id="offers"><article class="card" data-wp-id="c1"><h2 data-wp-id="c1h">Apples</h2><p data-wp-id="c1p">Crisp</p></article>
<article class="card" data-wp-id="c2"><h2 data-wp-id="c2h">Bread</h2></article></section>
</body></html>`;

export const ANALYSIS: Analysis = {
  captureWidthPx: 680,
  documentHeightPx: 600,
  baseUrl: 'http://fixture.local/index.html',
  pageBg: '#fff',
  warnings: [],
  nodes: [
    node('hdr', { tag: 'header', kind: 'header', name: 'Header', bbox: { x: 0, y: 0, w: 680, h: 80 } }),
    node('offers', { name: 'Offers', bbox: { x: 0, y: 100, w: 680, h: 400 } }),
    node('c1', { parentWpId: 'offers', depth: 2, tag: 'article', kind: 'card', name: 'Apples', repeatKey: 'card', bbox: { x: 0, y: 100, w: 300, h: 200 } }),
    node('c2', { parentWpId: 'offers', depth: 2, tag: 'article', kind: 'card', name: 'Bread', repeatKey: 'card', bbox: { x: 340, y: 100, w: 300, h: 200 } }),
  ],
};

function projectCapture(): CaptureValue {
  return {
    sourceId: 'main',
    key: 'project-capture-1',
    settings: { captureWidthPx: 680, presets: { hideChrome: true, expandInteractive: true, printMedia: false, linkUrls: false }, setupSteps: [], rules: [] },
    analysis: ANALYSIS,
    frozenHtml: FROZEN,
    bodyWpId: 'body',
    baseUrl: 'http://fixture.local/index.html',
  };
}

function setup() {
  const calls: string[] = [];
  const services: GraphServices = {
    async capture(files, settings) {
      calls.push(`${files.sourceId}@${settings.captureWidthPx}`);
      return { analysis: { ...ANALYSIS, captureWidthPx: settings.captureWidthPx }, frozenHtml: FROZEN, bodyWpId: 'body', baseUrl: 'x' };
    },
    parseHtml: (html) => parseHTML(html).document as unknown as Document,
  };
  const document = ops.newEditorDocument(ANALYSIS, 'body', 680);
  const ctx: EvalContext = { projectId: 'p-test', services, project: { title: 'Test page', document, capture: projectCapture() } };
  return { ctx, calls, evaluator: new GraphEvaluator(REGISTRY) };
}

const n = (id: string, type: string, config?: unknown) => ({ id, type, config: config ?? REGISTRY[type]!.defaultConfig(), position: { x: 0, y: 0 } });
const e = (source: string, sourcePort: string, target: string, targetPort: string) => ({ id: `${source}-${target}-${targetPort}`, source, sourcePort, target, targetPort });

/** An unlinked chain: an added page → Capture → Components → Filter. */
function unlinkedGraph(): Graph {
  return {
    nodes: [
      n('src', 'webSource', { sourceId: 's-1', title: 'Flyer', entry: 'index.html', hash: 'h1' }),
      n('cap', 'capture'),
      n('lib', 'components'),
      n('flt', 'filter'),
    ],
    edges: [e('src', 'files', 'cap', 'files'), e('cap', 'capture', 'lib', 'capture'), e('lib', 'components', 'flt', 'components')],
  };
}

describe('N0: the engine stays pure', () => {
  it('src/graph uses no React, DOM globals, storage or network (services do that)', () => {
    const dir = path.resolve(import.meta.dirname, '../src/graph');
    const files: string[] = [];
    const walk = (d: string) => readdirSync(d).forEach((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : files.push(path.join(d, f))));
    walk(dir);
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      // Code only: comments may mention what services do.
      const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(f.endsWith('.ts') && !f.endsWith('.tsx'), f).toBe(true);
      expect(src, f).not.toMatch(/from 'react|\bwindow\.|\bdocument\.(?!pages|placements|components|decomposition|overrides)|localStorage|indexedDB|\bfetch\(|DOMParser/);
    }
  });
});

describe('N0: connections', () => {
  const g = unlinkedGraph();

  it('accepts matching port types, and refuses others with a reason', () => {
    expect(edgeError(g, { source: 'cap', sourcePort: 'capture', target: 'lib', targetPort: 'capture', id: 'x' }, REGISTRY)).toMatch(/already connected/);
    const fresh: Graph = { nodes: [...g.nodes, n('pick', 'pick'), n('lay', 'layout')], edges: g.edges };
    expect(edgeError(fresh, { source: 'cap', sourcePort: 'capture', target: 'pick', targetPort: 'capture' }, REGISTRY)).toBeUndefined();
    expect(edgeError(fresh, { source: 'src', sourcePort: 'files', target: 'pick', targetPort: 'capture' }, REGISTRY)).toBe('Cannot connect a files output to a capture input');
    expect(edgeError(fresh, { source: 'cap', sourcePort: 'capture', target: 'cap', targetPort: 'files' }, REGISTRY)).toBe('A node cannot connect to itself');
    expect(edgeError(fresh, { source: 'lib', sourcePort: 'nope', target: 'lay', targetPort: 'components' }, REGISTRY)).toBe('Components has no output "nope"');
  });

  it('a Layout takes several component inputs', () => {
    let g2: Graph = { nodes: [...g.nodes, n('lay', 'layout')], edges: g.edges };
    const a = connect(g2, { source: 'lib', sourcePort: 'components', target: 'lay', targetPort: 'components' }, REGISTRY);
    expect('graph' in a).toBe(true);
    g2 = (a as { graph: Graph }).graph;
    const b = connect(g2, { source: 'flt', sourcePort: 'components', target: 'lay', targetPort: 'components' }, REGISTRY);
    expect('graph' in b).toBe(true);
  });

  it('refuses loops', () => {
    const g2: Graph = { nodes: [...g.nodes, n('ed', 'edit')], edges: [...g.edges, e('flt', 'components', 'ed', 'components')] };
    const g3: Graph = { ...g2, nodes: [...g2.nodes, n('ed2', 'edit')], edges: [...g2.edges, e('ed', 'components', 'ed2', 'components')] };
    // ed2 → flt would close flt → ed → ed2 → flt.
    const loop: Graph = { ...g3, edges: g3.edges.filter((x) => x.target !== 'flt') };
    const withBack = { ...loop, edges: [...loop.edges, e('ed2', 'components', 'flt', 'components')] };
    expect(edgeError(loop, { source: 'ed2', sourcePort: 'components', target: 'flt', targetPort: 'components' }, REGISTRY)).toBe('This connection would create a loop');
    expect(() => topologicalSort(withBack)).toThrow(/loop/);
  });
});

describe('N0: cached evaluation', () => {
  it('runs each node once; a second run, or moving nodes on the canvas, re-runs nothing', async () => {
    const { ctx, calls, evaluator } = setup();
    const g = unlinkedGraph();
    const r1 = await evaluator.evaluate(g, ctx);
    expect(r1.ran.sort()).toEqual(['cap', 'flt', 'lib', 'src']);
    expect(calls).toEqual(['s-1@680']);
    expect(r1.results.flt!.status).toBe('ok');
    const moved: Graph = { ...g, nodes: g.nodes.map((x) => ({ ...x, position: { x: 999, y: 999 } })) };
    const r2 = await evaluator.evaluate(moved, ctx);
    expect(r2.ran).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('a change re-runs that node and what follows it, never the capture before it', async () => {
    const { ctx, calls, evaluator } = setup();
    const g = unlinkedGraph();
    await evaluator.evaluate(g, ctx);
    const finer: Graph = { ...g, nodes: g.nodes.map((x) => (x.id === 'lib' ? { ...x, config: { ...(x.config as object), granularity: 1 } } : x)) };
    const r = await evaluator.evaluate(finer, ctx);
    expect(r.ran.sort()).toEqual(['flt', 'lib']);
    expect(calls).toHaveLength(1);
    // A different capture width re-captures.
    const wider: Graph = { ...g, nodes: g.nodes.map((x) => (x.id === 'cap' ? { ...x, config: { ...(x.config as object), captureWidthPx: 900 } } : x)) };
    await evaluator.evaluate(wider, ctx);
    expect(calls).toEqual(['s-1@680', 's-1@900']);
  });

  it('moving a frame in the Editor tab re-runs only the layout, not capture or components', async () => {
    const { ctx, evaluator } = setup();
    const g = defaultGraph();
    await evaluator.evaluate(g, ctx);
    const doc = ops.movePlacements(ctx.project!.document, ['pl-page'], 5, 5);
    const r = await evaluator.evaluate(g, { ...ctx, project: { ...ctx.project!, document: doc } });
    expect(r.ran.sort()).toEqual(['export', 'layout']);
  });

  it('a node waiting for input says what it needs; the nodes after it wait too', async () => {
    const { ctx, evaluator } = setup();
    const g: Graph = { nodes: [n('src', 'webSource'), n('cap', 'capture'), n('pk', 'pick')], edges: [e('src', 'files', 'cap', 'files'), e('cap', 'capture', 'pk', 'capture')] };
    const r = await evaluator.evaluate(g, ctx);
    expect(r.results.src!.status).toBe('waiting');
    expect(r.results.src!.message).toBe('Import a page in this node');
    expect(r.results.pk!.status).toBe('waiting');
  });
});

describe('N0: projects saved before graphs (v2) open as the default graph', () => {
  it('builds the default graph, and a stored graph round-trips through JSON', () => {
    expect(graphOf(undefined).graph).toEqual(defaultGraph());
    const stored = JSON.parse(JSON.stringify({ version: 1, graph: unlinkedGraph() }));
    const back = graphOf(stored);
    expect(back.issues).toEqual([]);
    expect(back.graph.nodes).toEqual(unlinkedGraph().nodes);
    expect(back.graph.edges).toEqual(unlinkedGraph().edges);
  });

  it('the default graph gives exactly the Editor tab’s document, capture and pages', async () => {
    const { ctx, evaluator, calls } = setup();
    const r = await evaluator.evaluate(defaultGraph(), ctx);
    for (const id of ['source', 'capture', 'components', 'layout', 'export']) expect(r.results[id]!.status, id).toBe('ok');
    expect(calls).toEqual([]); // linked: no new capture
    const pages = r.results.layout!.outputs.pages as PagesValue;
    expect(pages.document).toEqual(ctx.project!.document);
    const set = r.results.components!.outputs.components as ComponentSet;
    expect(set.items[0]).toEqual(ctx.project!.document.components.page);
    // Same page HTML as the Editor tab composes.
    const htmlFor = (cap: CaptureValue) => (def: Parameters<typeof isolateComponent>[2], w: number) =>
      isolateComponent((h) => parseHTML(h).document as unknown as Document, cap.frozenHtml, def, { widthPx: w, overrides: [], baseUrl: cap.baseUrl });
    expect(composePageHtml(pages.document, 'page-1', htmlFor(pages.capture))).toBe(composePageHtml(ctx.project!.document, 'page-1', htmlFor(ctx.project!.capture)));
  });

  it('linked components follow the Editor tab’s level of detail', async () => {
    const { ctx, evaluator } = setup();
    const doc1 = { ...ctx.project!.document, decomposition: { ...ctx.project!.document.decomposition, granularity: 1 } };
    const r1 = await evaluator.evaluate(defaultGraph(), { ...ctx, project: { ...ctx.project!, document: doc1 } });
    expect((r1.results.components!.outputs.components as ComponentSet).items.map((c) => c.rootWpId)).toEqual(['body', 'hdr', 'offers']);
    const r2 = await evaluator.evaluate(defaultGraph(), ctx);
    expect((r2.results.components!.outputs.components as ComponentSet).items.map((c) => c.rootWpId)).toEqual(['body', 'hdr', 'offers', 'c1', 'c2']);
  });
});

describe('N3 (engine): Pick, Edit and Filter', () => {
  const pickGraph = (config: object): Graph => ({
    nodes: [n('source', 'webSource', { sourceId: 'main', title: '', entry: '', hash: '' }), n('capture', 'capture', { ...REGISTRY.capture!.defaultConfig() as object, linked: true }), n('pk', 'pick', { selector: '', wpIds: [], similar: false, ...config })],
    edges: [e('source', 'files', 'capture', 'files'), e('capture', 'capture', 'pk', 'capture')],
  });
  const ids = async (config: object) => {
    const { ctx, evaluator } = setup();
    const r = await evaluator.evaluate(pickGraph(config), ctx);
    return { r: r.results.pk!, ids: ((r.results.pk!.outputs.components as ComponentSet | undefined)?.items ?? []).map((c) => c.rootWpId) };
  };

  it('a selector and clicked elements pick the same components (an inner element counts as its component)', async () => {
    expect((await ids({ selector: '.card' })).ids).toEqual(['c1', 'c2']);
    expect((await ids({ wpIds: ['c1', 'c2'] })).ids).toEqual(['c1', 'c2']);
    expect((await ids({ selector: '.card h2' })).ids).toEqual(['c1', 'c2']);
    expect((await ids({ wpIds: ['c1'], similar: true })).ids).toEqual(['c1', 'c2']);
  });

  it('reports a bad selector, no matches and missing picks plainly', async () => {
    expect((await ids({ selector: '.card[' })).r.message).toBe('".card[" is not a valid CSS selector');
    const none = await ids({ selector: '.nothing', wpIds: ['c1'] });
    expect(none.r.warnings).toEqual(['Nothing on the page matches ".nothing"']);
    expect((await ids({ wpIds: ['gone', 'c2'] })).r.warnings).toEqual(['A picked element (gone) is no longer on the page']);
  });

  it('Edit adds content edits (the later edit of the same thing wins) and Filter keeps, orders and counts', async () => {
    const { ctx, evaluator } = setup();
    const g: Graph = {
      nodes: [
        ...pickGraph({ selector: '.card, header' }).nodes,
        n('ed', 'edit', { overrides: [{ id: 'o1', componentId: 'c-c1', type: 'text', target: 'c1h', value: 'Pears', original: 'Apples' }, { id: 'o2', componentId: 'c-zzz', type: 'visibility', target: 'x', hidden: true }] }),
        n('ed2', 'edit', { overrides: [{ id: 'o3', componentId: 'c-c1', type: 'text', target: 'c1h', value: 'Plums', original: 'Apples' }] }),
        n('flt', 'filter', { kinds: ['card'], text: '', dropPage: true, order: 'reverse', first: 1 }),
      ],
      edges: [...pickGraph({}).edges, e('pk', 'components', 'ed', 'components'), e('ed', 'components', 'ed2', 'components'), e('ed2', 'components', 'flt', 'components')],
    };
    const r = await evaluator.evaluate(g, ctx);
    const ed2 = r.results.ed2!.outputs.components as ComponentSet;
    expect(ed2.overrides.map((o) => o.id)).toEqual(['o3']);
    expect(r.results.ed!.warnings).toEqual(['1 edit(s) are for components no longer in the input']);
    const flt = r.results.flt!;
    expect((flt.outputs.components as ComponentSet).items.map((c) => c.rootWpId)).toEqual(['c2']);
    expect(flt.info).toEqual({ kept: 1, of: 3 });
    expect((flt.outputs.components as ComponentSet).overrides).toEqual([]); // c1 left, so did its edit
  });
});
