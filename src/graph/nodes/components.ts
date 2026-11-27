import type { NodeDefinition, NodeOutput } from '../graph.js';
import { libraryComponents } from '../components.js';
import type { CaptureValue, ComponentSet, LibrarySettings } from '../values.js';

/** `linked`: the Editor tab's component library settings (and content edits). */
export interface ComponentsConfig extends LibrarySettings {
  linked: boolean;
}

export const components: NodeDefinition<ComponentsConfig> = {
  type: 'components',
  label: 'Components',
  description: 'The component library: the whole page, then each part found at this level of detail',
  inputs: [{ name: 'capture', type: 'capture', label: 'Capture' }],
  outputs: [{ name: 'components', type: 'components', label: 'Components' }],
  defaultConfig: () => ({ linked: false, granularity: 2, split: [], promoted: [], demoted: [], merged: [] }),
  dependencies: (config, ctx) =>
    config.linked && ctx.project ? { d: ctx.project.document.decomposition, o: ctx.project.document.overrides } : undefined,
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const capture = inputs.capture as CaptureValue;
    let lib: LibrarySettings = config;
    let overrides: ComponentSet['overrides'] = [];
    if (config.linked && ctx.project && capture.key === ctx.project.capture.key) {
      const { rules: _r, ...rest } = ctx.project.document.decomposition;
      void _r;
      lib = rest;
      overrides = ctx.project.document.overrides;
    }
    const items = libraryComponents(capture, lib);
    const ids = new Set(items.map((c) => c.id));
    const set: ComponentSet = { capture, items, overrides: overrides.filter((o) => ids.has(o.componentId)) };
    return { outputs: { components: set }, info: { components: items.length, detail: lib.granularity } };
  },
};
