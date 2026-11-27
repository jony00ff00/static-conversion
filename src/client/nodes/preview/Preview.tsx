/**
 * The Nodes tab's preview: it follows the selected node (as in Node CMS), showing what that node works on or makes.
 * Frozen pages and components render in `sandbox="allow-same-origin"` iframes (no scripts run); live pages in
 * the same script-running, recorded iframe as the Editor tab's Live view.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api.js';
import { makeHtmlFor } from '../../render.js';
import { isolateComponent } from '../../../compose/isolate.js';
import { composePageHtml } from '../../../compose/page.js';
import { mmToPx, trimMm } from '../../../model/geometry.js';
import { newId } from '../../../model/ops.js';
import { describeStep } from '../../../render/steps.js';
import { IS_STATIC } from '../../../static/env.js';
import type { ComponentDef, Override, SetupStep } from '../../../model/types.js';
import type { CaptureConfig } from '../../../graph/nodes/capture.js';
import type { EditConfig } from '../../../graph/nodes/edit.js';
import type { PickConfig } from '../../../graph/nodes/pick.js';
import { nodeForElement, type CaptureValue, type ComponentSet, type FilesValue, type GraphNode, type NodeResult, type PagesValue } from '../engine.js';
import { editorStore, useEditor } from '../store.js';
import { useHost } from '../host.js';
import { MinimiseButton } from '../panels.js';

const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');

/** The value arriving at one of a node's inputs (from the node feeding it). */
function useInput<T>(nodeId: string | undefined, port: string): T | undefined {
  return useEditor((s) => {
    const e = s.graph.edges.find((x) => x.target === nodeId && x.targetPort === port);
    return e ? (s.results[e.source]?.outputs[e.sourcePort] as T | undefined) : undefined;
  });
}

export function Preview({ onMinimise }: { onMinimise: () => void }) {
  const node = useEditor((s) => s.graph.nodes.find((n) => n.id === s.selectedId));
  const result = useEditor((s) => (s.selectedId ? s.results[s.selectedId] : undefined));
  return (
    <aside className="panel preview" aria-label="Preview">
      <div className="panel-head">
        <h2>Preview</h2>
        <MinimiseButton panel="preview" onClick={onMinimise} />
      </div>
      <div className="preview-body">{node ? <PreviewFor node={node} result={result} /> : <p className="muted">Select a node to see what it makes.</p>}</div>
    </aside>
  );
}

function PreviewFor({ node, result }: { node: GraphNode; result?: NodeResult }) {
  const notReady = !result || result.status !== 'ok';
  switch (node.type) {
    case 'webSource':
      return notReady ? <Waiting result={result} /> : <LiveView files={result!.outputs.files as FilesValue} />;
    case 'capture':
      return notReady ? <Waiting result={result} /> : <CaptureView node={node} capture={result!.outputs.capture as CaptureValue} />;
    case 'components':
    case 'filter':
      return notReady ? <Waiting result={result} /> : <SetView set={result!.outputs.components as ComponentSet} />;
    case 'pick':
      return <PickView node={node} result={result} />;
    case 'edit':
      return notReady ? <Waiting result={result} /> : <EditView node={node} set={result!.outputs.components as ComponentSet} />;
    case 'layout':
    case 'flow':
      return notReady ? <Waiting result={result} /> : <PagesView pages={result!.outputs.pages as PagesValue} />;
    case 'combine':
      return notReady ? <Waiting result={result} /> : <PagesView pages={result!.outputs.document as PagesValue} />;
    case 'export':
      return notReady ? <Waiting result={result} /> : <PagesView pages={result!.outputs.result as PagesValue} />;
    default:
      return null;
  }
}

function Waiting({ result }: { result?: NodeResult }) {
  if (!result) return <p className="muted" role="status">Running…</p>;
  return <p className={result.status === 'error' ? 'error-text' : 'muted'}>{result.message ?? 'Nothing to show yet.'}</p>;
}

/* ------------------------------------------------------------ frames */

/** Width available in the preview, for scaling pages down to fit. */
function useWidth(ref: React.RefObject<HTMLElement | null>) {
  const [w, setW] = useState(400);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(100, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

/** A frozen page with some components outlined; `onPick` gets the clicked element. */
function FrozenPage({ capture, outlined, onPick, title }: { capture: CaptureValue; outlined: string[]; onPick?: (el: Element) => void; title: string }) {
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => {
    const d = parse(capture.frozenHtml);
    const base = d.createElement('base');
    base.href = capture.baseUrl;
    d.head.insertBefore(base, d.head.firstChild);
    const style = d.createElement('style');
    style.textContent = '[data-ve-outline]{outline:2px solid #d97706!important;outline-offset:-2px}[data-ve-pickable] *{cursor:pointer!important}';
    d.head.appendChild(style);
    for (const id of outlined) d.querySelector(`[data-wp-id="${CSS.escape(id)}"]`)?.setAttribute('data-ve-outline', '');
    if (onPick) d.body.setAttribute('data-ve-pickable', '');
    return `<!DOCTYPE html>\n${d.documentElement.outerHTML}`;
  }, [capture, outlined, onPick]);
  const pickRef = useRef(onPick);
  pickRef.current = onPick;
  const s = Math.min(1, width / capture.analysis.captureWidthPx);
  const h = Math.max(200, capture.analysis.documentHeightPx);
  return (
    <div className="frame-box" ref={box} style={{ height: h * s }}>
      <iframe
        ref={frame}
        title={title}
        className="preview-frame"
        sandbox="allow-same-origin"
        srcDoc={html}
        style={{ width: capture.analysis.captureWidthPx, height: h, transform: `scale(${s})` }}
        onLoad={() => {
          const d = frame.current?.contentDocument;
          d?.addEventListener('click', (e) => {
            e.preventDefault();
            if (pickRef.current && e.target instanceof d.defaultView!.Element) pickRef.current(e.target);
          });
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------- per node */

function LiveView({ files, onSteps }: { files: FilesValue; onSteps?: (steps: SetupStep[]) => void }) {
  const host = useHost();
  const frame = useRef<HTMLIFrameElement>(null);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.data?.type !== 've-step' || e.source !== frame.current?.contentWindow) return;
      const step = e.data.step as SetupStep;
      setSteps((s) => {
        const last = s[s.length - 1];
        const same = last && last.action === step.action && last.selector === step.selector && step.action !== 'click';
        return same ? [...s.slice(0, -1), step] : [...s, step];
      });
    };
    addEventListener('message', on);
    return () => removeEventListener('message', on);
  }, []);
  const entry = files.sourceId === 'main' ? host.mainEntry : files.entry;
  return (
    <>
      {onSteps && (
        <div className="live-bar">
          <details className="steps">
            <summary className="muted" data-testid="node-recorded-steps">{steps.length} recorded step{steps.length === 1 ? '' : 's'}</summary>
            <ol>{steps.map((st, i) => <li key={i}>{describeStep(st)}</li>)}</ol>
          </details>
          <button type="button" className="primary" disabled={!steps.length} onClick={() => (onSteps(steps), setSteps([]))}>Capture this state</button>
        </div>
      )}
      <iframe
        ref={frame}
        title={`Live page: ${files.title}`}
        className="preview-frame live"
        sandbox={IS_STATIC ? 'allow-scripts allow-forms allow-same-origin' : 'allow-scripts allow-forms'}
        src={api.sourceLiveUrl(host.projectId, files.sourceId, entry)}
      />
    </>
  );
}

function CaptureView({ node, capture }: { node: GraphNode; capture: CaptureValue }) {
  const host = useHost();
  const [view, setView] = useState<'frozen' | 'live'>('frozen');
  const files = useInput<FilesValue>(node.id, 'files');
  const c = node.config as CaptureConfig;
  const record = (steps: SetupStep[]) => {
    setView('frozen');
    if (c.linked && files?.sourceId === 'main') void host.recaptureProject({ setupSteps: [...host.document.setupSteps, ...steps] });
    else editorStore.getState().updateConfig<CaptureConfig>(node.id, (x) => ({ ...x, setupSteps: [...x.setupSteps, ...steps] }));
  };
  return (
    <>
      <div role="tablist" aria-label="Capture view" className="tabs">
        <button role="tab" aria-selected={view === 'frozen'} onClick={() => setView('frozen')}>Frozen</button>
        <button role="tab" aria-selected={view === 'live'} disabled={!files} onClick={() => setView('live')}>Live</button>
      </div>
      {view === 'live' && files ? <LiveView files={files} onSteps={record} /> : <FrozenPage capture={capture} outlined={[]} title="Frozen page" />}
    </>
  );
}

function SetView({ set }: { set: ComponentSet }) {
  const outlined = useMemo(() => set.items.filter((c) => c.kind !== 'page').map((c) => c.rootWpId), [set]);
  return (
    <>
      <p className="muted small" data-testid="set-count">{set.items.length} component{set.items.length === 1 ? '' : 's'}, outlined on the page.</p>
      <FrozenPage capture={set.capture} outlined={outlined} title="Components on the page" />
    </>
  );
}

function PickView({ node, result }: { node: GraphNode; result?: NodeResult }) {
  const capture = useInput<CaptureValue>(node.id, 'capture');
  const set = result?.status === 'ok' ? (result.outputs.components as ComponentSet) : undefined;
  const outlined = useMemo(() => set?.items.map((c) => c.rootWpId) ?? [], [set]);
  if (!capture) return <Waiting result={result} />;
  const onPick = (el: Element) => {
    const n = nodeForElement(capture, el);
    if (!n) return;
    editorStore.getState().updateConfig<PickConfig>(node.id, (c) => ({ ...c, wpIds: c.wpIds.includes(n.wpId) ? c.wpIds.filter((x) => x !== n.wpId) : [...c.wpIds, n.wpId] }));
  };
  return (
    <>
      <p className="muted small">Click a component to pick it (or to take a clicked one out). {set ? `${set.items.length} picked.` : result?.message}</p>
      <FrozenPage capture={capture} outlined={outlined} onPick={onPick} title="Pick components" />
    </>
  );
}

/** One component on its own, with its edits; click a part to change it. */
function EditView({ node, set }: { node: GraphNode; set: ComponentSet }) {
  const [compId, setCompId] = useState<string>(() => set.items.find((c) => c.kind !== 'page')?.id ?? set.items[0]?.id ?? '');
  const [target, setTarget] = useState<{ wp: string; text: string | null } | null>(null);
  const def = set.items.find((c) => c.id === compId) ?? set.items[0];
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const frame = useRef<HTMLIFrameElement>(null);
  const html = useMemo(() => {
    if (!def) return '';
    const ov = set.overrides.filter((o) => o.componentId === def.id);
    const h = isolateComponent(parse, set.capture.frozenHtml, def, { widthPx: def.widthPx, overrides: ov, baseUrl: set.capture.baseUrl });
    return target ? h.replace('</head>', `<style>[data-wp-id="${target.wp}"]{outline:2px solid #be185d!important}</style></head>`) : h;
  }, [def, set, target]);
  if (!def) return <p className="muted">No components come into this node.</p>;
  const add = (o: Omit<Override, 'id' | 'componentId'>) =>
    editorStore.getState().updateConfig<EditConfig>(node.id, (c) => ({ ...c, overrides: [...c.overrides, { ...o, id: newId('ov'), componentId: def.id } as Override] }));
  const current = (type: Override['type'], prop?: string) =>
    set.overrides.find((o) => o.componentId === def.id && o.type === type && o.target === target?.wp && (o.type !== 'style' || o.prop === prop));
  const s = Math.min(1, width / def.widthPx);
  return (
    <>
      <label className="field">
        <span>Component</span>
        <select aria-label="Component to edit" value={def.id} onChange={(e) => (setCompId(e.target.value), setTarget(null))}>
          {set.items.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <div className="frame-box" ref={box} style={{ height: Math.max(60, def.heightPx) * s }}>
        <iframe
          ref={frame}
          title="Component to edit"
          className="preview-frame"
          sandbox="allow-same-origin"
          srcDoc={html}
          style={{ width: def.widthPx, height: Math.max(60, def.heightPx), transform: `scale(${s})` }}
          onLoad={() => {
            const d = frame.current?.contentDocument;
            d?.addEventListener('click', (e) => {
              e.preventDefault();
              const el = (e.target as Element).closest?.('[data-wp-id]');
              if (!el) return;
              const leaf = el.children.length === 0 && (el.textContent ?? '').trim() ? (el.textContent ?? '') : null;
              setTarget({ wp: el.getAttribute('data-wp-id')!, text: leaf });
            });
          }}
        />
      </div>
      {target ? (
        <div className="edit-target" data-testid="edit-target">
          {target.text !== null && (
            <label className="field">
              <span>Text</span>
              <textarea
                aria-label="Text"
                rows={2}
                key={`t-${target.wp}-${(current('text') as { value?: string } | undefined)?.value ?? target.text}`}
                defaultValue={(current('text') as { value?: string } | undefined)?.value ?? target.text}
                onBlur={(e) => e.target.value !== target.text && add({ type: 'text', target: target.wp, value: e.target.value, original: target.text! } as Omit<Override, 'id' | 'componentId'>)}
              />
            </label>
          )}
          <StyleInput label="Font size" prop="font-size" add={add} target={target.wp} value={(current('style', 'font-size') as { value?: string } | undefined)?.value ?? ''} />
          <StyleInput label="Colour" prop="color" add={add} target={target.wp} value={(current('style', 'color') as { value?: string } | undefined)?.value ?? ''} />
          <button type="button" onClick={() => add({ type: 'visibility', target: target.wp, hidden: true } as Omit<Override, 'id' | 'componentId'>)}>Hide this part</button>
        </div>
      ) : (
        <p className="muted small">Click a part of the component to edit it.</p>
      )}
    </>
  );
}

function StyleInput({ label, prop, value, target, add }: { label: string; prop: string; value: string; target: string; add: (o: Omit<Override, 'id' | 'componentId'>) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="text"
        aria-label={label}
        key={`${target}-${prop}-${value}`}
        defaultValue={value}
        onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== value && add({ type: 'style', target, prop, value: e.target.value.trim() } as Omit<Override, 'id' | 'componentId'>)}
      />
    </label>
  );
}

function PagesView({ pages }: { pages: PagesValue }) {
  const host = useHost();
  const box = useRef<HTMLDivElement>(null);
  const width = useWidth(box);
  const doc = pages.document;
  const t = trimMm(doc.pageSetup);
  const W = Math.ceil(mmToPx(t.width));
  const H = Math.ceil(mmToPx(t.height));
  const s = Math.min(1, (width - 2) / W);
  const htmls = useMemo(() => {
    const captures = Object.fromEntries(Object.entries(pages.captures).map(([k, c]) => [k, { frozenHtml: c.frozenHtml, baseUrl: c.baseUrl }]));
    const htmlFor = makeHtmlFor(host.projectId, pages.capture.frozenHtml, pages.capture.baseUrl, doc, { captures, overrides: pages.overrides });
    return doc.pages.map((p) => composePageHtml(doc, p.id, htmlFor));
  }, [doc, pages.capture, host.projectId]);
  return (
    <div ref={box} className="pages-preview">
      {htmls.map((h, i) => (
        <div key={i} className="frame-box page-thumb" style={{ height: H * s, width: W * s }}>
          <iframe title={`Page ${i + 1}`} className="preview-frame" sandbox="allow-same-origin" srcDoc={h} style={{ width: W, height: H, transform: `scale(${s})` }} />
        </div>
      ))}
    </div>
  );
}


export type { ComponentDef };
