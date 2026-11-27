import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { ComponentSet, PagesValue } from '../values.js';

/**
 * Hand layout of components on A4 pages. Linked: the Editor tab's pages. (Layouts of their own, edited in the
 * Editor tab, arrive in milestone N4.)
 */
export interface LayoutConfig {
  linked: boolean;
}

export const layout: NodeDefinition<LayoutConfig> = {
  type: 'layout',
  label: 'Layout',
  description: 'Components arranged by hand on A4 pages (the Editor tab)',
  inputs: [{ name: 'components', type: 'components', label: 'Components', multiple: true }],
  outputs: [{ name: 'pages', type: 'pages', label: 'Pages' }],
  defaultConfig: () => ({ linked: false }),
  dependencies: (config, ctx) => (config.linked ? ctx.project?.document : undefined),
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const sets = (inputs.components as ComponentSet[] | undefined) ?? [];
    if (!config.linked) return { outputs: {}, waiting: 'Layouts of their own arrive in a later milestone (N4); link this one to the Editor tab' };
    if (!ctx.project) return { outputs: {}, waiting: 'This project has no pages yet' };
    const doc = ctx.project.document;
    const capture = sets.find((s) => s.capture.key === ctx.project!.capture.key)?.capture ?? ctx.project.capture;
    const pages: PagesValue = { document: doc, capture };
    return { outputs: { pages }, info: { pages: doc.pages.length, frames: doc.placements.length } };
  },
};
