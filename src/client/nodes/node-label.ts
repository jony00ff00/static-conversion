// Copied from Node CMS (jony00ff00/cms-test-23nov26) src/ui/node-label.ts at c22a45d.
import type { GraphNode } from './engine.js';

/** How a node is called in the UI: the name it was given, or its id. */
export const nodeLabel = (node: Pick<GraphNode, 'id' | 'name'> | undefined, fallback = ''): string =>
  node?.name?.trim() || node?.id || fallback;
