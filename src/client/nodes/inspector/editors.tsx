/** One inspector editor per node type (Node CMS's `EDITORS` pattern, with this app's nodes). */
import { useState, type ComponentType } from 'react';
import { zipSync } from 'fflate';
import { api } from '../../api.js';
import { arrangeLooseFiles } from '../../../import/pure.js';
import { describeStep } from '../../../render/steps.js';
import type { GraphNode } from '../engine.js';
import type { ComponentKind, Override, Presets } from '../../../model/types.js';
import type { CaptureConfig } from '../../../graph/nodes/capture.js';
import type { ComponentsConfig } from '../../../graph/nodes/components.js';
import type { FilterConfig } from '../../../graph/nodes/filter.js';
import type { PickConfig } from '../../../graph/nodes/pick.js';
import type { EditConfig } from '../../../graph/nodes/edit.js';
import type { WebSourceConfig } from '../../../graph/nodes/web-source.js';
import { editorStore, useEditor } from '../store.js';
import { useHost } from '../host.js';
import { CheckboxField, SelectField, TextField } from './fields.js';

type EditorProps = { node: GraphNode };

const update = <C,>(id: string, patch: Partial<C>) => editorStore.getState().updateConfig<C>(id, (c) => ({ ...c, ...patch }));

const PRESET_LABELS: Record<keyof Presets, string> = {
  hideChrome: 'Hide sticky bars and cookie banners',
  expandInteractive: 'Expand tabs, accordions and carousels',
  printMedia: "Use the site's print styles",
  linkUrls: 'Show link addresses',
};

const toBase64 = (buf: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
};

/* ------------------------------------------------------------ Web Source */

function WebSourceEditor({ node }: EditorProps) {
  const host = useHost();
  const c = node.config as WebSourceConfig;
  const [html, setHtml] = useState('<h1>Hello</h1>\n<p>Paste your HTML here.</p>');
  const [css, setCss] = useState('');
  const [busy, setBusy] = useState('');
  if (c.sourceId === 'main') {
    return (
      <div className="node-editor">
        <p>
          The project’s own page, as captured in the <button type="button" className="link" onClick={host.openEditor}>Editor tab</button>.
        </p>
        <p className="muted small">To bring in another page, add a new Web Source node.</p>
      </div>
    );
  }
  const add = async (label: string, input: Record<string, unknown>) => {
    setBusy(label);
    try {
      const src = await api.addSource(host.projectId, input);
      editorStore.getState().updateConfig<WebSourceConfig>(node.id, { sourceId: src.id, title: src.title, entry: src.entry, hash: src.hash });
    } catch (e) {
      editorStore.getState().notify('error', (e as Error).message);
    } finally {
      setBusy('');
    }
  };
  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    if (files.length === 1 && /\.zip$/i.test(files[0]!.name)) {
      return add('Importing…', { type: 'zip', base64: toBase64(new Uint8Array(await files[0]!.arrayBuffer())), title: files[0]!.name });
    }
    const page = files.find((f) => /\.html?$/i.test(f.name));
    if (!page) return editorStore.getState().notify('error', 'Choose a .zip, or at least one .html file.');
    const loose: Record<string, Uint8Array> = {};
    for (const f of files) loose[f.name] = new Uint8Array(await f.arrayBuffer());
    return add('Importing…', { type: 'zip', base64: toBase64(zipSync(arrangeLooseFiles(loose))), title: page.name });
  };
  return (
    <div className="node-editor">
      <p className="current-page" data-testid="source-page">{c.sourceId ? <>Page: <strong>{c.title}</strong></> : <span className="muted">No page yet.</span>}</p>
      {busy && <p role="status" className="muted">{busy}</p>}
      {!c.sourceId && (
        <button type="button" onClick={() => editorStore.getState().updateConfig<WebSourceConfig>(node.id, { sourceId: 'main', title: '', entry: '', hash: '' })}>
          Use the project page
        </button>
      )}
      <label className="field">
        <span>{c.sourceId ? 'Replace with an .html or zip file' : 'An .html or zip file'}</span>
        <input
          type="file"
          multiple
          aria-label="Page file"
          accept=".html,.htm,.zip,.css,.js,.mjs,.json,.svg,.png,.jpg,.jpeg,.gif,.webp,.avif,.woff,.woff2,.ttf,.otf"
          onChange={(e) => {
            const input = e.currentTarget;
            void onFiles(input.files).finally(() => (input.value = ''));
          }}
        />
      </label>
      <details>
        <summary>Or paste code</summary>
        <label className="field"><span>HTML</span><textarea aria-label="Pasted HTML" rows={5} value={html} onChange={(e) => setHtml(e.target.value)} /></label>
        <label className="field"><span>CSS</span><textarea aria-label="Pasted CSS" rows={3} value={css} onChange={(e) => setCss(e.target.value)} /></label>
        <button type="button" disabled={!!busy} onClick={() => add('Importing…', { type: 'paste', html, css })}>Import pasted code</button>
      </details>
    </div>
  );
}

/* --------------------------------------------------------------- Capture */

function CaptureEditor({ node }: EditorProps) {
  const host = useHost();
  const c = node.config as CaptureConfig;
  const result = useEditor((s) => s.results[node.id]);
  const isMain = useEditor((s) => {
    const e = s.graph.edges.find((x) => x.target === node.id && x.targetPort === 'files');
    const src = e && s.graph.nodes.find((n) => n.id === e.source);
    return (src?.config as WebSourceConfig | undefined)?.sourceId === 'main';
  });
  const d = host.document;
  const settings = c.linked ? { captureWidthPx: d.captureWidthPx, presets: d.presets, setupSteps: d.setupSteps, rules: d.decomposition.rules } : c;
  const set = (patch: Partial<CaptureConfig>) => {
    if (c.linked) {
      const { rules, ...rest } = patch;
      void host.recaptureProject({ ...rest, ...(rules && { decomposition: { ...d.decomposition, rules } }) });
    } else update<CaptureConfig>(node.id, patch);
  };
  const [rule, setRule] = useState('');
  return (
    <div className="node-editor">
      {isMain && (
        <CheckboxField
          label="Use the Editor tab’s capture"
          checked={c.linked}
          hint={c.linked ? 'Changes here re-capture the project page for both tabs.' : 'This node captures with its own settings.'}
          onChange={(linked) => update<CaptureConfig>(node.id, linked ? { linked } : { linked, captureWidthPx: d.captureWidthPx, presets: { ...d.presets }, setupSteps: [...d.setupSteps], rules: [...d.decomposition.rules] })}
        />
      )}
      <label className="field">
        <span>Capture width (px)</span>
        <input
          type="number"
          min={200}
          max={4000}
          aria-label="Capture width (px)"
          key={`w-${settings.captureWidthPx}`}
          defaultValue={settings.captureWidthPx}
          onBlur={(e) => {
            const v = Math.round(Number(e.target.value));
            if (v >= 200 && v <= 4000 && v !== settings.captureWidthPx) set({ captureWidthPx: v });
          }}
        />
      </label>
      <fieldset>
        <legend>Print presets</legend>
        {(Object.keys(PRESET_LABELS) as Array<keyof Presets>).map((k) => (
          <CheckboxField key={k} label={PRESET_LABELS[k]} checked={settings.presets[k]} onChange={(v) => set({ presets: { ...settings.presets, [k]: v } })} />
        ))}
      </fieldset>
      <fieldset>
        <legend>Recorded steps</legend>
        {settings.setupSteps.length ? (
          <>
            <ol className="steps-list" data-testid="capture-steps">{settings.setupSteps.map((s, i) => <li key={i}>{describeStep(s)}</li>)}</ol>
            <button type="button" className="ghost" onClick={() => set({ setupSteps: [] })}>Clear steps</button>
          </>
        ) : (
          <p className="muted small">None. Use the preview’s Live view to click, tick and scroll, then “Capture this state”.</p>
        )}
      </fieldset>
      <fieldset>
        <legend>Component rules</legend>
        <ul className="rules">
          {settings.rules.map((r, i) => (
            <li key={i}>
              <code>{r.selector}</code> {r.action === 'component' ? 'always a component' : 'never a component'}{' '}
              <button type="button" className="link" onClick={() => set({ rules: settings.rules.filter((_, j) => j !== i) })}>Remove</button>
            </li>
          ))}
        </ul>
        <TextField label="CSS selector" value={rule} onChange={setRule} placeholder=".product-card" monospace />
        <div className="button-row">
          <button type="button" disabled={!rule.trim()} onClick={() => (set({ rules: [...settings.rules, { selector: rule.trim(), action: 'component' }] }), setRule(''))}>Always a component</button>
          <button type="button" disabled={!rule.trim()} onClick={() => (set({ rules: [...settings.rules, { selector: rule.trim(), action: 'ignore' }] }), setRule(''))}>Never</button>
        </div>
      </fieldset>
      {result?.status === 'ok' && <p className="muted small">The preview shows the frozen page; its Live view runs the page.</p>}
    </div>
  );
}

/* ------------------------------------------------------------ Components */

function ComponentsEditor({ node }: EditorProps) {
  const host = useHost();
  const c = node.config as ComponentsConfig;
  const granularity = c.linked ? host.document.decomposition.granularity : c.granularity;
  return (
    <div className="node-editor">
      <CheckboxField
        label="Use the Editor tab’s library"
        checked={c.linked}
        hint={c.linked ? 'The same components as the Editor tab’s library, with its content edits.' : 'This node’s own level of detail.'}
        onChange={(linked) => update<ComponentsConfig>(node.id, linked ? { linked } : { linked, granularity, split: [...host.document.decomposition.split], promoted: [...host.document.decomposition.promoted], demoted: [...host.document.decomposition.demoted], merged: [...host.document.decomposition.merged] })}
      />
      <label className="field">
        <span>Detail: {granularity}</span>
        <input
          type="range"
          min={1}
          max={4}
          value={granularity}
          aria-label="Detail"
          disabled={c.linked}
          onChange={(e) => update<ComponentsConfig>(node.id, { granularity: Number(e.target.value) })}
        />
      </label>
      {c.linked && <p className="muted small">Change the detail with the Editor tab’s slider, or untick to set it here.</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Pick */

function PickEditor({ node }: EditorProps) {
  const c = node.config as PickConfig;
  return (
    <div className="node-editor">
      <TextField label="CSS selector" value={c.selector} placeholder=".card, header" monospace onChange={(selector) => update<PickConfig>(node.id, { selector })} hint="Each match counts as the component it belongs to." />
      <CheckboxField label="Also pick similar ones" checked={c.similar} hint="Repeated siblings of each pick, such as every card in a row." onChange={(similar) => update<PickConfig>(node.id, { similar })} />
      <h3>Clicked in the preview</h3>
      {c.wpIds.length ? (
        <ul className="picked" data-testid="picked">
          {c.wpIds.map((id) => (
            <li key={id}>
              <code>{id}</code> <button type="button" className="link" onClick={() => update<PickConfig>(node.id, { wpIds: c.wpIds.filter((x) => x !== id) })}>Remove</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">Click components in the preview to add or remove them.</p>
      )}
      {(c.wpIds.length > 0 || c.selector) && <button type="button" className="ghost" onClick={() => update<PickConfig>(node.id, { wpIds: [], selector: '' })}>Clear</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ Edit */

const describeOverride = (o: Override) =>
  o.type === 'text' ? `Text: “${o.value.slice(0, 40)}”` : o.type === 'style' ? `${o.prop}: ${o.value}` : o.type === 'visibility' ? 'Hidden' : 'Image replaced';

function EditEditor({ node }: EditorProps) {
  const c = node.config as EditConfig;
  return (
    <div className="node-editor">
      <p className="muted small">Choose a component in the preview, click a part of it, then change its text or style, or hide it. The web page never changes.</p>
      {c.overrides.length ? (
        <ul className="overrides" data-testid="edits">
          {c.overrides.map((o) => (
            <li key={o.id}>
              <span>{describeOverride(o)}</span> <span className="muted small">{o.componentId}</span>{' '}
              <button type="button" className="link" onClick={() => update<EditConfig>(node.id, { overrides: c.overrides.filter((x) => x.id !== o.id) })}>Revert</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No edits yet.</p>
      )}
      {c.overrides.length > 0 && <button type="button" className="ghost" onClick={() => update<EditConfig>(node.id, { overrides: [] })}>Revert all</button>}
    </div>
  );
}

/* ---------------------------------------------------------------- Filter */

const KINDS: ComponentKind[] = ['header', 'nav', 'section', 'card', 'media', 'table', 'text', 'list', 'group', 'footer'];

function FilterEditor({ node }: EditorProps) {
  const c = node.config as FilterConfig;
  return (
    <div className="node-editor">
      <fieldset>
        <legend>Kinds to keep (none ticked: all)</legend>
        <div className="kinds">
          {KINDS.map((k) => (
            <CheckboxField key={k} label={k} checked={c.kinds.includes(k)} onChange={(on) => update<FilterConfig>(node.id, { kinds: on ? [...c.kinds, k] : c.kinds.filter((x) => x !== k) })} />
          ))}
        </div>
      </fieldset>
      <TextField label="Name contains" value={c.text} onChange={(text) => update<FilterConfig>(node.id, { text })} />
      <CheckboxField label="Leave out the whole page" checked={c.dropPage} onChange={(dropPage) => update<FilterConfig>(node.id, { dropPage })} />
      <SelectField
        label="Order"
        value={c.order}
        options={[
          { value: 'page', label: 'As on the page' },
          { value: 'reverse', label: 'Reversed' },
          { value: 'name', label: 'By name' },
        ]}
        onChange={(order) => update<FilterConfig>(node.id, { order })}
      />
      <label className="field">
        <span>Keep the first (empty: all)</span>
        <input
          type="number"
          min={0}
          aria-label="Keep the first"
          value={c.first ?? ''}
          onChange={(e) => update<FilterConfig>(node.id, { first: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))) })}
        />
      </label>
    </div>
  );
}

/* ------------------------------------------------------- Layout, Export */

function LayoutEditor({ node }: EditorProps) {
  const host = useHost();
  const linked = (node.config as { linked: boolean }).linked;
  return (
    <div className="node-editor">
      {linked ? (
        <>
          <p>These are the Editor tab’s pages.</p>
          <button type="button" className="primary" onClick={host.openEditor}>Edit pages</button>
        </>
      ) : (
        <p className="muted">Layouts of their own arrive in a later milestone (N4). Until then, the default Layout node shows the Editor tab’s pages.</p>
      )}
    </div>
  );
}

function ExportEditor() {
  const host = useHost();
  return (
    <div className="node-editor">
      <p>Export the pages from the <button type="button" className="link" onClick={host.openEditor}>Editor tab</button> for now; exporting from here arrives in a later milestone (N5).</p>
    </div>
  );
}

export const EDITORS: Record<string, ComponentType<EditorProps>> = {
  webSource: WebSourceEditor,
  capture: CaptureEditor,
  components: ComponentsEditor,
  pick: PickEditor,
  edit: EditEditor,
  filter: FilterEditor,
  layout: LayoutEditor,
  export: ExportEditor,
};
