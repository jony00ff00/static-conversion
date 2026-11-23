/**
 * The static build captures in the visitor's browser instead of the server's
 * sandbox. Both run the same in-page helpers, so the stable IDs and the
 * components found should match the server's for the test pages.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { chromium, type Browser } from 'playwright';
import { createStaticServer, STATIC_PREFIX } from '../../scripts/serve-static.js';
import { analyse, FIXTURES_DIR } from '../../src/server/projects.js';
import { dirSource } from '../../src/render/sandbox.js';
import { newEditorDocument } from '../../src/model/ops.js';
import type { AnalysisNode } from '../../src/model/types.js';
import { settle } from './harness.js';

let server: Server | undefined;
let browser: Browser | undefined;
let base: string;

beforeAll(async () => {
  const out = mkdtempSync(path.join(tmpdir(), 've-static-'));
  execFileSync('npx', ['tsx', 'scripts/build-static.ts', out], { stdio: 'pipe' });
  server = createStaticServer(out);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${STATIC_PREFIX}`;
  browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
});

async function staticNodes(name: string): Promise<AnalysisNode[]> {
  const page = await browser!.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(base);
  await page.click(`[data-fixture="${name}"]`);
  await page.waitForSelector('[data-testid="page-frame-1"]', { timeout: 60_000 });
  await settle(page);
  const id = /#\/project\/([a-z0-9-]+)/.exec(page.url())![1]!;
  const nodes = await page.evaluate(async (id) => {
    const req = indexedDB.open('static-conversion', 1);
    const db: IDBDatabase = await new Promise((r) => (req.onsuccess = () => r(req.result)));
    const get = db.transaction('projects').objectStore('projects').get(id);
    const p = await new Promise<{ analysis: { nodes: unknown[] } }>((r) => (get.onsuccess = () => r(get.result)));
    return p.analysis.nodes;
  }, id);
  await page.close();
  return nodes as AnalysisNode[];
}

async function serverNodes(name: string): Promise<AnalysisNode[]> {
  const probe = newEditorDocument({ captureWidthPx: 680, documentHeightPx: 1, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] }, 'x', 680);
  const a = await analyse(dirSource(path.join(FIXTURES_DIR, name)), { ...probe, captureWidthPx: 680 });
  return a.analysis.nodes;
}

describe('Static build matches the server capture', () => {
  for (const name of ['01-static', '03-bootstrap', '08-long-article', '09-div-soup']) {
    it(`finds the same components in ${name}`, async () => {
      const [s, b] = await Promise.all([serverNodes(name), staticNodes(name)]);
      expect(s.length).toBeGreaterThan(3);
      const ids = (ns: AnalysisNode[]) => ns.map((n) => n.wpId).sort();
      expect(ids(b)).toEqual(ids(s));
      const kinds = (ns: AnalysisNode[]) => Object.fromEntries(ns.map((n) => [n.wpId, `${n.kind}/${n.depth}`]));
      expect(kinds(b)).toEqual(kinds(s));
      // Same layout: boxes agree to within 2 px in total.
      const sb = new Map(s.map((n) => [n.wpId, n.bbox]));
      for (const n of b) {
        const o = sb.get(n.wpId)!;
        expect(Math.abs(n.bbox.y - o.y) + Math.abs(n.bbox.h - o.h) + Math.abs(n.bbox.w - o.w), n.wpId).toBeLessThanOrEqual(2);
      }
    }, 180_000);
  }
});
