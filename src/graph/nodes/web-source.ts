import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { FilesValue } from '../values.js';

/** `sourceId` "main" is the project's own page; others are pages added in the Nodes tab. */
export interface WebSourceConfig {
  sourceId: string;
  title: string;
  entry: string;
  /** Content hash of the imported files, so a re-import re-runs what follows. */
  hash: string;
}

export const webSource: NodeDefinition<WebSourceConfig> = {
  type: 'webSource',
  label: 'Web Source',
  description: 'A web page: pasted code, an .html file with its assets, or a zip',
  inputs: [],
  outputs: [{ name: 'files', type: 'files', label: 'Page' }],
  defaultConfig: () => ({ sourceId: '', title: '', entry: 'index.html', hash: '' }),
  dependencies: (config, ctx) => (config.sourceId === 'main' ? ctx.project?.capture.key : config.hash),
  async evaluate(_inputs, config, ctx): Promise<NodeOutput> {
    if (!config.sourceId) return { outputs: {}, waiting: 'Import a page in this node' };
    if (config.sourceId === 'main') {
      if (!ctx.project) return { outputs: {}, waiting: 'This project has no page yet' };
      const files: FilesValue = { sourceId: 'main', title: ctx.project.title, entry: config.entry || 'index.html' };
      return { outputs: { files }, info: { page: ctx.project.title } };
    }
    const files: FilesValue = { sourceId: config.sourceId, title: config.title, entry: config.entry };
    return { outputs: { files }, info: { page: config.title } };
  },
};
