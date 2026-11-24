/**
 * Pure document operations. Every edit in the editor is one of these: it takes
 * a document and returns a new one (the input is never mutated), so undo/redo is
 * just a stack of documents and every operation is unit-testable.
 */
import { PRINT_DEFAULTS } from '../config/printDefaults.js';
import { PageSetupSchema, type PageSetup } from '../schema/document.js';
import { contentRectMm, mmToPx, pxToMm, rectInside, type Rect } from './geometry.js';
import {
  DEFAULT_PRESETS,
  type Analysis,
  type Chain,
  type ComponentDef,
  type EditorDocument,
  type Fit,
  type FlowSlice,
  type Override,
  type Placement,
} from './types.js';

let seq = 0;
/** Deterministic-enough unique ids (time + counter); tests may pass their own. */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`;

const clone = <T>(v: T): T => structuredClone(v);

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

/* --------------------------------------------------------------- creation */

export function pageComponent(analysis: Analysis, bodyWpId: string): ComponentDef {
  return {
    id: 'page',
    name: 'Whole page',
    kind: 'page',
    rootWpId: bodyWpId,
    widthPx: analysis.captureWidthPx,
    heightPx: analysis.documentHeightPx,
    bg: analysis.pageBg,
    minFontPx: Math.min(...analysis.nodes.map((n) => n.minFontPx ?? Infinity).filter(Number.isFinite), Infinity) || null,
  };
}

/** A new document: one A4 page with the whole captured page placed in the content area. */
export function newEditorDocument(analysis: Analysis, bodyWpId: string, captureWidthPx: number): EditorDocument {
  const pageSetup: PageSetup = PageSetupSchema.parse({
    size: 'A4',
    orientation: PRINT_DEFAULTS.orientation,
    marginsMm: { ...PRINT_DEFAULTS.marginsMm },
    marginsLinked: false,
    bleedMm: 0,
  });
  const c = contentRectMm(pageSetup);
  const page = pageComponent(analysis, bodyWpId);
  return {
    schemaVersion: 2,
    pageSetup,
    pages: [{ id: 'page-1' }],
    components: { [page.id]: page },
    placements: [
      {
        id: 'pl-page',
        componentId: page.id,
        pageId: 'page-1',
        xMm: c.x,
        yMm: c.y,
        wMm: c.w,
        hMm: c.h,
        rotationDeg: 0,
        z: 0,
        fit: 'reflow',
        locked: false,
      },
    ],
    chains: [],
    overrides: [],
    guides: [],
    decomposition: { granularity: 2, rules: [], split: [], promoted: [], demoted: [], merged: [] },
    presets: { ...DEFAULT_PRESETS },
    captureWidthPx,
    setupSteps: [],
    showGrid: false,
  };
}

/* ------------------------------------------------------------ page setup */

export function setMargins(doc: EditorDocument, marginsMm: PageSetup['marginsMm']): EditorDocument {
  const r = PageSetupSchema.safeParse({ ...doc.pageSetup, marginsMm });
  if (!r.success) throw new OpError(r.error.issues[0]?.message ?? 'Invalid margins');
  // Placements keep their mm positions: changing margins never moves anything.
  return { ...clone(doc), pageSetup: r.data };
}

export function setOrientation(doc: EditorDocument, orientation: PageSetup['orientation']): EditorDocument {
  const r = PageSetupSchema.safeParse({ ...doc.pageSetup, orientation });
  if (!r.success) throw new OpError(r.error.issues[0]?.message ?? 'Invalid orientation');
  return { ...clone(doc), pageSetup: r.data };
}

export function addPage(doc: EditorDocument, id = newId('page'), afterPageId?: string): EditorDocument {
  const d = clone(doc);
  const i = afterPageId ? d.pages.findIndex((p) => p.id === afterPageId) + 1 : d.pages.length;
  d.pages.splice(i, 0, { id });
  return d;
}

export function removePage(doc: EditorDocument, pageId: string): EditorDocument {
  if (doc.pages.length <= 1) throw new OpError('A document needs at least one page');
  const d = clone(doc);
  d.pages = d.pages.filter((p) => p.id !== pageId);
  const removed = new Set(d.placements.filter((p) => p.pageId === pageId).map((p) => p.id));
  d.placements = d.placements.filter((p) => !removed.has(p.id));
  d.chains = d.chains
    .map((c) => ({ ...c, placementIds: c.placementIds.filter((id) => !removed.has(id)), slices: c.slices.filter((s) => !removed.has(s.placementId)) }))
    .filter((c) => c.placementIds.length);
  return d;
}

/* ------------------------------------------------------------ placements */

export function addComponent(doc: EditorDocument, def: ComponentDef): EditorDocument {
  const d = clone(doc);
  d.components[def.id] = def;
  return d;
}

/** Place a component; by default at its natural size (1 CSS px = 1/96 in), clamped to the content width. */
export function placeComponent(
  doc: EditorDocument,
  def: ComponentDef,
  pageId: string,
  at: { xMm: number; yMm: number; wMm?: number; hMm?: number; fit?: Fit },
  id = newId('pl'),
): EditorDocument {
  if (!doc.pages.some((p) => p.id === pageId)) throw new OpError(`Unknown page ${pageId}`);
  const d = addComponent(doc, def);
  const c = contentRectMm(d.pageSetup);
  const naturalW = pxToMm(def.widthPx);
  const wMm = at.wMm ?? Math.min(naturalW, c.w);
  const hMm = at.hMm ?? pxToMm(def.heightPx) * (wMm / naturalW);
  const z = Math.max(0, ...d.placements.filter((p) => p.pageId === pageId).map((p) => p.z)) + 1;
  d.placements.push({ id, componentId: def.id, pageId, xMm: at.xMm, yMm: at.yMm, wMm, hMm, rotationDeg: 0, z, fit: at.fit ?? 'scale', locked: false });
  return d;
}

const find = (d: EditorDocument, id: string) => {
  const p = d.placements.find((x) => x.id === id);
  if (!p) throw new OpError(`Unknown placement ${id}`);
  return p;
};

/** Placements that move with `id` (its group, if any). */
export function withGroup(doc: EditorDocument, ids: string[]): string[] {
  const groups = new Set(doc.placements.filter((p) => ids.includes(p.id) && p.groupId).map((p) => p.groupId));
  return doc.placements.filter((p) => ids.includes(p.id) || (p.groupId && groups.has(p.groupId))).map((p) => p.id);
}

export function movePlacements(doc: EditorDocument, ids: string[], dxMm: number, dyMm: number): EditorDocument {
  const d = clone(doc);
  for (const id of withGroup(d, ids)) {
    const p = find(d, id);
    if (p.locked) continue;
    p.xMm += dxMm;
    p.yMm += dyMm;
  }
  return d;
}

export function setPlacementRect(doc: EditorDocument, id: string, r: Rect): EditorDocument {
  const d = clone(doc);
  const p = find(d, id);
  if (p.locked) return d;
  if (r.w <= 0 || r.h <= 0) throw new OpError('Width and height must be positive');
  Object.assign(p, { xMm: r.x, yMm: r.y, wMm: r.w, hMm: r.h });
  return d;
}

export function updatePlacement(
  doc: EditorDocument,
  id: string,
  patch: Partial<Pick<Placement, 'rotationDeg' | 'fit' | 'locked' | 'cropXPx' | 'cropYPx' | 'pageId'>>,
): EditorDocument {
  const d = clone(doc);
  const p = find(d, id);
  if (patch.pageId && !d.pages.some((pg) => pg.id === patch.pageId)) throw new OpError(`Unknown page ${patch.pageId}`);
  Object.assign(p, patch);
  return d;
}

export function deletePlacements(doc: EditorDocument, ids: string[]): EditorDocument {
  const d = clone(doc);
  const gone = new Set(ids);
  d.placements = d.placements.filter((p) => !gone.has(p.id));
  d.chains = d.chains
    .map((c) => ({ ...c, placementIds: c.placementIds.filter((i) => !gone.has(i)), slices: c.slices.filter((s) => !gone.has(s.placementId)) }))
    .filter((c) => c.placementIds.length);
  return d;
}

export function bringToFront(doc: EditorDocument, ids: string[]): EditorDocument {
  const d = clone(doc);
  for (const id of ids) {
    const p = find(d, id);
    p.z = Math.max(...d.placements.filter((x) => x.pageId === p.pageId).map((x) => x.z)) + 1;
  }
  return d;
}

export function sendToBack(doc: EditorDocument, ids: string[]): EditorDocument {
  const d = clone(doc);
  for (const id of ids) {
    const p = find(d, id);
    p.z = Math.min(...d.placements.filter((x) => x.pageId === p.pageId).map((x) => x.z)) - 1;
  }
  return d;
}

export function group(doc: EditorDocument, ids: string[], groupId = newId('grp')): EditorDocument {
  if (ids.length < 2) throw new OpError('Select at least two items to group');
  const d = clone(doc);
  for (const id of ids) find(d, id).groupId = groupId;
  return d;
}

export function ungroup(doc: EditorDocument, ids: string[]): EditorDocument {
  const d = clone(doc);
  for (const id of withGroup(d, ids)) delete find(d, id).groupId;
  return d;
}

/** Bounding box of placements, in mm. */
export function boundsOf(ps: Pick<Placement, 'xMm' | 'yMm' | 'wMm' | 'hMm'>[]): Rect {
  const x = Math.min(...ps.map((p) => p.xMm));
  const y = Math.min(...ps.map((p) => p.yMm));
  return { x, y, w: Math.max(...ps.map((p) => p.xMm + p.wMm)) - x, h: Math.max(...ps.map((p) => p.yMm + p.hMm)) - y };
}

/** Crop parameters that draw a placement exactly as it looks now. */
export function cropParams(p: Placement, def: ComponentDef) {
  if (p.fit === 'crop') return { scale: p.cropScale ?? 1, layoutPx: p.cropLayoutPx ?? def.widthPx, xPx: p.cropXPx ?? 0, yPx: p.cropYPx ?? 0 };
  if (p.fit === 'scale') return { scale: mmToPx(p.wMm) / def.widthPx, layoutPx: def.widthPx, xPx: 0, yPx: 0 };
  return { scale: 1, layoutPx: mmToPx(p.wMm), xPx: 0, yPx: 0 };
}

export type GroupResizeMode = 'scale' | 'crop';

/**
 * Resize a group (or several selected items) as one, to the bounding box `to`.
 * - scale: every item's position and size scale with the box; cropped items
 *   scale their content too.
 * - crop: the box trims the items; their content stays where it is (items are
 *   switched to crop mode where they are trimmed).
 */
export function resizeGroup(doc: EditorDocument, ids: string[], to: Rect, mode: GroupResizeMode): EditorDocument {
  const d = clone(doc);
  const members = withGroup(d, ids).map((id) => find(d, id));
  if (!members.length) throw new OpError('Nothing selected');
  if (members.some((p) => p.locked)) throw new OpError('Unlock every item in the group to resize it');
  if (to.w <= 0 || to.h <= 0) throw new OpError('Width and height must be positive');
  const from = boundsOf(members);
  if (mode === 'scale') {
    const sx = to.w / from.w;
    const sy = to.h / from.h;
    for (const p of members) {
      p.xMm = to.x + (p.xMm - from.x) * sx;
      p.yMm = to.y + (p.yMm - from.y) * sy;
      p.wMm *= sx;
      p.hMm *= sy;
      if (p.fit === 'crop') p.cropScale = (p.cropScale ?? 1) * sx;
    }
    return d;
  }
  for (const p of members) {
    const def = d.components[p.componentId];
    const x1 = Math.max(p.xMm, to.x);
    const y1 = Math.max(p.yMm, to.y);
    const x2 = Math.min(p.xMm + p.wMm, to.x + to.w);
    const y2 = Math.min(p.yMm + p.hMm, to.y + to.h);
    const tol = 1e-6;
    if (x2 - x1 < 0.5 || y2 - y1 < 0.5) throw new OpError(`Cropping that far would remove "${def?.name ?? p.componentId}" completely`);
    if (Math.abs(x1 - p.xMm) < tol && Math.abs(y1 - p.yMm) < tol && Math.abs(x2 - p.xMm - p.wMm) < tol && Math.abs(y2 - p.yMm - p.hMm) < tol) continue;
    if (p.chainId) throw new OpError('Linked frames can\'t be cropped; unlink them first');
    if (p.rotationDeg) throw new OpError('Rotated items can\'t be cropped as part of a group');
    if (!def) continue;
    const c = cropParams(p, def);
    Object.assign(p, {
      fit: 'crop',
      cropScale: c.scale,
      cropLayoutPx: c.layoutPx,
      cropXPx: c.xPx + mmToPx(x1 - p.xMm) / c.scale,
      cropYPx: c.yPx + mmToPx(y1 - p.yMm) / c.scale,
      xMm: x1,
      yMm: y1,
      wMm: x2 - x1,
      hMm: y2 - y1,
    });
  }
  return d;
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** Align placements to each other, or to the content area when one item is selected. */
export function align(doc: EditorDocument, ids: string[], how: Align): EditorDocument {
  const d = clone(doc);
  const ps = ids.map((id) => find(d, id)).filter((p) => !p.locked);
  if (!ps.length) return d;
  const box =
    ps.length === 1
      ? contentRectMm(d.pageSetup)
      : (() => {
          const x = Math.min(...ps.map((p) => p.xMm));
          const y = Math.min(...ps.map((p) => p.yMm));
          return { x, y, w: Math.max(...ps.map((p) => p.xMm + p.wMm)) - x, h: Math.max(...ps.map((p) => p.yMm + p.hMm)) - y };
        })();
  for (const p of ps) {
    if (how === 'left') p.xMm = box.x;
    if (how === 'right') p.xMm = box.x + box.w - p.wMm;
    if (how === 'hcenter') p.xMm = box.x + (box.w - p.wMm) / 2;
    if (how === 'top') p.yMm = box.y;
    if (how === 'bottom') p.yMm = box.y + box.h - p.hMm;
    if (how === 'vcenter') p.yMm = box.y + (box.h - p.hMm) / 2;
  }
  return d;
}

/** Equal gaps between three or more placements along an axis. */
export function distribute(doc: EditorDocument, ids: string[], axis: 'x' | 'y'): EditorDocument {
  const d = clone(doc);
  const ps = ids.map((id) => find(d, id));
  if (ps.length < 3) return d;
  const pos = (p: Placement) => (axis === 'x' ? p.xMm : p.yMm);
  const size = (p: Placement) => (axis === 'x' ? p.wMm : p.hMm);
  ps.sort((a, b) => pos(a) - pos(b));
  const first = ps[0]!;
  const last = ps[ps.length - 1]!;
  const span = pos(last) + size(last) - pos(first);
  const gap = (span - ps.reduce((s, p) => s + size(p), 0)) / (ps.length - 1);
  let at = pos(first);
  for (const p of ps) {
    if (!p.locked) {
      if (axis === 'x') p.xMm = at;
      else p.yMm = at;
    }
    at += size(p) + gap;
  }
  return d;
}

/** Placements that are not fully inside the content area (shown with a warning badge). */
export function placementsInMargin(doc: EditorDocument): string[] {
  const c = contentRectMm(doc.pageSetup);
  return doc.placements.filter((p) => !rectInside({ x: p.xMm, y: p.yMm, w: p.wMm, h: p.hMm }, c)).map((p) => p.id);
}

/* -------------------------------------------------------------- overrides */

const sameSlot = (a: Override, b: Override) =>
  a.componentId === b.componentId &&
  a.type === b.type &&
  a.target === b.target &&
  (a.type !== 'style' || (b.type === 'style' && a.prop === b.prop));

/** Add or replace an override (one per component, target, type and style property). */
export function setOverride(doc: EditorDocument, o: Override): EditorDocument {
  const d = clone(doc);
  if (!d.components[o.componentId]) throw new OpError(`Unknown component ${o.componentId}`);
  const i = d.overrides.findIndex((x) => sameSlot(x, o));
  if (o.type === 'text' && o.value === o.original) {
    if (i >= 0) d.overrides.splice(i, 1); // edited back to the original: no override
    return d;
  }
  if (i >= 0) d.overrides[i] = { ...o, id: d.overrides[i]!.id };
  else d.overrides.push(o);
  return d;
}

export function revertOverride(doc: EditorDocument, overrideId: string): EditorDocument {
  const d = clone(doc);
  d.overrides = d.overrides.filter((o) => o.id !== overrideId);
  return d;
}

export function revertAllOverrides(doc: EditorDocument, componentId?: string): EditorDocument {
  const d = clone(doc);
  d.overrides = componentId ? d.overrides.filter((o) => o.componentId !== componentId) : [];
  return d;
}

/* ------------------------------------------------------------------ guides */

export function addGuide(doc: EditorDocument, axis: 'x' | 'y', posMm: number, id = newId('guide')): EditorDocument {
  const d = clone(doc);
  d.guides.push({ id, axis, posMm });
  return d;
}

export function removeGuide(doc: EditorDocument, id: string): EditorDocument {
  const d = clone(doc);
  d.guides = d.guides.filter((g) => g.id !== id);
  return d;
}

/* ------------------------------------------------------------------ chains */

/** Link placements of the same component into a flow chain (content continues frame to frame). */
export function linkFrames(doc: EditorDocument, placementIds: string[], chainId = newId('chain')): EditorDocument {
  if (placementIds.length < 2) throw new OpError('Link at least two frames');
  const d = clone(doc);
  const ps = placementIds.map((id) => find(d, id));
  const componentId = ps[0]!.componentId;
  if (ps.some((p) => p.componentId !== componentId)) throw new OpError('Linked frames must show the same component');
  for (const p of ps) {
    p.chainId = chainId;
    p.fit = 'reflow';
  }
  d.chains = d.chains.filter((c) => c.id !== chainId);
  d.chains.push({ id: chainId, componentId, placementIds, slices: [] });
  return d;
}

export function unlinkChain(doc: EditorDocument, chainId: string): EditorDocument {
  const d = clone(doc);
  for (const p of d.placements) if (p.chainId === chainId) delete p.chainId;
  d.chains = d.chains.filter((c) => c.id !== chainId);
  return d;
}

export function setChainSlices(doc: EditorDocument, chainId: string, slices: FlowSlice[]): EditorDocument {
  const d = clone(doc);
  const c = d.chains.find((x) => x.id === chainId);
  if (!c) throw new OpError(`Unknown chain ${chainId}`);
  c.slices = slices;
  return d;
}

/**
 * Auto-paginate: put the component in a chain of full content-area frames, one
 * per page, starting at `pageId`, adding pages as needed. Slices are computed
 * separately (they depend on layout) and set with setChainSlices.
 */
export function flowOntoPages(
  doc: EditorDocument,
  componentId: string,
  startPageId: string,
  pageCount: number,
  chainId = newId('chain'),
): EditorDocument {
  let d = clone(doc);
  const c = contentRectMm(d.pageSetup);
  const startIdx = d.pages.findIndex((p) => p.id === startPageId);
  if (startIdx < 0) throw new OpError(`Unknown page ${startPageId}`);
  const ids: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    let page = d.pages[startIdx + i];
    if (!page) {
      d = addPage(d, `${chainId}-p${i}`);
      page = d.pages[d.pages.length - 1]!;
    }
    const id = `${chainId}-f${i}`;
    d.placements.push({ id, componentId, pageId: page.id, xMm: c.x, yMm: c.y, wMm: c.w, hMm: c.h, rotationDeg: 0, z: 1, fit: 'reflow', locked: false, chainId });
    ids.push(id);
  }
  d.chains.push({ id: chainId, componentId, placementIds: ids, slices: [] });
  return d;
}

export function chainOf(doc: EditorDocument, placementId: string): Chain | undefined {
  return doc.chains.find((c) => c.placementIds.includes(placementId));
}

/* ------------------------------------------------------------------ history */

export class History {
  past: EditorDocument[] = [];
  future: EditorDocument[] = [];
  constructor(public present: EditorDocument, private limit = 200) {}

  apply(op: (d: EditorDocument) => EditorDocument): EditorDocument {
    const next = op(this.present);
    if (next === this.present) return next;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.present = next;
    return next;
  }
  undo(): EditorDocument {
    const prev = this.past.pop();
    if (prev) {
      this.future.push(this.present);
      this.present = prev;
    }
    return this.present;
  }
  redo(): EditorDocument {
    const next = this.future.pop();
    if (next) {
      this.past.push(this.present);
      this.present = next;
    }
    return this.present;
  }
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
}
