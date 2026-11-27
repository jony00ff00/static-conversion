/**
 * Starter graphs: ready-made sets of nodes added next to what is on the canvas, in a named group with a note that
 * says what to do next. They start from the project page's capture (the default graph's), so nothing re-captures.
 */
import type { CanvasNote, Graph, GraphEdge, GraphNode, NodeGroup } from './graph.js';

export type StarterKind = 'brochure' | 'flyer';

export const STARTERS: Record<StarterKind, { label: string; description: string }> = {
  brochure: { label: 'Brochure', description: 'Pick parts of the project page, edit them for print and arrange them on your own pages' },
  flyer: { label: 'Flyer + article', description: 'A cover from another page and the project page, then the project page flowed over as many pages as it needs, as one document' },
};

const NOTES: Record<StarterKind, string> = {
  brochure: 'Brochure: type a CSS selector in Pick (or click parts in its preview), change text in Edit, then open the Layout’s pages in the Editor tab (“Edit pages”) and place them. Export from the Export node.',
  flyer: 'Flyer + article: import a page into the Web Source, pick its parts in Pick, arrange the cover with “Edit pages”. The Flow node lays the project page over as many pages as it needs; Combine puts the cover first.',
};

/** Ids not used yet in the graph, like the store's (type-N). */
function idMaker(graph: Graph) {
  const used = new Set(graph.nodes.map((n) => n.id));
  return (type: string) => {
    let i = graph.nodes.length + 1;
    while (used.has(`${type}-${i}`)) i++;
    used.add(`${type}-${i}`);
    return `${type}-${i}`;
  };
}

/** Nodes, connections, a group and a note to add for a starter. Returns null when there is no project capture to start from. */
export function starterGraph(graph: Graph, kind: StarterKind, defaults: (type: string) => unknown): { nodes: GraphNode[]; edges: GraphEdge[]; group: Omit<NodeGroup, 'id' | 'color'>; note: Omit<CanvasNote, 'id'> } | null {
  const capture = graph.nodes.find((n) => n.type === 'capture' && graph.edges.some((e) => e.target === n.id && graph.nodes.find((s) => s.id === e.source && (s.config as { sourceId?: string }).sourceId === 'main')));
  if (!capture) return null;
  const components = graph.nodes.find((n) => n.type === 'components' && graph.edges.some((e) => e.source === capture.id && e.target === n.id));
  const id = idMaker(graph);
  const top = Math.max(0, ...graph.nodes.map((n) => n.position?.y ?? 0)) + 260;
  const left = Math.min(...graph.nodes.map((n) => n.position?.x ?? 0));
  const at = (col: number, row = 0) => ({ x: left + 260 + col * 260, y: top + row * 170 });
  const node = (type: string, col: number, row = 0, name?: string, config?: unknown): GraphNode => ({ id: id(type), type, ...(name && { name }), config: config ?? defaults(type), position: at(col, row) });
  const edge = (source: string, sourcePort: string, target: string, targetPort: string): GraphEdge => ({ id: `e-${source}-${target}-${targetPort}`, source, sourcePort, target, targetPort });

  if (kind === 'brochure') {
    const pick = node('pick', 0, 0, 'Brochure parts');
    const edit = node('edit', 1, 0, 'Print edits');
    const layout = node('layout', 2, 0, 'Brochure');
    const exp = node('export', 3, 0, 'Brochure export');
    return {
      nodes: [pick, edit, layout, exp],
      edges: [edge(capture.id, 'capture', pick.id, 'capture'), edge(pick.id, 'components', edit.id, 'components'), edge(edit.id, 'components', layout.id, 'components'), edge(layout.id, 'pages', exp.id, 'pages')],
      group: { name: 'Brochure', nodeIds: [pick.id, edit.id, layout.id, exp.id] },
      note: { text: NOTES.brochure, position: { x: at(0).x, y: top - 110 }, width: 520 },
    };
  }
  const src = node('webSource', -1, 0, 'Flyer page');
  const cap = node('capture', 0, 0, 'Flyer capture');
  const pick = node('pick', 1, 0, 'Flyer parts');
  const cover = node('layout', 2, 0, 'Cover');
  const flow = node('flow', 2, 1, 'Article');
  const combine = node('combine', 3, 0, 'Flyer + article');
  const exp = node('export', 4, 0, 'Flyer export');
  const edges = [
    edge(src.id, 'files', cap.id, 'files'),
    edge(cap.id, 'capture', pick.id, 'capture'),
    edge(pick.id, 'components', cover.id, 'components'),
    edge(cover.id, 'pages', combine.id, 'pages'),
    edge(flow.id, 'pages', combine.id, 'pages'),
    edge(combine.id, 'document', exp.id, 'document'),
  ];
  if (components) edges.push(edge(components.id, 'components', flow.id, 'components'));
  return {
    nodes: [src, cap, pick, cover, flow, combine, exp],
    edges,
    group: { name: 'Flyer + article', nodeIds: [src.id, cap.id, pick.id, cover.id, flow.id, combine.id, exp.id] },
    note: { text: NOTES.flyer, position: { x: at(-1).x, y: top - 110 }, width: 560 },
  };
}
