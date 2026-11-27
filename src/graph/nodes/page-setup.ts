import { PRINT_DEFAULTS } from '../../config/printDefaults.js';
import { PageSetupSchema, type PageSetup } from '../../schema/document.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';

/** A4 page orientation and margins, for the layouts and flows it is connected to. */
export interface PageSetupConfig {
  orientation: PageSetup['orientation'];
  marginsMm: PageSetup['marginsMm'];
}

export const pageSetup: NodeDefinition<PageSetupConfig> = {
  type: 'pageSetup',
  label: 'Page Setup',
  description: 'A4 orientation and margins for the layouts it connects to',
  inputs: [],
  outputs: [{ name: 'setup', type: 'setup', label: 'Page setup' }],
  defaultConfig: () => ({ orientation: PRINT_DEFAULTS.orientation, marginsMm: { ...PRINT_DEFAULTS.marginsMm } }),
  async evaluate(_inputs, config): Promise<NodeOutput> {
    const r = PageSetupSchema.safeParse({ size: 'A4', orientation: config.orientation, marginsMm: config.marginsMm, marginsLinked: false, bleedMm: 0 });
    if (!r.success) return { outputs: {}, warnings: [], info: {}, waiting: r.error.issues[0]?.message ?? 'Invalid page setup' };
    const m = r.data.marginsMm;
    return { outputs: { setup: r.data }, info: { page: `A4 ${r.data.orientation}`, margins: `${m.top}/${m.right}/${m.bottom}/${m.left} mm` } };
  },
};
