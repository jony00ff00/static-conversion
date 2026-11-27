import { z } from 'zod';
import { PageSetupSchema } from '../schema/document.js';
import type { EditorDocument } from '../model/types.js';

const num = z.number().finite();
const rect = z.object({ x: num, y: num, w: num, h: num });

const Placement = z.object({
  id: z.string().min(1),
  componentId: z.string().min(1),
  pageId: z.string().min(1),
  xMm: num,
  yMm: num,
  wMm: num.positive(),
  hMm: num.positive(),
  rotationDeg: num,
  z: num,
  fit: z.enum(['reflow', 'scale', 'crop']),
  cropXPx: num.optional(),
  cropYPx: num.optional(),
  cropScale: num.positive().optional(),
  cropLayoutPx: num.positive().optional(),
  locked: z.boolean(),
  groupId: z.string().optional(),
  chainId: z.string().optional(),
});

const Component = z.object({
  id: z.string().min(1),
  name: z.string(),
  kind: z.string(),
  rootWpId: z.string().min(1),
  showWpIds: z.array(z.string()).optional(),
  widthPx: num.positive(),
  heightPx: num.nonnegative(),
  bg: z.string(),
  minFontPx: num.nullable(),
  captureKey: z.string().max(200).optional(),
});

const Override = z.union([
  z.object({ id: z.string(), componentId: z.string(), type: z.literal('text'), target: z.string(), value: z.string(), original: z.string() }),
  z.object({ id: z.string(), componentId: z.string(), type: z.literal('style'), target: z.string(), prop: z.string().regex(/^-?[a-z][a-z-]*$/), value: z.string().regex(/^[^;{}<>]*$/) }),
  z.object({ id: z.string(), componentId: z.string(), type: z.literal('visibility'), target: z.string(), hidden: z.boolean() }),
  z.object({
    id: z.string(),
    componentId: z.string(),
    type: z.literal('asset'),
    target: z.string(),
    src: z.string().optional(),
    objectFit: z.enum(['cover', 'contain', 'fill']).optional(),
    focalX: num.min(0).max(100).optional(),
    focalY: num.min(0).max(100).optional(),
  }),
]);

const Slice = z.object({
  placementId: z.string(),
  startPx: num,
  endPx: num,
  header: z.object({ startPx: num, endPx: num }).optional(),
  overflow: z.boolean(),
});

export const EditorDocumentSchema = z
  .object({
    schemaVersion: z.literal(2),
    pageSetup: PageSetupSchema,
    pages: z.array(z.object({ id: z.string().min(1) })).min(1),
    components: z.record(z.string(), Component),
    placements: z.array(Placement),
    chains: z.array(z.object({ id: z.string(), componentId: z.string(), placementIds: z.array(z.string()), slices: z.array(Slice) })),
    overrides: z.array(Override),
    guides: z.array(z.object({ id: z.string(), axis: z.enum(['x', 'y']), posMm: num })),
    decomposition: z.object({
      granularity: z.number().int().min(1).max(6),
      rules: z.array(z.object({ selector: z.string(), action: z.enum(['component', 'ignore']) })),
      split: z.array(z.string()),
      promoted: z.array(z.string()),
      demoted: z.array(z.string()),
      merged: z.array(z.object({ id: z.string(), rootWpId: z.string(), wpIds: z.array(z.string()) })),
    }),
    presets: z.object({ hideChrome: z.boolean(), expandInteractive: z.boolean(), printMedia: z.boolean(), linkUrls: z.boolean() }),
    captureWidthPx: z.number().int().min(200).max(4000),
    setupSteps: z.array(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('click'), selector: z.string().max(2000) }),
        z.object({ action: z.literal('check'), selector: z.string().max(2000), checked: z.boolean() }),
        z.object({ action: z.literal('select'), selector: z.string().max(2000), value: z.string().max(10_000) }),
        z.object({ action: z.literal('scroll'), selector: z.string().max(2000).nullable(), x: num, y: num }),
      ]),
    ).max(500),
    showGrid: z.boolean(),
  })
  .superRefine((d, ctx) => {
    const pages = new Set(d.pages.map((p) => p.id));
    d.placements.forEach((p, i) => {
      if (!pages.has(p.pageId)) ctx.addIssue({ code: 'custom', path: ['placements', i, 'pageId'], message: `Unknown page ${p.pageId}` });
      if (!d.components[p.componentId]) ctx.addIssue({ code: 'custom', path: ['placements', i, 'componentId'], message: `Unknown component ${p.componentId}` });
    });
  }) as unknown as z.ZodType<EditorDocument>;

export { rect };
