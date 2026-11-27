import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { PagesValue } from '../values.js';

/** The finished pages. Exporting from here (PDF / PNG / print) arrives in milestone N5; use the Editor tab's Export. */
export const exportNode: NodeDefinition<Record<string, never>> = {
  type: 'export',
  label: 'Export',
  description: 'The finished A4 pages, ready to export',
  inputs: [{ name: 'pages', type: 'pages', label: 'Pages' }],
  outputs: [],
  defaultConfig: () => ({}),
  async evaluate(inputs): Promise<NodeOutput> {
    const p = inputs.pages as PagesValue;
    return { outputs: {}, info: { pages: p.document.pages.length } };
  },
};
