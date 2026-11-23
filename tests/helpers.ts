import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';

export const REPO = path.resolve(import.meta.dirname, '..');
export const fixture = (name: string) => path.join(REPO, 'fixtures', name);
export const freezeFixture = (name: string) => path.join(REPO, 'tests', 'freeze-fixtures', name);
export const tmp = (prefix = 've-test-') => mkdtempSync(path.join(tmpdir(), prefix));

/** Poppler tools are required for PDF checks (apt install poppler-utils). */
export function poppler(tool: 'pdfinfo' | 'pdffonts' | 'pdftotext' | 'pdftoppm', args: string[]): string {
  try {
    return execFileSync(tool, args, { encoding: 'utf8' });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`${tool} not found — install poppler-utils to run the PDF checks`);
    }
    throw e;
  }
}

export function writeTmp(data: Buffer, name: string): string {
  const f = path.join(tmp(), name);
  writeFileSync(f, data);
  return f;
}

export function pdfPageSize(pdfFile: string) {
  const m = /Page size:\s+([\d.]+) x ([\d.]+) pts/.exec(poppler('pdfinfo', [pdfFile]));
  const pages = Number(/Pages:\s+(\d+)/.exec(poppler('pdfinfo', [pdfFile]))?.[1]);
  return { width: Number(m?.[1]), height: Number(m?.[2]), pages };
}

/** Rasterise page 1 of a PDF with pdftoppm. */
export function rasterisePdf(pdfFile: string, dpi: number): Buffer {
  const out = path.join(tmp(), 'page');
  poppler('pdftoppm', ['-r', String(dpi), '-png', '-singlefile', pdfFile, out]);
  return readFileSync(out + '.png');
}

export function pixel(png: Buffer | PNG, x: number, y: number): [number, number, number] {
  const p = Buffer.isBuffer(png) ? PNG.sync.read(png) : png;
  const i = (p.width * y + x) * 4;
  return [p.data[i]!, p.data[i + 1]!, p.data[i + 2]!];
}

/**
 * Sub-pixel edges of a solid red area on a white page, along one row and one column.
 * Partial (anti-aliased) pixels count by their coverage. Returns positions in mm.
 */
export function redBoxEdgesMm(png: Buffer, dpi: number) {
  const p = PNG.sync.read(png);
  const cov = (x: number, y: number) => {
    const i = (p.width * y + x) * 4;
    return 1 - p.data[i + 1]! / 255; // green channel: 255 on white, 0 on red
  };
  const edges = (n: number, at: (k: number) => number) => {
    let first = -1;
    let last = -1;
    for (let k = 0; k < n; k++) {
      if (at(k) > 0.02) {
        if (first < 0) first = k;
        last = k;
      }
    }
    const start = first + (1 - at(first));
    const end = last + at(last);
    return [start, end] as const;
  };
  const toMm = (px: number) => (px / dpi) * 25.4;
  const row = Math.round(p.height / 2);
  const col = Math.round(p.width / 2);
  const [l, r] = edges(p.width, (x) => cov(x, row));
  const [t, b] = edges(p.height, (y) => cov(col, y));
  return { left: toMm(l), right: toMm(r), top: toMm(t), bottom: toMm(b), widthPx: p.width, heightPx: p.height };
}
