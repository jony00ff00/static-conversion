/**
 * Service worker for the static build. Serves imported project files from
 * IndexedDB at `<base>vfs/<projectId>/<path>` (capture: the determinism
 * script is injected first in <head>) and `<base>live/<projectId>/<path>`
 * (live preview: the click recorder is injected). HTML is served with a CSP
 * that keeps the page off other origins, like the server's offline sandbox.
 */
import { idbGet, type StoredFile } from './idb.js';
import { RECORDER } from '../render/recorder.js';
import { MIME_BY_EXT } from './mime.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const sw = self as any;

/** Fixed clock (same instant as the server sandbox) so pages that print dates render the same each time. */
const FIXED_DATE = `<script data-ve-init>(function(){var F=Date.UTC(2026,0,1),D=Date;function FD(){if(!(this instanceof FD))return new D(F).toString();if(!arguments.length)return new D(F);return new (Function.prototype.bind.apply(D,[null].concat([].slice.call(arguments))))();}FD.prototype=D.prototype;FD.now=function(){return F};FD.UTC=D.UTC;FD.parse=D.parse;window.Date=FD;})();</script>`;
const INIT = `${FIXED_DATE}<script data-ve-init>${__INIT_JS__}</script>`;

const CSP = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src 'self' data: blob:; object-src 'none'";

sw.addEventListener('install', () => sw.skipWaiting());
sw.addEventListener('activate', (e: any) => e.waitUntil(sw.clients.claim()));

sw.addEventListener('fetch', (e: any) => {
  const url = new URL(e.request.url);
  const scope = new URL(sw.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  const m = /^(vfs|live)\/([a-z0-9-]+)\/(.*)$/.exec(url.pathname.slice(scope.pathname.length));
  if (!m) return;
  let rel: string;
  try {
    rel = decodeURIComponent(m[3]!);
  } catch {
    return e.respondWith(new Response('Bad path', { status: 400 }));
  }
  e.respondWith(serve(m[1] as 'vfs' | 'live', m[2]!, rel));
});

function inject(html: string, snippet: string, where: 'head' | 'body'): string {
  if (where === 'head') {
    const h = /<head[^>]*>/i.exec(html);
    if (h) return html.slice(0, h.index + h[0].length) + snippet + html.slice(h.index + h[0].length);
    const d = /<!doctype[^>]*>/i.exec(html);
    return d ? html.slice(0, d.index + d[0].length) + snippet + html.slice(d.index + d[0].length) : snippet + html;
  }
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${snippet}</body>`) : html + snippet;
}

async function serve(mode: 'vfs' | 'live', projectId: string, rel: string): Promise<Response> {
  const candidates = rel === '' || rel.endsWith('/') ? [`${rel}index.html`] : [rel];
  let file: StoredFile | undefined;
  for (const c of candidates) file ??= await idbGet<StoredFile>('files', `${projectId}/${c}`);
  if (!file) return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
  const ext = /\.[^./]+$/.exec(candidates[0]!)?.[0].toLowerCase() ?? '';
  const type = file.type || MIME_BY_EXT[ext] || 'application/octet-stream';
  const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-store' };
  if (type.startsWith('text/html')) {
    const html = new TextDecoder().decode(file.data);
    headers['content-security-policy'] = CSP;
    const out = mode === 'vfs' ? inject(html, INIT, 'head') : inject(html, RECORDER, 'body');
    return new Response(out, { headers });
  }
  return new Response(file.data as BodyInit, { headers });
}
