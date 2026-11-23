/** Browser-side composition: isolation with DOMParser, cached per component/width/overrides. */
import { isolateComponent } from '../compose/isolate.js';
import { composePageHtml, type HtmlFor } from '../compose/page.js';
import type { ComponentDef, EditorDocument } from '../model/types.js';
import { IS_STATIC, vfsUrl } from '../static/env.js';

const parser = typeof DOMParser !== 'undefined' ? new DOMParser() : null;
export const parse = (html: string) => parser!.parseFromString(html, 'text/html');

/** Base URL that resolves the source's relative assets through the editor server. */
export function clientBaseUrl(projectId: string, analysisBaseUrl: string): string {
  // Static build: the capture already ran at the service-worker URL the assets live at.
  if (IS_STATIC) return analysisBaseUrl;
  let pathname = '/';
  try {
    pathname = new URL(analysisBaseUrl).pathname;
  } catch {
    /* keep / */
  }
  return `${location.origin}/api/projects/${projectId}/src${pathname}`;
}

/** Live (scripts running) preview of the source's entry page. */
export function liveUrl(projectId: string, entry: string): string {
  return IS_STATIC ? vfsUrl(projectId, entry, 'live') : `/api/projects/${projectId}/live/${entry}`;
}

const cache = new Map<string, string>();

export function makeHtmlFor(projectId: string, frozenHtml: string, baseUrl: string, doc: EditorDocument): HtmlFor {
  return (def: ComponentDef, widthPx: number) => {
    const ov = doc.overrides.filter((o) => o.componentId === def.id);
    const key = `${projectId}|${frozenHtml.length}|${JSON.stringify(def)}|${widthPx.toFixed(3)}|${JSON.stringify(ov)}`;
    let html = cache.get(key);
    if (!html) {
      html = isolateComponent(parse, frozenHtml, def, { widthPx, overrides: ov, baseUrl });
      if (cache.size > 400) cache.clear();
      cache.set(key, html);
    }
    return html;
  };
}

export function pageHtml(projectId: string, frozenHtml: string, baseUrl: string, doc: EditorDocument, pageId: string) {
  return composePageHtml(doc, pageId, makeHtmlFor(projectId, frozenHtml, baseUrl, doc));
}

/** Frozen document for the web pane, with assets resolved through the editor server. */
export function frozenForPane(frozenHtml: string, baseUrl: string) {
  const doc = parse(frozenHtml);
  const base = doc.createElement('base');
  base.setAttribute('href', baseUrl);
  doc.head.insertBefore(base, doc.head.firstChild);
  const style = doc.createElement('style');
  style.textContent = '[data-ve-overridden-src]{outline:2px dashed #f59e0b!important;outline-offset:1px}';
  doc.head.appendChild(style);
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
