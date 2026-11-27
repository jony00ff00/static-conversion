import type { NodeDefinition, NodeOutput } from '../graph.js';
import { componentForNode, nodeForElement, uniqueNames } from '../components.js';
import type { AnalysisNode } from '../../model/types.js';
import type { CaptureValue, ComponentSet } from '../values.js';

/**
 * Components chosen by hand: a CSS selector and/or elements clicked in the preview. Each match becomes the
 * analysed component it belongs to. `similar` adds the repeated siblings of each pick (e.g. every card in a row).
 */
export interface PickConfig {
  selector: string;
  wpIds: string[];
  similar: boolean;
}

export const pick: NodeDefinition<PickConfig> = {
  type: 'pick',
  label: 'Pick',
  description: 'Components you choose: by CSS selector or by clicking them in the preview',
  inputs: [{ name: 'capture', type: 'capture', label: 'Capture' }],
  outputs: [{ name: 'components', type: 'components', label: 'Components' }],
  defaultConfig: () => ({ selector: '', wpIds: [], similar: false }),
  async evaluate(inputs, config, ctx): Promise<NodeOutput> {
    const capture = inputs.capture as CaptureValue;
    const warnings: string[] = [];
    const picked = new Map<string, AnalysisNode>();
    const byId = new Map(capture.analysis.nodes.map((n) => [n.wpId, n]));
    const selector = config.selector.trim();
    if (selector) {
      const doc = ctx.services.parseHtml(capture.frozenHtml);
      let els: Element[] = [];
      try {
        els = Array.from(doc.querySelectorAll(selector));
      } catch {
        return { outputs: {}, warnings: [], info: {}, waiting: `"${selector}" is not a valid CSS selector` };
      }
      if (!els.length) warnings.push(`Nothing on the page matches "${selector}"`);
      for (const el of els) {
        const n = nodeForElement(capture, el);
        if (n) picked.set(n.wpId, n);
      }
    }
    for (const id of config.wpIds) {
      const n = byId.get(id);
      if (n) picked.set(n.wpId, n);
      else warnings.push(`A picked element (${id}) is no longer on the page`);
    }
    if (config.similar) {
      const keys = new Set([...picked.values()].map((n) => n.repeatKey).filter(Boolean));
      for (const n of capture.analysis.nodes) if (n.repeatKey && keys.has(n.repeatKey)) picked.set(n.wpId, n);
    }
    if (!picked.size) return { outputs: {}, warnings, waiting: 'Enter a CSS selector, or click components in the preview' };
    const nodes = [...picked.values()].sort((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
    const set: ComponentSet = { capture, items: uniqueNames(nodes.map(componentForNode)), overrides: [] };
    return { outputs: { components: set }, warnings, info: { components: nodes.length } };
  },
};
