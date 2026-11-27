import type { NodeRegistry } from '../graph.js';
import { capture } from './capture.js';
import { components } from './components.js';
import { edit } from './edit.js';
import { exportNode } from './export.js';
import { filter } from './filter.js';
import { layout } from './layout.js';
import { pick } from './pick.js';
import { pageSetup } from './page-setup.js';
import { flow } from './flow.js';
import { combine } from './combine.js';
import { webSource } from './web-source.js';

/** Every node type, in palette order. */
export const REGISTRY: NodeRegistry = {
  webSource,
  capture,
  components,
  pick,
  edit,
  filter,
  pageSetup,
  layout,
  flow,
  combine,
  export: exportNode,
};

export { capture, combine, components, edit, exportNode, filter, flow, layout, pageSetup, pick, webSource };
