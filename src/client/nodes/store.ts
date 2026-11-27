// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/store/editor-store.ts at c22a45d, adapted: one store per
// project, saved through the editor's API (not localStorage); no files, snippet library or examples; evaluation
// gets the project's services and the Editor tab's document and capture.
// Editor state: the graph, the selection and the latest results.
// The graph is evaluated automatically (debounced) whenever the graph or the Editor tab's project changes.
import { temporal } from 'zundo';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import {
  connect as connectEdge, GraphEvaluator, nodeRegistry, moveEdge, type CanvasNote, type EdgeCandidate, type Graph,
  type GraphNode, type GraphServices, type NodeRegistry, type NodeResult, type ProjectSnapshot, defaultGraph,
} from './engine.js';
import { parseProject, projectToJson } from './project.js';
import { groupOfNode, groupsOf, nextGroupColor, nextGroupId, nextGroupName, pruneGroups, withoutNodes } from './groups.js';

export interface Notice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

/** Every selected node that still exists: the multi-selection, or just the main one. */
export function selectedNodeIds(s: Pick<EditorState, 'graph' | 'selectedId' | 'selectedIds'>): string[] {
  if (!s.selectedId) return [];
  const ids = s.selectedIds?.includes(s.selectedId) ? s.selectedIds : [s.selectedId];
  return ids.filter((id) => s.graph.nodes.some((n) => n.id === id));
}

export interface EditorState {
  graph: Graph;
  /** The Editor tab's document and capture, for nodes linked to it. */
  project: ProjectSnapshot | null;
  /** The node the inspector and the preview follow (the last one clicked). */
  selectedId?: string;
  /** Every selected node when several are. Only counts while it holds `selectedId`. Read with `selectedNodeIds`. */
  selectedIds?: string[];
  results: Record<string, NodeResult>;
  evaluating: boolean;
  /** Set when evaluating the whole graph failed (individual node problems are in `results`). */
  graphError?: string;
  notice?: Notice;
  /** Increases when the canvas should fit all nodes into view (after opening a graph). */
  fitRequest: number;

  addNode(type: string, position?: { x: number; y: number }): string;
  removeNodes(ids: string[]): void;
  removeEdges(ids: string[]): void;
  duplicateNode(id: string): string | undefined;
  moveInput(edgeId: string, delta: -1 | 1): void;
  /** Nodes, connections and canvas notes, as one undo step. */
  removeElements(nodeIds: string[], edgeIds: string[], noteIds?: string[]): void;
  addNote(position?: { x: number; y: number }, text?: string): string;
  updateNote(id: string, patch: Partial<Omit<CanvasNote, 'id'>>): void;
  moveNode(id: string, position: { x: number; y: number }): void;
  moveNodes(positions: Record<string, { x: number; y: number }>): void;
  updateConfig<C>(id: string, update: C | ((config: C) => C)): void;
  renameNode(id: string, name: string): void;
  /** Add a connection. Returns the reason when it is not allowed (and shows it). */
  connect(edge: EdgeCandidate): string | undefined;
  select(id?: string): void;
  selectedGroupId?: string;
  fitTo?: { nodeIds: string[]; groupId?: string; n: number };
  groupNodes(ids: string[], name?: string): string | undefined;
  ungroup(groupId: string): void;
  renameGroup(groupId: string, name: string): void;
  setGroupColor(groupId: string, color: string): void;
  setGroupCollapsed(groupId: string, collapsed: boolean): void;
  addToGroup(groupId: string, ids: string[]): void;
  removeFromGroup(ids: string[]): void;
  selectGroup(groupId: string): void;
  focusGroup(groupId: string): void;
  duplicateGroup(groupId: string): string | undefined;
  deleteGroupAndNodes(groupId: string): void;
  changeSelection(added: string[], removed: string[]): void;
  /** The Editor tab's project changed (or loaded): re-evaluate nodes linked to it. */
  setProject(project: ProjectSnapshot | null): void;
  /** Replace the graph with the default one (linked to the Editor tab). */
  resetGraph(): void;
  clear(): void;
  notify(kind: Notice['kind'], text: string): void;
  dismissNotice(): void;
  evaluate(): Promise<void>;
  whenIdle(): Promise<void>;
  /** When the graph was last saved with the project. */
  savedAt?: Date;
  /** The graph as a graph file (JSON). */
  exportProject(): string;
  /** Replace the graph with one from a graph file. Returns the reason when it cannot be opened. */
  importProject(text: string): string | undefined;
  undo(): void;
  redo(): void;
}

export interface EditorOptions {
  projectId: string;
  services: GraphServices;
  graph: Graph;
  project: ProjectSnapshot | null;
  /** Saves the graph with the project (debounced). */
  save?: (graph: Graph) => Promise<unknown>;
  registry?: NodeRegistry;
  /** Milliseconds to wait after a change before evaluating. Default 150. */
  evaluateDelay?: number;
  /** Milliseconds to wait after a change before saving. Default 600. */
  autosaveDelay?: number;
  /** Edits to the same node's settings closer together than this become one undo step (typing). Default 1000. */
  undoGrouping?: number;
}

const NODE_SPACING = 280;

export function createEditorStore(options: EditorOptions) {
  const registry = options.registry ?? nodeRegistry;
  const delay = options.evaluateDelay ?? 150;
  const evaluator = new GraphEvaluator(registry);
  let runId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  let noticeId = 0;

  const nextId = (graph: Graph, type: string) => {
    const used = new Set(graph.nodes.map((n) => n.id));
    let i = graph.nodes.length + 1;
    while (used.has(`${type}-${i}`)) i++;
    return `${type}-${i}`;
  };

  const grouping = options.undoGrouping ?? 1000;
  let batchDepth = 0;
  let groupKey: string | undefined;
  const batch = <T,>(fn: () => T): T => {
    const t = store.temporal.getState();
    if (batchDepth === 0) {
      const { graph } = store.getState();
      store.temporal.setState({ pastStates: [...t.pastStates, { graph }].slice(-100), futureStates: [] });
      t.pause();
    }
    batchDepth++;
    try {
      return fn();
    } finally {
      batchDepth--;
      if (batchDepth === 0) {
        groupKey = undefined;
        store.temporal.getState().resume();
      }
    }
  };

  const store = createStore<EditorState>()(temporal((set, get) => ({
    graph: options.graph,
    project: options.project,
    results: {},
    evaluating: false,
    fitRequest: 1,

    addNode(type, position) {
      const def = registry[type];
      if (!def) throw new Error(`Unknown node type "${type}"`);
      const { graph } = get();
      const id = nextId(graph, type);
      const rightmost = graph.nodes.reduce((max, n) => Math.max(max, n.position?.x ?? 0), -NODE_SPACING + 40);
      const node: GraphNode = { id, type, config: def.defaultConfig(), position: position ?? { x: rightmost + NODE_SPACING, y: 120 } };
      set({ graph: { ...graph, nodes: [...graph.nodes, node] }, selectedId: id });
      return id;
    },

    removeNodes(ids) {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const { graph, selectedId } = get();
      const nodes = graph.nodes.filter((n) => !gone.has(n.id));
      set({
        graph: {
          nodes,
          edges: graph.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
          ...(graph.groups && { groups: pruneGroups(graph.groups, new Set(nodes.map((n) => n.id))) }),
          ...(graph.notes && { notes: graph.notes }),
        },
        selectedId: selectedId && gone.has(selectedId) ? undefined : selectedId,
      });
    },

    removeElements(nodeIds, edgeIds, noteIds = []) {
      if (nodeIds.length === 0 && edgeIds.length === 0 && noteIds.length === 0) return;
      const nodes = new Set(nodeIds);
      const edges = new Set(edgeIds);
      const notes = new Set(noteIds);
      const { graph, selectedId } = get();
      const kept = graph.nodes.filter((n) => !nodes.has(n.id));
      const keptNotes = graph.notes?.filter((n) => !notes.has(n.id));
      set({
        graph: {
          nodes: kept,
          edges: graph.edges.filter((e) => !edges.has(e.id) && !nodes.has(e.source) && !nodes.has(e.target)),
          ...(graph.groups && { groups: pruneGroups(graph.groups, new Set(kept.map((n) => n.id))) }),
          ...(keptNotes?.length && { notes: keptNotes }),
        },
        selectedId: selectedId && nodes.has(selectedId) ? undefined : selectedId,
      });
    },

    duplicateNode(id) {
      const original = get().graph.nodes.find((n) => n.id === id);
      if (!original) return undefined;
      return batch(() => {
        const base = original.position ?? { x: 40, y: 120 };
        let position = { x: base.x + 30, y: base.y + 110 };
        const taken = (p: { x: number; y: number }) =>
          get().graph.nodes.some((n) => n.position && Math.abs(n.position.x - p.x) < 60 && Math.abs(n.position.y - p.y) < 60);
        while (taken(position)) position = { x: position.x + 30, y: position.y + 60 };
        const copyId = get().addNode(original.type, position);
        get().updateConfig(copyId, structuredClone(original.config));
        if (original.name?.trim()) get().renameNode(copyId, `${original.name.trim()} copy`);
        const group = groupOfNode(get().graph, id);
        if (group) get().addToGroup(group.id, [copyId]);
        for (const e of get().graph.edges.filter((x) => x.target === id)) {
          get().connect({ source: e.source, sourcePort: e.sourcePort, target: copyId, targetPort: e.targetPort });
        }
        get().select(copyId);
        return copyId;
      });
    },

    moveInput(edgeId, delta) {
      const graph = moveEdge(get().graph, edgeId, delta);
      if (graph !== get().graph) set({ graph });
    },

    removeEdges(ids) {
      if (ids.length === 0) return;
      const gone = new Set(ids);
      const { graph } = get();
      set({ graph: { ...graph, edges: graph.edges.filter((e) => !gone.has(e.id)) } });
    },

    moveNodes(positions) {
      const { graph } = get();
      if (!Object.keys(positions).length) return;
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (positions[n.id] ? { ...n, position: positions[n.id] } : n)) } });
    },

    addNote(position, text = '') {
      const { graph } = get();
      const notes = graph.notes ?? [];
      let n = notes.length + 1;
      while (notes.some((x) => x.id === `note-${n}`)) n++;
      const id = `note-${n}`;
      // Without a place: above the top-left node (in view after an example loads), a little apart from other notes.
      const xs = graph.nodes.map((x) => x.position?.x ?? 0);
      const ys = graph.nodes.map((x) => x.position?.y ?? 0);
      const at = position ?? { x: (xs.length ? Math.min(...xs) : 40) + notes.length * 30, y: (ys.length ? Math.min(...ys) : 160) - 120 + notes.length * 30 };
      set({ graph: { ...graph, notes: [...notes, { id, text, position: at }] } });
      return id;
    },

    updateNote(id, patch) {
      const { graph } = get();
      const note = graph.notes?.find((n) => n.id === id);
      if (!note) return;
      if (patch.text !== undefined && Object.keys(patch).length === 1) groupKey = `note-text:${id}`; // typing is one undo step
      set({ graph: { ...graph, notes: graph.notes!.map((n) => (n.id === id ? { ...n, ...patch } : n)) } });
    },

    moveNode(id, position) {
      const { graph } = get();
      // Moving changes nothing the engine looks at, but positions are part of the saved graph.
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position } : n)) } });
    },

    renameNode(id, name) {
      const { graph } = get();
      const node = graph.nodes.find((n) => n.id === id);
      const next = name.trim() ? name : undefined;
      if (!node || node.name === next) return;
      groupKey = `name:${id}`; // typing a name is one undo step
      set({ graph: { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, name: next } : n)) } });
    },

    updateConfig(id, update) {
      const { graph } = get();
      groupKey = `config:${id}`;
      set({
        graph: {
          ...graph,
          nodes: graph.nodes.map((n) =>
            n.id === id ? { ...n, config: typeof update === 'function' ? (update as (c: unknown) => unknown)(n.config) : update } : n,
          ),
        },
      });
    },

    connect(edge) {
      const result = connectEdge(get().graph, edge, registry);
      if ('error' in result) {
        get().notify('error', result.error);
        return result.error;
      }
      set({ graph: result.graph });
      return undefined;
    },

    select(id) {
      const { selectedId, selectedIds } = get();
      if (selectedId !== id || (selectedIds?.length ?? 0) > 1 || get().selectedGroupId) {
        set({ selectedId: id, selectedIds: undefined, selectedGroupId: undefined });
      }
    },

    changeSelection(added, removed) {
      const state = get();
      const gone = new Set(removed);
      const ids = [...selectedNodeIds(state).filter((id) => !gone.has(id) && !added.includes(id)), ...added.filter((id) => !gone.has(id))];
      const main = added.filter((id) => !gone.has(id)).at(-1) ?? (state.selectedId && ids.includes(state.selectedId) ? state.selectedId : ids.at(-1));
      set({ selectedId: main, selectedIds: ids.length > 1 ? ids : undefined, selectedGroupId: undefined });
    },

    groupNodes(ids, name) {
      const { graph } = get();
      const real = ids.filter((id) => graph.nodes.some((n) => n.id === id));
      if (!real.length) return undefined;
      const others = withoutNodes(groupsOf(graph), real);
      const group = { id: nextGroupId(groupsOf(graph)), name: name?.trim() || nextGroupName(others), nodeIds: real, color: nextGroupColor(others) };
      set({ graph: { ...graph, groups: [...others, group] } });
      get().selectGroup(group.id);
      return group.id;
    },

    ungroup(groupId) {
      const { graph, selectedGroupId } = get();
      if (!groupsOf(graph).some((g) => g.id === groupId)) return;
      set({ graph: { ...graph, groups: groupsOf(graph).filter((g) => g.id !== groupId) }, ...(selectedGroupId === groupId && { selectedGroupId: undefined }) });
    },

    renameGroup(groupId, name) {
      const { graph } = get();
      const group = groupsOf(graph).find((g) => g.id === groupId);
      if (!group || group.name === name) return;
      groupKey = `group-name:${groupId}`; // typing a name is one undo step
      set({ graph: { ...graph, groups: groupsOf(graph).map((g) => (g.id === groupId ? { ...g, name } : g)) } });
    },

    setGroupColor(groupId, color) {
      const { graph } = get();
      set({ graph: { ...graph, groups: groupsOf(graph).map((g) => (g.id === groupId ? { ...g, color } : g)) } });
    },

    setGroupCollapsed(groupId, collapsed) {
      const { graph } = get();
      const group = groupsOf(graph).find((g) => g.id === groupId);
      if (!group || !!group.collapsed === collapsed) return;
      set({ graph: { ...graph, groups: groupsOf(graph).map((g) => (g.id === groupId ? { ...g, collapsed: collapsed || undefined } : g)) } });
    },

    addToGroup(groupId, ids) {
      const { graph } = get();
      const target = groupsOf(graph).find((g) => g.id === groupId);
      if (!target) return;
      const add = ids.filter((id) => !target.nodeIds.includes(id) && graph.nodes.some((n) => n.id === id));
      if (!add.length) return;
      const groups = withoutNodes(groupsOf(graph), add).map((g) => (g.id === groupId ? { ...g, nodeIds: [...g.nodeIds, ...add] } : g));
      // The target group may only have held nodes that were added again: keep it in any case.
      set({ graph: { ...graph, groups: groups.some((g) => g.id === groupId) ? groups : [...groups, { ...target, nodeIds: [...target.nodeIds, ...add] }] } });
    },

    removeFromGroup(ids) {
      const { graph, selectedGroupId } = get();
      const groups = withoutNodes(groupsOf(graph), ids);
      set({ graph: { ...graph, groups }, ...(selectedGroupId && !groups.some((g) => g.id === selectedGroupId) && { selectedGroupId: undefined }) });
    },

    selectGroup(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return;
      set({
        selectedGroupId: groupId,
        selectedId: group.nodeIds.at(-1),
        selectedIds: group.nodeIds.length > 1 ? [...group.nodeIds] : undefined,
      });
    },

    focusGroup(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return;
      get().selectGroup(groupId);
      set({ fitTo: { nodeIds: [...group.nodeIds], groupId, n: (get().fitTo?.n ?? 0) + 1 } });
    },

    duplicateGroup(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return undefined;
      return batch(() => {
        const members = get().graph.nodes.filter((n) => group.nodeIds.includes(n.id));
        const ys = members.map((n) => n.position?.y ?? 0);
        // Below the group: its height, plus room for the frame's header and the nodes' own height.
        const dy = Math.max(...ys) - Math.min(...ys) + 220;
        const copies = new Map<string, string>();
        for (const n of members) {
          const p = n.position ?? { x: 40, y: 120 };
          const id = get().addNode(n.type, { x: p.x, y: p.y + dy });
          get().updateConfig(id, structuredClone(n.config));
          if (n.name?.trim()) get().renameNode(id, `${n.name.trim()} copy`);
          copies.set(n.id, id);
        }
        // Connections between members, and those coming in from outside, in their order.
        for (const e of get().graph.edges.filter((x) => copies.has(x.target))) {
          get().connect({ source: copies.get(e.source) ?? e.source, sourcePort: e.sourcePort, target: copies.get(e.target)!, targetPort: e.targetPort });
        }
        const copyId = get().groupNodes([...copies.values()], `${group.name} copy`);
        if (copyId && group.collapsed) get().setGroupCollapsed(copyId, true);
        return copyId;
      });
    },

    deleteGroupAndNodes(groupId) {
      const group = groupsOf(get().graph).find((g) => g.id === groupId);
      if (!group) return;
      get().removeElements(group.nodeIds, []);
      set({ selectedGroupId: undefined, selectedId: undefined, selectedIds: undefined });
    },

    setProject(project) {
      set({ project });
    },

    resetGraph() {
      set({ graph: defaultGraph(), selectedId: undefined, selectedIds: undefined, selectedGroupId: undefined, fitRequest: get().fitRequest + 1 });
    },

    clear() {
      set({ graph: { nodes: [], edges: [] }, selectedId: undefined, results: {} });
    },

    notify(kind, text) {
      set({ notice: { id: ++noticeId, kind, text } });
    },

    dismissNotice() {
      set({ notice: undefined });
    },

    evaluate() {
      clearTimeout(timer);
      timer = undefined;
      const id = ++runId;
      const { graph, project } = get();
      set({ evaluating: true });
      running = evaluator
        .evaluate(graph, { projectId: options.projectId, services: options.services, project })
        .then(({ results }) => {
          // A newer evaluation started while this one ran: its results win.
          if (id === runId) set({ results, evaluating: false, graphError: undefined });
        })
        .catch((err: Error) => {
          if (id === runId) set({ evaluating: false, graphError: err.message });
        });
      return running;
    },

    async whenIdle() {
      while (timer !== undefined || get().evaluating) {
        if (timer !== undefined) await get().evaluate();
        else await running;
      }
    },
    exportProject() {
      return projectToJson({ graph: get().graph });
    },

    importProject(text) {
      try {
        const { project, warnings } = parseProject(text, registry);
        set({ graph: project.graph, selectedId: undefined, selectedIds: undefined, selectedGroupId: undefined, results: {}, fitRequest: get().fitRequest + 1 });
        get().notify('info', warnings.length ? `Graph opened. ${warnings.join('. ')}.` : 'Graph opened.');
        return undefined;
      } catch (err) {
        const message = (err as Error).message;
        get().notify('error', message);
        return message;
      }
    },

    undo() {
      store.temporal.getState().undo();
    },

    redo() {
      store.temporal.getState().redo();
    },
  }), {
    // Only the project itself is undoable; selection, results and notices are not.
    partialize: (s) => ({ graph: s.graph }),
    equality: (a, b) => a.graph === b.graph,
    limit: 100,
    // Typing into one node's settings becomes one undo step; every other change is its own step.
    // (Actions that change several things at once use batch(), which records one step itself.)
    handleSet: (handleSet) => {
      let last = -Infinity;
      let lastKey: string | undefined;
      return (...args: Parameters<typeof handleSet>) => {
        const key = groupKey;
        groupKey = undefined;
        const now = Date.now();
        const sameGroup = key !== undefined && key === lastKey && now - last < grouping;
        if (!sameGroup) handleSet(...args);
        last = now;
        lastKey = key;
      };
    },
  }));

  store.temporal.getState().clear();
  setTimeout(() => void store.getState().evaluate(), 0);

  // Save the graph with the project.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  store.subscribe((state, prev) => {
    if (!options.save || state.graph === prev.graph) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      options.save!(store.getState().graph).then(
        () => store.setState({ savedAt: new Date() }),
        (err: Error) => store.getState().notify('error', `The graph could not be saved: ${err.message}`),
      );
    }, options.autosaveDelay ?? 600);
  });

  store.subscribe((state, prev) => {
    if (state.graph === prev.graph && state.project === prev.project) return;
    // Only positions changed: nothing to re-run.
    if (state.project === prev.project && sameExceptPositions(state.graph, prev.graph)) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void store.getState().evaluate();
    }, delay);
  });

  return store;
}

/** Only positions, groups or notes changed: nothing the engine looks at. */
function sameExceptPositions(a: Graph, b: Graph) {
  return (
    a.edges === b.edges &&
    a.nodes.length === b.nodes.length &&
    a.nodes.every((n, i) => n.id === b.nodes[i]!.id && n.type === b.nodes[i]!.type && n.config === b.nodes[i]!.config)
  );
}

export type EditorStore = ReturnType<typeof createEditorStore>;

/**
 * The open project's store. The copied canvas reads it as a module-level value, so opening a project replaces it
 * (the Nodes tab mounts after `openGraphStore`).
 */
export let editorStore: EditorStore = createEditorStore({
  projectId: '',
  graph: { nodes: [], edges: [] },
  project: null,
  services: { capture: () => Promise.reject(new Error('No project is open')), parseHtml: () => { throw new Error('No project is open'); } },
  evaluateDelay: 1e9,
});

let openProjectId = '';

/** The project the open store belongs to ('' before one is opened). */
export const graphStoreProject = () => openProjectId;

export function openGraphStore(options: EditorOptions): EditorStore {
  editorStore = createEditorStore(options);
  openProjectId = options.projectId;
  return editorStore;
}

export function useEditor<T>(selector: (state: EditorState) => T): T {
  return useStore(editorStore, selector);
}
