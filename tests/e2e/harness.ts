/**
 * End-to-end harness: starts the editor server on a free port with a temporary
 * data directory, and opens the editor in Chromium.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser, type Frame, type Page } from 'playwright';
import type { EditorDocument } from '../../src/model/types.js';

process.env.VE_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 've-e2e-'));

export interface Harness {
  base: string;
  browser: Browser;
  server: Server;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const { createAppServer, clientBundle } = await import('../../src/server/server.js');
  await clientBundle();
  const server = createAppServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // Same text rendering as the server's sandbox, so editor and Proof compare like for like.
  const browser = await chromium.launch({ args: ['--disable-gpu', '--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] });
  return {
    base,
    browser,
    server,
    async close() {
      await browser.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export async function api<T = unknown>(h: Harness, method: string, p: string, body?: unknown): Promise<T> {
  const r = await fetch(`${h.base}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${method} ${p}: ${await r.text()}`);
  const ct = r.headers.get('content-type') ?? '';
  return (ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer())) as T;
}

export async function createProject(h: Harness, body: Record<string, unknown>): Promise<string> {
  const r = await api<{ meta: { id: string } }>(h, 'POST', '/api/projects', body);
  return r.meta.id;
}

export async function openEditor(h: Harness, id: string, viewport = { width: 1600, height: 1000 }) {
  const page = await h.browser.newPage({ viewport });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    // Playwright's own evaluate() calls inside the sandboxed (script-free) preview
    // frames log this; it comes from the test tooling, not the editor.
    if (m.type() === 'error' && !m.text().startsWith('Blocked script execution in')) errors.push(m.text());
  });
  await page.goto(`${h.base}/project/${id}`);
  await page.waitForSelector('[data-testid="page-frame-1"]');
  await settle(page);
  return { page, errors };
}

/** Wait until every page iframe and its component frames have loaded. */
export async function settle(page: Page) {
  await page.waitForFunction(() => {
    const frames = Array.from(document.querySelectorAll<HTMLIFrameElement>('.page-frame'));
    return (
      frames.length > 0 &&
      frames.every((f) => {
        const d = f.contentDocument;
        if (!d || d.readyState !== 'complete') return false;
        return Array.from(d.querySelectorAll<HTMLIFrameElement>('iframe.ve-inner')).every((i) => i.contentDocument?.readyState === 'complete');
      })
    );
  });
  await page.waitForTimeout(200);
}

/** The frozen web pane's frame. */
export async function frozenFrame(page: Page): Promise<Frame> {
  const el = await page.waitForSelector('iframe[title="Frozen web page"]');
  return (await el.contentFrame())!;
}

/** The component frames inside page N. */
export async function componentFrames(page: Page, n = 1): Promise<Frame[]> {
  const el = await page.waitForSelector(`[data-testid="page-frame-${n}"]`);
  const pf = (await el.contentFrame())!;
  const inners = await pf.$$('iframe.ve-inner');
  return Promise.all(inners.map(async (i) => (await i.contentFrame())!));
}

export const getDoc = (page: Page) =>
  page.evaluate(() => (window as unknown as { __ve: { getDoc(): unknown } }).__ve.getDoc()) as Promise<EditorDocument>;

/** Apply a model operation through the editor (same path as a UI action). */
export async function editorOp(page: Page, fn: string, ...args: unknown[]) {
  await page.evaluate(
    ({ fn, args }) => {
      const ve = (window as unknown as { __ve: { commit(op: (d: unknown) => unknown): void; ops: Record<string, (...a: unknown[]) => unknown> } }).__ve;
      ve.commit((d) => ve.ops[fn]!(d, ...args));
    },
    { fn, args },
  );
  await settle(page);
}
