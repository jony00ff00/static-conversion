import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseHTML } from 'linkedom';
import { isolateComponent } from '../compose/isolate.js';
import { composeDocumentHtml, composePageHtml, type HtmlFor } from '../compose/page.js';
import { computeSlices, type FlowLayout } from '../flow/breaks.js';
import { contentRectMm, mmToPx, trimMm } from '../model/geometry.js';
import { flowOntoPages, newEditorDocument, setChainSlices } from '../model/ops.js';
import type { Analysis, ComponentDef, EditorDocument, Snapshot } from '../model/types.js';
import { setExactPageSize } from '../export/pdf.js';
import { cropPng, setPngDpi } from '../export/png.js';
import { mmToDevicePx } from '../config/printDefaults.js';
import { importDirectory, importPaste, importUrl, importZip, type Imported } from '../import/index.js';
import { captureInSession, sourceUrl, withSandbox, type RenderSource } from '../render/sandbox.js';

const FLOW_JS = readFileSync(path.join(import.meta.dirname, '..', 'flow', 'layout.browser.js'), 'utf8');

export const DATA_DIR = process.env.VE_DATA_DIR ?? path.resolve(import.meta.dirname, '..', '..', 'data');
export const FIXTURES_DIR = path.resolve(import.meta.dirname, '..', '..', 'fixtures');

export interface ProjectMeta {
  id: string;
  title: string;
  source: RenderSource;
  importKind: Imported['kind'] | 'fixture';
  createdAt: string;
}

export interface ProjectState {
  meta: ProjectMeta;
  document: EditorDocument;
  analysis: Analysis;
  frozenHtml: string;
  bodyWpId: string;
  snapshots: Snapshot[];
}

export const parseDoc = (html: string) => parseHTML(html).document as unknown as Document;

const pdir = (id: string) => path.join(DATA_DIR, 'projects', id);
const safeId = (id: string) => {
  if (!/^[a-z0-9-]{4,64}$/.test(id)) throw new Error('bad project id');
  return id;
};

/** Print-resolution capture so canvases and screenshots are sharp in export. */
export const CAPTURE_SCALE = 300 / 96;

/** Capture, freeze and decompose the source at the document's capture width. */
export async function analyse(source: RenderSource, doc: Pick<EditorDocument, 'captureWidthPx' | 'presets' | 'setupSteps' | 'decomposition'>) {
  return withSandbox(source, { viewport: { width: doc.captureWidthPx, height: 900 }, scale: CAPTURE_SCALE, timeoutMs: 60_000 }, async (s) => {
    const cap = await captureInSession(s, sourceUrl(source), {
      fullPage: false,
      presets: doc.presets,
      setupSteps: doc.setupSteps,
      decompose: { rules: doc.decomposition.rules },
    });
    const d = cap.decomposition!;
    const warnings = [...(cap.fonts?.warnings ?? []), ...cap.stepErrors.map((e) => `Recorded step failed: ${e}`)];
    const analysis: Analysis = {
      captureWidthPx: doc.captureWidthPx,
      documentHeightPx: d.documentHeightPx,
      baseUrl: cap.baseUrl,
      pageBg: d.pageBg,
      nodes: d.nodes,
      warnings,
    };
    return { analysis, frozenHtml: cap.html, bodyWpId: d.bodyWpId, presetReport: cap.presetReport };
  });
}

export async function createProject(input: {
  type: 'fixture' | 'paste' | 'zip' | 'url' | 'directory';
  name?: string;
  html?: string;
  css?: string;
  js?: string;
  base64?: string;
  url?: string;
  path?: string;
  title?: string;
}): Promise<ProjectState> {
  const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const dir = pdir(id);
  await mkdir(dir, { recursive: true });
  let imported: Imported;
  let title = input.title ?? '';
  if (input.type === 'fixture') {
    if (!input.name || !/^[\w-]+$/.test(input.name)) throw new Error('bad fixture name');
    imported = await importDirectory(path.join(FIXTURES_DIR, input.name));
    title ||= input.name;
  } else if (input.type === 'directory') {
    imported = await importDirectory(input.path!);
    title ||= path.basename(input.path!);
  } else if (input.type === 'paste') {
    imported = await importPaste({ html: input.html ?? '', css: input.css, js: input.js }, { parentDir: dir });
    title ||= 'Pasted page';
  } else if (input.type === 'zip') {
    imported = await importZip(Buffer.from(input.base64 ?? '', 'base64'), { parentDir: dir });
    title ||= 'Zip import';
  } else {
    imported = await importUrl(input.url ?? '', { parentDir: dir });
    title ||= input.url ?? 'URL import';
  }
  const meta: ProjectMeta = { id, title, source: imported.source, importKind: input.type === 'fixture' ? 'fixture' : imported.kind, createdAt: new Date().toISOString() };
  // Default capture width: the content-area width (text keeps its size on paper).
  const probe = newEditorDocument({ captureWidthPx: 680, documentHeightPx: 1, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] }, 'x', 680);
  const captureWidthPx = Math.round(mmToPx(contentRectMm(probe.pageSetup).w));
  const a = await analyse(imported.source, { ...probe, captureWidthPx });
  const document = newEditorDocument(a.analysis, a.bodyWpId, captureWidthPx);
  const state: ProjectState = { meta, document, analysis: a.analysis, frozenHtml: a.frozenHtml, bodyWpId: a.bodyWpId, snapshots: [] };
  await saveProject(state);
  return state;
}

export async function saveProject(s: ProjectState) {
  const dir = pdir(safeId(s.meta.id));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, 'meta.json'), JSON.stringify(s.meta, null, 2)),
    writeFile(path.join(dir, 'document.json'), JSON.stringify(s.document)),
    writeFile(path.join(dir, 'analysis.json'), JSON.stringify(s.analysis)),
    writeFile(path.join(dir, 'frozen.html'), s.frozenHtml),
    writeFile(path.join(dir, 'state.json'), JSON.stringify({ bodyWpId: s.bodyWpId })),
    writeFile(path.join(dir, 'snapshots.json'), JSON.stringify(s.snapshots)),
  ]);
}

export async function loadProject(id: string): Promise<ProjectState> {
  const dir = pdir(safeId(id));
  if (!existsSync(dir)) throw Object.assign(new Error('project not found'), { status: 404 });
  const [meta, document, analysis, frozenHtml, state, snapshots] = await Promise.all([
    readFile(path.join(dir, 'meta.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'document.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'analysis.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'frozen.html'), 'utf8'),
    readFile(path.join(dir, 'state.json'), 'utf8').then(JSON.parse),
    readFile(path.join(dir, 'snapshots.json'), 'utf8').then(JSON.parse).catch(() => []),
  ]);
  return { meta, document, analysis, frozenHtml, bodyWpId: state.bodyWpId, snapshots };
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const root = path.join(DATA_DIR, 'projects');
  if (!existsSync(root)) return [];
  const ids = await readdir(root);
  const metas = await Promise.all(ids.map((id) => readFile(path.join(root, id, 'meta.json'), 'utf8').then(JSON.parse).catch(() => null)));
  return metas.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Re-run capture after capture width, presets, rules or recorded steps change. */
export async function recapture(s: ProjectState, patch: Partial<Pick<EditorDocument, 'captureWidthPx' | 'presets' | 'setupSteps' | 'decomposition'>>) {
  const document = { ...s.document, ...patch };
  const a = await analyse(s.meta.source, document);
  // The whole-page component follows the new capture.
  const page = document.components.page;
  if (page) document.components.page = { ...page, widthPx: a.analysis.captureWidthPx, heightPx: a.analysis.documentHeightPx, bg: a.analysis.pageBg, rootWpId: a.bodyWpId };
  const next: ProjectState = { ...s, document, analysis: a.analysis, frozenHtml: a.frozenHtml, bodyWpId: a.bodyWpId };
  await saveProject(next);
  return { state: next, presetReport: a.presetReport };
}

/* -------------------------------------------------------- server rendering */

export function htmlForServer(s: Pick<ProjectState, 'frozenHtml' | 'analysis' | 'document'>): HtmlFor {
  const cache = new Map<string, string>();
  return (def: ComponentDef, widthPx: number) => {
    const key = `${def.id}|${widthPx.toFixed(3)}`;
    let html = cache.get(key);
    if (!html) {
      html = isolateComponent(parseDoc, s.frozenHtml, def, {
        widthPx,
        overrides: s.document.overrides.filter((o) => o.componentId === def.id),
        baseUrl: s.analysis.baseUrl,
      });
      cache.set(key, html);
    }
    return html;
  };
}

/** Render composed pages (PDF or one page as PNG) in the sandbox, at the source origin. */
export async function renderPages(
  s: ProjectState,
  opts: { format: 'pdf' } | { format: 'png'; pageId: string; dpi?: number; editorFrame?: boolean },
): Promise<Buffer> {
  const t = trimMm(s.document.pageSetup);
  const dpi = opts.format === 'png' ? opts.dpi ?? 300 : 300;
  const scale = dpi / 96;
  return withSandbox(s.meta.source, { viewport: { width: Math.ceil(mmToPx(t.width)), height: Math.ceil(mmToPx(t.height)) }, scale, timeoutMs: 120_000 }, async (sb) => {
    const htmlFor = htmlForServer(s);
    let html = opts.format === 'pdf' ? composeDocumentHtml(s.document, htmlFor) : composePageHtml(s.document, opts.pageId, htmlFor);
    if (opts.format === 'png' && opts.editorFrame) {
      // Proof: draw the page inside a page iframe, the same structure as the
      // editor, so the two can be compared pixel for pixel.
      const esc = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      html = `<!DOCTYPE html><html><head><style>html,body{margin:0}iframe{border:0;display:block;width:${Math.ceil(mmToPx(t.width))}px;height:${Math.ceil(mmToPx(t.height))}px}</style></head><body><iframe sandbox="allow-same-origin" srcdoc="${esc}"></iframe></body></html>`;
    }
    const url = sb.serve('pages.html', html);
    await sb.page.emulateMedia({ media: 'screen' });
    await sb.page.goto(url, { waitUntil: 'load' });
    await sb.page.evaluate('document.fonts.ready');
    for (const f of sb.page.frames()) await f.evaluate('document.fonts && document.fonts.ready').catch(() => undefined);
    if (opts.format === 'pdf') {
      const raw = await sb.page.pdf({ preferCSSPageSize: true, printBackground: true });
      return setExactPageSize(raw, t.width, t.height);
    }
    const w = mmToDevicePx(t.width, dpi);
    const h = mmToDevicePx(t.height, dpi);
    const shot = await sb.page.screenshot({ clip: { x: 0, y: 0, width: Math.ceil(w / scale), height: Math.ceil(h / scale) }, animations: 'disabled', caret: 'hide' });
    return setPngDpi(cropPng(shot, w, h), dpi);
  });
}

/** Measure flow layout of a component laid out at `widthPx`. */
export async function measureFlow(s: ProjectState, def: ComponentDef, widthPx: number): Promise<FlowLayout> {
  return withSandbox(s.meta.source, { viewport: { width: Math.ceil(widthPx), height: 900 }, timeoutMs: 60_000 }, async (sb) => {
    const html = htmlForServer(s)(def, widthPx);
    const url = sb.serve('flow.html', html);
    await sb.page.goto(url, { waitUntil: 'load' });
    await sb.page.evaluate('document.fonts.ready');
    return (await sb.page.evaluate(FLOW_JS)) as FlowLayout;
  });
}

/** Auto-paginate a component onto as many full-content-area pages as needed. */
export async function autoPaginate(s: ProjectState, componentId: string, startPageId: string) {
  const def = s.document.components[componentId];
  if (!def) throw new Error(`unknown component ${componentId}`);
  const c = contentRectMm(s.document.pageSetup);
  const layout = await measureFlow(s, def, mmToPx(c.w));
  const probe = computeSlices(layout, [{ placementId: 'probe', heightPx: mmToPx(c.h) }], { unlimited: true });
  const pageCount = probe.filter((x) => x.endPx > x.startPx).length || 1;
  let doc = flowOntoPages(s.document, componentId, startPageId, pageCount);
  const chain = doc.chains[doc.chains.length - 1]!;
  const frames = chain.placementIds.map((id) => ({ placementId: id, heightPx: mmToPx(doc.placements.find((p) => p.id === id)!.hMm) }));
  doc = setChainSlices(doc, chain.id, computeSlices(layout, frames));
  return { document: doc, layout, chainId: chain.id };
}

/** Recompute slices for an existing chain (after frames were linked, moved or resized). */
export async function reflowChain(s: ProjectState, chainId: string) {
  const chain = s.document.chains.find((c) => c.id === chainId);
  if (!chain) throw new Error(`unknown chain ${chainId}`);
  const def = s.document.components[chain.componentId]!;
  const frames = chain.placementIds.map((id) => s.document.placements.find((p) => p.id === id)!);
  const width = mmToPx(frames[0]!.wMm); // frames in a chain share the first frame's width for layout
  const layout = await measureFlow(s, def, width);
  const slices = computeSlices(layout, frames.map((f) => ({ placementId: f.id, heightPx: mmToPx(f.hMm) })));
  return { document: setChainSlices(s.document, chainId, slices), layout };
}
