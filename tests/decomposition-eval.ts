import { parseHTML } from 'linkedom';
import { analyse } from '../src/server/projects.js';
import { dirSource } from '../src/render/sandbox.js';
import { DEFAULT_PRESETS } from '../src/model/types.js';
import { visibleWpIds } from '../src/compose/tree.js';
import { LABELS } from './decomposition-labels.js';
import { fixture } from './helpers.js';

const DEC = { granularity: 1, rules: [], split: [], promoted: [], demoted: [], merged: [] };

/** Precision/recall of the component boundaries against the labels, per level. */
export async function evaluateFixture(name: string) {
  const a = await analyse(dirSource(fixture(name)), { captureWidthPx: 680, presets: DEFAULT_PRESETS, setupSteps: [], decomposition: DEC });
  const doc = parseHTML(a.frozenHtml).document;
  const hiddenIds = new Set(a.analysis.nodes.map((n) => n.wpId));
  const levels = LABELS[name]!;
  const out: Array<{ level: number; precision: number; recall: number; missing: string[]; extra: string[] }> = [];
  const expected = new Set<string>();
  for (let g = 1; g <= 3; g++) {
    for (const sel of levels[g - 1] ?? []) {
      for (const el of doc.querySelectorAll(sel)) {
        const id = el.getAttribute('data-wp-id');
        // Labels only count elements the analysis could see (visible ones).
        if (id && (hiddenIds.has(id) || !el.closest('[data-ve-preset]'))) expected.add(id);
      }
    }
    const actual = visibleWpIds(a.analysis.nodes, { ...DEC, granularity: g });
    const visible = new Set(a.analysis.nodes.map((n) => n.wpId));
    const exp = new Set([...expected].filter((id) => visible.has(id) || !doc.querySelector(`[data-wp-id="${id}"]`)?.closest('[data-ve-preset]')));
    const hit = [...actual].filter((id) => exp.has(id));
    const name = (id: string) => {
      const n = a.analysis.nodes.find((x) => x.wpId === id);
      const el = doc.querySelector(`[data-wp-id="${id}"]`);
      return n ? `${n.tag}:${n.name.slice(0, 18)}` : `${el?.tagName.toLowerCase()}#${id}`;
    };
    out.push({
      level: g,
      precision: actual.size ? hit.length / actual.size : 1,
      recall: exp.size ? hit.length / exp.size : 1,
      missing: [...exp].filter((id) => !actual.has(id)).map(name),
      extra: [...actual].filter((id) => !exp.has(id)).map(name),
    });
  }
  return { analysis: a, levels: out };
}
