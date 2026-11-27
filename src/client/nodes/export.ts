/** Exporting a node's pages: a file from the server, or the print dialog in the browser-only version. */
import { api } from '../api.js';
import { makeHtmlFor } from '../render.js';
import { composeDocumentHtml } from '../../compose/page.js';
import { mmToPx, trimMm } from '../../model/geometry.js';
import { IS_STATIC } from '../../static/env.js';
import { printHtml } from '../../static/capture.js';
import type { PagesValue } from './engine.js';
import { editorStore } from './store.js';

const save = (blob: Blob, name: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
};

const fileBase = (s: string) => s.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '') || 'export';

/** Export what `nodeId` makes. Resolves when the file is saved (or the print dialog closes). */
export async function exportNodePages(projectId: string, nodeId: string, format: 'pdf' | 'png', name: string, pageId?: string) {
  const state = editorStore.getState();
  if (IS_STATIC) {
    const r = state.results[nodeId];
    const v = (r?.outputs.result ?? r?.outputs.pages ?? r?.outputs.document) as PagesValue | undefined;
    if (!v) throw new Error(r?.message ?? 'Nothing to export yet');
    const captures = Object.fromEntries(Object.entries(v.captures).map(([k, c]) => [k, { frozenHtml: c.frozenHtml, baseUrl: c.baseUrl }]));
    const htmlFor = makeHtmlFor(projectId, v.capture.frozenHtml, v.capture.baseUrl, v.document, { captures, overrides: v.overrides });
    const t = trimMm(v.document.pageSetup);
    return printHtml(composeDocumentHtml(v.document, htmlFor), Math.ceil(mmToPx(t.width)), Math.ceil(mmToPx(t.height)));
  }
  const blob = await api.exportGraph(projectId, { graph: state.graph, nodeId, format, pageId, dpi: 300 });
  save(blob, `${fileBase(name)}.${format}`);
}
