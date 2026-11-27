import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { PagesValue } from '../values.js';

/**
 * The finished pages: a Layout's or Flow's pages, or a Combine node's document. Exporting (a PDF or PNG on the
 * server, the print dialog in the browser-only version) runs from its inspector.
 */
export const exportNode: NodeDefinition<Record<string, never>> = {
  type: 'export',
  label: 'Export',
  description: 'The finished A4 pages, exported as PDF or PNG',
  inputs: [
    { name: 'pages', type: 'pages', label: 'Pages', optional: true },
    { name: 'document', type: 'document', label: 'Document', optional: true },
  ],
  outputs: [],
  defaultConfig: () => ({}),
  async evaluate(inputs): Promise<NodeOutput> {
    const p = (inputs.document ?? inputs.pages) as PagesValue | undefined;
    if (!p) return { outputs: {}, waiting: 'Connect pages or a document' };
    if (inputs.document && inputs.pages) return { outputs: { result: p }, warnings: ['Both inputs are connected; exporting the document'], info: { pages: p.document.pages.length } };
    return { outputs: { result: p }, info: { pages: p.document.pages.length } };
  },
};
