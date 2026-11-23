import { chromium, type Browser } from 'playwright';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

// In-page helpers are plain browser JS, injected as text (never transpiled).
const IN_PAGE_JS = readFileSync(path.join(import.meta.dirname, 'inPage.browser.js'), 'utf8');
const SEED_RANDOM_JS = readFileSync(path.join(import.meta.dirname, 'seedRandom.browser.js'), 'utf8');

/** Virtual origin the fixture is served from. Nothing else is reachable. */
export const FIXTURE_ORIGIN = 'http://fixture.local';

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
/** Fixed clock so pages that print dates/times render identically each run. */
export const FIXED_TIME = new Date('2026-01-01T00:00:00Z');
export const RANDOM_SEED = 0x5eed;

export interface RenderOptions {
  viewport?: { width: number; height: number };
  /** Hard wall-clock limit for the whole render, including browser start. */
  timeoutMs?: number;
  /** Entry HTML file inside the fixture directory. */
  entry?: string;
  fullPage?: boolean;
}

export interface RenderResult {
  html: string;
  screenshot: Buffer;
  wpIdCount: number;
  unstampedCount: number;
  blockedRequests: string[];
  pageErrors: string[];
  durationMs: number;
}

export class RenderTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`Render exceeded ${timeoutMs} ms and was terminated`);
    this.name = 'RenderTimeoutError';
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Resolve a request URL to a file inside `root`, or null if it is outside the
 * fixture origin or escapes the directory (path traversal).
 */
export function resolveFixturePath(root: string, url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== FIXTURE_ORIGIN) return null;
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
  const abs = path.resolve(root, rel || 'index.html');
  const rootAbs = path.resolve(root);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) return null;
  return abs;
}

/**
 * Render a directory of HTML/CSS/JS in an isolated, offline Chromium:
 * - a fresh browser process per render (killed on timeout),
 * - only files from `dir` are served; every other request is blocked,
 * - service workers, downloads and permissions are denied,
 * - clock and Math.random are fixed for determinism,
 * - the page is settled (load, network idle, fonts, images, animations frozen),
 * - every element is stamped with a stable data-wp-id.
 *
 * Production deployments should additionally run this inside a container with
 * no outbound network and CPU/memory limits (see docs/SANDBOX.md).
 */
export async function renderFixture(dir: string, opts: RenderOptions = {}): Promise<RenderResult> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const viewport = opts.viewport ?? DEFAULT_VIEWPORT;
  const entry = opts.entry ?? 'index.html';
  const started = Date.now();

  let browser: Browser | undefined;
  let timer: NodeJS.Timeout | undefined;
  let finished = false;

  const work = (async (): Promise<RenderResult> => {
    browser = await chromium.launch({
      args: ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
    });
    if (finished) {
      // The deadline fired while the browser was still starting.
      await browser.close();
      throw new RenderTimeoutError(timeoutMs);
    }
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      acceptDownloads: false,
      permissions: [],
      locale: 'en-GB',
      timezoneId: 'UTC',
      colorScheme: 'light',
      reducedMotion: 'no-preference',
    });
    const blockedRequests: string[] = [];
    const pageErrors: string[] = [];

    await context.route('**/*', async (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
      const file = resolveFixturePath(dir, url);
      if (!file) {
        blockedRequests.push(url);
        return route.abort('blockedbyclient');
      }
      try {
        const s = await stat(file);
        if (!s.isFile()) throw new Error('not a file');
        const body = await readFile(file);
        const type = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        return route.fulfill({ status: 200, body, headers: { 'content-type': type } });
      } catch {
        return route.fulfill({ status: 404, body: 'Not found' });
      }
    });
    await context.routeWebSocket(/.*/, (ws) => {
      blockedRequests.push(ws.url());
      ws.close({ code: 1008, reason: 'blocked by sandbox' });
    });

    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    page.on('dialog', (d) => d.dismiss().catch(() => undefined));
    await page.clock.setFixedTime(FIXED_TIME);
    await page.addInitScript({ content: SEED_RANDOM_JS.replaceAll('__SEED__', String(RANDOM_SEED)) });

    await page.goto(`${FIXTURE_ORIGIN}/${entry}`, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle');
    // Injected after load (not as an init script) so page code can't see or tamper with it first.
    await page.evaluate(IN_PAGE_JS);
    await page.evaluate('window.__ve.waitForAssets()');
    await page.evaluate('window.__ve.freezeAnimations()');
    await page.evaluate('window.__ve.waitForAssets()');

    const wpIdCount = (await page.evaluate('window.__ve.stampWpIds()')) as number;
    const unstampedCount = (await page.evaluate('window.__ve.countUnstamped()')) as number;
    const html = (await page.evaluate('window.__ve.serializeDom()')) as string;
    const screenshot = await page.screenshot({
      fullPage: opts.fullPage ?? true,
      animations: 'disabled',
      caret: 'hide',
    });

    return {
      html,
      screenshot,
      wpIdCount,
      unstampedCount,
      blockedRequests: [...new Set(blockedRequests)],
      pageErrors,
      durationMs: Date.now() - started,
    };
  })();

  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(timeoutMs)), timeoutMs);
  });

  try {
    return await Promise.race([work, deadline]);
  } finally {
    finished = true;
    clearTimeout(timer);
    work.catch(() => undefined);
    // Closing the browser kills its renderer processes, including one stuck
    // in an infinite loop. Bound the wait in case close itself hangs.
    const b = browser as Browser | undefined;
    if (b) await Promise.race([b.close().catch(() => undefined), new Promise((r) => setTimeout(r, 5_000))]);
  }
}
