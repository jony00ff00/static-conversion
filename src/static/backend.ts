/**
 * The editor API, implemented entirely in the browser for the static build:
 * projects and their files live in IndexedDB, capture and flow measurement run
 * in hidden iframes, and export opens the browser's print dialog.
 */
import { unzipSync } from 'fflate';
import type { ProjectPayload } from '../client/api.js';
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
    await idbPutMany(
      'files',
      Object.entries(files).map(([rel, data]): [string, StoredFile] => [`${id}/${rel}`, { type: mimeOf(rel), data }]),
    );
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

  restore: async (id: string, snapId: string) => {
    const p = await load(id);
    const snap = p.snapshots.find((x) => x.id === snapId);
    if (!snap) throw new Error('snapshot not found');
    await save({ ...p, document: snap.document });
    return { document: snap.document };
  },
};
