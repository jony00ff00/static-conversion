import type { Override } from '../../model/types.js';
import type { NodeDefinition, NodeOutput } from '../graph.js';
import type { ComponentSet } from '../values.js';

/** Content edits (text, style, hide, image) on the components passing through; the web page is never changed. */
export interface EditConfig {
  overrides: Override[];
}

/** Same thing changed twice: the later edit wins. */
const sameTarget = (a: Override, b: Override) =>
  a.componentId === b.componentId && a.type === b.type && a.target === b.target && (a.type !== 'style' || (b.type === 'style' && a.prop === b.prop));

export const edit: NodeDefinition<EditConfig> = {
  type: 'edit',
  label: 'Edit',
  description: 'Changes text, styles, images or hides parts of components, for print only',
  inputs: [{ name: 'components', type: 'components', label: 'Components' }],
  outputs: [{ name: 'components', type: 'components', label: 'Components' }],
  defaultConfig: () => ({ overrides: [] }),
  async evaluate(inputs, config): Promise<NodeOutput> {
    const set = inputs.components as ComponentSet;
    const ids = new Set(set.items.map((c) => c.id));
    const mine = config.overrides.filter((o) => ids.has(o.componentId));
    const unused = config.overrides.length - mine.length;
    const overrides = [...set.overrides.filter((o) => !mine.some((m) => sameTarget(o, m))), ...mine];
    return {
      outputs: { components: { ...set, overrides } satisfies ComponentSet },
      warnings: unused ? [`${unused} edit(s) are for components no longer in the input`] : [],
      info: { edits: mine.length },
    };
  },
};
