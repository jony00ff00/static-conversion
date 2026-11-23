/**
 * Auto-pagination and chain reflow, independent of where layout is measured
 * (the server's sandboxed Chromium, or an iframe in the static build).
 */
import { computeSlices, type FlowLayout } from './breaks.js';
import { contentRectMm, mmToPx } from '../model/geometry.js';
import { flowOntoPages, setChainSlices } from '../model/ops.js';
import type { ComponentDef, EditorDocument } from '../model/types.js';

/** Measures the flow layout of a component laid out at `widthPx`. */
export type MeasureFlow = (def: ComponentDef, widthPx: number) => Promise<FlowLayout>;

/** Auto-paginate a component onto as many full-content-area pages as needed. */
export async function autoPaginateDoc(doc0: EditorDocument, componentId: string, startPageId: string, measure: MeasureFlow) {
  const def = doc0.components[componentId];
  if (!def) throw new Error(`unknown component ${componentId}`);
  const c = contentRectMm(doc0.pageSetup);
  const layout = await measure(def, mmToPx(c.w));
  const probe = computeSlices(layout, [{ placementId: 'probe', heightPx: mmToPx(c.h) }], { unlimited: true });
  const pageCount = probe.filter((x) => x.endPx > x.startPx).length || 1;
  let doc = flowOntoPages(doc0, componentId, startPageId, pageCount);
  const chain = doc.chains[doc.chains.length - 1]!;
  const frames = chain.placementIds.map((id) => ({ placementId: id, heightPx: mmToPx(doc.placements.find((p) => p.id === id)!.hMm) }));
  doc = setChainSlices(doc, chain.id, computeSlices(layout, frames));
  return { document: doc, layout, chainId: chain.id };
}

/** Recompute slices for an existing chain (after frames were linked, moved or resized). */
export async function reflowChainDoc(doc: EditorDocument, chainId: string, measure: MeasureFlow) {
  const chain = doc.chains.find((c) => c.id === chainId);
  if (!chain) throw new Error(`unknown chain ${chainId}`);
  const def = doc.components[chain.componentId]!;
  const frames = chain.placementIds.map((id) => doc.placements.find((p) => p.id === id)!);
  const width = mmToPx(frames[0]!.wMm); // frames in a chain share the first frame's width for layout
  const layout = await measure(def, width);
  const slices = computeSlices(layout, frames.map((f) => ({ placementId: f.id, heightPx: mmToPx(f.hMm) })));
  return { document: setChainSlices(doc, chainId, slices), layout };
}
