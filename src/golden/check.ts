import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderFixture, type RenderResult } from '../render/sandbox.js';
import { comparePng } from './compare.js';
import { DIFF_DIR, PIXEL_TOLERANCE, fixturePath, goldenPath } from './fixtures.js';

export interface GoldenMeta {
  wpIdCount: number;
  blockedRequests: string[];
  pageErrors: string[];
}

export interface GoldenOutcome {
  fixture: string;
  ok: boolean;
  domMatch: boolean;
  pixelRatio: number;
  metaMatch: boolean;
  missingGolden: boolean;
  durationMs: number;
  messages: string[];
}

const metaOf = (r: RenderResult): GoldenMeta => ({
  wpIdCount: r.wpIdCount,
  blockedRequests: [...r.blockedRequests].sort(),
  pageErrors: r.pageErrors,
});

export async function writeGolden(fixture: string, r: RenderResult) {
  await mkdir(path.dirname(goldenPath(fixture, 'x')), { recursive: true });
  await writeFile(goldenPath(fixture, 'dom.html'), r.html);
  await writeFile(goldenPath(fixture, 'screenshot.png'), r.screenshot);
  await writeFile(goldenPath(fixture, 'meta.json'), JSON.stringify(metaOf(r), null, 2) + '\n');
}

/** Render a fixture and compare it with its stored golden files. */
export async function checkGolden(fixture: string, opts: { update?: boolean } = {}): Promise<GoldenOutcome> {
  const r = await renderFixture(fixturePath(fixture));
  if (opts.update) {
    await writeGolden(fixture, r);
    return { fixture, ok: true, domMatch: true, pixelRatio: 0, metaMatch: true, missingGolden: false, durationMs: r.durationMs, messages: ['golden updated'] };
  }
  const messages: string[] = [];
  let dom: string, png: Buffer, meta: GoldenMeta;
  try {
    [dom, png, meta] = await Promise.all([
      readFile(goldenPath(fixture, 'dom.html'), 'utf8'),
      readFile(goldenPath(fixture, 'screenshot.png')),
      readFile(goldenPath(fixture, 'meta.json'), 'utf8').then((s) => JSON.parse(s) as GoldenMeta),
    ]);
  } catch {
    return { fixture, ok: false, domMatch: false, pixelRatio: 1, metaMatch: false, missingGolden: true, durationMs: r.durationMs, messages: ['no golden files — run npm run golden:update'] };
  }
  const domMatch = dom === r.html;
  if (!domMatch) messages.push('frozen DOM differs from golden');
  const diff = comparePng(png, r.screenshot, { withDiffImage: true });
  if (diff.sizeMismatch) messages.push('screenshot size differs from golden');
  else if (diff.ratio > PIXEL_TOLERANCE) messages.push(`screenshot differs by ${(diff.ratio * 100).toFixed(3)}% (> ${PIXEL_TOLERANCE * 100}%)`);
  const metaMatch = JSON.stringify(meta) === JSON.stringify(metaOf(r));
  if (!metaMatch) messages.push('meta (wp-id count / blocked requests / page errors) differs');
  const ok = domMatch && !diff.sizeMismatch && diff.ratio <= PIXEL_TOLERANCE && metaMatch;
  if (!ok) {
    const out = path.join(DIFF_DIR, fixture);
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'actual.png'), r.screenshot);
    await writeFile(path.join(out, 'actual.html'), r.html);
    if (diff.diffPng) await writeFile(path.join(out, 'diff.png'), diff.diffPng);
  }
  return { fixture, ok, domMatch, pixelRatio: diff.ratio, metaMatch, missingGolden: false, durationMs: r.durationMs, messages };
}
