import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

export interface PixelDiff {
  /** Fraction of pixels that differ (0–1). Size mismatch counts as 1. */
  ratio: number;
  diffPixels: number;
  totalPixels: number;
  sizeMismatch: boolean;
  diffPng?: Buffer;
}

/** Compare two PNG buffers pixel by pixel. */
export function comparePng(a: Buffer, b: Buffer, opts: { threshold?: number; withDiffImage?: boolean } = {}): PixelDiff {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) {
    return {
      ratio: 1,
      diffPixels: Math.max(pa.width * pa.height, pb.width * pb.height),
      totalPixels: Math.max(pa.width * pa.height, pb.width * pb.height),
      sizeMismatch: true,
    };
  }
  const { width, height } = pa;
  const diff = opts.withDiffImage ? new PNG({ width, height }) : undefined;
  const diffPixels = pixelmatch(pa.data, pb.data, diff?.data, width, height, {
    threshold: opts.threshold ?? 0.1,
  });
  return {
    ratio: diffPixels / (width * height),
    diffPixels,
    totalPixels: width * height,
    sizeMismatch: false,
    diffPng: diff ? PNG.sync.write(diff) : undefined,
  };
}
