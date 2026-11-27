import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dirSource, renderFixture, type RenderResult } from '../render/sandbox.js';
import { exportA4 } from '../export/a4.js';
import { comparePng } from './compare.js';
import { DIFF_DIR, PIXEL_TOLERANCE, fixturePath, goldenPath } from './fixtures.js';

export interface GoldenMeta {
  wpIdCount: number;
  blockedRequests: string[];
  pageErrors: string[];
  freeze: { canvases: number; videos: number; pseudoConverted: number; pseudoSkipped: number; placeholders: number; screenshots: number };
  fonts: string[];
  export: { captureWidthPx: number; documentHeightPx: number; overflowMm: number; smallestTextPt: number | null };
}

/** Golden A4 exports are stored at 96 dpi to keep the repository small. */
export const GOLDEN_EXPORT_DPI = 96;

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

type ExportOut = Awaited<ReturnType<typeof exportA4>>;

const metaOf = (r: RenderResult, e: ExportOut): GoldenMeta => ({
  wpIdCount: r.wpIdCount,
  blockedRequests: [...r.blockedRequests].sort(),
  pageErrors: r.pageErrors,
  freeze: {
    canvases: r.freeze?.canvases.length ?? 0,
    videos: r.freeze?.videos.length ?? 0,
    pseudoConverted: r.freeze?.pseudoConverted ?? 0,
    pseudoSkipped: r.freeze?.pseudoSkipped.length ?? 0,
    placeholders: r.freeze?.rasterized.filter((x) => x.result === 'placeholder').length ?? 0,
    screenshots: r.freeze?.rasterized.filter((x) => x.result === 'screenshot').length ?? 0,
  },
  fonts: (r.fonts?.groups ?? [])
    .map((g) => `${g.requested} ${g.weight} ${g.style}: ${g.status} (${g.used.map((u) => u.familyName).join(', ')})`)
    .sort(),
  export: {
    captureWidthPx: e.report.captureWidthPx,
    documentHeightPx: e.report.documentHeightPx,
    overflowMm: e.report.overflowMm,
    smallestTextPt: e.report.smallestTextPt,
  },
});

const renderBoth = async (fixture: string) => {
  const r = await renderFixture(fixturePath(fixture));
  const e = await exportA4(dirSource(fixturePath(fixture)), { format: 'png', dpi: GOLDEN_EXPORT_DPI });
  return { r, e };
};

export async function writeGolden(fixture: string, r: RenderResult, e: ExportOut) {
  await mkdir(path.dirname(goldenPath(fixture, 'x')), { recursive: true });
  await writeFile(goldenPath(fixture, 'dom.html'), r.html);
  await writeFile(goldenPath(fixture, 'screenshot.png'), r.screenshot);
  await writeFile(goldenPath(fixture, 'a4-96dpi.png'), e.data);
  await writeFile(goldenPath(fixture, 'meta.json'), JSON.stringify(metaOf(r, e), null, 2) + '\n');
}

/**
 * Frozen canvases and screenshots are embedded as PNG data URLs. Their bytes
 * depend on anti-aliasing, which differs slightly between machines, so the
 * golden DOM comparison ignores their contents; the screenshot and A4
 * comparisons check how they look. (Repeat renders on one machine are still
 * compared byte for byte by the determinism tests.)
 */
export const normaliseRasters = (html: string) => html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, 'data:image/png;base64,<raster>');

/** Render a fixture and compare it with its stored golden files. */
export async function checkGolden(fixture: string, opts: { update?: boolean } = {}): Promise<GoldenOutcome> {
  const { r, e } = await renderBoth(fixture);
  if (opts.update) {
    await writeGolden(fixture, r, e);
    return { fixture, ok: true, domMatch: true, pixelRatio: 0, metaMatch: true, missingGolden: false, durationMs: r.durationMs, messages: ['golden updated'] };
  }
  const messages: string[] = [];
  let dom: string, png: Buffer, a4: Buffer, meta: GoldenMeta;
  try {
    [dom, png, a4, meta] = await Promise.all([
      readFile(goldenPath(fixture, 'dom.html'), 'utf8'),
      readFile(goldenPath(fixture, 'screenshot.png')),
      readFile(goldenPath(fixture, 'a4-96dpi.png')),
      readFile(goldenPath(fixture, 'meta.json'), 'utf8').then((s) => JSON.parse(s) as GoldenMeta),
    ]);
  } catch {
    return { fixture, ok: false, domMatch: false, pixelRatio: 1, metaMatch: false, missingGolden: true, durationMs: r.durationMs, messages: ['no golden files — run npm run golden:update'] };
  }
  const domMatch = normaliseRasters(dom) === normaliseRasters(r.html);
  if (!domMatch) messages.push('frozen DOM differs from golden');
  const diff = comparePng(png, r.screenshot, { withDiffImage: true });
  if (diff.sizeMismatch) messages.push('screenshot size differs from golden');
  else if (diff.ratio > PIXEL_TOLERANCE) messages.push(`screenshot differs by ${(diff.ratio * 100).toFixed(3)}% (> ${PIXEL_TOLERANCE * 100}%)`);
  const a4Diff = comparePng(a4, e.data, { withDiffImage: true });
  if (a4Diff.sizeMismatch) messages.push('A4 export size differs from golden');
  else if (a4Diff.ratio > PIXEL_TOLERANCE) messages.push(`A4 export differs by ${(a4Diff.ratio * 100).toFixed(3)}% (> ${PIXEL_TOLERANCE * 100}%)`);
  const metaMatch = JSON.stringify(meta) === JSON.stringify(metaOf(r, e));
  if (!metaMatch) messages.push('meta (IDs, blocked requests, errors, freeze, fonts or export summary) differs');
  const a4Ok = !a4Diff.sizeMismatch && a4Diff.ratio <= PIXEL_TOLERANCE;
  const ok = domMatch && !diff.sizeMismatch && diff.ratio <= PIXEL_TOLERANCE && a4Ok && metaMatch;
  if (!ok) {
    const out = path.join(DIFF_DIR, fixture);
    await mkdir(out, { recursive: true });
    await writeFile(path.join(out, 'actual.png'), r.screenshot);
    await writeFile(path.join(out, 'actual.html'), r.html);
    if (diff.diffPng) await writeFile(path.join(out, 'diff.png'), diff.diffPng);
    await writeFile(path.join(out, 'actual-a4-96dpi.png'), e.data);
    if (a4Diff.diffPng) await writeFile(path.join(out, 'diff-a4.png'), a4Diff.diffPng);
    await writeFile(path.join(out, 'actual-meta.json'), JSON.stringify(metaOf(r, e), null, 2) + '\n');
  }
  return { fixture, ok, domMatch, pixelRatio: diff.ratio, metaMatch, missingGolden: false, durationMs: r.durationMs, messages };
}
