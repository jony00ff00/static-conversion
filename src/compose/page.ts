/**
 * A4 page composition. The editor's print pane, the server Proof view and the
 * export all render exactly this HTML, so what you see is what you export.
 *
 * Chromium snaps box positions and sizes to whole CSS pixels, so every frame is
 * positioned with transforms and clipped with an exact clip-path polygon (see M1).
 */
import { contentRectMm, mmToPx, trimMm } from '../model/geometry.js';
import type { ComponentDef, EditorDocument, FlowSlice, Placement } from '../model/types.js';

/** Returns the isolated HTML for a component laid out at `widthPx`. */
export type HtmlFor = (def: ComponentDef, widthPx: number) => string;

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const r4 = (n: number) => Math.round(n * 10000) / 10000;

export interface FrameGeometry {
  /** Frame size in CSS px. */
  w: number;
  h: number;
  /** Layout width of the component inside the frame (CSS px, before scaling). */
  layoutWidth: number;
  /** Uniform scale applied to the component. */
  scale: number;
  /** Offset of the component inside the frame, before scaling (CSS px). */
  offsetX: number;
  offsetY: number;
  /** Height the inner iframe needs (CSS px, before scaling). */
  innerHeight: number;
}

export function frameGeometry(p: Placement, def: ComponentDef, slice?: FlowSlice): FrameGeometry {
  const w = mmToPx(p.wMm);
  const h = mmToPx(p.hMm);
  if (slice) {
    const headerH = slice.header ? slice.header.endPx - slice.header.startPx : 0;
    return { w, h, layoutWidth: w, scale: 1, offsetX: 0, offsetY: slice.startPx - headerH, innerHeight: slice.endPx + 1 };
  }
  if (p.fit === 'reflow') return { w, h, layoutWidth: w, scale: 1, offsetX: 0, offsetY: 0, innerHeight: Math.max(h, 1) };
  if (p.fit === 'scale') {
    const s = w / def.widthPx;
    return { w, h, layoutWidth: def.widthPx, scale: s, offsetX: 0, offsetY: 0, innerHeight: Math.max(h / s, def.heightPx) };
  }
  const cx = p.cropXPx ?? 0;
  const cy = p.cropYPx ?? 0;
  const sc = p.cropScale ?? 1;
  return { w, h, layoutWidth: p.cropLayoutPx ?? def.widthPx, scale: sc, offsetX: cx, offsetY: cy, innerHeight: Math.max(def.heightPx, h / sc + cy) };
}

interface FrameOverride {
  /** Inner iframe height (layout px): the full content, for the overflow view. */
  innerHeight?: number;
  /** Outer box size (CSS px) and clip-path, replacing the frame's own clip. */
  box?: { w: number; h: number; clip: string };
}

function frameHtml(p: Placement, def: ComponentDef, htmlFor: HtmlFor, captureWidthPx: number, slice?: FlowSlice, o: FrameOverride = {}): string {
  const g0 = frameGeometry(p, def, slice);
  const g = o.innerHeight !== undefined ? { ...g0, innerHeight: Math.max(g0.innerHeight, o.innerHeight) } : g0;
  // Viewport units (vw) in the page's CSS must resolve against the capture
  // width, so a component's frame is never narrower than the captured page.
  // The frame's clip shows only the component's own width.
  const iframeWidth = def.kind === 'page' ? g.layoutWidth : Math.max(g.layoutWidth, captureWidthPx);
  const x = mmToPx(p.xMm);
  const y = mmToPx(p.yMm);
  const transform =
    p.rotationDeg
      ? `translate(${r4(x + g.w / 2)}px, ${r4(y + g.h / 2)}px) rotate(${p.rotationDeg}deg) translate(${r4(-g.w / 2)}px, ${r4(-g.h / 2)}px)`
      : `translate(${r4(x)}px, ${r4(y)}px)`;
  const html = htmlFor(def, g.layoutWidth);
  const inner = (offsetY: number, height: number, top: number, clipH?: number) =>
    `<iframe class="ve-inner" sandbox="allow-same-origin" scrolling="no" tabindex="-1" srcdoc="${escAttr(html)}" style="` +
    `width:${r4(iframeWidth)}px;height:${r4(height)}px;transform:translate(${r4(-g.offsetX * g.scale)}px, ${r4(top - offsetY * g.scale)}px) scale(${r4(g.scale)});` +
    `${clipH !== undefined ? `clip-path:polygon(0 ${r4(offsetY)}px, 100% ${r4(offsetY)}px, 100% ${r4(offsetY + clipH)}px, 0 ${r4(offsetY + clipH)}px);` : ''}"></iframe>`;
  let content: string;
  if (slice?.header) {
    const hh = slice.header.endPx - slice.header.startPx;
    content =
      inner(slice.header.startPx, slice.header.endPx + 1, 0, hh) +
      inner(slice.startPx, g.innerHeight, hh, slice.endPx - slice.startPx);
  } else if (slice) {
    content = inner(slice.startPx, g.innerHeight, 0, slice.endPx - slice.startPx);
  } else {
    content = inner(g.offsetY, g.innerHeight, 0);
  }
  return (
    `<div class="ve-frame" data-placement="${escAttr(p.id)}" data-component="${escAttr(def.id)}" style="` +
    `width:${Math.ceil(o.box?.w ?? g.w)}px;height:${Math.ceil(o.box?.h ?? g.h)}px;transform:${transform};z-index:${p.z};` +
    `clip-path:${o.box?.clip ?? `polygon(0 0, ${r4(g.w)}px 0, ${r4(g.w)}px ${r4(g.h)}px, 0 ${r4(g.h)}px)`}">${content}</div>`
  );
}

export const PAGE_CSS = (pageWmm: number, pageHmm: number) => `
@page { size: ${pageWmm}mm ${pageHmm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.ve-page { position: relative; width: ${pageWmm}mm; height: ${pageHmm}mm; overflow: hidden; background: #fff; break-after: page; }
.ve-page:last-child { break-after: auto; }
.ve-frame { position: absolute; left: 0; top: 0; transform-origin: 0 0; overflow: visible; }
.ve-inner { position: absolute; left: 0; top: 0; display: block; border: 0; margin: 0; padding: 0; transform-origin: 0 0; background: transparent; }
`;

function sliceFor(doc: EditorDocument, p: Placement): FlowSlice | undefined {
  if (!p.chainId) return undefined;
  return doc.chains.find((c) => c.id === p.chainId)?.slices.find((s) => s.placementId === p.id);
}

function pageBody(doc: EditorDocument, pageId: string, htmlFor: HtmlFor): string {
  const frames = doc.placements
    .filter((p) => p.pageId === pageId)
    .sort((a, b) => a.z - b.z)
    .map((p) => {
      const def = doc.components[p.componentId];
      return def ? frameHtml(p, def, htmlFor, doc.captureWidthPx, sliceFor(doc, p)) : '';
    })
    .join('');
  return `<div class="ve-page" data-page="${escAttr(pageId)}">${frames}</div>`;
}

/** One A4 page as a full HTML document. */
export function composePageHtml(doc: EditorDocument, pageId: string, htmlFor: HtmlFor): string {
  const t = trimMm(doc.pageSetup);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PAGE_CSS(t.width, t.height)}</style></head><body>${pageBody(doc, pageId, htmlFor)}</body></html>`;
}

/** Every page in one document (for PDF export). */
export function composeDocumentHtml(doc: EditorDocument, htmlFor: HtmlFor): string {
  const t = trimMm(doc.pageSetup);
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${PAGE_CSS(t.width, t.height)}</style></head><body>${doc.pages
    .map((p) => pageBody(doc, p.id, htmlFor))
    .join('')}</body></html>`;
}

/* ------------------------------------------------------------ overflow view */

/** Space around the page (CSS px) the overflow view needs, capped per side. */
export interface Pad {
  l: number;
  t: number;
  r: number;
  b: number;
}

export const OVERFLOW_MAX_PAD_MM = 120;

interface OverflowFrame {
  p: Placement;
  def: ComponentDef;
  /** Everything the frame would draw if nothing clipped it (page px). */
  content: { x: number; y: number; w: number; h: number };
  /** Part already drawn on the page (frame ∩ page), in frame-local px. */
  hole: { x1: number; y1: number; x2: number; y2: number } | null;
  innerHeight?: number;
}

/**
 * Frames that draw outside what the page shows: frames that run off the page,
 * and reflow/scale frames whose content is taller than the frame.
 * `contentHeightPx` is the measured content height of reflow frames.
 */
function overflowFrames(doc: EditorDocument, pageId: string, contentHeightPx: Record<string, number>): OverflowFrame[] {
  const t = trimMm(doc.pageSetup);
  const W = mmToPx(t.width);
  const H = mmToPx(t.height);
  const out: OverflowFrame[] = [];
  for (const p of doc.placements.filter((x) => x.pageId === pageId)) {
    const def = doc.components[p.componentId];
    if (!def) continue;
    const g = frameGeometry(p, def, sliceFor(doc, p));
    const x = mmToPx(p.xMm);
    const y = mmToPx(p.yMm);
    let contentH = g.h;
    let innerHeight: number | undefined;
    if (!p.chainId && p.fit === 'reflow' && contentHeightPx[p.id] !== undefined) {
      contentH = Math.max(g.h, contentHeightPx[p.id]!);
      innerHeight = contentH;
    } else if (!p.chainId && p.fit === 'scale') {
      contentH = Math.max(g.h, def.heightPx * g.scale);
    }
    const tallerThanFrame = contentH > g.h + 0.5;
    const offPage = !p.rotationDeg && (x < -0.5 || y < -0.5 || x + g.w > W + 0.5 || y + g.h > H + 0.5);
    if (!tallerThanFrame && !offPage) continue;
    let hole: OverflowFrame['hole'] = { x1: 0, y1: 0, x2: g.w, y2: g.h };
    if (!p.rotationDeg) {
      hole = { x1: Math.max(0, -x), y1: Math.max(0, -y), x2: Math.min(g.w, W - x), y2: Math.min(g.h, H - y) };
      if (hole.x2 <= hole.x1 || hole.y2 <= hole.y1) hole = null;
    }
    out.push({ p, def, content: { x, y, w: g.w, h: contentH }, hole, innerHeight });
  }
  return out;
}

/**
 * A see-through layer for the editor (never exported): what frames draw
 * outside the page and outside their own frame, positioned `pad` px in from
 * its top-left corner so it can extend beyond the page.
 */
export function composeOverflowHtml(
  doc: EditorDocument,
  pageId: string,
  htmlFor: HtmlFor,
  contentHeightPx: Record<string, number> = {},
): { html: string; pad: Pad } | null {
  const frames = overflowFrames(doc, pageId, contentHeightPx);
  if (!frames.length) return null;
  const t = trimMm(doc.pageSetup);
  const W = mmToPx(t.width);
  const H = mmToPx(t.height);
  const max = mmToPx(OVERFLOW_MAX_PAD_MM);
  const pad: Pad = {
    l: Math.min(max, Math.max(0, ...frames.map((f) => -f.content.x))),
    t: Math.min(max, Math.max(0, ...frames.map((f) => -f.content.y))),
    r: Math.min(max, Math.max(0, ...frames.map((f) => f.content.x + f.content.w - W))),
    b: Math.min(max, Math.max(0, ...frames.map((f) => f.content.y + f.content.h - H))),
  };
  const body = frames
    .sort((a, b) => a.p.z - b.p.z)
    .map((f) => {
      const { w, h } = f.content;
      const outer = `0 0, ${r4(w)}px 0, ${r4(w)}px ${r4(h)}px, 0 ${r4(h)}px, 0 0`;
      const k = f.hole;
      const clip = k
        ? `polygon(evenodd, ${outer}, ${r4(k.x1)}px ${r4(k.y1)}px, ${r4(k.x1)}px ${r4(k.y2)}px, ${r4(k.x2)}px ${r4(k.y2)}px, ${r4(k.x2)}px ${r4(k.y1)}px, ${r4(k.x1)}px ${r4(k.y1)}px)`
        : `polygon(${outer})`;
      return frameHtml(f.p, f.def, htmlFor, doc.captureWidthPx, sliceFor(doc, f.p), { innerHeight: f.innerHeight, box: { w, h, clip } });
    })
    .join('');
  const css = `${PAGE_CSS(t.width, t.height)}
html, body { background: transparent; overflow: hidden; }
.ve-overflow { position: absolute; left: 0; top: 0; transform: translate(${r4(pad.l)}px, ${r4(pad.t)}px); }`;
  return {
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="ve-overflow">${body}</div></body></html>`,
    pad,
  };
}

export { contentRectMm };
