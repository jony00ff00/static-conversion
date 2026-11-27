import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { EditorDocumentSchema } from './validate.js';
import {
  FIXTURES_DIR,
  autoPaginate,
  createProject,
  listProjects,
  loadProject,
  recapture,
  reflowChain,
  renderPages,
  saveProject,
  addSource,
  captureSource,
  listSources,
  loadGraph,
  saveGraph,
  sourceOf,
  type CaptureRequest,
} from './projects.js';
import { FIXTURE_ORIGIN, resolveFixturePath, type RenderSource } from '../render/sandbox.js';
import { RECORDER } from '../render/recorder.js';
import { clientBuildOptions, clientCss } from '../build/client.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

let bundle: Promise<string> | null = null;
export function clientBundle(): Promise<string> {
  bundle ??= build({ ...clientBuildOptions({ static: false }), write: false, minify: false, sourcemap: 'inline' }).then((r) => r.outputFiles![0]!.text);
  return bundle;
}

async function body(req: IncomingMessage, limit = 60 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

const send = (res: ServerResponse, status: number, data: unknown, type = 'application/json') => {
  const payload = Buffer.isBuffer(data) || typeof data === 'string' ? data : JSON.stringify(data);
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(payload);
};

const publicState = (s: Awaited<ReturnType<typeof loadProject>>) => ({
  meta: s.meta,
  document: s.document,
  analysis: s.analysis,
  bodyWpId: s.bodyWpId,
  snapshots: s.snapshots.map(({ id, name, createdAt }) => ({ id, name, createdAt })),
  liveAvailable: s.meta.source.kind === 'dir',
});

async function serveSourceFile(res: ServerResponse, source: RenderSource, rel: string, live: boolean) {
  const src = source.kind === 'dir' ? { root: source.root, entry: source.entry } : null;
  if (!src) {
    // HAR imports: serve recorded responses by path on the original origin.
    if (source.kind !== 'har') return send(res, 404, 'not found', 'text/plain');
    const har = JSON.parse(await readFile(source.harPath, 'utf8'));
    const origin = new URL(source.url).origin;
    const want = `${origin}/${rel}`;
    const entry = har.log.entries.find((e: { request: { url: string } }) => e.request.url.split('?')[0] === want);
    if (!entry) return send(res, 404, 'not found', 'text/plain');
    const c = entry.response.content;
    const data = c.encoding === 'base64' ? Buffer.from(c.text ?? '', 'base64') : Buffer.from(c.text ?? '', 'utf8');
    return send(res, 200, data, c.mimeType || 'application/octet-stream');
  }
  const file = resolveFixturePath(src.root, `${FIXTURE_ORIGIN}/${rel}`);
  if (!file) return send(res, 403, 'forbidden', 'text/plain');
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    let data: Buffer | string = await readFile(file);
    const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
    const headers: Record<string, string> = { 'content-type': type, 'cache-control': 'no-store' };
    if (live && type.startsWith('text/html')) {
      data = data.toString('utf8');
      data = /<\/body>/i.test(data) ? data.replace(/<\/body>/i, `${RECORDER}</body>`) : data + RECORDER;
      // The live preview runs the page's own scripts: keep it off the network.
      headers['content-security-policy'] = "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; connect-src 'self'; frame-src 'none'";
    }
    res.writeHead(200, headers);
    res.end(data);
  } catch {
    send(res, 404, 'not found', 'text/plain');
  }
}

const INDEX = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Static Conversion</title><link rel="stylesheet" href="/app.css"></head>
<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;

export function createAppServer() {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const p = url.pathname;
    try {
      if (req.method === 'GET' && (p === '/' || p.startsWith('/project/'))) return send(res, 200, INDEX, 'text/html; charset=utf-8');
      if (req.method === 'GET' && p === '/app.js') return send(res, 200, await clientBundle(), 'text/javascript; charset=utf-8');
      if (req.method === 'GET' && p === '/app.css') return send(res, 200, await clientCss(), 'text/css; charset=utf-8');
      if (req.method === 'GET' && p === '/api/fixtures') {
        const names = (await readdir(FIXTURES_DIR)).filter((n) => /^\d\d-/.test(n)).sort();
        return send(res, 200, names);
      }
      if (p === '/api/projects' && req.method === 'GET') return send(res, 200, await listProjects());
      if (p === '/api/projects' && req.method === 'POST') {
        const s = await createProject((await body(req)) as Parameters<typeof createProject>[0]);
        return send(res, 201, publicState(s));
      }
      const m = /^\/api\/projects\/([a-z0-9-]+)(\/.*)?$/.exec(p);
      if (m) {
        const id = m[1]!;
        const rest = m[2] ?? '';
        const s = await loadProject(id);
        if (req.method === 'GET' && rest === '') return send(res, 200, publicState(s));
        if (req.method === 'GET' && rest === '/frozen') return send(res, 200, s.frozenHtml, 'text/html; charset=utf-8');
        if (req.method === 'GET' && rest.startsWith('/src/')) return serveSourceFile(res, s.meta.source, decodeURIComponent(rest.slice(5)), false);
        if (req.method === 'GET' && rest.startsWith('/live/')) return serveSourceFile(res, s.meta.source, decodeURIComponent(rest.slice(6)), true);
        // Nodes tab: the graph, pages added in Web Source nodes, and captures with a Capture node's settings.
        if (req.method === 'GET' && rest === '/graph') return send(res, 200, { stored: await loadGraph(id) });
        if (req.method === 'PUT' && rest === '/graph') {
          const { stored } = (await body(req)) as { stored: { version?: number; graph?: { nodes?: unknown; edges?: unknown } } };
          if (!stored || stored.version !== 1 || !Array.isArray(stored.graph?.nodes) || !Array.isArray(stored.graph?.edges)) return send(res, 400, { error: 'invalid graph' });
          await saveGraph(id, stored);
          return send(res, 200, { ok: true });
        }
        if (req.method === 'GET' && rest === '/sources') return send(res, 200, await listSources(id));
        if (req.method === 'POST' && rest === '/sources') return send(res, 201, await addSource(s, (await body(req)) as Parameters<typeof addSource>[1]));
        const sm = /^\/sources\/([a-z0-9-]+)(\/.*)$/.exec(rest);
        if (sm) {
          const [, sid, sub] = sm as unknown as [string, string, string];
          if (req.method === 'POST' && sub === '/capture') return send(res, 200, await captureSource(s, sid, (await body(req)) as CaptureRequest));
          if (req.method === 'GET' && sub.startsWith('/src/')) return serveSourceFile(res, await sourceOf(s, sid), decodeURIComponent(sub.slice(5)), false);
          if (req.method === 'GET' && sub.startsWith('/live/')) return serveSourceFile(res, await sourceOf(s, sid), decodeURIComponent(sub.slice(6)), true);
        }
        if (req.method === 'PUT' && rest === '/document') {
          const { document } = (await body(req)) as { document: unknown };
          const parsed = EditorDocumentSchema.safeParse(document);
          if (!parsed.success) return send(res, 400, { error: parsed.error.issues[0]?.message ?? 'invalid document' });
          await saveProject({ ...s, document: parsed.data });
          return send(res, 200, { ok: true });
        }
        if (req.method === 'POST' && rest === '/recapture') {
          const patch = (await body(req)) as Parameters<typeof recapture>[1];
          const r = await recapture(s, patch);
          return send(res, 200, { ...publicState(r.state), presetReport: r.presetReport });
        }
        if (req.method === 'POST' && rest === '/proof') {
          const { pageId, dpi } = (await body(req)) as { pageId: string; dpi?: number };
          return send(res, 200, await renderPages(s, { format: 'png', pageId, dpi: dpi ?? 96, editorFrame: true }), 'image/png');
        }
        if (req.method === 'POST' && rest === '/export') {
          const o = (await body(req)) as { format: 'pdf' | 'png'; pageId?: string; dpi?: number };
          if (o.format === 'pdf') return send(res, 200, await renderPages(s, { format: 'pdf' }), 'application/pdf');
          return send(res, 200, await renderPages(s, { format: 'png', pageId: o.pageId ?? s.document.pages[0]!.id, dpi: o.dpi ?? 300 }), 'image/png');
        }
        if (req.method === 'POST' && rest === '/paginate') {
          const { componentId, pageId, document } = (await body(req)) as { componentId: string; pageId: string; document?: unknown };
          const base = document ? { ...s, document: EditorDocumentSchema.parse(document) } : s;
          const r = await autoPaginate(base, componentId, pageId);
          await saveProject({ ...s, document: r.document });
          return send(res, 200, { document: r.document, chainId: r.chainId });
        }
        const rc = /^\/chains\/([\w-]+)\/reflow$/.exec(rest);
        if (req.method === 'POST' && rc) {
          const { document } = (await body(req)) as { document?: unknown };
          const base = document ? { ...s, document: EditorDocumentSchema.parse(document) } : s;
          const r = await reflowChain(base, rc[1]!);
          await saveProject({ ...s, document: r.document });
          return send(res, 200, { document: r.document });
        }
        if (req.method === 'POST' && rest === '/snapshots') {
          const { name } = (await body(req)) as { name: string };
          const snap = { id: `snap-${Date.now().toString(36)}`, name: name || 'Snapshot', createdAt: new Date().toISOString(), document: s.document };
          await saveProject({ ...s, snapshots: [...s.snapshots, snap] });
          return send(res, 201, { id: snap.id, name: snap.name, createdAt: snap.createdAt });
        }
        const rs = /^\/snapshots\/([\w-]+)\/restore$/.exec(rest);
        if (req.method === 'POST' && rs) {
          const snap = s.snapshots.find((x) => x.id === rs[1]);
          if (!snap) return send(res, 404, { error: 'snapshot not found' });
          await saveProject({ ...s, document: snap.document });
          return send(res, 200, { document: snap.document });
        }
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      const err = e as Error & { status?: number };
      send(res, err.status ?? 500, { error: err.message });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const port = Number(process.env.PORT ?? 5173);
  createAppServer().listen(port, () => console.log(`Static Conversion editor on http://localhost:${port}`));
}
