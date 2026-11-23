import { describe, expect, it } from 'vitest';
import { exportA4 } from '../src/export/a4.js';
import { readPngInfo, setPngDpi } from '../src/export/png.js';
import { importPaste } from '../src/import/index.js';
import { dirSource } from '../src/render/sandbox.js';
import { fixture, pdfPageSize, poppler, rasterisePdf, redBoxEdgesMm, writeTmp } from './helpers.js';

/** Automated margin tolerance (the physical print check allows ±1 mm). */
const TOL_MM = 0.1;

/** A page that is solid red everywhere, to measure where the content area lands. */
const solidRed = () =>
  importPaste({ html: '<div></div>', css: 'html,body{margin:0;background:#f00;min-height:5000px}' }).then((i) => i.source);

describe('A4 page size', () => {
  it('PDF portrait is exactly 595.276 × 841.89 pt (210 × 297 mm), one page', async () => {
    const { data } = await exportA4(dirSource(fixture('01-static')), { format: 'pdf' });
    const s = pdfPageSize(writeTmp(data, 'p.pdf'));
    expect(s.pages).toBe(1);
    expect(s.width).toBeCloseTo(595.276, 2);
    expect(s.height).toBeCloseTo(841.89, 2);
  });

  it('PDF landscape is 841.89 × 595.276 pt', async () => {
    const { data } = await exportA4(dirSource(fixture('01-static')), { format: 'pdf', pageSetup: { orientation: 'landscape' } });
    const s = pdfPageSize(writeTmp(data, 'l.pdf'));
    expect(s.width).toBeCloseTo(841.89, 2);
    expect(s.height).toBeCloseTo(595.276, 2);
  });

  it('PNG is 2480 × 3508 px and tagged 300 dpi', async () => {
    const { data, report } = await exportA4(dirSource(fixture('01-static')), { format: 'png' });
    expect(readPngInfo(data)).toEqual({ width: 2480, height: 3508, dpi: 300 });
    expect(report.pngSizePx).toEqual({ width: 2480, height: 3508 });
  });

  it('PNG landscape is 3508 × 2480 px', async () => {
    const { data } = await exportA4(dirSource(fixture('01-static')), { format: 'png', pageSetup: { orientation: 'landscape' } });
    expect(readPngInfo(data)).toMatchObject({ width: 3508, height: 2480 });
  });

  it('setPngDpi writes a pHYs chunk readers understand', async () => {
    const { data } = await exportA4(dirSource(fixture('09-div-soup')), { format: 'png', dpi: 150 });
    expect(readPngInfo(data).dpi).toBe(150);
    expect(readPngInfo(setPngDpi(data, 600)).dpi).toBe(600);
  });
});

describe('margins land on the exact mm position (± 0.1 mm)', () => {
  const cases = [
    { name: 'default 20/15/20/15', margins: undefined, expect: { top: 20, right: 15, bottom: 20, left: 15 } },
    { name: 'odd 10/25/30/12.5', margins: { top: 10, right: 25, bottom: 30, left: 12.5 }, expect: { top: 10, right: 25, bottom: 30, left: 12.5 } },
  ];

  it.each(cases)('PNG at 300 dpi: $name', async ({ margins, expect: m }) => {
    const { data } = await exportA4(await solidRed(), { format: 'png', pageSetup: { marginsMm: margins } });
    const e = redBoxEdgesMm(data, 300);
    expect(Math.abs(e.left - m.left)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(e.top - m.top)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(210 - e.right - m.right)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(297 - e.bottom - m.bottom)).toBeLessThanOrEqual(TOL_MM);
  });

  it.each(cases)('PDF (rasterised at 600 dpi): $name', async ({ margins, expect: m }) => {
    const { data } = await exportA4(await solidRed(), { format: 'pdf', pageSetup: { marginsMm: margins } });
    const e = redBoxEdgesMm(rasterisePdf(writeTmp(data, 'm.pdf'), 600), 600);
    expect(Math.abs(e.left - m.left)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(e.top - m.top)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(210 - e.right - m.right)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(297 - e.bottom - m.bottom)).toBeLessThanOrEqual(TOL_MM);
  });

  it('landscape content area is placed correctly too', async () => {
    const { data } = await exportA4(await solidRed(), { format: 'png', pageSetup: { orientation: 'landscape' } });
    const e = redBoxEdgesMm(data, 300);
    expect(Math.abs(e.left - 15)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(e.top - 20)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(297 - e.right - 15)).toBeLessThanOrEqual(TOL_MM);
    expect(Math.abs(210 - e.bottom - 20)).toBeLessThanOrEqual(TOL_MM);
  });
});

describe('PDF content', () => {
  it('embeds every font', async () => {
    for (const name of ['01-static', '07-webfonts']) {
      const { data } = await exportA4(dirSource(fixture(name)), { format: 'pdf' });
      const rows = poppler('pdffonts', [writeTmp(data, 'f.pdf')]).trim().split('\n').slice(2);
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) expect(row).toMatch(/\s(yes)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+$/);
    }
  });

  it('keeps text and SVG text as real, selectable text (vector)', async () => {
    const svg = await exportA4(dirSource(fixture('06-svg-infographic')), { format: 'pdf' });
    const svgText = poppler('pdftotext', [writeTmp(svg.data, 's.pdf'), '-']);
    expect(svgText).toContain('Water use in 2025');
    expect(svgText).toContain('62%');
    const fonts = await exportA4(dirSource(fixture('07-webfonts')), { format: 'pdf' });
    expect(poppler('pdftotext', [writeTmp(fonts.data, 'w.pdf'), '-'])).toContain('Inter, self-hosted');
  });
});

describe('export report', () => {
  it('lays the page out at the content-area width (680 px) by default, at 1:1', async () => {
    const { report } = await exportA4(dirSource(fixture('01-static')), { format: 'pdf' });
    expect(report.captureWidthPx).toBe(680);
    expect(report.scale).toBeCloseTo(1, 2);
    expect(report.smallestTextPt).toBeGreaterThanOrEqual(10);
  });

  it('canvases are captured at print resolution (≥ 300 dpi at 1:1)', async () => {
    const { report } = await exportA4(dirSource(fixture('05-canvas-chart')), { format: 'pdf' });
    for (const c of report.freeze!.canvases) expect(c.effectiveDpi).toBeGreaterThanOrEqual(299);
  });

  it('warns when content is wider than the capture width, and not when shrunk to fit', async () => {
    const clipped = await exportA4(dirSource(fixture('05-canvas-chart')), { format: 'pdf' });
    expect(clipped.report.documentWidthPx).toBeGreaterThan(680);
    expect(clipped.report.warnings.some((w) => w.includes('cut off at the right'))).toBe(true);
    const fitted = await exportA4(dirSource(fixture('05-canvas-chart')), { format: 'pdf', captureWidthPx: 1184, fit: 'shrink' });
    expect(fitted.report.warnings.some((w) => w.includes('cut off'))).toBe(false);
    expect(fitted.report.scale).toBeCloseTo(680.315 / 1184, 3);
  });

  it('clip reports content cut off at the bottom; shrink fits it and warns about tiny text', async () => {
    const clip = await exportA4(dirSource(fixture('08-long-article')), { format: 'pdf' });
    expect(clip.report.overflowMm).toBeGreaterThan(100);
    expect(clip.report.warnings.some((w) => w.includes('below the content area is cut off'))).toBe(true);
    const shrink = await exportA4(dirSource(fixture('08-long-article')), { format: 'pdf', fit: 'shrink' });
    expect(shrink.report.overflowMm).toBe(0);
    expect(shrink.report.scale).toBeLessThan(0.3);
    expect(shrink.report.smallestTextPt).toBeLessThan(6);
    expect(shrink.report.warnings.some((w) => w.includes('may be unreadable'))).toBe(true);
  });

  it('lists blocked embeds and images in the warnings', async () => {
    const { report } = await exportA4(dirSource(fixture('12-cross-origin-iframe')), { format: 'pdf' });
    expect(report.warnings.filter((w) => w.includes('replaced with a placeholder'))).toHaveLength(2);
  });
});
