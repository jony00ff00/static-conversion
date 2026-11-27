/**
 * The editor API, implemented entirely in the browser for the static build:
 * projects and their files live in IndexedDB, capture and flow measurement run
 * in hidden iframes, and export opens the browser's print dialog.
 */
import { unzipSync } from 'fflate';
import type { ProjectPayload, SourceCapture, SourceInfo } from '../client/api.js';
import type { CaptureSettings } from '../graph/values.js';
import { hashString } from '../graph/hash.js';
import { makeHtmlFor } from '../client/render.js';
import { composeDocumentHtml } from '../compose/page.js';
import { autoPaginateDoc, reflowChainDoc } from '../flow/paginate.js';
import { ZIP_LIMITS, buildPastedHtml, pickEntry, safeZipPath } from '../import/pure.js';
import { contentRectMm, mmToPx, trimMm } from '../model/geometry.js';
import { newEditorDocument } from '../model/ops.js';
import type { Analysis, EditorDocument, Snapshot } from '../model/types.js';
import { EditorDocumentSchema } from '../server/validate.js';
import { captureInBrowser, measureFlowInBrowser, printHtml } from './capture.js';
import { appBase, vfsUrl } from './env.js';
import { idbGet, idbGetAll, idbPut, idbPutMany, type StoredFile } from './idb.js';
import { MIME_BY_EXT } from './mime.js';

interface StaticProject {
  meta: { id: string; title: string; importKind: string; createdAt: string; source: { kind: 'browser'; entry: string } };
  document: EditorDocument;
  analysis: Analysis;
  frozenHtml: string;
  bodyWpId: string;
  snapshots: Snapshot[];
  /** Nodes tab: the stored graph, and pages added in Web Source nodes. */
  graph?: unknown;
  sources?: Record<string, SourceInfo>;
}

/** Imported files, with a title and the entry page. */
async function importFiles(input: Record<string, unknown>): Promise<{ files: Record<string, Uint8Array>; title: string; entry: string; type: string }> {
  let files: Record<string, Uint8Array>;
  let title = String(input.title ?? '');
  const type = String(input.type);
  if (type === 'fixture') {
    const name = String(input.name ?? '');
    if (!/^[\w-]+$/.test(name)) throw new Error('bad fixture name');
    files = await fixtureFiles(name);
    title ||= name;
  } else if (type === 'paste') {
    files = { 'index.html': new TextEncoder().encode(buildPastedHtml({ html: String(input.html ?? ''), css: input.css as string, js: input.js as string })) };
    title ||= 'Pasted page';
  } else if (type === 'zip') {
    files = zipFiles(String(input.base64 ?? ''));
    title ||= 'Zip import';
  } else if (type === 'url') {
    throw new Error(UNSUPPORTED_URL);
  } else {
    throw new Error(`Import type "${type}" is not available in the browser version.`);
  }
  const entry = pickEntry(Object.keys(files).filter((f) => /\.html?$/i.test(f)));
  if (!entry) throw new Error('No .html file found in the import.');
  return { files, title, entry, type };
}

const storeFiles = (folder: string, files: Record<string, Uint8Array>) =>
  idbPutMany(
    'files',
    Object.entries(files).map(([rel, data]): [string, StoredFile] => [`${folder}/${rel}`, { type: mimeOf(rel), data }]),
  );

/** The service-worker folder a project page lives in ("main" is the project's own). */
const sourceFolder = (projectId: string, sourceId: string) => (sourceId === 'main' ? projectId : `${projectId}--${sourceId}`);

function entryOf(p: StaticProject, sourceId: string): string {
  if (sourceId === 'main') return p.meta.source.entry;
  const src = p.sources?.[sourceId];
  if (!src) throw new Error('That page is not in this project any more');
  return src.entry;
}

export const UNSUPPORTED_URL =
  'Importing from a web address needs the local version (browsers block reading other sites). Save the page and import it as a zip instead.';

const mimeOf = (p: string) => MIME_BY_EXT[/\.[^./]+$/.exec(p)?.[0].toLowerCase() ?? ''] ?? '';

async function load(id: string): Promise<StaticProject> {
  const p = await idbGet<StaticProject>('projects', id);
  if (!p) throw new Error('Project not found in this browser.');
  return p;
}

const save = (p: StaticProject) => idbPut('projects', p.meta.id, p);

const payload = (p: StaticProject, presetReport?: ProjectPayload['presetReport']): ProjectPayload => ({
  meta: p.meta,
  document: p.document,
  analysis: p.analysis,
  bodyWpId: p.bodyWpId,
  snapshots: p.snapshots.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
  liveAvailable: true,
  presetReport: presetReport ?? null,
});

type CaptureDoc = Pick<EditorDocument, 'captureWidthPx' | 'presets' | 'setupSteps' | 'decomposition'>;

async function analyse(projectId: string, entry: string, doc: CaptureDoc) {
  const cap = await captureInBrowser(vfsUrl(projectId, entry), {
    widthPx: doc.captureWidthPx,
    presets: doc.presets,
    setupSteps: doc.setupSteps,
    rules: doc.decomposition.rules,
  });
  const d = cap.decomposition;
  const analysis: Analysis = {
    captureWidthPx: doc.captureWidthPx,
    documentHeightPx: d.documentHeightPx,
    baseUrl: cap.baseUrl,
    pageBg: d.pageBg,
    nodes: d.nodes,
    warnings: cap.warnings,
  };
  return { analysis, frozenHtml: cap.html, bodyWpId: d.bodyWpId, presetReport: cap.presetReport };
}

/* ----------------------------------------------------------------- imports */

let fixtureIndex: Promise<Record<string, string[]>> | null = null;
const fixtures = () =>
  (fixtureIndex ??= fetch(`${appBase()}fixtures.json`).then((r) => {
    if (!r.ok) throw new Error('Could not load the test pages.');
    return r.json() as Promise<Record<string, string[]>>;
  }));

async function fixtureFiles(name: string): Promise<Record<string, Uint8Array>> {
  const list = (await fixtures())[name];
  if (!list) throw new Error(`Unknown test page ${name}`);
  const out: Record<string, Uint8Array> = {};
  await Promise.all(
    list.map(async (rel) => {
      const r = await fetch(`${appBase()}fixtures/${name}/${rel.split('/').map(encodeURIComponent).join('/')}`);
      if (!r.ok) throw new Error(`Could not load ${name}/${rel}`);
      out[rel] = new Uint8Array(await r.arrayBuffer());
    }),
  );
  return out;
}

function zipFiles(base64: string): Record<string, Uint8Array> {
  const bin = atob(base64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  let count = 0;
  let total = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(buf, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (count > ZIP_LIMITS.maxFiles) throw new Error(`Zip has more than ${ZIP_LIMITS.maxFiles} files.`);
        if (f.originalSize > ZIP_LIMITS.maxFileBytes) throw new Error(`"${f.name}" is larger than ${ZIP_LIMITS.maxFileBytes / 1024 / 1024} MB.`);
        if (total > ZIP_LIMITS.maxTotalBytes) throw new Error(`Zip expands to more than ${ZIP_LIMITS.maxTotalBytes / 1024 / 1024} MB.`);
        return true;
      },
    });
  } catch (e) {
    const m = (e as Error).message;
    throw new Error(/^(Zip|")/.test(m) ? m : `Could not read zip: ${m}`);
  }
  const out: Record<string, Uint8Array> = {};
  const rejected: string[] = [];
  for (const [name, data] of Object.entries(files)) {
    const safe = safeZipPath(name);
    if (!safe) rejected.push(name);
    else if (!safe.split('/').some((p) => p.startsWith('.') || p === '__MACOSX')) out[safe] = data;
  }
  if (rejected.length) throw new Error(`Zip contains unsafe paths: ${rejected.slice(0, 5).join(', ')}`);
  return out;
}

/* --------------------------------------------------------------------- api */

const isolatedFor = (p: StaticProject, doc: EditorDocument) => makeHtmlFor(p.meta.id, p.frozenHtml, p.analysis.baseUrl, doc);
const measure = (p: StaticProject, doc: EditorDocument) => (def: Parameters<ReturnType<typeof isolatedFor>>[0], widthPx: number) =>
  measureFlowInBrowser(isolatedFor(p, doc)(def, widthPx), widthPx);

export const staticApi = {
  fixtures: async () => Object.keys(await fixtures()).sort(),

  projects: async () =>
    (await idbGetAll<StaticProject>('projects'))
      .map((p) => ({ id: p.meta.id, title: p.meta.title, createdAt: p.meta.createdAt }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),

  create: async (input: Record<string, unknown>): Promise<ProjectPayload> => {
    const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const { files, title, entry, type } = await importFiles(input);
    await storeFiles(id, files);
    const probe = newEditorDocument({ captureWidthPx: 680, documentHeightPx: 1, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] }, 'x', 680);
    const captureWidthPx = Math.round(mmToPx(contentRectMm(probe.pageSetup).w));
    const a = await analyse(id, entry, { ...probe, captureWidthPx });
    const p: StaticProject = {
      meta: { id, title, importKind: type, createdAt: new Date().toISOString(), source: { kind: 'browser', entry } },
      document: newEditorDocument(a.analysis, a.bodyWpId, captureWidthPx),
      analysis: a.analysis,
      frozenHtml: a.frozenHtml,
      bodyWpId: a.bodyWpId,
      snapshots: [],
    };
    await save(p);
    return payload(p);
  },

  load: async (id: string) => payload(await load(id)),
  frozen: async (id: string) => (await load(id)).frozenHtml,

  save: async (id: string, document: EditorDocument) => {
    const parsed = EditorDocumentSchema.safeParse(document);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'invalid document');
    await save({ ...(await load(id)), document: parsed.data });
    return { ok: true as const };
  },

  recapture: async (id: string, patch: Partial<EditorDocument>) => {
    const s = await load(id);
    const document = { ...s.document, ...patch };
    const a = await analyse(id, s.meta.source.entry, document);
    const page = document.components.page;
    if (page) document.components.page = { ...page, widthPx: a.analysis.captureWidthPx, heightPx: a.analysis.documentHeightPx, bg: a.analysis.pageBg, rootWpId: a.bodyWpId };
    const next: StaticProject = { ...s, document, analysis: a.analysis, frozenHtml: a.frozenHtml, bodyWpId: a.bodyWpId };
    await save(next);
    return payload(next, a.presetReport);
  },

  proof: async (): Promise<Blob> => {
    throw new Error('Proof needs the local version.');
  },

  /** Opens the print dialog (choose "Save as PDF"); there is no file to download. */
  exportPdf: async (id: string): Promise<Blob | null> => {
    const p = await load(id);
    const t = trimMm(p.document.pageSetup);
    await printHtml(composeDocumentHtml(p.document, isolatedFor(p, p.document)), Math.ceil(mmToPx(t.width)), Math.ceil(mmToPx(t.height)));
    return null;
  },

  paginate: async (id: string, componentId: string, pageId: string, document: EditorDocument) => {
    const p = await load(id);
    const doc = EditorDocumentSchema.parse(document);
    const r = await autoPaginateDoc(doc, componentId, pageId, measure(p, doc));
    await save({ ...p, document: r.document });
    return { document: r.document, chainId: r.chainId };
  },

  reflowChain: async (id: string, chainId: string, document: EditorDocument) => {
    const p = await load(id);
    const doc = EditorDocumentSchema.parse(document);
    const r = await reflowChainDoc(doc, chainId, measure(p, doc));
    await save({ ...p, document: r.document });
    return { document: r.document };
  },

  snapshot: async (id: string, name: string) => {
    const p = await load(id);
    const snap = { id: `snap-${Date.now().toString(36)}`, name: name || 'Snapshot', createdAt: new Date().toISOString(), document: p.document };
    await save({ ...p, snapshots: [...p.snapshots, snap] });
    return { id: snap.id, name: snap.name, createdAt: snap.createdAt };
  },

  graph: async (id: string) => (await load(id)).graph ?? null,

  saveGraph: async (id: string, stored: unknown) => {
    await save({ ...(await load(id)), graph: stored });
    return { ok: true as const };
  },

  addSource: async (id: string, input: Record<string, unknown>): Promise<SourceInfo> => {
    const p = await load(id);
    const { files, title, entry } = await importFiles(input);
    const sid = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    await storeFiles(sourceFolder(id, sid), files);
    const info: SourceInfo = { id: sid, title, entry, hash: hashString(JSON.stringify([input.type, input.html, input.css, input.js, input.base64, input.name])) };
    await save({ ...(await load(id)), sources: { ...(p.sources ?? {}), [sid]: info } });
    return info;
  },

  /** Capture a project page with a Capture node's settings, in a hidden iframe; kept in IndexedDB by source and settings. */
  captureSource: async (id: string, sourceId: string, settings: CaptureSettings): Promise<SourceCapture> => {
    const p = await load(id);
    const key = `capture:${id}:${hashString(JSON.stringify([sourceId, p.sources?.[sourceId]?.hash ?? '', settings]))}`;
    const hit = await idbGet<SourceCapture>('files', key);
    if (hit) return hit;
    const cap = await captureInBrowser(vfsUrl(sourceFolder(id, sourceId), entryOf(p, sourceId)), {
      widthPx: settings.captureWidthPx,
      presets: settings.presets,
      setupSteps: settings.setupSteps,
      rules: settings.rules,
    });
    const out: SourceCapture = { analysis: { captureWidthPx: settings.captureWidthPx, documentHeightPx: cap.decomposition.documentHeightPx, baseUrl: cap.baseUrl, pageBg: cap.decomposition.pageBg, nodes: cap.decomposition.nodes, warnings: cap.warnings }, frozenHtml: cap.html, bodyWpId: cap.decomposition.bodyWpId, presetReport: cap.presetReport };
    await idbPut('files', key, out);
    return out;
  },

  /** In the browser build the capture already ran at the service-worker URL its files live at. */
  sourceBaseUrl: (_id: string, _sourceId: string, analysisBaseUrl: string) => analysisBaseUrl,

  sourceLiveUrl: (id: string, sourceId: string, entry: string) => vfsUrl(sourceFolder(id, sourceId), entry, 'live'),

  restore: async (id: string, snapId: string) => {
    const p = await load(id);
    const snap = p.snapshots.find((x) => x.id === snapId);
    if (!snap) throw new Error('snapshot not found');
    await save({ ...p, document: snap.document });
    return { document: snap.document };
  },
};
