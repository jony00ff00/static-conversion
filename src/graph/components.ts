/** Building component sets from a capture (shared by the Components and Pick nodes). */
import { buildTree, defFromItem, flattenTree } from '../compose/tree.js';
import { pageComponent } from '../model/ops.js';
import type { AnalysisNode, ComponentDef } from '../model/types.js';
import type { CaptureValue, LibrarySettings } from './values.js';

/** The whole page, then every library item at these settings, in reading order. */
export function libraryComponents(capture: CaptureValue, lib: LibrarySettings): ComponentDef[] {
  const tree = buildTree(capture.analysis.nodes, { ...lib, rules: capture.settings.rules });
  const items = flattenTree(tree).map((i) => defFromItem(i, i.mergedId ? lib.merged.find((m) => m.id === i.mergedId) : undefined));
  return [pageComponent(capture.analysis, capture.bodyWpId), ...items];
}

/**
 * The analysed component an element belongs to: its own node, or its nearest
 * analysed ancestor (as when dragging from the web pane).
 */
export function nodeForElement(capture: CaptureValue, el: Element | null): AnalysisNode | null {
  const byId = new Map(capture.analysis.nodes.map((n) => [n.wpId, n]));
  for (let e = el; e; e = e.parentElement) {
    const n = byId.get(e.getAttribute('data-wp-id') ?? '');
    if (n) return n;
  }
  return null;
}

/** A component for one analysed node. */
export function componentForNode(n: AnalysisNode): ComponentDef {
  return defFromItem({ node: n, children: [], label: n.name, repeatCount: 1 });
}

/** Make names unique within a set ("Card", "Card (2)"). */
export function uniqueNames(items: ComponentDef[]): ComponentDef[] {
  const seen = new Map<string, number>();
  return items.map((c) => {
    const base = c.name.replace(/ \(\d+\)$/, '');
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k > 1 ? { ...c, name: `${base} (${k})` } : c;
  });
}
