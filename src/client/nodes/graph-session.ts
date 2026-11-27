/**
 * The project's graph, opened when the editor opens the project (not only when the Nodes tab is shown): the Editor
 * tab edits Layout nodes in it, and both tabs share one undo history.
 */
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { undoLog } from '../undo-log.js';
import { clientServices } from './host.js';
import { GRAPH_VERSION, graphOf, type ProjectSnapshot } from './engine.js';
import { editorStore, graphStoreProject, openGraphStore } from './store.js';

/** Opens (once per project) and keeps the graph store in step with the Editor tab. Returns whether it is ready. */
export function useProjectGraph(projectId: string, snapshot: ProjectSnapshot | null): boolean {
  const [ready, setReady] = useState(graphStoreProject() === projectId);
  useEffect(() => {
    if (graphStoreProject() === projectId) return setReady(true);
    let cancelled = false;
    setReady(false);
    api.graph(projectId).then(
      (stored) => {
        if (cancelled) return;
        const { graph, issues } = graphOf(stored);
        undoLog.reset();
        const store = openGraphStore({
          projectId,
          services: clientServices(projectId),
          graph,
          project: snapshot,
          save: (g) => api.saveGraph(projectId, { version: GRAPH_VERSION, graph: g }),
          onRecord: () => undoLog.record('graph'),
          undoRedo: undoLog,
        });
        undoLog.register('graph', { undo: () => store.temporal.getState().undo(), redo: () => store.temporal.getState().redo() });
        if (issues.length) store.getState().notify('info', `Parts of the graph were left out: ${issues.map((i) => i.message).join('. ')}.`);
        setReady(true);
      },
      (e: Error) => !cancelled && console.error(`The graph could not be loaded: ${e.message}`),
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  // The Editor tab's document or capture changed: nodes linked to it re-run.
  useEffect(() => {
    if (ready && snapshot) editorStore.getState().setProject(snapshot);
  }, [ready, snapshot]);
  return ready;
}
