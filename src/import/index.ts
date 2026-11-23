import { chromium } from 'playwright';
import { unzipSync } from 'fflate';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dirSource, type RenderSource } from '../render/sandbox.js';

/** Limits for zip imports (protect against zip bombs and junk uploads). */
export const ZIP_LIMITS = {
  maxFiles: 5_000,
  maxTotalBytes: 200 * 1024 * 1024,
  maxFileBytes: 50 * 1024 * 1024,
} as const;

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

export interface Imported {
  source: RenderSource;
  /** Directory holding the imported files (or the HAR recording). */
  dir: string;
  kind: 'paste' | 'directory' | 'zip' | 'url';
}

const newImportDir = async (parent?: string) => {
  if (parent) {
    await mkdir(parent, { recursive: true });
    return mkdtemp(path.join(parent, 'import-'));
  }
  return mkdtemp(path.join(tmpdir(), 've-import-'));
};

/* ------------------------------------------------------------------ paste */

/**
 * Import pasted code. `html` may be a full document or a fragment; `css` is
 * added as a <style> at the end of <head>, `js` as a <script> at the end of <body>.
 */
export async function importPaste(
  input: { html: string; css?: string; js?: string },
  opts: { parentDir?: string } = {},
): Promise<Imported> {
  let html = input.html.trim();
  if (!/<html[\s>]/i.test(html)) {
    html = `<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Pasted</title></head>\n<body>\n${html}\n</body>\n</html>`;
  } else if (!/<!doctype/i.test(html)) {
    html = `<!DOCTYPE html>\n${html}`;
  }
  if (!/<head[\s>]/i.test(html)) html = html.replace(/<html([^>]*)>/i, '<html$1><head><meta charset="utf-8"></head>');
  if (input.css) {
    const style = `<style data-ve-pasted>\n${input.css.replace(/<\/style/gi, '<\\/style')}\n</style>`;
    html = html.replace(/<\/head>/i, `${style}\n</head>`);
  }
  if (input.js) {
    const script = `<script data-ve-pasted>\n${input.js.replace(/<\/script/gi, '<\\/script')}\n</script>`;
    html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${script}\n</body>`) : html + script;
  }
  const dir = await newImportDir(opts.parentDir);
  await writeFile(path.join(dir, 'index.html'), html);
  return { source: dirSource(dir, 'index.html'), dir, kind: 'paste' };
}

/* -------------------------------------------------------------- directory */

/**
 * Pick the entry HTML file: index.html at the root, else index.html in the only
 * top-level folder, else the shallowest .html file (alphabetical).
 */
export async function findEntry(root: string): Promise<string> {
  const htmls: string[] = [];
  const walk = async (rel: string, depth: number) => {
    if (depth > 6) return;
    for (const e of await readdir(path.join(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__MACOSX') continue;
      const r = rel ? path.join(rel, e.name) : e.name;
      if (e.isDirectory()) await walk(r, depth + 1);
      else if (e.isFile() && /\.html?$/i.test(e.name)) htmls.push(r);
    }
  };
  await walk('', 0);
  if (!htmls.length) throw new ImportError('No .html file found in the import.');
  const depth = (p: string) => p.split(path.sep).length;
  const index = htmls.filter((p) => /^index\.html?$/i.test(path.basename(p))).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b));
  if (index[0] && depth(index[0]) <= 2) return index[0];
  return htmls.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))[0]!;
}

/** Use a directory in place (files are served read-only from it). */
export async function importDirectory(dir: string, entry?: string): Promise<Imported> {
  const s = await stat(dir).catch(() => null);
  if (!s?.isDirectory()) throw new ImportError(`Not a directory: ${dir}`);
  const e = entry ?? (await findEntry(dir));
  return { source: dirSource(path.resolve(dir), e), dir: path.resolve(dir), kind: 'directory' };
}

/* -------------------------------------------------------------------- zip */

/** Reject absolute paths, drive letters and any `..` segment (zip-slip). */
export function safeZipPath(name: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n)) return null;
  const parts = n.split('/').filter((p) => p !== '' && p !== '.');
  if (!parts.length || parts.some((p) => p === '..')) return null;
  return parts.join('/');
}

/** Extract a zip into a new import directory, with size and path checks. */
export async function importZip(zip: Buffer | string, opts: { parentDir?: string } = {}): Promise<Imported> {
  const buf = typeof zip === 'string' ? await readFile(zip) : zip;
  let files: Record<string, Uint8Array>;
  let count = 0;
  let total = 0;
  try {
    files = unzipSync(new Uint8Array(buf), {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (count > ZIP_LIMITS.maxFiles) throw new ImportError(`Zip has more than ${ZIP_LIMITS.maxFiles} files.`);
        if (f.originalSize > ZIP_LIMITS.maxFileBytes) throw new ImportError(`"${f.name}" is larger than ${ZIP_LIMITS.maxFileBytes / 1024 / 1024} MB.`);
        if (total > ZIP_LIMITS.maxTotalBytes) throw new ImportError(`Zip expands to more than ${ZIP_LIMITS.maxTotalBytes / 1024 / 1024} MB.`);
        return true;
      },
    });
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError(`Could not read zip: ${(e as Error).message}`);
  }
  const dir = await newImportDir(opts.parentDir);
  const rejected: string[] = [];
  for (const [name, data] of Object.entries(files)) {
    const safe = safeZipPath(name);
    if (!safe) {
      rejected.push(name);
      continue;
    }
    const dest = path.join(dir, ...safe.split('/'));
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
  }
  if (rejected.length) throw new ImportError(`Zip contains unsafe paths: ${rejected.slice(0, 5).join(', ')}`);
  return { source: dirSource(dir, await findEntry(dir)), dir, kind: 'zip' };
}

/* -------------------------------------------------------------------- url */

/**
 * Import a live URL by recording it once into a HAR file (every response,
 * embedded). Rendering afterwards replays only the recording, fully offline,
 * so the import is stable even if the site changes or goes down.
 *
 * Note: unlike rendering, recording needs network access and runs the site's
 * own JavaScript against the live site.
 */
export async function importUrl(
  url: string,
  opts: { parentDir?: string; viewport?: { width: number; height: number }; timeoutMs?: number; settleMs?: number } = {},
): Promise<Imported> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new ImportError(`Not a valid URL: ${url}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ImportError('Only http and https URLs can be imported.');
  const dir = await newImportDir(opts.parentDir);
  const harPath = path.join(dir, 'capture.har');
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      viewport: opts.viewport ?? { width: 1280, height: 800 },
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
      locale: 'en-GB',
      timezoneId: 'UTC',
    });
    await context.routeFromHAR(harPath, { update: true, updateContent: 'embed', updateMode: 'full', url: /.*/ });
    const page = await context.newPage();
    page.on('dialog', (d) => d.dismiss().catch(() => undefined));
    await page.goto(u.href, { waitUntil: 'load', timeout: opts.timeoutMs ?? 30_000 });
    await page.waitForLoadState('networkidle', { timeout: opts.timeoutMs ?? 30_000 }).catch(() => undefined);
    // Give late requests (lazy images, fonts) a moment to be recorded.
    await page.waitForTimeout(opts.settleMs ?? 500);
    const finalUrl = page.url();
    await context.close(); // writes the HAR
    await writeFile(path.join(dir, 'import.json'), JSON.stringify({ url: u.href, finalUrl, recordedAt: new Date().toISOString() }, null, 2));
    return { source: { kind: 'har', harPath, url: finalUrl }, dir, kind: 'url' };
  } finally {
    await browser.close();
  }
}
