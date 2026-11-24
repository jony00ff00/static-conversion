import { describe, expect, it } from 'vitest';
import { PRINT_DEFAULTS, mmToCssPx, mmToDevicePx, mmToPt, cssPxToPt } from '../src/config/printDefaults.js';
import {
  DocumentSchema,
  PageSetupSchema,
  PlacementSchema,
  contentAreaMm,
  defaultPageSetup,
  newDocument,
  trimSizeMm,
} from '../src/schema/document.js';

const setup = (marginsMm: Record<string, number>, orientation = 'portrait') => ({
  size: 'A4',
  orientation,
  marginsMm,
  marginsLinked: false,
  bleedMm: 0,
});

describe('A4 geometry', () => {
  it('A4 portrait is 210 × 297 mm, landscape is 297 × 210 mm', () => {
    expect(trimSizeMm('portrait')).toEqual({ width: 210, height: 297 });
    expect(trimSizeMm('landscape')).toEqual({ width: 297, height: 210 });
  });

  it('A4 in PDF points is 595.28 × 841.89', () => {
    expect(mmToPt(210)).toBeCloseTo(595.28, 2);
    expect(mmToPt(297)).toBeCloseTo(841.89, 2);
  });

  it('A4 at 96 CSS px/in is 793.7 × 1122.5 px', () => {
    expect(mmToCssPx(210)).toBeCloseTo(793.7, 1);
    expect(mmToCssPx(297)).toBeCloseTo(1122.5, 1);
  });

  it('A4 at 300 DPI is 2480 × 3508 px (2551 × 3579 with 3 mm bleed)', () => {
    expect(mmToDevicePx(210)).toBe(2480);
    expect(mmToDevicePx(297)).toBe(3508);
    expect(mmToDevicePx(216)).toBe(2551);
    expect(mmToDevicePx(303)).toBe(3579);
  });

  it('16 CSS px is 12 pt', () => {
    expect(cssPxToPt(16)).toBe(12);
  });
});

describe('page setup defaults', () => {
  it('uses the placeholder margins 20/15/20/15 mm', () => {
    expect(defaultPageSetup().marginsMm).toEqual({ top: 20, right: 15, bottom: 20, left: 15 });
    expect(PRINT_DEFAULTS.marginsMm).toEqual({ top: 20, right: 15, bottom: 20, left: 15 });
  });

  it('default content area is 180 × 257 mm at (15, 20)', () => {
    expect(contentAreaMm(defaultPageSetup())).toEqual({ x: 15, y: 20, width: 180, height: 257 });
  });

  it('new documents are valid and have one page', () => {
    const d = newDocument();
    expect(d.pages).toHaveLength(1);
    expect(DocumentSchema.safeParse(d).success).toBe(true);
  });
});

describe('margin validation', () => {
  it('rejects negative margins', () => {
    expect(PageSetupSchema.safeParse(setup({ top: -1, right: 15, bottom: 20, left: 15 })).success).toBe(false);
  });

  it('allows zero margins', () => {
    expect(PageSetupSchema.safeParse(setup({ top: 0, right: 0, bottom: 0, left: 0 })).success).toBe(true);
  });

  it('rounds margins to 0.5 mm', () => {
    const s = PageSetupSchema.parse(setup({ top: 12.26, right: 9.74, bottom: 20.1, left: 15.3 }));
    expect(s.marginsMm).toEqual({ top: 12.5, right: 9.5, bottom: 20, left: 15.5 });
  });

  it('keeps the content area at least 50 × 50 mm', () => {
    // 210 - 80 - 80 = 50 → ok; 210 - 80 - 81 = 49 → rejected
    expect(PageSetupSchema.safeParse(setup({ top: 20, right: 80, bottom: 20, left: 80 })).success).toBe(true);
    expect(PageSetupSchema.safeParse(setup({ top: 20, right: 81, bottom: 20, left: 80 })).success).toBe(false);
  });

  it('checks the content-area minimum against the landscape page too', () => {
    // Landscape height is 210: 80 + 81 leaves 49 mm.
    expect(PageSetupSchema.safeParse(setup({ top: 80, right: 15, bottom: 81, left: 15 }, 'landscape')).success).toBe(false);
  });

  it('only A4 is accepted for now', () => {
    expect(PageSetupSchema.safeParse({ ...setup({ top: 20, right: 15, bottom: 20, left: 15 }), size: 'Letter' }).success).toBe(false);
  });
});

describe('placements', () => {
  it('stores geometry in mm with reflow as the default fit', () => {
    const p = PlacementSchema.parse({ id: 'pl1', componentId: 'c1', pageId: 'page-1', xMm: 15, yMm: 20, wMm: 180, hMm: 60 });
    expect(p.fit).toBe('reflow');
    expect(p.locked).toBe(false);
  });

  it('changing margins does not move placements', () => {
    const d = newDocument();
    d.placements.push(PlacementSchema.parse({ id: 'pl1', componentId: 'c1', pageId: 'page-1', xMm: 15, yMm: 20, wMm: 100, hMm: 50 }));
    const changed = DocumentSchema.parse({ ...d, pageSetup: { ...d.pageSetup, marginsMm: { top: 30, right: 25, bottom: 30, left: 25 } } });
    expect(changed.placements[0]).toMatchObject({ xMm: 15, yMm: 20, wMm: 100, hMm: 50 });
  });

  it('rejects placements on unknown pages', () => {
    const d = newDocument();
    const bad = { ...d, placements: [{ id: 'pl1', componentId: 'c1', pageId: 'nope', xMm: 0, yMm: 0, wMm: 10, hMm: 10 }] };
    expect(DocumentSchema.safeParse(bad).success).toBe(false);
  });
});

describe('Recorded steps ("Capture this state")', async () => {
  const { EditorDocumentSchema } = await import('../src/server/validate.js');
  const { newEditorDocument } = await import('../src/model/ops.js');
  const base = newEditorDocument({ captureWidthPx: 680, documentHeightPx: 100, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] }, 'body', 680);
  base.components.page!.minFontPx = 12; // an empty test analysis has no text to measure
  const withSteps = (setupSteps: unknown[]) => EditorDocumentSchema.safeParse({ ...base, setupSteps });

  it('accepts clicks (as saved by earlier versions), ticks, choices and scrolls', () => {
    const r = withSteps([
      { action: 'click', selector: '#t2' },
      { action: 'check', selector: '#more', checked: false },
      { action: 'select', selector: '#size', value: 'l' },
      { action: 'scroll', selector: null, x: 0, y: 2200 },
      { action: 'scroll', selector: 'div:nth-of-type(2)', x: 300, y: 0 },
    ]);
    expect(r.success).toBe(true);
  });

  it('rejects malformed steps', () => {
    expect(withSteps([{ action: 'check', selector: '#more' }]).success).toBe(false);
    expect(withSteps([{ action: 'scroll', selector: null, x: 0, y: Infinity }]).success).toBe(false);
    expect(withSteps([{ action: 'hover', selector: 'a' }]).success).toBe(false);
  });
});
