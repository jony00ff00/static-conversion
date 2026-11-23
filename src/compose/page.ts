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
  return { w, h, layoutWidth: def.widthPx, scale: 1, offsetX: cx, offsetY: cy, innerHeight: Math.max(def.heightPx, h + cy) };
}

function frameHtml(p: Placement, def: ComponentDef, htmlFor: HtmlFor, captureWidthPx: number, slice?: FlowSlice): string {
  const g = frameGeometry(p, def, slice);
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
    `width:${Math.ceil(g.w)}px;height:${Math.ceil(g.h)}px;transform:${transform};z-index:${p.z};` +
    `clip-path:polygon(0 0, ${r4(g.w)}px 0, ${r4(g.w)}px ${r4(g.h)}px, 0 ${r4(g.h)}px)">${content}</div>`
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

export { contentRectMm };
