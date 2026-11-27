import type { ComponentKind } from '../../model/types.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { ComponentSet } from '../values.js';

export interface FilterConfig {
  /** Keep only these kinds (empty: all). */
  kinds: ComponentKind[];
  /** Keep components whose name contains this (case-insensitive). */
  text: string;
  /** Leave out the whole-page component. */
  dropPage: boolean;
  order: 'page' | 'reverse' | 'name';
  /** Keep the first N after ordering (null: all). */
  first: number | null;
}

export const filter: NodeDefinition<FilterConfig> = {
  type: 'filter',
  label: 'Filter',
  description: 'Keeps components by kind or name, reorders them, or keeps the first few',
  inputs: [{ name: 'components', type: 'components', label: 'Components' }],
  outputs: [{ name: 'components', type: 'components', label: 'Components' }],
  defaultConfig: () => ({ kinds: [], text: '', dropPage: true, order: 'page', first: null }),
  async evaluate(inputs, config): Promise<NodeOutput> {
    const set = inputs.components as ComponentSet;
    const text = config.text.trim().toLowerCase();
    let items = set.items.filter(
      (c) =>
        (!config.dropPage || c.kind !== 'page') &&
        (!config.kinds.length || config.kinds.includes(c.kind)) &&
        (!text || c.name.toLowerCase().includes(text)),
    );
    if (config.order === 'reverse') items = [...items].reverse();
    if (config.order === 'name') items = [...items].sort((a, b) => a.name.localeCompare(b.name));
    if (config.first != null && config.first >= 0) items = items.slice(0, config.first);
    const ids = new Set(items.map((c) => c.id));
    const out: ComponentSet = { ...set, items, overrides: set.overrides.filter((o) => ids.has(o.componentId)) };
    return { outputs: { components: out }, info: { kept: items.length, of: set.items.length } };
  },
};
