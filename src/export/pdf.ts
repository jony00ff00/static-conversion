import { PDFDocument } from 'pdf-lib';
import { mmToPt } from '../config/printDefaults.js';

/**
 * Chromium rounds the PDF page box to whole 300-dpi device pixels
 * (A4 becomes 594.96 × 841.92 pt instead of 595.28 × 841.89 pt), while drawing
 * content at exact positions measured from the top-left corner. Rewrite each
 * page's MediaBox to the exact size, keeping the top edge where Chromium put it
 * so the content's distance from the top and left edges is unchanged.
 */
export async function setExactPageSize(pdf: Buffer | Uint8Array, widthMm: number, heightMm: number): Promise<Buffer> {
  const doc = await PDFDocument.load(pdf);
  const w = mmToPt(widthMm);
  const h = mmToPt(heightMm);
  for (const page of doc.getPages()) {
    const box = page.getMediaBox();
    const top = box.y + box.height;
    page.setMediaBox(box.x, top - h, w, h);
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

/** Read each page's MediaBox in points. */
export async function readPageSizes(pdf: Buffer | Uint8Array): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const doc = await PDFDocument.load(pdf);
  return doc.getPages().map((p) => p.getMediaBox());
}
