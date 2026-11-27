/**
 * The Nodes tab: Node CMS's four columns (palette · canvas · inspector · preview) around this project's graph.
 * Adapted from Node CMS src/ui/App.tsx at c22a45d (no resizable / separate-window preview yet).
 */
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, useState, type CSSProperties } from 'react';
import { api } from '../api.js';
import { Canvas } from './canvas/Canvas.js';
import { Palette } from './canvas/Palette.js';
import { useUndoShortcuts } from './canvas/ProjectToolbar.js';
import { Inspector } from './inspector/Inspector.js';
import { Preview } from './preview/Preview.js';
import { NoticeToast } from './Notice.js';
import { PanelRail, RailButton, useMinimisedPanels } from './panels.js';
import { nodeLabel } from './node-label.js';
import { clientServices, HostContext, type NodesHost } from './host.js';
import { editorStore, graphStoreProject, openGraphStore, useEditor } from './store.js';
import { GRAPH_VERSION, graphOf, type CaptureValue, type ComponentSet, type ProjectSnapshot } from './engine.js';

export function NodesTab({ host, snapshot }: { host: NodesHost; snapshot: ProjectSnapshot | null }) {
  const [ready, setReady] = useState(graphStoreProject() === host.projectId);
  useEffect(() => {
    if (graphStoreProject() === host.projectId) return;
    let cancelled = false;
    api.graph(host.projectId).then(
      (stored) => {
        if (cancelled) return;
        const { graph, issues } = graphOf(stored);
        const store = openGraphStore({
          projectId: host.projectId,
          services: clientServices(host.projectId),
          graph,
          project: snapshot,
          save: (g) => api.saveGraph(host.projectId, { version: GRAPH_VERSION, graph: g }),
        });
        if (issues.length) store.getState().notify('info', `Parts of the graph were left out: ${issues.map((i) => i.message).join('. ')}.`);
        setReady(true);
      },
      (e: Error) => !cancelled && alert(`The graph could not be loaded: ${e.message}`),
    );
    return () => {
      cancelled = true;
    };
  }, [host.projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Editor tab's document or capture changed: nodes linked to it re-run.
  useEffect(() => {
    if (ready) editorStore.getState().setProject(snapshot);
  }, [ready, snapshot]);
  if (!ready) return <p className="muted nodes-loading" role="status">Loading the graph…</p>;
  return (
    <HostContext.Provider value={host}>
      <ReactFlowProvider>
        <NodesApp />
      </ReactFlowProvider>
    </HostContext.Provider>
  );
}

/** For tests and debugging: the graph, a summary of each node's result, and waiting for evaluation to finish. */
function useTestHooks() {
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__veGraph = () => editorStore.getState().graph;
    w.__veGraphIdle = () => editorStore.getState().whenIdle();
    w.__veResults = () =>
      Object.fromEntries(
        Object.entries(editorStore.getState().results).map(([id, r]) => {
          const set = r.outputs.components as ComponentSet | undefined;
          const capture = r.outputs.capture as CaptureValue | undefined;
          return [id, {
            status: r.status, message: r.message, info: r.info, warnings: r.warnings,
            items: set?.items.map((c) => c.rootWpId), overrides: set?.overrides,
            capture: capture && { key: capture.key, nodes: capture.analysis.nodes, settings: capture.settings },
          }];
        }),
      );
  }, []);
}

function NodesApp() {
  useUndoShortcuts();
  useTestHooks();
  const [minimised, setMinimised] = useMinimisedPanels();
  const selected = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const style = {
    '--preview-width': minimised.preview ? 'var(--rail-width)' : '440px',
    '--palette-width': minimised.palette ? 'var(--rail-width)' : '220px',
    '--inspector-width': minimised.inspector ? 'var(--rail-width)' : '320px',
  } as CSSProperties;
  return (
    <div className="nodes-app">
      <div className="app" style={style}>
        {minimised.palette ? <PanelRail panel="palette" onRestore={() => setMinimised('palette', false)} /> : <Palette onMinimise={() => setMinimised('palette', true)} />}
        <Canvas />
        {minimised.inspector ? (
          <PanelRail panel="inspector" note={selected && nodeLabel(selected)} onRestore={() => setMinimised('inspector', false)} />
        ) : (
          <Inspector onMinimise={() => setMinimised('inspector', true)} />
        )}
        {minimised.preview ? (
          <aside className="panel-rail preview" aria-label="Preview (minimised)">
            <RailButton panel="preview" onRestore={() => setMinimised('preview', false)} />
          </aside>
        ) : (
          <Preview onMinimise={() => setMinimised('preview', true)} />
        )}
        <NoticeToast />
      </div>
    </div>
  );
}
