import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { collectFonts, type FontReport } from './fonts.js';

// In-page helpers are plain browser JS, injected as text (never transpiled).
const IN_PAGE_JS = readFileSync(path.join(import.meta.dirname, 'inPage.browser.js'), 'utf8');
const INIT_JS = readFileSync(path.join(import.meta.dirname, 'init.browser.js'), 'utf8');

/** Virtual origin a directory source is served from. Nothing else is reachable. */
export const FIXTURE_ORIGIN = 'http://fixture.local';

export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const;
/** Fixed clock so pages that print dates/times render identically each run. */
export const FIXED_TIME = new Date('2026-01-01T00:00:00Z');
export const RANDOM_SEED = 0x5eed;

/** Where the page comes from. Either way, rendering is fully offline. */
export type RenderSource =
  | { kind: 'dir'; root: string; entry: string }
  /** A recorded URL import: every response is replayed from the HAR file. */
  | { kind: 'har'; harPath: string; url: string };

export const dirSource = (root: string, entry = 'index.html'): RenderSource => ({ kind: 'dir', root, entry });

export function sourceUrl(source: RenderSource): string {
  return source.kind === 'dir'
    ? `${FIXTURE_ORIGIN}/${source.entry.split(path.sep).map(encodeURIComponent).join('/')}`
    : source.url;
}

export interface SandboxOptions {
  viewport?: { width: number; height: number };
  /** Device scale factor. Export uses dpi/96 so canvases and rasters are print resolution. */
  scale?: number;
  /** Hard wall-clock limit for the whole session, including browser start. */
  timeoutMs?: number;
}

export interface SandboxSession {
  page: Page;
  context: BrowserContext;
  blockedRequests: string[];
  pageErrors: string[];
  /** Every request the page made (URL and Playwright resource type). */
  requests: Array<{ url: string; type: string }>;
  /** Serve extra generated HTML at `${origin}/__ve__/<name>` (same origin as the source). */
  serve(name: string, html: string): string;
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
  '.avif': 'image/avif',
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
 * Run `fn` against a page in an isolated, offline Chromium:
 * - a fresh browser process per session (closed afterwards, killed on timeout),
 * - directory sources: only files inside the directory are served;
 *   HAR sources: only recorded responses are replayed; everything else is blocked,
 * - WebSockets blocked; service workers, downloads and permissions denied,
 * - clock and Math.random fixed for determinism.
 *
 * Production deployments should additionally run this inside a container with
 * no outbound network and CPU/memory limits (see docs/SANDBOX.md).
 */
export async function withSandbox<T>(
  source: RenderSource,
  opts: SandboxOptions,
  fn: (s: SandboxSession) => Promise<T>,
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let browser: Browser | undefined;
  let timer: NodeJS.Timeout | undefined;
  let finished = false;

  const work = (async (): Promise<T> => {
    browser = await chromium.launch({
      args: ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'],
    });
    if (finished) {
      await browser.close();
      throw new RenderTimeoutError(timeoutMs);
    }
    const context = await browser.newContext({
      viewport: opts.viewport ?? DEFAULT_VIEWPORT,
      deviceScaleFactor: opts.scale ?? 1,
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
    const requests: Array<{ url: string; type: string }> = [];
    context.on('request', (req) => requests.push({ url: req.url(), type: req.resourceType() }));
    const generated = new Map<string, string>();
    const origin = new URL(sourceUrl(source)).origin;

    if (source.kind === 'dir') {
      await context.route('**/*', async (route) => {
        const url = route.request().url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        const file = resolveFixturePath(source.root, url);
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
    } else {
      // Anything not in the recording is aborted, so the page stays offline.
      await context.routeFromHAR(source.harPath, { notFound: 'abort', url: /.*/ });
      context.on('requestfailed', (req) => {
        if (!req.url().startsWith('data:') && !req.url().startsWith('blob:')) blockedRequests.push(req.url());
      });
    }
    // Registered last, so it takes precedence over the routes above.
    await context.route(`${origin}/__ve__/**`, (route) => {
      const html = generated.get(new URL(route.request().url()).pathname);
      return html === undefined
        ? route.fulfill({ status: 404, body: 'Not found' })
        : route.fulfill({ status: 200, body: html, headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    await context.routeWebSocket(/.*/, (ws) => {
      blockedRequests.push(ws.url());
      ws.close({ code: 1008, reason: 'blocked by sandbox' });
    });

    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(String(e.message)));
    page.on('dialog', (d) => d.dismiss().catch(() => undefined));
    await page.clock.setFixedTime(FIXED_TIME);
    await page.addInitScript({ content: INIT_JS.replaceAll('__SEED__', String(RANDOM_SEED)) });

    return fn({
      page,
      context,
      blockedRequests,
      pageErrors,
      requests,
      serve(name, html) {
        generated.set(`/__ve__/${name}`, html);
        return `${origin}/__ve__/${name}`;
      },
    });
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

/* ------------------------------------------------------------------ freeze */

export interface FreezeReport {
  canvases: Array<{
    wpId: string | null;
    webgl: boolean;
    cssWidth: number;
    cssHeight: number;
    pixelWidth: number;
    pixelHeight: number;
    method: 'toDataURL' | 'screenshot';
    /** Resolution the canvas pixels give at their on-page size, placed at 100%. */
    effectiveDpi: number;
  }>;
  videos: Array<{ wpId: string | null; method: string; timeSec?: number }>;
  pseudoConverted: number;
  pseudoSkipped: Array<{ wpId: string | null; which: string; content: string }>;
  bakedProps: number;
  rasterized: Array<{
    wpId: string | null;
    kind: string;
    reason: string;
    src: string | null;
    result: 'screenshot' | 'placeholder';
  }>;
}

interface RasterJob {
  id: string;
  kind: string;
  reason: string;
  wpId: string | null;
  src: string | null;
  width: number;
  height: number;
}

type PreparedFreeze = Omit<FreezeReport, 'rasterized' | 'canvases'> & {
  rasterJobs: RasterJob[];
  canvases: Array<Omit<FreezeReport['canvases'][number], 'effectiveDpi'>>;
};

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

/** Freeze JS output into static content (canvas, WebGL, video, pseudo-elements, iframes, animations). */
export async function freezePage(s: SandboxSession, opts: { videoTimeSec?: number } = {}): Promise<FreezeReport> {
  const { page } = s;
  const prep = (await page.evaluate(
    `window.__ve.prepareFreeze(${JSON.stringify({ videoTimeSec: opts.videoTimeSec ?? 0 })})`,
  )) as PreparedFreeze;

  const blocked = new Set(s.blockedRequests);
  const rasterized: FreezeReport['rasterized'] = [];
  for (const job of prep.rasterJobs) {
    const isBlockedEmbed = job.kind === 'iframe' && job.src && blocked.has(job.src);
    if (isBlockedEmbed || job.kind === 'img') {
      const label =
        job.kind === 'img'
          ? `Image unavailable${job.src ? ` (${hostOf(job.src)})` : ''}`
          : `Embedded content unavailable (${hostOf(job.src!)})`;
      await page.evaluate(`window.__ve.applyPlaceholder(${JSON.stringify(job.id)}, ${JSON.stringify(label)})`);
      const reason = job.src && blocked.has(job.src) ? 'blocked' : job.reason;
      rasterized.push({ wpId: job.wpId, kind: job.kind, reason, src: job.src, result: 'placeholder' });
      continue;
    }
    const png = await page
      .locator(`[data-ve-raster="${job.id}"]`)
      .screenshot({ animations: 'disabled', caret: 'hide' });
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
    await page.evaluate(`window.__ve.applyRaster(${JSON.stringify(job.id)}, ${JSON.stringify(dataUrl)})`);
    rasterized.push({ wpId: job.wpId, kind: job.kind, reason: job.reason, src: job.src, result: 'screenshot' });
  }
  await page.evaluate('window.__ve.addStaticStyle()');
  await page.evaluate('window.__ve.waitForAssets()');

  return {
    canvases: prep.canvases.map((c) => ({
      ...c,
      effectiveDpi: c.cssWidth ? Math.round((c.pixelWidth / c.cssWidth) * 96) : 0,
    })),
    videos: prep.videos,
    pseudoConverted: prep.pseudoConverted,
    pseudoSkipped: prep.pseudoSkipped,
    bakedProps: prep.bakedProps,
    rasterized,
  };
}

/* ------------------------------------------------------------------ render */

export interface RenderOptions extends SandboxOptions {
  /** Freeze JS output into static content (default true). */
  freeze?: boolean;
  /** Also screenshot before freezing, for comparing (slower; used by tests). */
  verifyFreeze?: boolean;
  /** Collect the font report (default true). */
  fonts?: boolean;
  videoTimeSec?: number;
  fullPage?: boolean;
}

export interface Measure {
  width: number;
  height: number;
  smallestFontPx: number | null;
  smallestFontWpId: string | null;
}

export interface CaptureResult {
  /** Frozen, static document: scripts removed, JS output captured. */
  html: string;
  /** Screenshot of the frozen page. */
  screenshot: Buffer;
  /** Screenshot taken before freezing (only with verifyFreeze). */
  screenshotBeforeFreeze?: Buffer;
  baseUrl: string;
  wpIdCount: number;
  unstampedCount: number;
  freeze: FreezeReport | null;
  fonts: FontReport | null;
  measure: Measure;
}

export interface RenderResult extends CaptureResult {
  blockedRequests: string[];
  pageErrors: string[];
  durationMs: number;
}

/** Load the source and wait until it is visually stable, then stop its timers. */
export async function settlePage(s: SandboxSession, url: string) {
  const { page } = s;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForLoadState('networkidle');
  // Injected after load (not as an init script) so page code can't see or tamper with it first.
  await page.evaluate(IN_PAGE_JS);
  await page.evaluate('window.__ve.waitForAssets()');
  await page.evaluate('window.__ve.freezeAnimations()');
  await page.evaluate('window.__ve.waitForAssets()');
  await page.evaluate('window.__ve.stopTimers()');
}

/** Settle, stamp IDs, collect fonts, freeze and serialise, inside an open session. */
export async function captureInSession(s: SandboxSession, url: string, opts: RenderOptions = {}): Promise<CaptureResult> {
  const { page } = s;
  await settlePage(s, url);
  const wpIdCount = (await page.evaluate('window.__ve.stampWpIds()')) as number;
  const unstampedCount = (await page.evaluate('window.__ve.countUnstamped()')) as number;
  const fontUrls = s.requests.filter((r) => r.type === 'font').map((r) => r.url);
  const fonts = opts.fonts === false ? null : await collectFonts(page, fontUrls);
  const shot = () => page.screenshot({ fullPage: opts.fullPage ?? true, animations: 'disabled', caret: 'hide' });
  const screenshotBeforeFreeze = opts.verifyFreeze ? await shot() : undefined;
  const freeze = opts.freeze === false ? null : await freezePage(s, { videoTimeSec: opts.videoTimeSec });
  const measure = (await page.evaluate('window.__ve.measure()')) as Measure;
  const screenshot = await shot();
  const html = (await page.evaluate('window.__ve.serializeDom()')) as string;
  return { html, screenshot, screenshotBeforeFreeze, baseUrl: page.url(), wpIdCount, unstampedCount, fonts, freeze, measure };
}

/** Render a source: settle, stamp, collect fonts, freeze, screenshot, serialise. */
export async function renderSource(source: RenderSource, opts: RenderOptions = {}): Promise<RenderResult> {
  const started = Date.now();
  return withSandbox(source, opts, async (s) => {
    const r = await captureInSession(s, sourceUrl(source), opts);
    return {
      ...r,
      blockedRequests: [...new Set(s.blockedRequests)],
      pageErrors: s.pageErrors,
      durationMs: Date.now() - started,
    };
  });
}

/** Render a directory of HTML/CSS/JS (entry defaults to index.html). */
export function renderFixture(dir: string, opts: RenderOptions & { entry?: string } = {}): Promise<RenderResult> {
  return renderSource(dirSource(dir, opts.entry), opts);
}
