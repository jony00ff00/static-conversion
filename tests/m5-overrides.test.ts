import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

process.env.VE_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 've-m5-'));

const { createProject, loadProject, saveProject, renderPages, parseDoc } = await import('../src/server/projects.js');
const ops = await import('../src/model/ops.js');
const { isolateComponent, applyOverrides } = await import('../src/compose/isolate.js');
const { comparePng } = await import('../src/golden/compare.js');
const { poppler, writeTmp } = await import('./helpers.js');
type Override = import('../src/model/types.js').Override;

/** Tag sequence of a document: the structure an edit must not change. */
const structure = (html: string) =>
  Array.from(parseHTML(html).document.querySelectorAll('body *'))
    .filter((e) => !e.hasAttribute('data-ve-isolate'))
    .map((e) => e.tagName)
    .join(',');

describe('M5: overrides', () => {
  it('each edit type is one override and one undo step; undo restores exactly', async () => {
    const s = await createProject({ type: 'fixture', name: '01-static' });
    const doc0 = s.document;
    const h1 = parseHTML(s.frozenHtml).document.querySelector('h1')!.getAttribute('data-wp-id')!;
    const img = parseHTML(s.frozenHtml).document.querySelector('img')!.getAttribute('data-wp-id')!;
    const edits: Override[] = [
      { id: 'o1', componentId: 'page', type: 'text', target: h1, value: 'New headline', original: 'Design that prints as well as it scrolls' },
      { id: 'o2', componentId: 'page', type: 'style', target: h1, prop: 'font-size', value: '28px' },
      { id: 'o3', componentId: 'page', type: 'visibility', target: img, hidden: true },
      { id: 'o4', componentId: 'page', type: 'asset', target: img, objectFit: 'cover', focalX: 20, focalY: 80 },
    ];
    const hist = new ops.History(doc0);
    const states = [JSON.stringify(doc0)];
    for (const e of edits) {
      const before = hist.present.overrides.length;
      hist.apply((d) => ops.setOverride(d, e));
      expect(hist.present.overrides.length).toBe(before + 1);
      expect(hist.past.length).toBe(states.length);
      states.push(JSON.stringify(hist.present));
    }
    // Editing the same slot again replaces the override (still one per slot).
    hist.apply((d) => ops.setOverride(d, { ...edits[1]!, id: 'o2b', value: '30px' } as Override));
    expect(hist.present.overrides.filter((o) => o.type === 'style')).toHaveLength(1);
    // Editing text back to the original removes the override.
    hist.apply((d) => ops.setOverride(d, { ...edits[0]!, id: 'o1b', value: 'Design that prints as well as it scrolls' } as Override));
    expect(hist.present.overrides.some((o) => o.type === 'text')).toBe(false);
    hist.undo();
    hist.undo();
    for (let i = edits.length - 1; i >= 0; i--) {
      expect(JSON.stringify(hist.present)).toBe(states[i + 1]);
      hist.undo();
    }
    expect(JSON.stringify(hist.present)).toBe(states[0]);
  }, 60_000);

  it('text edits never add or remove elements', async () => {
    const s = await createProject({ type: 'fixture', name: '03-bootstrap' });
    const doc = parseHTML(s.frozenHtml).document;
    const page = s.document.components.page!;
    const before = structure(isolateComponent(parseDoc, s.frozenHtml, page, {}));
    const overrides: Override[] = Array.from(doc.querySelectorAll('h5, p, .badge, a')).map((el, i) => ({
      id: `t${i}`,
      componentId: 'page',
      type: 'text',
      target: el.getAttribute('data-wp-id')!,
      value: `<b>Edited ${i}</b> & more`,
      original: el.textContent ?? '',
    }));
    const after = isolateComponent(parseDoc, s.frozenHtml, page, { overrides });
    expect(structure(after)).toBe(before);
    // Text is inserted as text, never as markup.
    expect(after).toContain('&lt;b&gt;Edited 0&lt;/b&gt; &amp; more');
  }, 60_000);

  it('reverting an override gives a pixel-identical page; the web source never changes', async () => {
    const s = await createProject({ type: 'fixture', name: '01-static' });
    const frozenBefore = s.frozenHtml;
    const original = await renderPages(s, { format: 'png', pageId: 'page-1', dpi: 96 });
    const h1 = parseHTML(s.frozenHtml).document.querySelector('h1')!.getAttribute('data-wp-id')!;
    let doc = ops.setOverride(s.document, { id: 'x1', componentId: 'page', type: 'text', target: h1, value: 'Changed', original: '' });
    doc = ops.setOverride(doc, { id: 'x2', componentId: 'page', type: 'style', target: h1, prop: 'color', value: 'red' });
    const edited = await renderPages({ ...s, document: doc }, { format: 'png', pageId: 'page-1', dpi: 96 });
    expect(comparePng(original, edited).diffPixels).toBeGreaterThan(100);
    doc = ops.revertAllOverrides(doc);
    const reverted = await renderPages({ ...s, document: doc }, { format: 'png', pageId: 'page-1', dpi: 96 });
    expect(comparePng(original, reverted).diffPixels).toBe(0);
    await saveProject({ ...s, document: doc });
    expect((await loadProject(s.meta.id)).frozenHtml).toBe(frozenBefore);
  }, 120_000);

  it('overrides survive save and reload', async () => {
    const s = await createProject({ type: 'fixture', name: '09-div-soup' });
    const t = parseHTML(s.frozenHtml).document.querySelector('.f')!.getAttribute('data-wp-id')!;
    const doc = ops.setOverride(s.document, { id: 'r1', componentId: 'page', type: 'text', target: t, value: 'Persisted', original: 'Widget One' });
    await saveProject({ ...s, document: doc });
    const again = await loadProject(s.meta.id);
    expect(again.document.overrides).toEqual(doc.overrides);
  }, 60_000);

  it('Unicode text round-trips through the PDF (accents, CJK, RTL, combining marks, emoji)', async () => {
    const s = await createProject({ type: 'fixture', name: '09-div-soup' });
    const d = parseHTML(s.frozenHtml).document;
    const samples = ['Café naïve façade', '東京の地図', 'שלום עולם', 'مرحبا', 'é combining', 'Emoji 😀 ok'];
    const targets = ['.f', '.g', '.h > div'].flatMap((sel) => Array.from(d.querySelectorAll(sel))).slice(0, samples.length);
    let doc = s.document;
    samples.forEach((value, i) => {
      doc = ops.setOverride(doc, { id: `u${i}`, componentId: 'page', type: 'text', target: targets[i]!.getAttribute('data-wp-id')!, value, original: '' });
    });
    const pdf = await renderPages({ ...s, document: doc }, { format: 'pdf' });
    // Narrow columns wrap the samples onto several lines: compare with whitespace collapsed.
    const text = poppler('pdftotext', [writeTmp(pdf, 'u.pdf'), '-']).normalize('NFC').replace(/\s+/g, ' ');
    for (const v of samples) {
      const want = v.normalize('NFC');
      // RTL text may be extracted in visual order: accept either direction.
      const ok = text.includes(want) || text.includes([...want].reverse().join(''));
      expect(ok, `${v} not found in PDF text`).toBe(true);
    }
  }, 120_000);

  it('applyOverrides marks every overridden element (for the "differs from web" markers)', async () => {
    const s = await createProject({ type: 'fixture', name: '01-static' });
    const doc = parseDoc(s.frozenHtml);
    const id = doc.querySelector('h1')!.getAttribute('data-wp-id')!;
    applyOverrides(doc, [{ id: 'm', componentId: 'page', type: 'style', target: id, prop: 'color', value: 'blue' }]);
    expect(doc.querySelector(`[data-wp-id="${id}"]`)!.hasAttribute('data-ve-overridden')).toBe(true);
  }, 60_000);
});
