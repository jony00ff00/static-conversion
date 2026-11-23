/**
 * Where to split flowed content across frames. Pure: takes measured layout,
 * returns slices. Rules:
 * - never cut through a line of text, an image or a table row,
 * - a heading is never the last thing in a frame (it moves with what follows),
 * - a paragraph split leaves at least 2 lines on each side (no widows/orphans),
 * - a table continued in the next frame repeats its header there.
 */
import type { FlowSlice } from '../model/types.js';

export interface FlowLayout {
  height: number;
  blocks: Array<{ top: number; bottom: number; kind: 'heading' | 'text' | 'atomic' | 'row'; tag: string }>;
  lines: Array<{ top: number; bottom: number; block: number }>;
  tables: Array<{ top: number; bottom: number; thead: { top: number; bottom: number } | null; rows: Array<{ top: number; bottom: number }> }>;
}

export const MIN_LINES = 2;

interface Candidate {
  y: number;
  /** Index of the last block that ends at or before y. */
  prevBlock: number;
}

/** Every position content may be split at, in order. */
export function breakCandidates(l: FlowLayout): Candidate[] {
  const out: Candidate[] = [];
  const blocks = l.blocks;
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1]!;
    const b = blocks[i]!;
    if (b.top < prev.bottom - 0.5) continue; // overlapping (side by side): not a clean split
    out.push({ y: (prev.bottom + b.top) / 2, prevBlock: i - 1 });
  }
  // Between lines inside a paragraph, keeping MIN_LINES on each side.
  const byBlock = new Map<number, FlowLayout['lines']>();
  for (const ln of l.lines) {
    const arr = byBlock.get(ln.block) ?? [];
    arr.push(ln);
    byBlock.set(ln.block, arr);
  }
  for (const [bi, ls] of byBlock) {
    if (blocks[bi]?.kind !== 'text') continue;
    for (let k = MIN_LINES; k <= ls.length - MIN_LINES; k++) {
      const a = ls[k - 1]!;
      const b = ls[k]!;
      const y = b.top >= a.bottom ? (a.bottom + b.top) / 2 : b.top;
      out.push({ y, prevBlock: bi - 0.5 }); // inside block bi
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

/** Is y inside a table body that has a header? Returns the header to repeat. */
function headerAt(l: FlowLayout, y: number) {
  for (const t of l.tables) {
    if (t.thead && y > t.thead.bottom + 0.5 && y < t.bottom - 0.5) return t.thead;
  }
  return undefined;
}

/**
 * Split content of `layout.height` across frames of the given heights.
 * With `unlimited`, keeps reusing the last frame height until everything fits
 * (used by auto-paginate to decide how many pages are needed).
 */
export function computeSlices(
  layout: FlowLayout,
  frames: Array<{ placementId: string; heightPx: number }>,
  opts: { unlimited?: boolean } = {},
): FlowSlice[] {
  const cands = breakCandidates(layout);
  const blocks = layout.blocks;
  const isHeadingLast = (c: Candidate) => Number.isInteger(c.prevBlock) && blocks[c.prevBlock]?.kind === 'heading';
  const slices: FlowSlice[] = [];
  let start = 0;
  let i = 0;
  const end = layout.height;
  while (start < end - 0.5) {
    const frame = frames[i] ?? (opts.unlimited ? { ...frames[frames.length - 1]!, placementId: `auto-${i}` } : undefined);
    if (!frame) {
      if (slices.length) slices[slices.length - 1]!.overflow = true;
      break;
    }
    const header = start > 0 ? headerAt(layout, start) : undefined;
    const cap = frame.heightPx - (header ? header.bottom - header.top : 0);
    let stop: number;
    if (start + cap >= end - 0.5) stop = end;
    else {
      const ok = cands.filter((c) => c.y > start + 0.5 && c.y <= start + cap && !isHeadingLast(c));
      const any = cands.filter((c) => c.y > start + 0.5 && c.y <= start + cap);
      stop = ok.length ? ok[ok.length - 1]!.y : any.length ? any[any.length - 1]!.y : start + cap; // last resort: cut
    }
    slices.push({
      placementId: frame.placementId,
      startPx: start,
      endPx: stop,
      header: header ? { startPx: header.top, endPx: header.bottom } : undefined,
      overflow: false,
    });
    start = stop;
    i++;
  }
  // Frames left over show nothing.
  for (; i < frames.length; i++) slices.push({ placementId: frames[i]!.placementId, startPx: end, endPx: end, overflow: false });
  return slices;
}

/* --------------------------------------------------------------- checks */

export interface PaginationIssue {
  rule: 'line-cut' | 'heading-last' | 'widow-orphan' | 'header-missing' | 'text-lost' | 'text-duplicated';
  detail: string;
}

/** Check slices against the pagination rules (used by tests and the editor's warnings). */
export function checkSlices(layout: FlowLayout, slices: FlowSlice[]): PaginationIssue[] {
  const issues: PaginationIssue[] = [];
  const real = slices.filter((s) => s.endPx > s.startPx);
  const tol = 0.5;
  // Each line fully inside exactly one slice.
  layout.lines.forEach((ln, idx) => {
    const holders = real.filter((s) => ln.top >= s.startPx - tol && ln.bottom <= s.endPx + tol);
    const touching = real.filter((s) => ln.bottom > s.startPx + tol && ln.top < s.endPx - tol);
    if (!holders.length && touching.length) issues.push({ rule: 'line-cut', detail: `line ${idx} (${ln.top.toFixed(1)}–${ln.bottom.toFixed(1)}) is cut` });
    if (!touching.length && !holders.length && ln.top < (real[real.length - 1]?.endPx ?? 0)) issues.push({ rule: 'text-lost', detail: `line ${idx} not shown` });
    if (holders.length > 1) issues.push({ rule: 'text-duplicated', detail: `line ${idx} shown ${holders.length}×` });
  });
  // Atomic blocks and rows are not cut.
  layout.blocks.forEach((b, idx) => {
    if (b.kind !== 'atomic' && b.kind !== 'row') return;
    const cut = real.some((s) => s.startPx > b.top + tol && s.startPx < b.bottom - tol);
    if (cut && b.bottom - b.top < Math.max(...real.map((s) => s.endPx - s.startPx))) issues.push({ rule: 'line-cut', detail: `block ${idx} (${b.tag}) is cut` });
  });
  for (let k = 0; k < real.length - 1; k++) {
    const s = real[k]!;
    // Last block fully inside the slice must not be a heading.
    const inside = layout.blocks.filter((b) => b.top >= s.startPx - tol && b.bottom <= s.endPx + tol);
    const last = inside[inside.length - 1];
    if (last?.kind === 'heading') issues.push({ rule: 'heading-last', detail: `heading ends frame ${k}` });
    // Paragraph split: count lines of the split block on each side.
    const byBlock = new Map<number, number[]>();
    layout.lines.forEach((ln) => {
      if (ln.top < s.endPx && ln.bottom > s.endPx - 1e9) {
        const arr = byBlock.get(ln.block) ?? [];
        arr.push(ln.top);
        byBlock.set(ln.block, arr);
      }
    });
    for (const [bi, tops] of byBlock) {
      const before = tops.filter((t) => t < s.endPx).length;
      const after = tops.length - before;
      if (before > 0 && after > 0 && (before < MIN_LINES || after < MIN_LINES)) {
        issues.push({ rule: 'widow-orphan', detail: `block ${bi} split ${before}/${after} at frame ${k}` });
      }
    }
  }
  // Continued tables repeat their header.
  for (const s of real) {
    const h = s.startPx > 0 ? headerAt(layout, s.startPx) : undefined;
    if (h && !s.header) issues.push({ rule: 'header-missing', detail: `frame starting at ${s.startPx.toFixed(1)} lacks the table header` });
  }
  return issues;
}
