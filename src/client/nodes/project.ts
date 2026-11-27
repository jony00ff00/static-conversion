// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/store/project.ts at c22a45d, adapted: a graph file holds
// only the graph (pages imported into Web Source nodes stay in the project), no snippet library, no old-node upgrades.
import { edgeError, NOTE_COLORS, REGISTRY, type CanvasNote, type Graph, type NodeGroup, type NodeRegistry, type NoteColor } from './engine.js';

export const PROJECT_FORMAT = 'web2print-graph';
export const PROJECT_VERSION = 1;

/** A graph saved to a file ("Save graph file…"). */
export interface ProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  savedAt: string;
  graph: Graph;
}

export interface Project {
  graph: Graph;
}

export function toProjectFile(project: Project, savedAt = new Date()): ProjectFile {
  return { format: PROJECT_FORMAT, version: PROJECT_VERSION, savedAt: savedAt.toISOString(), graph: project.graph };
}

export const projectToJson = (project: Project) => JSON.stringify(toProjectFile(project), null, 1);

export interface ParsedProject {
  project: Project;
  /** Parts that were dropped because they were broken. */
  warnings: string[];
}

/** Read a graph file. Throws with a readable message when it is not one; drops broken parts with a warning. */
export function parseProject(text: string, registry: NodeRegistry = REGISTRY): ParsedProject {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('This is not a graph file (it is not valid JSON)');
  }
  const p = raw as Partial<ProjectFile>;
  if (!p || typeof p !== 'object' || p.format !== PROJECT_FORMAT) throw new Error('This is not a Static Conversion graph file');
  if (typeof p.version !== 'number' || p.version > PROJECT_VERSION) {
    throw new Error(`This graph was saved by a newer version of the app (format ${String(p.version)})`);
  }
  return readGraph(p.graph, registry);
}

/** A graph from storage or a file: unknown node types, broken connections, groups and notes are left out with a warning. */
export function readGraph(rawGraph: unknown, registry: NodeRegistry = REGISTRY): ParsedProject {
  const warnings: string[] = [];
  const g = (rawGraph ?? {}) as Partial<Graph>;
  const rawNodes = Array.isArray(g.nodes) ? g.nodes : [];
  const rawEdges = Array.isArray(g.edges) ? g.edges : [];
  const nodes = rawNodes.filter((n) => {
    const ok = n && typeof n.id === 'string' && typeof n.type === 'string' && registry[n.type];
    if (!ok) warnings.push(`A node of unknown type "${String(n?.type)}" was left out`);
    return ok;
  });
  // A name must be text; anything else is dropped.
  for (const n of nodes) if (n.name !== undefined && typeof n.name !== 'string') delete n.name;
  const ids = new Set<string>();
  const unique = nodes.filter((n) => (ids.has(n.id) ? (warnings.push(`A second node "${n.id}" was left out`), false) : ids.add(n.id)));
  const graph: Graph = { nodes: unique, edges: [] };
  for (const e of rawEdges) {
    const error = e && typeof e.id === 'string' ? edgeError(graph, e, registry) : 'incomplete connection';
    if (error) warnings.push(`A connection was left out: ${error}`);
    else graph.edges.push(e);
  }
  const groups = readGroups(g.groups, ids, warnings);
  if (groups.length) graph.groups = groups;
  const notes = readNotes(g.notes, warnings);
  if (notes.length) graph.notes = notes;
  return { project: { graph }, warnings };
}

function readNotes(raw: unknown, warnings: string[]): CanvasNote[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The notes could not be read and were left out');
    return [];
  }
  const notes: CanvasNote[] = [];
  for (const n of raw as Partial<CanvasNote>[]) {
    const p = n?.position;
    if (!n || typeof n.id !== 'string' || typeof n.text !== 'string' || !p || typeof p.x !== 'number' || typeof p.y !== 'number' || notes.some((x) => x.id === n.id)) {
      warnings.push('A note could not be read and was left out');
      continue;
    }
    notes.push({
      id: n.id,
      text: n.text,
      position: { x: p.x, y: p.y },
      ...(typeof n.width === 'number' && n.width > 0 && { width: n.width }),
      ...(NOTE_COLORS.includes(n.color as NoteColor) && { color: n.color }),
    });
  }
  return notes;
}

/** Groups from a project file: unknown nodes leave them, a node in two groups stays in the first, empty ones go. */
function readGroups(raw: unknown, nodeIds: Set<string>, warnings: string[]): NodeGroup[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    warnings.push('The groups could not be read and were left out');
    return [];
  }
  const groups: NodeGroup[] = [];
  const taken = new Set<string>();
  for (const g of raw as Partial<NodeGroup>[]) {
    if (!g || typeof g.id !== 'string' || !Array.isArray(g.nodeIds) || groups.some((x) => x.id === g.id)) {
      warnings.push('A group could not be read and was left out');
      continue;
    }
    const name = typeof g.name === 'string' ? g.name : g.id;
    const members: string[] = [];
    for (const id of g.nodeIds) {
      if (typeof id !== 'string' || !nodeIds.has(id) || members.includes(id)) continue;
      if (taken.has(id)) {
        warnings.push(`The node "${id}" was in two groups; it stays in the first`);
        continue;
      }
      members.push(id);
      taken.add(id);
    }
    if (!members.length) {
      warnings.push(`The group "${name}" has no nodes left and was left out`);
      continue;
    }
    groups.push({
      id: g.id,
      name,
      nodeIds: members,
      ...(typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) && { color: g.color }),
      ...(g.collapsed === true && { collapsed: true }),
    });
  }
  return groups;
}
