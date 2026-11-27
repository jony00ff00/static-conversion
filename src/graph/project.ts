/** Graphs stored with projects: the default graph for a project, and checking graphs read from storage. */
import { validateGraph, type Graph, type GraphIssue } from './graph.js';
import { REGISTRY } from './nodes/index.js';

export const GRAPH_VERSION = 1;

/** Stored with a project (schema v3 = the v2 editor document plus this). */
export interface StoredGraph {
  version: typeof GRAPH_VERSION;
  graph: Graph;
}

/**
 * The graph every project starts with: the project page → Capture → Components → Layout → Export, each linked to
 * the Editor tab, so the two tabs show the same thing. Opening a v2 project (no graph yet) gives this graph.
 */
export function defaultGraph(): Graph {
  const y = 80;
  return {
    nodes: [
      { id: 'source', type: 'webSource', name: 'Project page', config: { sourceId: 'main', title: '', entry: '', hash: '' }, position: { x: 0, y } },
      { id: 'capture', type: 'capture', config: { linked: true, captureWidthPx: 680, presets: { hideChrome: true, expandInteractive: true, printMedia: false, linkUrls: false }, setupSteps: [], rules: [] }, position: { x: 260, y } },
      { id: 'components', type: 'components', config: { linked: true, granularity: 2, split: [], promoted: [], demoted: [], merged: [] }, position: { x: 520, y } },
      { id: 'layout', type: 'layout', name: 'Pages', config: { linked: true }, position: { x: 780, y } },
      { id: 'export', type: 'export', config: {}, position: { x: 1040, y } },
    ],
    edges: [
      { id: 'e-source-capture', source: 'source', sourcePort: 'files', target: 'capture', targetPort: 'files' },
      { id: 'e-capture-components', source: 'capture', sourcePort: 'capture', target: 'components', targetPort: 'capture' },
      { id: 'e-components-layout', source: 'components', sourcePort: 'components', target: 'layout', targetPort: 'components' },
      { id: 'e-layout-export', source: 'layout', sourcePort: 'pages', target: 'export', targetPort: 'pages' },
    ],
    groups: [],
    notes: [],
  };
}

/** A stored graph, or the default one for a project saved before graphs existed. */
export function graphOf(stored: unknown): { graph: Graph; issues: GraphIssue[] } {
  const s = stored as Partial<StoredGraph> | null | undefined;
  if (!s || s.version !== GRAPH_VERSION || !s.graph || !Array.isArray(s.graph.nodes) || !Array.isArray(s.graph.edges)) {
    return { graph: defaultGraph(), issues: [] };
  }
  const graph: Graph = { nodes: s.graph.nodes, edges: s.graph.edges, groups: s.graph.groups ?? [], notes: s.graph.notes ?? [] };
  return { graph, issues: validateGraph(graph, REGISTRY) };
}

export { REGISTRY };
