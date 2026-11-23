/**
 * Cut one component out of the frozen page as a standalone document.
 *
 * Instead of copying styles, the whole frozen document is kept and everything
 * outside the component is hidden. The component's ancestors stay (with their
 * boxes neutralised), so the author's selectors (`.features .card h3`,
 * `:nth-child`) still match and inherited styles (font, colour) still apply.
 *
 * Works on any DOM implementation: the browser's DOMParser or linkedom on the server.
 */
import type { ComponentDef, Override } from '../model/types.js';

export type ParseHtml = (html: string) => Document;

export interface IsolateOptions {
  /** Layout width in CSS px (default: the component's natural width). */
  widthPx?: number;
  /** Fix the height too (used for pixel comparisons with the source). */
  heightPx?: number;
  overrides?: Override[];
  baseUrl?: string;
}

const NON_VISUAL = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE', 'BASE', 'HEAD', 'NOSCRIPT', 'TEMPLATE']);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function appendStyle(el: Element, decl: string) {
  const cur = el.getAttribute('style') ?? '';
  el.setAttribute('style', `${cur}${cur && !cur.trim().endsWith(';') ? ';' : ''}${decl}`);
}

/** Replace an element's own text (direct text nodes only; child elements are kept). */
function setOwnText(el: Element, value: string) {
  const texts = Array.from(el.childNodes).filter((n) => n.nodeType === 3);
  const firstNonEmpty = texts.find((t) => (t.textContent ?? '').trim()) ?? texts[0];
  if (!firstNonEmpty) {
    el.appendChild(el.ownerDocument.createTextNode(value));
    return;
  }
  for (const t of texts) t.textContent = t === firstNonEmpty ? value : '';
}

/** The element's own text, as shown to the user for editing. */
export function ownText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === 3)
    .map((n) => n.textContent ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

export function applyOverrides(doc: Document, overrides: Override[]) {
  for (const o of overrides) {
    const el = doc.querySelector(`[data-wp-id="${o.target}"]`);
    if (!el) continue;
    if (o.type === 'text') setOwnText(el, o.value);
    else if (o.type === 'style') appendStyle(el, `${o.prop}:${o.value} !important`);
    else if (o.type === 'visibility') {
      if (o.hidden) el.setAttribute('data-ve-hide', '');
      else el.removeAttribute('data-ve-hide');
    } else if (o.type === 'asset') {
      if (o.src && el.tagName === 'IMG') {
        el.setAttribute('src', o.src);
        el.removeAttribute('srcset');
      }
      const fit = o.objectFit ?? 'cover';
      appendStyle(el, `object-fit:${fit} !important;object-position:${o.focalX ?? 50}% ${o.focalY ?? 50}% !important`);
    }
    el.setAttribute('data-ve-overridden', '');
  }
}

export function isolateComponent(parse: ParseHtml, frozenHtml: string, def: ComponentDef, opts: IsolateOptions = {}): string {
  const doc = parse(frozenHtml);
  const head = doc.head ?? doc.querySelector('head');
  const body = doc.body ?? doc.querySelector('body');
  if (!head || !body) throw new Error('frozen document has no head/body');
  const isPage = def.kind === 'page';
  const root = isPage ? body : doc.querySelector(`[data-wp-id="${def.rootWpId}"]`);
  const width = opts.widthPx ?? def.widthPx;
  const css: string[] = ['[data-ve-hide]{display:none!important}', 'html,body{overflow:hidden!important}'];

  if (!root) {
    return `<!DOCTYPE html><html><body style="margin:0;font:12px sans-serif;color:#b91c1c;background:#fef2f2;padding:8px">Component "${esc(def.name)}" is missing from the source.</body></html>`;
  }

  if (!isPage) {
    // Hide everything that isn't the component or one of its ancestors.
    for (let a: Element | null = root; a && a !== doc.documentElement; a = a.parentElement) {
      const parent: Element | null = a.parentElement;
      if (!parent) break;
      if (parent !== doc.documentElement) parent.setAttribute('data-ve-anc', '');
      for (const sib of Array.from(parent.children) as Element[]) {
        if (sib !== a && !NON_VISUAL.has(sib.tagName)) sib.setAttribute('data-ve-hide', '');
      }
    }
    doc.documentElement.setAttribute('data-ve-anc', '');
    body.setAttribute('data-ve-anc', '');
    if (def.showWpIds?.length) {
      const keep = def.showWpIds.map((id) => doc.querySelector(`[data-wp-id="${id}"]`)).filter((e): e is Element => !!e);
      for (const child of Array.from(root.children)) {
        if (!keep.some((k) => k === child || child.contains(k))) child.setAttribute('data-ve-hide', '');
      }
    }
    root.setAttribute('data-ve-root', '');
    css.push(
      '[data-ve-anc]{margin:0!important;padding:0!important;border:0!important;background:transparent!important;box-shadow:none!important;' +
        'position:static!important;transform:none!important;min-height:0!important;height:auto!important;max-height:none!important;' +
        'width:auto!important;max-width:none!important;min-width:0!important;overflow:visible!important;display:block!important;' +
        'float:none!important;filter:none!important;opacity:1!important;columns:auto!important;gap:0!important}',
      `html{background:${def.bg}!important}`,
      `[data-ve-root]{margin:0!important;width:${width}px!important;box-sizing:border-box!important;position:relative!important;` +
        'left:0!important;top:0!important;right:auto!important;bottom:auto!important;transform:none!important;float:none!important;' +
        `flex:none!important;max-width:none!important;min-width:0!important${opts.heightPx ? `;height:${opts.heightPx}px!important` : ''}}`,
    );
  }

  applyOverrides(doc, opts.overrides ?? []);
  const style = doc.createElement('style');
  style.setAttribute('data-ve-isolate', '');
  style.textContent = css.join('\n');
  head.appendChild(style);
  if (opts.baseUrl && !head.querySelector('base')) {
    const base = doc.createElement('base');
    base.setAttribute('href', opts.baseUrl);
    head.insertBefore(base, head.firstChild);
  }
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
