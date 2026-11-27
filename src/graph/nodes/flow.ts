import { isolateComponent } from '../../compose/isolate.js';
import { addComponent, addPage } from '../../model/ops.js';
import type { PageSetup } from '../../schema/document.js';
import { autoPaginateDoc } from '../../flow/paginate.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';
import { emptyLayout, pagesValue, scopeSets } from '../layout.js';
import type { ComponentSet } from '../values.js';

/** Long content over as many pages as it needs. `which`: the first component only, or each in turn (each from a new page). */
export interface FlowConfig {
  which: 'first' | 'each';
}

export const flow: NodeDefinition<FlowConfig> = {
  type: 'flow',
  label: 'Flow',
  description: 'Long content over as many pages as it needs, with the break rules',
  inputs: [
    { name: 'components', type: 'components', label: 'Components' },
    { name: 'setup', type: 'setup', label: 'Page setup', optional: true },
  ],
  outputs: [{ name: 'pages', type: 'pages', label: 'Pages' }],
  defaultConfig: () => ({ which: 'first' }),
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const set = inputs.components as ComponentSet;
    const setup = inputs.setup as PageSetup | undefined;
    const scoped = scopeSets([set]);
    const defs = config.which === 'first' ? scoped.available.slice(0, 1) : scoped.available;
    if (!defs.length) return { outputs: {}, waiting: 'No components to flow' };
    const capture = set.capture;
    let doc = emptyLayout(setup, capture.settings.captureWidthPx);
    const measure = (def: Parameters<typeof isolateComponent>[2], widthPx: number) =>
      ctx.services.measureFlow(
        isolateComponent((h) => ctx.services.parseHtml(h), capture.frozenHtml, def, { widthPx, overrides: scoped.overrides.filter((o) => o.componentId === def.id), baseUrl: capture.baseUrl }),
        widthPx,
      );
    let overflow = 0;
    for (let i = 0; i < defs.length; i++) {
      const def = defs[i]!;
      doc = addComponent(doc, def);
      let start = doc.pages[doc.pages.length - 1]!.id;
      if (doc.placements.some((p) => p.pageId === start)) {
        doc = addPage(doc, `flow-${i}-start`);
        start = doc.pages[doc.pages.length - 1]!.id;
      }
      const r = await autoPaginateDoc(doc, def.id, start, measure, `flow-${i}`);
      doc = r.document;
      overflow += doc.chains.find((c) => c.id === r.chainId)!.slices.filter((s) => s.overflow).length;
    }
    return {
      outputs: { pages: pagesValue(doc, [set], capture) },
      warnings: overflow ? [`${overflow} page(s) hold content that can't break and is too tall for the page`] : [],
      info: { pages: doc.pages.length, components: defs.length },
    };
  },
};
