import { PRINT_DEFAULTS, cssPxToPt, mmToCssPx, mmToDevicePx } from '../config/printDefaults.js';
import { PageSetupSchema, contentAreaMm, trimSizeMm, type PageSetup } from '../schema/document.js';
import {
  captureInSession,
  sourceUrl,
  withSandbox,
  type FreezeReport,
  type RenderSource,
} from '../render/sandbox.js';
import type { FontReport } from '../render/fonts.js';
import { cropPng, setPngDpi } from './png.js';
import { setExactPageSize } from './pdf.js';

export type ExportFormat = 'pdf' | 'png';
/** clip: place at full width and cut off what doesn't fit; shrink: scale down to fit the whole page. */
export type ExportFit = 'clip' | 'shrink';

export interface ExportOptions {
  format: ExportFormat;
  /** Page setup; anything omitted uses the A4 defaults (placeholder margins). */
  pageSetup?: Partial<Pick<PageSetup, 'orientation' | 'marginsMm' | 'bleedMm'>>;
  /** Raster resolution for PNG, and for canvases/screenshots embedded in the PDF. Default 300. */
  dpi?: number;
  fit?: ExportFit;
  /**
   * Width (CSS px) the source is laid out at. Defaults to the content-area width
   * (680 px for 180 mm), so text keeps its intended size on paper.
   */
  captureWidthPx?: number;
  /** Draw margin guides and mm rulers (for the margin test page). */
  guides?: boolean;
  timeoutMs?: number;
}

export interface ExportReport {
  format: ExportFormat;
  pageSetup: PageSetup;
  trimMm: { width: number; height: number };
  contentAreaMm: { x: number; y: number; width: number; height: number };
  dpi: number;
  fit: ExportFit;
  captureWidthPx: number;
  documentHeightPx: number;
  /** Width of the laid-out document; more than captureWidthPx means content is cut off at the right. */
  documentWidthPx: number;
  /** Scale applied to the captured document when placing it in the content area. */
  scale: number;
  /** Content cut off below the content area (clip mode), in mm on paper. */
  overflowMm: number;
  /** Smallest visible text size on paper, in points. */
  smallestTextPt: number | null;
  smallestTextWpId: string | null;
  pngSizePx?: { width: number; height: number };
  fonts: FontReport | null;
  freeze: FreezeReport | null;
  blockedRequests: string[];
  pageErrors: string[];
  warnings: string[];
  durationMs: number;
}

export interface ExportResult {
  data: Buffer;
  report: ExportReport;
  /** The frozen document that was placed on the page. */
  frozenHtml: string;
}

/** Below this, text is very hard to read on paper (placeholder; preflight in M8). */
export const MIN_TEXT_PT = 6;

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function resolvePageSetup(p: ExportOptions['pageSetup'] = {}): PageSetup {
  return PageSetupSchema.parse({
    size: 'A4',
    orientation: p.orientation ?? PRINT_DEFAULTS.orientation,
    marginsMm: p.marginsMm ?? { ...PRINT_DEFAULTS.marginsMm },
    marginsLinked: false,
    bleedMm: p.bleedMm ?? PRINT_DEFAULTS.bleedMm,
  });
}

/** Insert <base> so relative URLs in the frozen document resolve against the source. */
export function withBase(html: string, baseUrl: string): string {
  const tag = `<base href="${escapeAttr(baseUrl)}">`;
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (m) => m + tag) : tag + html;
}

/** SVG overlay: content-box outline, mm rulers on every edge, and labels. */
function guidesSvg(setup: PageSetup, pageW: number, pageH: number, bleed: number): string {
  const trim = trimSizeMm(setup.orientation);
  const c = contentAreaMm(setup);
  const m = setup.marginsMm;
  const ticks: string[] = [];
  const tick = (x1: number, y1: number, x2: number, y2: number) =>
    ticks.push(`<line x1="${r3(x1)}" y1="${r3(y1)}" x2="${r3(x2)}" y2="${r3(y2)}"/>`);
  const len = (mm: number) => (mm % 10 === 0 ? 5 : mm % 5 === 0 ? 3.5 : 2);
  const labels: string[] = [];
  for (let x = 0; x <= trim.width; x++) {
    tick(bleed + x, bleed, bleed + x, bleed + len(x));
    tick(bleed + x, bleed + trim.height, bleed + x, bleed + trim.height - len(x));
    if (x % 10 === 0 && x > 0 && x < trim.width) labels.push(`<text x="${bleed + x}" y="${bleed + 8}" text-anchor="middle">${x}</text>`);
  }
  for (let y = 0; y <= trim.height; y++) {
    tick(bleed, bleed + y, bleed + len(y), bleed + y);
    tick(bleed + trim.width, bleed + y, bleed + trim.width - len(y), bleed + y);
    if (y % 10 === 0 && y > 0 && y < trim.height) labels.push(`<text x="${bleed + 7}" y="${bleed + y + 1}">${y}</text>`);
  }
  const midX = bleed + trim.width / 2;
  const midY = bleed + trim.height / 2;
  return `<svg class="ve-guides" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pageW} ${pageH}" width="${pageW}mm" height="${pageH}mm">
<g stroke="#000" stroke-width="0.15">${ticks.join('')}</g>
<g font-family="sans-serif" font-size="2.4" fill="#000">${labels.join('')}</g>
<rect x="${bleed + c.x}" y="${bleed + c.y}" width="${c.width}" height="${c.height}" fill="none" stroke="#e11d48" stroke-width="0.25"/>
<g font-family="sans-serif" font-size="3" fill="#e11d48" text-anchor="middle">
<text x="${midX}" y="${bleed + c.y + 4}">↑ Top margin ${m.top} mm</text>
<text x="${midX}" y="${bleed + c.y + c.height - 2}">↓ Bottom margin ${m.bottom} mm</text>
<text transform="translate(${bleed + c.x + 4} ${midY}) rotate(-90)">Left margin ${m.left} mm</text>
<text transform="translate(${bleed + c.x + c.width - 4} ${midY}) rotate(90)">Right margin ${m.right} mm</text>
</g>
</svg>`;
}

/** Build the A4 print page: the frozen document in a script-free iframe, placed at the margins. */
export function composePrintHtml(args: {
  frozenHtml: string;
  baseUrl: string;
  setup: PageSetup;
  captureWidthPx: number;
  documentHeightPx: number;
  scale: number;
  guides: boolean;
}): string {
  const { setup } = args;
  const trim = trimSizeMm(setup.orientation);
  const bleed = setup.bleedMm;
  const pageW = trim.width + 2 * bleed;
  const pageH = trim.height + 2 * bleed;
  const c = contentAreaMm(setup);
  const doc = withBase(args.frozenHtml, args.baseUrl);
  // Chromium snaps box positions and sizes to whole CSS pixels (15 mm = 56.69 px
  // would be drawn at 57 px = 15.08 mm). Transforms and clip-path geometry are not
  // snapped, so the content area is placed with translate() and clipped with an
  // exact polygon: margins land on the exact mm position in both PDF and PNG.
  const cx = mmToCssPx(bleed + c.x);
  const cy = mmToCssPx(bleed + c.y);
  const cw = mmToCssPx(c.width);
  const ch = mmToCssPx(c.height);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>A4 export</title>
<style>
@page { size: ${pageW}mm ${pageH}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ve-page { position: relative; width: ${pageW}mm; height: ${pageH}mm; overflow: hidden; background: #fff; }
.ve-content { position: absolute; left: 0; top: 0; width: ${Math.ceil(cw)}px; height: ${Math.ceil(ch)}px; transform: translate(${cx}px, ${cy}px); transform-origin: 0 0; clip-path: polygon(0 0, ${cw}px 0, ${cw}px ${ch}px, 0 ${ch}px); }
.ve-frame { display: block; border: 0; margin: 0; padding: 0; width: ${args.captureWidthPx}px; height: ${args.documentHeightPx}px; transform: scale(${args.scale}); transform-origin: 0 0; }
.ve-guides { position: absolute; left: 0; top: 0; pointer-events: none; }
</style></head>
<body><div class="ve-page"><div class="ve-content"><iframe class="ve-frame" sandbox="allow-same-origin" scrolling="no" srcdoc="${escapeAttr(doc)}"></iframe></div>${
    args.guides ? guidesSvg(setup, pageW, pageH, bleed) : ''
  }</div></body></html>`;
}

/**
 * Export a source as a single A4 page (PDF or PNG). The source is re-rendered
 * at the content-area width and at print resolution, frozen, and placed inside
 * the margins. Content taller than the page is cut off (clip) or scaled down
 * (shrink); multi-page output arrives with pagination in M6.
 */
export async function exportA4(source: RenderSource, opts: ExportOptions): Promise<ExportResult> {
  const started = Date.now();
  const setup = resolvePageSetup(opts.pageSetup);
  const dpi = opts.dpi ?? PRINT_DEFAULTS.dpi;
  const scaleFactor = dpi / 96;
  const fit = opts.fit ?? 'clip';
  const trim = trimSizeMm(setup.orientation);
  const c = contentAreaMm(setup);
  const contentWpx = mmToCssPx(c.width);
  const contentHpx = mmToCssPx(c.height);
  const captureWidthPx = opts.captureWidthPx ?? Math.round(contentWpx);
  const pageWmm = trim.width + 2 * setup.bleedMm;
  const pageHmm = trim.height + 2 * setup.bleedMm;

  return withSandbox(
    source,
    { viewport: { width: captureWidthPx, height: Math.round(contentHpx) }, scale: scaleFactor, timeoutMs: opts.timeoutMs ?? 60_000 },
    async (s) => {
      const cap = await captureInSession(s, sourceUrl(source), { fullPage: false });
      const docH = Math.max(1, cap.measure.height);
      const widthScale = contentWpx / captureWidthPx;
      const scale = fit === 'shrink' ? Math.min(widthScale, contentHpx / docH) : widthScale;
      const overflowPx = Math.max(0, docH * scale - contentHpx);
      const overflowMm = r3((overflowPx / 96) * 25.4);

      const html = composePrintHtml({
        frozenHtml: cap.html,
        baseUrl: cap.baseUrl,
        setup,
        captureWidthPx,
        documentHeightPx: docH,
        scale,
        guides: !!opts.guides,
      });
      const url = s.serve('print.html', html);
      const { page } = s;
      // Print with screen styles, so the PDF matches the preview and the PNG.
      // (Applying the author's @media print rules is an explicit preset, in M3.)
      await page.emulateMedia({ media: 'screen' });
      await page.setViewportSize({ width: Math.ceil(mmToCssPx(pageWmm)), height: Math.ceil(mmToCssPx(pageHmm)) });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      const frame = page.frames().find((f) => f !== page.mainFrame());
      if (frame) await frame.evaluate('document.fonts.ready').catch(() => undefined);

      let data: Buffer;
      let pngSizePx: ExportReport['pngSizePx'];
      if (opts.format === 'pdf') {
        const raw = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        data = await setExactPageSize(raw, pageWmm, pageHmm);
      } else {
        const wDev = mmToDevicePx(pageWmm, dpi);
        const hDev = mmToDevicePx(pageHmm, dpi);
        // Screenshot clips are whole CSS pixels; capture slightly more, then crop
        // to the exact device-pixel size (2480 × 3508 at 300 dpi).
        const shot = await page.screenshot({
          clip: { x: 0, y: 0, width: Math.ceil(wDev / scaleFactor), height: Math.ceil(hDev / scaleFactor) },
          animations: 'disabled',
          caret: 'hide',
        });
        data = setPngDpi(cropPng(shot, wDev, hDev), dpi);
        pngSizePx = { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
      }

      const horizontalOverflowPx = Math.max(0, cap.measure.width - captureWidthPx);
      const smallestTextPt =
        cap.measure.smallestFontPx === null ? null : Math.round(cssPxToPt(cap.measure.smallestFontPx * scale) * 10) / 10;
      const warnings: string[] = [];
      if (overflowMm > 0.5) {
        warnings.push(
          `${overflowMm.toFixed(1)} mm of content below the content area is cut off. Use fit "shrink", or wait for multi-page layout (M6).`,
        );
      }
      if (horizontalOverflowPx > 1) {
        const cutMm = (horizontalOverflowPx * scale * 25.4) / 96;
        warnings.push(
          `Content is ${cap.measure.width} px wide but was laid out at ${captureWidthPx} px; ` +
            `${cutMm.toFixed(1)} mm is cut off at the right. Export with a capture width of at least ` +
            `${cap.measure.width} px and fit "shrink" to include it.`,
        );
      }
      if (smallestTextPt !== null && smallestTextPt < MIN_TEXT_PT) {
        warnings.push(`Smallest text is ${smallestTextPt} pt on paper (below ${MIN_TEXT_PT} pt) and may be unreadable.`);
      }
      if (cap.fonts) warnings.push(...cap.fonts.warnings);
      for (const r of cap.freeze?.rasterized ?? []) {
        warnings.push(
          r.result === 'placeholder'
            ? `${r.kind === 'img' ? 'Image' : 'Embedded ' + r.kind} ${r.src ?? ''} could not be loaded (${r.reason}) and was replaced with a placeholder.`
            : `A ${r.kind} was captured as an image (${r.reason}); it will not be vector in the PDF.`,
        );
      }
      for (const p of cap.freeze?.pseudoSkipped ?? []) {
        warnings.push(`A ::${p.which} element uses content the editor can't make static (${p.content}); it is kept as-is.`);
      }
      const blocked = [...new Set(s.blockedRequests)];
      if (blocked.length) warnings.push(`${blocked.length} outside request(s) were blocked by the sandbox.`);

      return {
        data,
        frozenHtml: cap.html,
        report: {
          format: opts.format,
          pageSetup: setup,
          trimMm: trim,
          contentAreaMm: c,
          dpi,
          fit,
          captureWidthPx,
          documentHeightPx: docH,
          documentWidthPx: cap.measure.width,
          scale: r3(scale),
          overflowMm,
          smallestTextPt,
          smallestTextWpId: cap.measure.smallestFontWpId,
          pngSizePx,
          fonts: cap.fonts,
          freeze: cap.freeze,
          blockedRequests: blocked,
          pageErrors: s.pageErrors,
          warnings,
          durationMs: Date.now() - started,
        },
      };
    },
  );
}
