import { z } from 'zod';
import { PRINT_DEFAULTS } from '../config/printDefaults.js';

/** Round to the configured margin step (0.5 mm). */
export const roundToStep = (mm: number, step: number = PRINT_DEFAULTS.marginStepMm) =>
  Math.round(mm / step) * step;

const mm = z.number().finite();

export const MarginsSchema = z
  .object({
    top: mm.min(PRINT_DEFAULTS.minMarginMm),
    right: mm.min(PRINT_DEFAULTS.minMarginMm),
    bottom: mm.min(PRINT_DEFAULTS.minMarginMm),
    left: mm.min(PRINT_DEFAULTS.minMarginMm),
  })
  .strict()
  .transform((m) => ({
    top: roundToStep(m.top),
    right: roundToStep(m.right),
    bottom: roundToStep(m.bottom),
    left: roundToStep(m.left),
  }));
export type Margins = z.output<typeof MarginsSchema>;

export const OrientationSchema = z.enum(['portrait', 'landscape']);
export type Orientation = z.infer<typeof OrientationSchema>;

/** Trim size in mm for the given orientation. A4 only for now. */
export function trimSizeMm(orientation: Orientation) {
  const { widthMm: w, heightMm: h } = PRINT_DEFAULTS;
  return orientation === 'portrait' ? { width: w, height: h } : { width: h, height: w };
}

export function contentAreaMm(setup: { orientation: Orientation; marginsMm: Margins }) {
  const trim = trimSizeMm(setup.orientation);
  const m = setup.marginsMm;
  return {
    x: m.left,
    y: m.top,
    width: trim.width - m.left - m.right,
    height: trim.height - m.top - m.bottom,
  };
}

export const PageSetupSchema = z
  .object({
    // Literal for now; widen to a union when more sizes are supported.
    size: z.literal('A4'),
    orientation: OrientationSchema,
    marginsMm: MarginsSchema,
    marginsLinked: z.boolean(),
    bleedMm: mm.min(0).max(10),
  })
  .strict()
  .superRefine((s, ctx) => {
    const c = contentAreaMm(s);
    if (c.width < PRINT_DEFAULTS.minContentMm || c.height < PRINT_DEFAULTS.minContentMm) {
      ctx.addIssue({
        code: 'custom',
        path: ['marginsMm'],
        message: `Content area must be at least ${PRINT_DEFAULTS.minContentMm} × ${PRINT_DEFAULTS.minContentMm} mm (got ${c.width} × ${c.height} mm)`,
      });
    }
  });
export type PageSetup = z.output<typeof PageSetupSchema>;

export const FitSchema = z.enum(['reflow', 'scale', 'crop']);

export const PlacementSchema = z
  .object({
    id: z.string().min(1),
    componentId: z.string().min(1),
    pageId: z.string().min(1),
    // All geometry in mm from the top-left of the trim.
    xMm: mm,
    yMm: mm,
    wMm: mm.positive(),
    hMm: mm.positive(),
    rotationDeg: mm.default(0),
    z: z.number().int().default(0),
    fit: FitSchema.default('reflow'),
    crop: z
      .object({ xMm: mm, yMm: mm, wMm: mm.positive(), hMm: mm.positive() })
      .strict()
      .optional(),
    locked: z.boolean().default(false),
  })
  .strict();
export type Placement = z.output<typeof PlacementSchema>;

export const PageSchema = z
  .object({
    id: z.string().min(1),
    // Reserved: per-page margin overrides are not exposed in the UI yet.
    marginsOverrideMm: MarginsSchema.optional(),
  })
  .strict();

export const DocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    pageSetup: PageSetupSchema,
    pages: z.array(PageSchema).min(1),
    placements: z.array(PlacementSchema),
  })
  .strict()
  .superRefine((d, ctx) => {
    const pageIds = new Set(d.pages.map((p) => p.id));
    d.placements.forEach((p, i) => {
      if (!pageIds.has(p.pageId)) {
        ctx.addIssue({ code: 'custom', path: ['placements', i, 'pageId'], message: `Unknown page "${p.pageId}"` });
      }
    });
  });
export type VEDocument = z.output<typeof DocumentSchema>;

export function defaultPageSetup(): PageSetup {
  return PageSetupSchema.parse({
    size: PRINT_DEFAULTS.size,
    orientation: PRINT_DEFAULTS.orientation,
    marginsMm: { ...PRINT_DEFAULTS.marginsMm },
    marginsLinked: PRINT_DEFAULTS.marginsLinked,
    bleedMm: PRINT_DEFAULTS.bleedMm,
  });
}

export function newDocument(): VEDocument {
  return DocumentSchema.parse({
    schemaVersion: 1,
    pageSetup: defaultPageSetup(),
    pages: [{ id: 'page-1' }],
    placements: [],
  });
}
