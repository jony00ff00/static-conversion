/**
 * Layouts in the graph: component sets from several captures placed in one document. Components are scoped to
 * their capture (`captureKey`, and an id that can't clash with another page's), refreshed from the inputs on every
 * run so placements survive a re-capture, and drawn with each capture's own frozen page.
 */
import { contentRectMm } from '../model/geometry.js';
import type { ComponentDef, EditorDocument, Override } from '../model/types.js';
import { DEFAULT_PRESETS } from '../model/types.js';
import { PageSetupSchema, type PageSetup } from '../schema/document.js';
import { PRINT_DEFAULTS } from '../config/printDefaults.js';
import { hashString } from './hash.js';
import type { CaptureValue, ComponentSet, PagesValue } from './values.js';

/** A component id unique across captures (the first input's keep their own, so linked layouts match). */
export const scopedId = (id: string, captureKey: string, primary: boolean) => (primary ? id : `${id}~${hashString(captureKey).slice(0, 6)}`);

/** Every input's components and edits, scoped to their capture. */
export function scopeSets(sets: ComponentSet[]): { available: ComponentDef[]; overrides: Override[]; captures: Record<string, CaptureValue>; primary: CaptureValue | undefined } {
  const primary = sets[0]?.capture;
  const available: ComponentDef[] = [];
  const overrides: Override[] = [];
  const captures: Record<string, CaptureValue> = {};
  const seen = new Set<string>();
  for (const set of sets) {
    const key = set.capture.key;
    captures[key] = set.capture;
    const isPrimary = key === primary?.key;
    for (const def of set.items) {
      const id = scopedId(def.id, key, isPrimary);
      if (seen.has(id)) continue;
      seen.add(id);
      available.push({ ...def, id, captureKey: key });
    }
    for (const o of set.overrides) overrides.push({ ...o, componentId: scopedId(o.componentId, key, isPrimary) });
  }
  return { available, overrides, captures, primary };
}

/** A layout with one empty A4 page. */
export function emptyLayout(pageSetup?: PageSetup, captureWidthPx = 680): EditorDocument {
  return {
    schemaVersion: 2,
    pageSetup: pageSetup ?? PageSetupSchema.parse({ size: 'A4', orientation: PRINT_DEFAULTS.orientation, marginsMm: { ...PRINT_DEFAULTS.marginsMm }, marginsLinked: false, bleedMm: 0 }),
    pages: [{ id: 'page-1' }],
    components: {},
    placements: [],
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

/**
 * The layout as drawn: placed components refreshed from what the inputs offer now (same id), the page setup from a
 * Page Setup node when one is connected. Returns the ids of placed components no longer offered.
 */
export function refreshLayout(doc: EditorDocument, available: ComponentDef[], setup?: PageSetup): { document: EditorDocument; missing: string[] } {
  const byId = new Map(available.map((c) => [c.id, c]));
  const components: Record<string, ComponentDef> = {};
  const missing: string[] = [];
  for (const [id, def] of Object.entries(doc.components)) {
    const now = byId.get(id);
    components[id] = now ?? def;
    if (!now && doc.placements.some((p) => p.componentId === id)) missing.push(id);
  }
  return { document: { ...doc, components, ...(setup && { pageSetup: setup }) }, missing };
}

/** The Pages value for a document drawn from these inputs. */
export function pagesValue(document: EditorDocument, sets: ComponentSet[], fallback: CaptureValue): PagesValue {
  const s = scopeSets(sets);
  const captures = { ...s.captures };
  if (!captures[fallback.key]) captures[fallback.key] = fallback;
  return { document, capture: s.primary ?? fallback, captures, overrides: s.overrides, available: s.available };
}

/** The content area of a layout, for placing new components. */
export const contentOf = (doc: EditorDocument) => contentRectMm(doc.pageSetup);
