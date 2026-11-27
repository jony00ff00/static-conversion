import type { EditorDocument } from '../../model/types.js';
import type { PageSetup } from '../../schema/document.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';
import { emptyLayout, pagesValue, refreshLayout, scopeSets } from '../layout.js';
import type { ComponentSet } from '../values.js';

/**
 * Components arranged by hand on A4 pages, edited in the Editor tab.
 * linked: the Editor tab's own pages (the project document). Otherwise `document` holds this layout's pages
 * (null until the first edit: one empty page).
 */
export interface LayoutConfig {
  linked: boolean;
  document: EditorDocument | null;
}

export const layout: NodeDefinition<LayoutConfig> = {
  type: 'layout',
  label: 'Layout',
  description: 'Components arranged by hand on A4 pages, in the Editor tab',
  inputs: [
    { name: 'components', type: 'components', label: 'Components', multiple: true },
    { name: 'setup', type: 'setup', label: 'Page setup', optional: true },
  ],
  outputs: [{ name: 'pages', type: 'pages', label: 'Pages' }],
  defaultConfig: () => ({ linked: false, document: null }),
  dependencies: (config, ctx) => (config.linked ? { d: ctx.project?.document, c: ctx.project?.capture.key } : undefined),
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const sets = (inputs.components as ComponentSet[] | undefined) ?? [];
    const setup = inputs.setup as PageSetup | undefined;
    if (config.linked) {
      if (!ctx.project) return { outputs: {}, waiting: 'This project has no pages yet' };
      const doc = ctx.project.document;
      // The project's own components first: they are the Editor tab's (ids unscoped).
      const own = sets.some((s) => s.capture.key === ctx.project!.capture.key) ? sets : [{ capture: ctx.project.capture, items: [], overrides: [] }, ...sets];
      const value = pagesValue(doc, own, ctx.project.capture);
      return { outputs: { pages: { ...value, overrides: [] } }, info: { pages: doc.pages.length, frames: doc.placements.length } };
    }
    const scoped = scopeSets(sets);
    const fallback = scoped.primary ?? ctx.project?.capture;
    if (!fallback) return { outputs: {}, waiting: 'Connect components to lay out' };
    const base = config.document ?? emptyLayout(setup, fallback.settings.captureWidthPx);
    const { document, missing } = refreshLayout(base, scoped.available, setup);
    const warnings = missing.length ? [`${missing.length} placed component(s) no longer come into this layout; they show as last captured`] : [];
    return {
      outputs: { pages: pagesValue(document, sets, fallback) },
      warnings,
      info: { pages: document.pages.length, frames: document.placements.length, components: scoped.available.length },
    };
  },
};
