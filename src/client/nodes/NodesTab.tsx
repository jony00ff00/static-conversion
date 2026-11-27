/**
 * The Nodes tab: Node CMS's four columns (palette · canvas · inspector · preview) around this project's graph.
 * Adapted from Node CMS src/ui/App.tsx at c22a45d (no resizable / separate-window preview yet).
 */
import { ReactFlowProvider } from '@xyflow/react';
import { useEffect, type CSSProperties } from 'react';
import { Canvas } from './canvas/Canvas.js';
import { Palette } from './canvas/Palette.js';
import { useUndoShortcuts } from './canvas/ProjectToolbar.js';
import { Inspector } from './inspector/Inspector.js';
import { Preview } from './preview/Preview.js';
import { NoticeToast } from './Notice.js';
import { PanelRail, RailButton, useMinimisedPanels } from './panels.js';
import { nodeLabel } from './node-label.js';
import { HostContext, type NodesHost } from './host.js';
import { editorStore, useEditor } from './store.js';
import type { CaptureValue, ComponentSet, PagesValue } from './engine.js';

/** The Nodes tab. The editor opens the project's graph first (see graph-session.ts). */
export function NodesTab({ host, ready }: { host: NodesHost; ready: boolean }) {
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
    w.__veLastRan = () => editorStore.getState().lastRan;
    w.__veStore = () => editorStore;
    w.__veConnect = (e: Parameters<ReturnType<typeof editorStore.getState>['connect']>[0]) => editorStore.getState().connect(e);
    w.__veResults = () =>
      Object.fromEntries(
        Object.entries(editorStore.getState().results).map(([id, r]) => {
          const set = r.outputs.components as ComponentSet | undefined;
          const capture = r.outputs.capture as CaptureValue | undefined;
          const pages = r.outputs.pages as PagesValue | undefined;
          return [id, {
            status: r.status, message: r.message, info: r.info, warnings: r.warnings,
            items: set?.items.map((c) => c.rootWpId), overrides: set?.overrides,
            capture: capture && { key: capture.key, nodes: capture.analysis.nodes, settings: capture.settings },
            pages: pages && { document: pages.document, captureKeys: Object.keys(pages.captures), overrides: pages.overrides.length },
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
