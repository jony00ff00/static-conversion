import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { comparePng } from '../src/golden/compare.js';
import { ImportError, findEntry, importDirectory, importPaste, importUrl, importZip, safeZipPath } from '../src/import/index.js';
import { renderFixture, renderSource } from '../src/render/sandbox.js';
import { fixture, tmp } from './helpers.js';

describe('paste import', () => {
  it('wraps a fragment and adds the CSS and JS', async () => {
    const { source } = await importPaste({
      html: '<h1 id="t">Hello</h1>',
      css: 'h1{color:rgb(255, 0, 0)}',
      js: 'document.getElementById("t").textContent = "Hello from JS";',
    });
    const r = await renderSource(source);
    expect(r.pageErrors).toEqual([]);
    expect(r.html).toContain('Hello from JS');
    expect(r.html).toContain('color:rgb(255, 0, 0)');
    expect(r.html).not.toContain('<script'); // frozen output is static
  });

  it('accepts a full document as-is', async () => {
    const { source } = await importPaste({ html: '<html><head><title>T</title></head><body><p>Full</p></body></html>' });
    const r = await renderSource(source);
    expect(r.html).toContain('<p data-wp-id');
  });
});

describe('directory import', () => {
  it('uses index.html at the root', async () => {
    const i = await importDirectory(fixture('01-static'));
    expect(i.source).toMatchObject({ kind: 'dir', entry: 'index.html' });
  });

  it('falls back to index.html in a single top-level folder, then the shallowest .html', async () => {
    const a = tmp();
    mkdirSync(path.join(a, 'site'));
    writeFileSync(path.join(a, 'site', 'index.html'), '<p>x</p>');
    expect(await findEntry(a)).toBe(path.join('site', 'index.html'));
    const b = tmp();
    mkdirSync(path.join(b, 'deep', 'er'), { recursive: true });
    writeFileSync(path.join(b, 'deep', 'er', 'page.html'), '<p>x</p>');
    writeFileSync(path.join(b, 'about.html'), '<p>x</p>');
    expect(await findEntry(b)).toBe('about.html');
  });

  it('rejects a folder without HTML', async () => {
    await expect(importDirectory(tmp())).rejects.toBeInstanceOf(ImportError);
  });
});

describe('zip import', () => {
  it('extracts a zipped site in a subfolder and renders it with its CSS', async () => {
    const zip = zipSync({
      'mysite/index.html': strToU8('<!DOCTYPE html><html><head><link rel="stylesheet" href="css/s.css"></head><body><p class="p">Zipped</p></body></html>'),
      'mysite/css/s.css': strToU8('.p{color:rgb(0, 128, 0)}'),
    });
    const i = await importZip(Buffer.from(zip));
    expect(i.source).toMatchObject({ kind: 'dir', entry: path.join('mysite', 'index.html') });
    const r = await renderSource(i.source);
    expect(r.html).toContain('Zipped');
    expect(r.blockedRequests).toEqual([]);
  });

  it('rejects paths that escape the folder (zip-slip)', async () => {
    expect(safeZipPath('../evil.txt')).toBeNull();
    expect(safeZipPath('/etc/passwd')).toBeNull();
    expect(safeZipPath('C:\\x.txt')).toBeNull();
    expect(safeZipPath('a/./b/../c.txt')).toBeNull();
    expect(safeZipPath('a/b.txt')).toBe('a/b.txt');
    const zip = zipSync({ 'index.html': strToU8('<p>x</p>'), '../evil.txt': strToU8('x') });
    await expect(importZip(Buffer.from(zip))).rejects.toThrow(/unsafe paths/);
  });

  it('rejects files that expand beyond the size limit (zip bomb)', async () => {
    const zip = zipSync({ 'index.html': strToU8('<p>x</p>'), 'big.bin': new Uint8Array(51 * 1024 * 1024) });
    await expect(importZip(Buffer.from(zip))).rejects.toThrow(/larger than/);
  });

  it('rejects something that is not a zip', async () => {
    await expect(importZip(Buffer.from('not a zip'))).rejects.toBeInstanceOf(ImportError);
  });
});

describe('URL import (recorded, then rendered offline)', () => {
  let server: Server;
  let base: string;
  const root = fixture('01-static');

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const rel = decodeURIComponent((req.url ?? '/').split('?')[0]!).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(root, rel);
      if (!file.startsWith(root)) return res.writeHead(403).end();
      try {
        const body = await readFile(file);
        const type = file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
        res.writeHead(200, { 'content-type': type }).end(body);
      } catch {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('records the page and renders it after the site goes away', async () => {
    const i = await importUrl(base, { settleMs: 200 });
    expect(i.source.kind).toBe('har');
    await new Promise<void>((r) => server.close(() => r())); // site is now offline
    server = createServer(); // keep afterAll happy
    server.listen(0);
    const fromUrl = await renderSource(i.source);
    const fromDir = await renderFixture(root);
    expect(fromUrl.pageErrors).toEqual([]);
    expect(fromUrl.blockedRequests).toEqual([]);
    const d = comparePng(fromDir.screenshot, fromUrl.screenshot);
    expect(d.sizeMismatch).toBe(false);
    expect(d.ratio).toBeLessThanOrEqual(0.005);
  });

  it('rejects non-http URLs', async () => {
    await expect(importUrl('file:///etc/passwd')).rejects.toBeInstanceOf(ImportError);
  });
});
