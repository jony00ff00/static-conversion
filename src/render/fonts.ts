import type { Page } from 'playwright';

export type FontStatus =
  /** The requested font (system or web font) is what actually drew the text. */
  | 'ok'
  /** A generic family (serif, sans-serif…) was requested; the platform picked a font. */
  | 'generic'
  /** The requested font wasn't available, so a different font drew the text. */
  | 'substituted';

export interface FontGroup {
  /** Computed font-family stack of the first element seen, e.g. `Georgia, serif`. */
  stack: string;
  /** First family in the stack — the one the author wanted. */
  requested: string;
  weight: string;
  style: string;
  /** Fonts that actually drew the text (from Chromium). */
  used: Array<{ familyName: string; isCustomFont: boolean; glyphCount: number }>;
  status: FontStatus;
  nodeCount: number;
  /** One element using this group, for "show me" in the UI. */
  sampleWpId: string;
}

export interface FontReport {
  groups: FontGroup[];
  /** Web fonts (@font-face) that loaded. */
  loadedFaces: string[];
  /** Web fonts that failed to load (e.g. blocked Google Fonts URL). */
  failedFaces: string[];
  /** Font files the page fetched. */
  fontFiles: string[];
  /** Human-readable warnings, one per substituted group. */
  warnings: string[];
}

interface FontFacts {
  nodes: Array<{ wpId: string; family: string; weight: string; style: string } | null>;
  loadedFaces: string[];
  failedFaces: string[];
  fontFiles: string[];
  genericPattern: string;
}

interface PlatformFont {
  familyName: string;
  postScriptName?: string;
  isCustomFont: boolean;
  glyphCount: number;
}

const unquote = (s: string) => s.trim().replace(/^["']|["']$/g, '');

/**
 * Work out which fonts actually render the page's text. `fontUrls` are the font
 * requests seen by the sandbox (resource timing misses intercepted requests). Must run after
 * window.__ve is injected and IDs are stamped.
 */
export async function collectFonts(page: Page, fontUrls: string[] = []): Promise<FontReport> {
  const facts = (await page.evaluate('window.__ve.fontFacts()')) as FontFacts;
  const generic = new RegExp(facts.genericPattern, 'i');
  const loaded = new Set(facts.loadedFaces.map((f) => f.toLowerCase()));

  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    // Same document order as document.querySelectorAll('[data-wp-id]') in the page.
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: '[data-wp-id]' });
    if (nodeIds.length !== facts.nodes.length) {
      throw new Error(`font collection: node count mismatch (${nodeIds.length} vs ${facts.nodes.length})`);
    }

    const groups = new Map<string, FontGroup & { usedMap: Map<string, PlatformFont> }>();
    await Promise.all(
      facts.nodes.map(async (n, i) => {
        if (!n) return;
        const nodeId = nodeIds[i]!;
        const { fonts } = (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })) as { fonts: PlatformFont[] };
        if (!fonts.length) return; // not rendered (e.g. display:none)
        const requested = unquote(n.family.split(',')[0] ?? '');
        const key = `${requested.toLowerCase()}|${n.weight}|${n.style}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            stack: n.family,
            requested,
            weight: n.weight,
            style: n.style,
            used: [],
            status: 'ok',
            nodeCount: 0,
            sampleWpId: n.wpId,
            usedMap: new Map(),
          };
          groups.set(key, g);
        }
        g.nodeCount++;
        for (const f of fonts) {
          const prev = g.usedMap.get(f.familyName);
          if (prev) prev.glyphCount += f.glyphCount;
          else g.usedMap.set(f.familyName, { ...f });
        }
      }),
    );

    const out: FontGroup[] = [];
    const warnings: string[] = [];
    for (const g of [...groups.values()].sort((a, b) => b.nodeCount - a.nodeCount)) {
      const { usedMap, ...rest } = g;
      const used = [...usedMap.values()]
        .sort((a, b) => b.glyphCount - a.glyphCount)
        .map((f) => ({ familyName: f.familyName, isCustomFont: f.isCustomFont, glyphCount: f.glyphCount }));
      const req = rest.requested.toLowerCase();
      let status: FontStatus;
      if (generic.test(rest.requested)) status = 'generic';
      else if (loaded.has(req)) status = used.some((f) => f.isCustomFont) ? 'ok' : 'substituted';
      else status = used.some((f) => f.familyName.toLowerCase() === req) ? 'ok' : 'substituted';
      if (status === 'substituted') {
        warnings.push(
          `"${rest.requested}" (${rest.weight}${rest.style === 'normal' ? '' : ' ' + rest.style}) is not available; ` +
            `text is drawn with ${used.map((f) => `"${f.familyName}"`).join(', ')} instead (${rest.nodeCount} element${rest.nodeCount === 1 ? '' : 's'}).`,
        );
      }
      out.push({ ...rest, used, status });
    }
    for (const f of facts.failedFaces) warnings.push(`Web font "${f}" failed to load.`);
    return {
      groups: out,
      loadedFaces: facts.loadedFaces,
      failedFaces: facts.failedFaces,
      fontFiles: [...new Set([...fontUrls, ...facts.fontFiles])],
      warnings,
    };
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}
