import { crc32 } from 'node:zlib';
import { PNG } from 'pngjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Set the PNG's physical resolution (pHYs chunk) so image editors and print
 * dialogs open it at the right physical size. Replaces an existing pHYs chunk.
 */
export function setPngDpi(png: Buffer, dpi: number): Buffer {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  const ppm = Math.round(dpi / 0.0254); // pixels per metre
  const data = Buffer.alloc(9);
  data.writeUInt32BE(ppm, 0);
  data.writeUInt32BE(ppm, 4);
  data.writeUInt8(1, 8); // unit: metre
  const type = Buffer.from('pHYs', 'ascii');
  const chunk = Buffer.alloc(12 + 9);
  chunk.writeUInt32BE(9, 0);
  type.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0, 17);

  const parts: Buffer[] = [png.subarray(0, 8)];
  let off = 8;
  let inserted = false;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const kind = png.toString('ascii', off + 4, off + 8);
    const end = off + 12 + len;
    if (kind !== 'pHYs') parts.push(png.subarray(off, end));
    if (kind === 'IHDR' && !inserted) {
      parts.push(chunk);
      inserted = true;
    }
    off = end;
  }
  return Buffer.concat(parts);
}

/** Read width, height and DPI (if a pHYs chunk in metres is present). */
export function readPngInfo(png: Buffer): { width: number; height: number; dpi: number | null } {
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  let off = 8;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const kind = png.toString('ascii', off + 4, off + 8);
    if (kind === 'pHYs' && png.readUInt8(off + 16) === 1) {
      return { width, height, dpi: Math.round(png.readUInt32BE(off + 8) * 0.0254) };
    }
    if (kind === 'IDAT') break;
    off += 12 + len;
  }
  return { width, height, dpi: null };
}

/** Crop a PNG to its top-left `width` × `height` pixels. */
export function cropPng(png: Buffer, width: number, height: number): Buffer {
  const src = PNG.sync.read(png);
  if (src.width === width && src.height === height) return png;
  if (src.width < width || src.height < height) {
    throw new Error(`cannot crop ${src.width}×${src.height} to ${width}×${height}`);
  }
  const out = new PNG({ width, height });
  PNG.bitblt(src, out, 0, 0, width, height, 0, 0);
  return PNG.sync.write(out);
}
