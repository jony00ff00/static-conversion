import type { Analysis, EditorDocument } from '../model/types.js';
import type { CaptureSettings } from '../graph/values.js';
import { IS_STATIC } from '../static/env.js';
import { staticApi } from '../static/backend.js';

/** A page added in a Web Source node. */
export interface SourceInfo {
  id: string;
  title: string;
  entry: string;
  hash: string;
}

/** A capture made for a Capture node (base URL as the server saw it; the client maps it). */
export interface SourceCapture {
  analysis: Analysis;
  frozenHtml: string;
  bodyWpId: string;
  presetReport: { hidden: number; expanded: number; links: number } | null;
}

export interface ProjectPayload {
  meta: { id: string; title: string; importKind: string; createdAt: string; source: { kind: string } };
  document: EditorDocument;
  analysis: Analysis;
  bodyWpId: string;
  snapshots: Array<{ id: string; name: string; createdAt: string }>;
  liveAvailable: boolean;
  presetReport?: { hidden: number; expanded: number; links: number } | null;
}

async function json<T>(r: Response): Promise<T> {
  if (!r.ok) {
    const e = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(e.error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const serverApi = {
  fixtures: () => fetch('/api/fixtures').then((r) => json<string[]>(r)),
  projects: () => fetch('/api/projects').then((r) => json<Array<{ id: string; title: string; createdAt: string }>>(r)),
  create: (input: Record<string, unknown>) => post('/api/projects', input).then((r) => json<ProjectPayload>(r)),
  load: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<ProjectPayload>(r)),
  frozen: (id: string) => fetch(`/api/projects/${id}/frozen`).then((r) => r.text()),
  save: (id: string, document: EditorDocument) =>
    fetch(`/api/projects/${id}/document`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ document }) }).then((r) =>
      json<{ ok: true }>(r),
    ),
  recapture: (id: string, patch: Partial<EditorDocument>) => post(`/api/projects/${id}/recapture`, patch).then((r) => json<ProjectPayload>(r)),
  proof: (id: string, pageId: string) => post(`/api/projects/${id}/proof`, { pageId }).then((r) => r.blob()),
  exportPdf: (id: string): Promise<Blob | null> => post(`/api/projects/${id}/export`, { format: 'pdf' }).then((r) => r.blob()),
  paginate: (id: string, componentId: string, pageId: string, document: EditorDocument) =>
    post(`/api/projects/${id}/paginate`, { componentId, pageId, document }).then((r) => json<{ document: EditorDocument; chainId: string }>(r)),
  reflowChain: (id: string, chainId: string, document: EditorDocument) =>
    post(`/api/projects/${id}/chains/${chainId}/reflow`, { document }).then((r) => json<{ document: EditorDocument }>(r)),
  snapshot: (id: string, name: string) => post(`/api/projects/${id}/snapshots`, { name }).then((r) => json<{ id: string; name: string; createdAt: string }>(r)),
  restore: (id: string, snapId: string) => post(`/api/projects/${id}/snapshots/${snapId}/restore`, {}).then((r) => json<{ document: EditorDocument }>(r)),
  /** Nodes tab: the stored graph (null before the project has one). */
  graph: (id: string) => fetch(`/api/projects/${id}/graph`).then((r) => json<{ stored: unknown }>(r)).then((r) => r.stored),
  saveGraph: (id: string, stored: unknown) =>
    fetch(`/api/projects/${id}/graph`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stored }) }).then((r) => json<{ ok: true }>(r)),
  addSource: (id: string, input: Record<string, unknown>) => post(`/api/projects/${id}/sources`, input).then((r) => json<SourceInfo>(r)),
  captureSource: (id: string, sourceId: string, settings: CaptureSettings) => post(`/api/projects/${id}/sources/${sourceId}/capture`, settings).then((r) => json<SourceCapture>(r)),
  /** Where a source's files are served, given the page URL its capture saw (for images, styles and fonts). */
  sourceBaseUrl: (id: string, sourceId: string, analysisBaseUrl: string) => {
    let pathname = '/';
    try {
      pathname = new URL(analysisBaseUrl).pathname;
    } catch {
      /* keep / */
    }
    return sourceId === 'main' ? `${location.origin}/api/projects/${id}/src${pathname}` : `${location.origin}/api/projects/${id}/sources/${sourceId}/src${pathname}`;
  },
  /** The live (scripts running) preview of a source's entry page. */
  sourceLiveUrl: (id: string, sourceId: string, entry: string) =>
    sourceId === 'main' ? `/api/projects/${id}/live/${entry}` : `/api/projects/${id}/sources/${sourceId}/live/${entry}`,
};

/** The server API, or (GitHub Pages build) the same calls implemented in the browser. */
export const api: typeof serverApi = IS_STATIC ? staticApi : serverApi;
