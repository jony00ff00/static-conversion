/**
 * The node graph on the server: the same engine the editor runs, with server services (captures through the disk
 * cache, flow measured in the sandbox), and exporting a node's pages as PDF or PNG. Pages added in the Nodes tab
 * are served to the sandbox under /__src/<id>/, so one document can mix them.
 */
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isolateComponent } from '../compose/isolate.js';
import type { HtmlFor } from '../compose/page.js';
import type { FlowLayout } from '../flow/breaks.js';
import { GraphEvaluator, REGISTRY, hashString, type Graph, type GraphServices, type PagesValue, type ProjectSnapshot } from '../graph/index.js';
import { extraSourceBase, FIXTURE_ORIGIN, withSandbox } from '../render/sandbox.js';
import { captureSource, listSources, renderDocument, type ProjectState } from './projects.js';

const FLOW_JS = readFileSync(path.join(import.meta.dirname, '..', 'flow', 'layout.browser.js'), 'utf8');
const parseDoc = (html: string) => parseHTML(html).document as unknown as Document;

/** The project page as nodes linked to the Editor tab see it. */
export function projectSnapshot(s: ProjectState): ProjectSnapshot {
  const d = s.document;
  return {
    title: s.meta.title,
    document: d,
    capture: {
      sourceId: 'main',
      key: `main:${hashString(s.frozenHtml)}`,
      settings: { captureWidthPx: s.analysis.captureWidthPx, presets: d.presets, setupSteps: d.setupSteps, rules: d.decomposition.rules },
      analysis: s.analysis,
      frozenHtml: s.frozenHtml,
      bodyWpId: s.bodyWpId,
      baseUrl: s.analysis.baseUrl,
    },
  };
}

/** Folders of the project's added pages, for the sandbox. */
export async function extraDirsOf(s: ProjectState): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [id, src] of Object.entries(await listSources(s.meta.id))) if (src.source.kind === 'dir') out[id] = src.source.root;
  return out;
}

export async function serverServices(s: ProjectState): Promise<GraphServices> {
  const extraDirs = await extraDirsOf(s);
  return {
    async capture(files, settings) {
      const r = await captureSource(s, files.sourceId, settings);
      if (files.sourceId === 'main') return { analysis: r.analysis, frozenHtml: r.frozenHtml, bodyWpId: r.bodyWpId, presetReport: r.presetReport, baseUrl: r.analysis.baseUrl };
      // An added page lives under /__src/<id>/ when pages are mixed: point its URLs there.
      const base = extraSourceBase(files.sourceId);
      const rebase = (x: string) => x.split(`${FIXTURE_ORIGIN}/`).join(base);
      return { analysis: r.analysis, frozenHtml: rebase(r.frozenHtml), bodyWpId: r.bodyWpId, presetReport: r.presetReport, baseUrl: rebase(r.analysis.baseUrl) };
    },
    parseHtml: parseDoc,
    async measureFlow(html, widthPx): Promise<FlowLayout> {
      return withSandbox(s.meta.source, { viewport: { width: Math.ceil(widthPx), height: 900 }, timeoutMs: 60_000, extraDirs }, async (sb) => {
        const esc = html.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        const url = sb.serve('flow.html', `<!DOCTYPE html><html><head><style>html,body{margin:0}iframe{border:0;display:block;width:${widthPx}px;height:900px}</style></head><body><iframe srcdoc="${esc}"></iframe></body></html>`);
        await sb.page.goto(url, { waitUntil: 'load' });
        const frame = sb.page.frames().find((f) => f !== sb.page.mainFrame())!;
        await frame.evaluate('document.fonts.ready');
        return (await frame.evaluate(FLOW_JS)) as FlowLayout;
      });
    },
  };
}

/** Evaluate a graph for a project on the server. */
export async function evaluateGraph(s: ProjectState, graph: Graph) {
  const services = await serverServices(s);
  return new GraphEvaluator(REGISTRY).evaluate(graph, { projectId: s.meta.id, services, project: projectSnapshot(s) });
}

/** The pages a node makes (Layout, Flow, Combine) or exports (Export). Throws with the node's message if it can't. */
export async function pagesOfNode(s: ProjectState, graph: Graph, nodeId: string): Promise<PagesValue> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw Object.assign(new Error(`There is no node "${nodeId}"`), { status: 400 });
  const { results } = await evaluateGraph(s, graph);
  const r = results[nodeId];
  const value = (r?.outputs.result ?? r?.outputs.pages ?? r?.outputs.document) as PagesValue | undefined;
  if (!r || r.status !== 'ok' || !value) throw Object.assign(new Error(r?.message ?? 'That node has no pages yet'), { status: 400 });
  return value;
}

/** Draw a Pages value's components, each from its own capture, with edits made upstream on top. */
export function htmlForPages(v: PagesValue): HtmlFor {
  const cache = new Map<string, string>();
  const overrides = [...v.overrides, ...v.document.overrides];
  return (def, widthPx) => {
    const key = `${def.id}|${widthPx.toFixed(3)}`;
    let html = cache.get(key);
    if (!html) {
      const cap = (def.captureKey && v.captures[def.captureKey]) || v.capture;
      html = isolateComponent(parseDoc, cap.frozenHtml, def, { widthPx, overrides: overrides.filter((o) => o.componentId === def.id), baseUrl: cap.baseUrl });
      cache.set(key, html);
    }
    return html;
  };
}

/** Export a node's pages: every page as one PDF (exact A4 boxes), or one page as a PNG. */
export async function exportNodePages(s: ProjectState, graph: Graph, nodeId: string, opts: { format: 'pdf' } | { format: 'png'; pageId?: string; dpi?: number }) {
  const v = await pagesOfNode(s, graph, nodeId);
  const extraDirs = await extraDirsOf(s);
  const htmlFor = htmlForPages(v);
  if (opts.format === 'pdf') return renderDocument(s.meta.source, extraDirs, v.document, htmlFor, { format: 'pdf' });
  return renderDocument(s.meta.source, extraDirs, v.document, htmlFor, { format: 'png', pageId: opts.pageId ?? v.document.pages[0]!.id, dpi: opts.dpi ?? 300 });
}
