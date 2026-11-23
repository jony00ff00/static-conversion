/**
 * Browser-side capture for the static build: the same in-page helpers the
 * server runs through Playwright (src/render/inPage.browser.js), run in a
 * hidden same-origin iframe instead. Differences from the server:
 * - no screenshots, so iframes and failed images always become placeholders;
 * - "print styles" are baked before presets instead of emulating print media;
 * - no font report (it needs the DevTools protocol).
 */
import type { CapturePresets, DecompositionResult } from '../render/sandbox.js';
import type { FlowLayout } from '../flow/breaks.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ve = Record<string, (...a: any[]) => any>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what} took longer than ${ms / 1000} s`)), ms))]);
}

/** A hidden iframe that still lays out and paints (off-screen frames can be throttled). */
function hiddenFrame(widthPx: number, heightPx: number): HTMLIFrameElement {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  f.style.cssText = `position:fixed;left:0;top:0;width:${widthPx}px;height:${heightPx}px;border:0;opacity:0;pointer-events:none;z-index:-1`;
  return f;
}

const loaded = (f: HTMLIFrameElement) => new Promise<void>((resolve) => f.addEventListener('load', () => resolve(), { once: true }));

/** Wait until the frame stops starting new requests (a stand-in for "network idle"). */
async function quiet(win: Window, maxMs = 5_000) {
  let last = -1;
  const until = Date.now() + maxMs;
  while (Date.now() < until) {
    const n = win.performance.getEntriesByType('resource').length;
    if (n === last) return;
    last = n;
    await sleep(250);
  }
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

export interface BrowserCapture {
  html: string;
  baseUrl: string;
  decomposition: DecompositionResult;
  presetReport: { hidden: number; expanded: number; links: number } | null;
  warnings: string[];
}

export async function captureInBrowser(
  url: string,
  opts: {
    widthPx: number;
    presets?: CapturePresets;
    setupSteps?: Array<{ action: 'click'; selector: string }>;
    rules: Array<{ selector: string; action: 'component' | 'ignore' }>;
  },
): Promise<BrowserCapture> {
  const frame = hiddenFrame(opts.widthPx, 900);
  const isLoaded = loaded(frame);
  frame.src = url;
  document.body.appendChild(frame);
  try {
    return await withTimeout(
      (async () => {
        await isLoaded;
        const win = frame.contentWindow as (Window & { __ve?: Ve; __veStopTimers?: unknown; eval(s: string): unknown }) | null;
        if (!win || !win.__veStopTimers) throw new Error('The page could not be prepared for capture. Reload the editor and try again.');
        await quiet(win);
        win.eval(__IN_PAGE_JS__);
        const ve = win.__ve!;
        await ve.waitForAssets!();
        await ve.freezeAnimations!();
        await ve.waitForAssets!();
        ve.stopTimers!();

        const warnings: string[] = [];
        for (const step of opts.setupSteps ?? []) {
          let el: Element | null = null;
          try {
            el = win.document.querySelector(step.selector);
          } catch {
            /* invalid selector */
          }
          if (!el) {
            warnings.push(`Recorded step failed: ${step.action} ${step.selector}: element not found`);
            continue;
          }
          (el as HTMLElement).click();
          await ve.waitForAssets!();
        }
        if (opts.setupSteps?.length) {
          await ve.freezeAnimations!();
          ve.stopTimers!();
        }

        let presetReport: BrowserCapture['presetReport'] = null;
        if (opts.presets) {
          // No print-media emulation in a browser tab: bake the print rules in first.
          if (opts.presets.printMedia) ve.bakePrintMedia!();
          presetReport = plain(ve.applyPresets!(opts.presets));
          await ve.waitForAssets!();
        }
        ve.stampWpIds!();

        const prep = plain(await ve.prepareFreeze!({ videoTimeSec: 0 })) as { rasterJobs: Array<{ id: string; kind: string; src: string | null }> };
        for (const job of prep.rasterJobs) {
          const label =
            job.kind === 'img'
              ? `Image unavailable${job.src ? ` (${hostOf(job.src)})` : ''}`
              : `Embedded content unavailable${job.src ? ` (${hostOf(job.src)})` : ''}`;
          ve.applyPlaceholder!(job.id, label);
          warnings.push(`${label}: replaced with a placeholder.`);
        }
        ve.addStaticStyle!();
        await ve.waitForAssets!();

        const decomposition = plain(ve.decompose!(opts.rules)) as DecompositionResult;
        const html = String(ve.serializeDom!());
        return { html, baseUrl: win.location.href, decomposition, presetReport, warnings };
      })(),
      60_000,
      'Capturing the page',
    );
  } finally {
    frame.remove();
  }
}

/** Measure flow layout of an isolated component inside a frame of exactly `widthPx`. */
export async function measureFlowInBrowser(isolatedHtml: string, widthPx: number): Promise<FlowLayout> {
  const frame = hiddenFrame(widthPx, 900);
  const isLoaded = loaded(frame);
  frame.srcdoc = isolatedHtml;
  document.body.appendChild(frame);
  try {
    await withTimeout(isLoaded, 30_000, 'Measuring the layout');
    const win = frame.contentWindow as Window & { eval(s: string): unknown };
    await win.document.fonts.ready;
    return plain(win.eval(__FLOW_JS__)) as FlowLayout;
  } finally {
    frame.remove();
  }
}

/** Open the browser's print dialog for a composed A4 document ("Save as PDF"). */
export async function printHtml(html: string, widthPx: number, heightPx: number): Promise<void> {
  // Tests replace the dialog with a hook that receives the document.
  const hook = (window as unknown as { __vePrintHook?: (html: string) => void }).__vePrintHook;
  if (hook) return hook(html);
  const frame = hiddenFrame(widthPx, heightPx);
  const isLoaded = loaded(frame);
  frame.srcdoc = html;
  document.body.appendChild(frame);
  try {
    await withTimeout(isLoaded, 60_000, 'Preparing the print');
    const win = frame.contentWindow!;
    await win.document.fonts.ready;
    // Page frames are nested iframes: wait for their fonts and images too.
    for (const f of Array.from(win.document.querySelectorAll('iframe'))) {
      const d = f.contentDocument;
      if (d && d.readyState !== 'complete') await new Promise((r) => f.addEventListener('load', r, { once: true }));
      await f.contentDocument?.fonts.ready;
    }
    win.focus();
    win.print();
  } finally {
    // print() blocks in Chromium; elsewhere it returns at once, so keep the frame a little longer.
    setTimeout(() => frame.remove(), 60_000);
  }
}
