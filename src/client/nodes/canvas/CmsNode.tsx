// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/ui/canvas/CmsNode.tsx at c22a45d, adapted: summaries for
// web-to-print nodes, no snippet library badge, a "Linked to the Editor tab" badge.
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, useState } from 'react';
import { nodeRegistry, type GraphNode, type NodeResult } from '../engine.js';
import { editorStore, useEditor } from '../store.js';

export type CmsFlowNode = Node<Record<string, never>, 'cms'>;

const STATUS_LABEL: Record<string, string> = { ok: 'OK', waiting: 'Waiting', error: 'Error', blocked: 'Blocked' };

function CmsNodeView({ id, selected }: NodeProps<CmsFlowNode>) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === id));
  const result = useEditor((s) => s.results[id]);
  if (!node) return null;
  const def = nodeRegistry[node.type];
  if (!def) return null;
  const linked = (node.config as { linked?: boolean } | null)?.linked === true || (node.type === 'webSource' && (node.config as { sourceId?: string }).sourceId === 'main');
  const status = result?.status ?? 'waiting';
  const warnings = result?.warnings.length ?? 0;
  const rows = Math.max(def.inputs.length, def.outputs.length);

  return (
    <div className={`cms-node cms-node-${node.type} status-${status}${selected ? ' is-selected' : ''}`} data-testid={`node-${id}`}>
      <header>
        <NodeTitle id={id} name={node.name} label={def.label} />
        <span className={`status-pill status-${status}`} title={result?.message}>
          {STATUS_LABEL[status]}
        </span>
      </header>
      <div className="cms-node-summary">{summarize(node, result)}</div>
      {linked && <div className="linked-pill node-badge" title="Uses the Editor tab’s page and settings">Linked to the Editor tab</div>}
      {result?.message && status !== 'ok' && <div className="cms-node-message">{result.message}</div>}
      {warnings > 0 && (
        <div className="cms-node-warnings">
          {warnings} warning{warnings === 1 ? '' : 's'}
        </div>
      )}
      <div className="cms-node-ports">
        {Array.from({ length: rows }, (_, i) => {
          const input = def.inputs[i];
          const output = def.outputs[i];
          return (
            <div className="cms-node-port-row" key={i}>
              <span className="port port-in">
                {input && (
                  <>
                    <Handle type="target" position={Position.Left} id={input.name} className={`handle-${input.type}`} />
                    {input.label}
                  </>
                )}
              </span>
              <span className="port port-out">
                {output && (
                  <>
                    {output.label}
                    <Handle type="source" position={Position.Right} id={output.name} className={`handle-${output.type}`} />
                  </>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const CmsNode = memo(CmsNodeView);

/** The node's name (or its type), with the type below a given name. Double-click to rename. */
function NodeTitle({ id, name, label }: { id: string; name?: string; label: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (editing) {
    const done = (save: boolean) => {
      if (save) editorStore.getState().renameNode(id, draft);
      setEditing(false);
    };
    return (
      <input
        className="node-name-input nodrag"
        aria-label={`Name of ${id}`}
        autoFocus
        value={draft}
        placeholder={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => done(true)}
        onKeyDown={(e) => {
          e.stopPropagation(); // keep Backspace from deleting the node
          if (e.key === 'Enter') done(true);
          if (e.key === 'Escape') done(false);
        }}
      />
    );
  }
  return (
    <span
      className="cms-node-title"
      title="Double-click to rename"
      onDoubleClick={(e) => {
        e.stopPropagation();
        setDraft(name ?? '');
        setEditing(true);
      }}
    >
      {name?.trim() || label}
      {name?.trim() && <span className="cms-node-type">{label}</span>}
    </span>
  );
}

const n = (count: unknown, word: string) => (typeof count === 'number' ? `${count} ${word}${count === 1 ? '' : 's'}` : '');

function summarize(node: GraphNode, result: NodeResult | undefined): string {
  const info = result?.info ?? {};
  const c = node.config as Record<string, unknown>;
  switch (node.type) {
    case 'webSource':
      return info.page ? String(info.page) : 'No page imported';
    case 'capture':
      return info.elements !== undefined ? `${info.width} wide · ${info.height} tall · ${n(info.elements, 'element')}` : `${c.captureWidthPx} px wide`;
    case 'components':
      return info.components !== undefined ? `${n(info.components, 'component')} · detail ${info.detail}` : `Detail ${c.granularity}`;
    case 'pick': {
      const how = [String(c.selector ?? '').trim(), (c.wpIds as string[]).length ? `${(c.wpIds as string[]).length} clicked` : ''].filter(Boolean).join(' + ') || 'Nothing picked yet';
      return `${how}${c.similar ? ' + similar' : ''}${info.components !== undefined ? ` · ${n(info.components, 'component')}` : ''}`;
    }
    case 'edit':
      return info.edits !== undefined ? n(info.edits, 'edit') : 'No edits';
    case 'filter':
      return info.kept !== undefined ? `${info.kept} of ${info.of} kept` : 'Keeps every component';
    case 'layout':
      return info.pages !== undefined ? `${n(info.pages, 'page')} · ${n(info.frames, 'frame')}` : '';
    case 'flow':
      return info.pages !== undefined ? `${n(info.pages, 'page')} · ${c.which === 'each' ? 'each component' : 'first component'}` : c.which === 'each' ? 'Each component' : 'The first component';
    case 'pageSetup':
      return info.page !== undefined ? `${info.page} · ${info.margins}` : '';
    case 'export':
      return info.pages !== undefined ? `${n(info.pages, 'page')} ready` : 'Connect pages';
    default:
      return '';
  }
}
