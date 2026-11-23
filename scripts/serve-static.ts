/**
 * Serve the static build like GitHub Pages does, under a sub-path:
 * http://localhost:5174/static-conversion/
 */
import { createServer, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MIME_BY_EXT } from '../src/static/mime.js';

export const STATIC_PREFIX = '/static-conversion/';

export function createStaticServer(root: string): Server {
  const rootAbs = path.resolve(root);
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(STATIC_PREFIX)) {
      res.writeHead(302, { location: STATIC_PREFIX }).end();
      return;
    }
    let rel = decodeURIComponent(url.pathname.slice(STATIC_PREFIX.length));
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(rootAbs, rel);
    if (!file.startsWith(rootAbs + path.sep)) return void res.writeHead(403).end();
    try {
      if (!(await stat(file)).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'application/octet-stream' });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const port = Number(process.env.PORT ?? 5174);
  const root = process.argv[2] ?? 'dist-static';
  createStaticServer(root).listen(port, () => console.log(`Static build on http://localhost:${port}${STATIC_PREFIX}`));
}
