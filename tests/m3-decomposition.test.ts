import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { PNG } from 'pngjs';
import { comparePng } from '../src/golden/compare.js';
import { isolateComponent } from '../src/compose/isolate.js';
import { buildTree, defFromItem, flattenTree, visibleWpIds } from '../src/compose/tree.js';
import { analyse, parseDoc } from '../src/server/projects.js';
import { dirSource, withSandbox } from '../src/render/sandbox.js';
import { DEFAULT_PRESETS, type DecompositionSettings } from '../src/model/types.js';
import { evaluateFixture } from './decomposition-eval.js';
import { LABELS } from './decomposition-labels.js';
import { REPO, fixture } from './helpers.js';

const DEC: DecompositionSettings = { granularity: 2, rules: [], split: [], promoted: [], demoted: [], merged: [] };
const run = (name: string, extra: Partial<Parameters<typeof analyse>[1]> = {}) =>
  analyse(dirSource(fixture(name)), { captureWidthPx: 680, presets: DEFAULT_PRESETS, setupSteps: [], decomposition: DEC, ...extra });

describe('M3: component boundaries match the labelled reference trees', () => {
  it.each(Object.keys(LABELS))('%s: precision and recall ≥ 0.9 at coarse, medium and fine', async (name) => {
    const r = await evaluateFixture(name);
    for (const l of r.levels) {
      expect(l.precision, `${name} L${l.level} extra: ${l.extra.join(', ')}`).toBeGreaterThanOrEqual(0.9);
      expect(l.recall, `${name} L${l.level} missing: ${l.missing.join(', ')}`).toBeGreaterThanOrEqual(0.9);
    }
  }, 60_000);
});

describe('M3: isolated components look like their region of the page', () => {
  it.each(['01-static', '02-tailwind', '03-bootstrap', '06-svg-infographic', '09-div-soup'])(
    '%s: every medium-level component isolated on its own matches the source region (< 1 %)',
    async (name) => {
      const a = await run(name);
      const items = flattenTree(buildTree(a.analysis.nodes, DEC));
      expect(items.length).toBeGreaterThan(3);
      // Compared at 2× so whole-pixel text snapping (which differs with the
      // element's start position) doesn't dominate small components.
      const K = 2;
      await withSandbox(dirSource(fixture(name)), { viewport: { width: 680, height: 900 }, scale: K }, async (s) => {
        // The whole frozen page, as the reference.
        const pageUrl = s.serve('page.html', a.frozenHtml.replace(/<head([^>]*)>/i, `<head$1><base href="${a.analysis.baseUrl}">`));
        await s.page.goto(pageUrl);
        const full = PNG.sync.read(await s.page.screenshot({ fullPage: true }));
        let checked = 0;
        for (const item of items) {
          const n = item.node;
          const w = Math.round(n.bbox.w);
          const h = Math.round(n.bbox.h);
          const X = Math.floor(n.bbox.x * K);
          const Y = Math.floor(n.bbox.y * K);
          if (w < 8 || h < 8 || X + w * K > full.width || Y + h * K > full.height) continue;
          const html = isolateComponent(parseDoc, a.frozenHtml, defFromItem(item), { widthPx: n.bbox.w, heightPx: n.bbox.h, baseUrl: a.analysis.baseUrl });
          // Viewport at the capture width (vw units), component at its own width.
          await s.page.setViewportSize({ width: 680, height: Math.max(h, 50) });
          await s.page.goto(s.serve(`c-${n.wpId}.html`, html));
          // Same sub-pixel offset as on the page, so the crop compares like for like.
          const fx = (n.bbox.x * K - X) / K;
          const fy = (n.bbox.y * K - Y) / K;
          await s.page.addStyleTag({ content: `html [data-ve-root][data-ve-root]{margin-left:${fx}px!important;margin-top:${fy}px!important}` });
          const shot = await s.page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } });
          const ref = new PNG({ width: w * K, height: h * K });
          PNG.bitblt(full, ref, X, Y, w * K, h * K, 0, 0);
          // Colour tolerance 0.2: on small components a few anti-aliased glyph
          // edges (sub-pixel text position) are a large share of the pixels.
          const d = comparePng(PNG.sync.write(ref), shot, { threshold: 0.2 });
          if (d.ratio >= 0.01) {
            // Keep both images for inspection (CI uploads .golden-diff/ on failure).
            const { mkdirSync, writeFileSync } = await import('node:fs');
            const dir = `${REPO}/.golden-diff/isolation`;
            mkdirSync(dir, { recursive: true });
            writeFileSync(`${dir}/${name}-${n.wpId}-expected.png`, PNG.sync.write(ref));
            writeFileSync(`${dir}/${name}-${n.wpId}-actual.png`, shot);
          }
          expect(d.ratio, `${name} ${n.tag} "${n.name}"`).toBeLessThan(0.01);
          checked++;
          await s.page.setViewportSize({ width: 680, height: 900 });
        }
        expect(checked).toBeGreaterThan(3);
      });
    },
    120_000,
  );
});

describe('M3: grouping, presets, rules and names', () => {
  it('repeated cards are one type with N instances', async () => {
    for (const [name, count] of [['03-bootstrap', 6], ['01-static', 3], ['09-div-soup', 3]] as const) {
      const a = await run(name);
      const tree = flattenTree(buildTree(a.analysis.nodes, { ...DEC, granularity: 1 + (name === '01-static' ? 1 : 0) }));
      const max = Math.max(...tree.map((i) => i.repeatCount));
      expect(max, name).toBeGreaterThanOrEqual(count);
    }
  }, 60_000);

  it('presets: cookie banner and sticky nav removed; tabs, accordions, carousel expanded', async () => {
    const on = await run('11-print-media-darkmode');
    const d1 = parseHTML(on.frozenHtml).document;
    expect(d1.querySelector('.cookie')!.getAttribute('data-ve-preset')).toBe('hidden');
    expect(d1.querySelector('.site-nav')!.getAttribute('data-ve-preset')).toBe('hidden');
    const off = await run('11-print-media-darkmode', { presets: { ...DEFAULT_PRESETS, hideChrome: false } });
    expect(parseHTML(off.frozenHtml).document.querySelector('.cookie')!.hasAttribute('data-ve-preset')).toBe(false);

    const i = await run('10-interactive');
    const d2 = parseHTML(i.frozenHtml).document;
    for (const id of ['p1', 'p2', 'p3', 'a1', 'a2']) expect(d2.getElementById(id)!.hasAttribute('hidden'), id).toBe(false);
    expect(d2.querySelector('details')!.hasAttribute('open')).toBe(true);
    expect(d2.querySelectorAll('.slide[hidden]').length).toBe(0);
    // One component per slide.
    const slides = i.analysis.nodes.filter((n) => d2.querySelector(`[data-wp-id="${n.wpId}"]`)?.classList.contains('slide'));
    expect(slides).toHaveLength(3);
  }, 60_000);

  it("'print styles' preset applies the author's @media print rules in the frozen page", async () => {
    const a = await run('11-print-media-darkmode', { presets: { ...DEFAULT_PRESETS, printMedia: true, hideChrome: false } });
    const ids = new Set(a.analysis.nodes.map((n) => n.name));
    expect([...ids].some((n) => n.startsWith('Printed programme'))).toBe(true); // .only-print shown
    expect([...ids].some((n) => n.startsWith('Scroll down'))).toBe(false); // .no-print hidden
    expect(a.frozenHtml).toContain('data-ve-print-baked');
  }, 60_000);

  it('link URLs preset adds the address after external links', async () => {
    const a = await run('11-print-media-darkmode', { presets: { ...DEFAULT_PRESETS, linkUrls: true } });
    expect(a.frozenHtml).toContain('(example.com/book)');
  }, 60_000);

  it('saved rules: "always" and "never" give the same tree on every re-import', async () => {
    const rules = [
      { selector: '.badge', action: 'component' as const },
      { selector: '.alert', action: 'ignore' as const },
    ];
    const a = await run('03-bootstrap', { decomposition: { ...DEC, rules } });
    const b = await run('03-bootstrap', { decomposition: { ...DEC, rules } });
    const idsA = [...visibleWpIds(a.analysis.nodes, { ...DEC, granularity: 3 })].sort();
    expect([...visibleWpIds(b.analysis.nodes, { ...DEC, granularity: 3 })].sort()).toEqual(idsA);
    const d = parseHTML(a.frozenHtml).document;
    const badge = d.querySelector('.badge')!.getAttribute('data-wp-id')!;
    const alert = d.querySelector('.alert')!.getAttribute('data-wp-id')!;
    expect(a.analysis.nodes.some((n) => n.wpId === badge)).toBe(true);
    expect(a.analysis.nodes.some((n) => n.wpId === alert)).toBe(false);
  }, 60_000);

  it('every component has a non-empty name, unique within the page', async () => {
    for (const name of Object.keys(LABELS)) {
      const a = await run(name);
      for (const g of [1, 2, 3]) {
        const labels = flattenTree(buildTree(a.analysis.nodes, { ...DEC, granularity: g })).map((i) => i.label);
        expect(labels.every((l) => l.trim().length > 0), name).toBe(true);
        expect(new Set(labels).size, `${name} L${g}`).toBe(labels.length);
      }
    }
  }, 180_000);

  it('split, promote, demote and merge edit the tree', async () => {
    const a = await run('01-static');
    const nodes = a.analysis.nodes;
    const features = nodes.find((n) => n.tag === 'section' && n.name === 'Research')!;
    const cards = nodes.filter((n) => n.parentWpId === features.wpId);
    const base = visibleWpIds(nodes, { ...DEC, granularity: 1 });
    expect(base.has(features.wpId)).toBe(true);
    const split = visibleWpIds(nodes, { ...DEC, granularity: 1, split: [features.wpId] });
    expect(split.has(features.wpId)).toBe(false);
    for (const c of cards) expect(split.has(c.wpId)).toBe(true);
    const h3 = nodes.find((n) => n.tag === 'h3')!;
    expect(visibleWpIds(nodes, { ...DEC, granularity: 1, promoted: [h3.wpId] }).has(h3.wpId)).toBe(true);
    expect(visibleWpIds(nodes, { ...DEC, granularity: 1, demoted: [features.wpId] }).has(features.wpId)).toBe(false);
    const merged = buildTree(nodes, { ...DEC, granularity: 2, merged: [{ id: 'm1', rootWpId: features.wpId, wpIds: [cards[0]!.wpId, cards[1]!.wpId] }] });
    const flat = flattenTree(merged);
    expect(flat.some((i) => i.mergedId === 'm1')).toBe(true);
    expect(flat.some((i) => i.node.wpId === cards[0]!.wpId && !i.mergedId)).toBe(false);
  }, 60_000);
});
