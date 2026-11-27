import type { EditorDocument, Override } from '../../model/types.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { PagesValue } from '../values.js';

/** Pages from several layouts and flows, one after another, as one document (cover, then the article, …). */
export const combine: NodeDefinition<Record<string, never>> = {
  type: 'combine',
  label: 'Combine',
  description: 'Pages from several layouts and flows, one after another, as one document',
  inputs: [{ name: 'pages', type: 'pages', label: 'Pages', multiple: true }],
  outputs: [{ name: 'document', type: 'document', label: 'Document' }],
  defaultConfig: () => ({}),
  async evaluate(inputs): Promise<NodeOutput> {
    const parts = (inputs.pages as PagesValue[] | undefined) ?? [];
    if (!parts.length) return { outputs: {}, waiting: 'Connect pages to combine' };
    const first = parts[0]!;
    const warnings: string[] = [];
    // Every id gets its part's prefix, so parts never clash (two layouts both have "page-1").
    const doc: EditorDocument = { ...first.document, pages: [], components: {}, placements: [], chains: [], overrides: [], guides: [] };
    const overrides: Override[] = [];
    const captures: PagesValue['captures'] = {};
    parts.forEach((part, i) => {
      const p = `${i + 1}/`;
      const d = part.document;
      if (d.pageSetup.orientation !== first.document.pageSetup.orientation) {
        warnings.push(`Part ${i + 1} is ${d.pageSetup.orientation}; the document uses the first part's ${first.document.pageSetup.orientation} pages`);
      }
      for (const pg of d.pages) doc.pages.push({ id: p + pg.id });
      for (const [id, c] of Object.entries(d.components)) {
        // Components without a capture key come from their part's main capture: name it, so they still do.
        doc.components[p + id] = { ...c, id: p + id, captureKey: c.captureKey ?? part.capture.key };
      }
      for (const pl of d.placements) doc.placements.push({ ...pl, id: p + pl.id, pageId: p + pl.pageId, componentId: p + pl.componentId, ...(pl.chainId && { chainId: p + pl.chainId }), ...(pl.groupId && { groupId: p + pl.groupId }) });
      for (const ch of d.chains) {
        doc.chains.push({ ...ch, id: p + ch.id, componentId: p + ch.componentId, placementIds: ch.placementIds.map((x) => p + x), slices: ch.slices.map((s) => ({ ...s, placementId: p + s.placementId })) });
      }
      for (const o of [...d.overrides, ...part.overrides]) overrides.push({ ...o, id: p + o.id, componentId: p + o.componentId });
      Object.assign(captures, part.captures);
      captures[part.capture.key] = part.capture;
    });
    const value: PagesValue = { document: doc, capture: first.capture, captures, overrides, available: [] };
    return { outputs: { document: value }, warnings, info: { pages: doc.pages.length, parts: parts.length } };
  },
};
