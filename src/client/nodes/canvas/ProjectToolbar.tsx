// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/ui/canvas/ProjectToolbar.tsx at c22a45d, reworded: the graph is saved with the project;
// Undo / Redo follow the shared undo log.
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { undoLog } from '../../undo-log.js';
import { editorStore, selectedNodeIds, useEditor } from '../store.js';
import { SaveDialog } from './SaveDialog.js';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';

/** Undo / redo, save / open project file, and the autosave status. */
export function ProjectToolbar() {
  // One undo history across the Editor and Nodes tabs (see undo-log.ts).
  const log = useSyncExternalStore((fn) => undoLog.subscribe(fn), () => `${undoLog.canUndo} ${undoLog.canRedo}`);
  const [canUndo, canRedo] = log.split(' ').map((x) => x === 'true');
  const savedAt = useEditor((s) => s.savedAt);
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);

  const open = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const state = editorStore.getState();
    if (state.graph.nodes.length && !window.confirm(`Open “${file.name}”? It replaces the current graph.`)) return;
    state.importProject(await file.text());
  };

  return (
    <div className="project-toolbar">
      <div className="project-toolbar-buttons">
      <button type="button" disabled={!canUndo} onClick={() => editorStore.getState().undo()} title={`Undo (${mod}Z)`}>
        Undo
      </button>
      <button type="button" disabled={!canRedo} onClick={() => editorStore.getState().redo()} title={`Redo (${isMac ? '⇧⌘Z' : 'Ctrl+Y'})`}>
        Redo
      </button>
      <span className="toolbar-gap" />
      <button
        type="button"
        onClick={() => setSaving(true)}
        title="Save the graph as a file (pages imported into Web Source nodes stay in this project)"
      >
        Save graph file…
      </button>
      {saving && <SaveDialog onClose={() => setSaving(false)} />}
      <button type="button" onClick={() => fileInput.current?.click()}>
        Open graph file…
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        aria-label="Graph file"
        className="visually-hidden"
        onChange={open}
      />
      </div>
      <SavedLabel at={savedAt} />
    </div>
  );
}

function SavedLabel({ at }: { at?: Date }) {
  // Re-render now and then so "just now" turns into a time.
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  if (!at) return null;
  const seconds = (Date.now() - at.getTime()) / 1000;
  const when = seconds < 45 ? 'just now' : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <span className="muted small saved-label" role="status" title="The graph is saved with the project.">
      Graph saved {when}
    </span>
  );
}

/**
 * Ctrl/Cmd+Z and Ctrl+Y / Shift+Cmd+Z (undo, redo) and Ctrl/Cmd+D (duplicate the selected node),
 * except while typing in a field (which has its own undo).
 */
export function useUndoShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor')) return;
      const key = e.key.toLowerCase();
      const state = editorStore.getState();
      if (key === 'g') {
        // Group the selected nodes; with Shift, ungroup the selected group (or the group of the selected node).
        if (e.shiftKey) {
          const id = state.selectedGroupId ?? state.graph.groups?.find((g) => state.selectedId && g.nodeIds.includes(state.selectedId))?.id;
          if (!id) return;
          state.ungroup(id);
        } else {
          const ids = selectedNodeIds(state);
          if (!ids.length) return;
          state.groupNodes(ids);
        }
      } else if (key === 'd' && !e.shiftKey) {
        // Duplicate the selected node (instead of the browser's bookmark shortcut).
        if (!state.selectedId) return;
        state.duplicateNode(state.selectedId);
      } else if (key === 'z' && !e.shiftKey) editorStore.getState().undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') editorStore.getState().redo();
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
}
