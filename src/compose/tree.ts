/**
 * The component library: which analysed elements are components at the
 * current granularity, after the user's split / promote / demote / merge edits.
 */
import type { AnalysisNode, ComponentDef, DecompositionSettings } from '../model/types.js';

export interface TreeItem {
  node: AnalysisNode;
  /** Merged components use a synthetic node built from their parts. */
  mergedId?: string;
  children: TreeItem[];
  /** Name, made unique on the page ("Card (2)"). */
  label: string;
  /** Number of components sharing this item's repeatKey in the visible tree. */
  repeatCount: number;
}

/** wpIds that are components at this granularity and with these manual edits. */
export function visibleWpIds(nodes: AnalysisNode[], s: DecompositionSettings): Set<string> {
  const byId = new Map(nodes.map((n) => [n.wpId, n]));
  const out = new Set<string>();
  const demoted = new Set(s.demoted);
  for (const n of nodes) if (n.depth <= s.granularity && !demoted.has(n.wpId)) out.add(n.wpId);
  for (const id of s.promoted) if (byId.has(id)) out.add(id);
  for (const id of s.split) {
    if (!byId.has(id)) continue;
    const kids = nodes.filter((n) => n.parentWpId === id);
    if (!kids.length) continue; // nothing to split into
    out.delete(id);
    for (const k of kids) if (!demoted.has(k.wpId)) out.add(k.wpId);
  }
  for (const m of s.merged) for (const id of m.wpIds) out.delete(id);
  return out;
}

const unionBox = (ns: AnalysisNode[]) => {
  const x = Math.min(...ns.map((n) => n.bbox.x));
  const y = Math.min(...ns.map((n) => n.bbox.y));
  return { x, y, w: Math.max(...ns.map((n) => n.bbox.x + n.bbox.w)) - x, h: Math.max(...ns.map((n) => n.bbox.y + n.bbox.h)) - y };
};

/** Build the library tree. */
export function buildTree(nodes: AnalysisNode[], s: DecompositionSettings): TreeItem[] {
  const visible = visibleWpIds(nodes, s);
  const byId = new Map(nodes.map((n) => [n.wpId, n]));
  const items = new Map<string, TreeItem>();
  for (const n of nodes) if (visible.has(n.wpId)) items.set(n.wpId, { node: n, children: [], label: n.name, repeatCount: 1 });
  for (const m of s.merged) {
    const parts = m.wpIds.map((id) => byId.get(id)).filter((n): n is AnalysisNode => !!n);
    const root = byId.get(m.rootWpId);
    if (!parts.length) continue;
    const node: AnalysisNode = {
      ...(root ?? parts[0]!),
      wpId: m.rootWpId,
      parentWpId: root?.parentWpId ?? parts[0]!.parentWpId,
      kind: 'group',
      name: `${parts[0]!.name} + ${parts.length - 1} more`,
      bbox: unionBox(parts),
      repeatKey: null,
      minFontPx: Math.min(...parts.map((p) => p.minFontPx ?? Infinity)) || null,
    };
    items.set(m.id, { node, mergedId: m.id, children: [], label: node.name, repeatCount: 1 });
  }
  // Parent = nearest visible ancestor in the analysis tree.
  const roots: TreeItem[] = [];
  for (const [key, item] of items) {
    let p = item.node.parentWpId;
    while (p && !items.has(p)) p = byId.get(p)?.parentWpId ?? null;
    const parent = p && p !== key ? items.get(p) : undefined;
    (parent ? parent.children : roots).push(item);
  }
  const sortRec = (list: TreeItem[]) => {
    list.sort((a, b) => a.node.bbox.y - b.node.bbox.y || a.node.bbox.x - b.node.bbox.x);
    list.forEach((i) => sortRec(i.children));
  };
  sortRec(roots);
  // Unique labels, and repeat counts.
  const all: TreeItem[] = [];
  const flat = (l: TreeItem[]) => l.forEach((i) => (all.push(i), flat(i.children)));
  flat(roots);
  const seen = new Map<string, number>();
  for (const i of all) {
    const n = (seen.get(i.label) ?? 0) + 1;
    seen.set(i.label, n);
    if (n > 1) i.label = `${i.label} (${n})`;
  }
  const reps = new Map<string, number>();
  for (const i of all) if (i.node.repeatKey) reps.set(i.node.repeatKey, (reps.get(i.node.repeatKey) ?? 0) + 1);
  for (const i of all) if (i.node.repeatKey) i.repeatCount = reps.get(i.node.repeatKey) ?? 1;
  return roots;
}

export function flattenTree(t: TreeItem[]): TreeItem[] {
  const out: TreeItem[] = [];
  const walk = (l: TreeItem[]) => l.forEach((i) => (out.push(i), walk(i.children)));
  walk(t);
  return out;
}

/** The component definition placed in a document for a library item. */
export function defFromItem(item: TreeItem, merged?: { wpIds: string[] }): ComponentDef {
  const n = item.node;
  return {
    id: item.mergedId ? `c-${item.mergedId}` : `c-${n.wpId}`,
    name: item.label,
    kind: n.kind,
    rootWpId: n.wpId,
    showWpIds: merged?.wpIds,
    widthPx: n.bbox.w,
    heightPx: n.bbox.h,
    bg: n.bg,
    minFontPx: n.minFontPx,
  };
}

/** Lowest common ancestor of several nodes (for merging). */
export function commonAncestor(nodes: AnalysisNode[], all: AnalysisNode[]): string | null {
  const byId = new Map(all.map((n) => [n.wpId, n]));
  const chain = (n: AnalysisNode) => {
    const c: string[] = [];
    for (let p = n.parentWpId; p; p = byId.get(p)?.parentWpId ?? null) c.push(p);
    return c;
  };
  if (!nodes.length) return null;
  const [first, ...rest] = nodes.map(chain);
  return first!.find((id) => rest.every((c) => c.includes(id))) ?? null;
}
