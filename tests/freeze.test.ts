import { describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { comparePng } from '../src/golden/compare.js';
import { listFixtures } from '../src/golden/fixtures.js';
import { withBase } from '../src/export/a4.js';
import { captureInSession, dirSource, renderFixture, withSandbox } from '../src/render/sandbox.js';
import { fixture, freezeFixture, pixel } from './helpers.js';

const FREEZE_TOLERANCE = 0.005; // 0.5 % of pixels

describe('freezing keeps the page looking the same', () => {
  const all = [...listFixtures().map((f) => ['fixtures', f]), ...['pseudo', 'webgl', 'media'].map((f) => ['freeze-fixtures', f])];
  it.each(all)('%s/%s: frozen screenshot matches the live page', async (kind, name) => {
    const dir = kind === 'fixtures' ? fixture(name) : freezeFixture(name);
    const r = await renderFixture(dir, { verifyFreeze: true });
    expect(r.pageErrors).toEqual([]);
    const placeholders = r.freeze!.rasterized.filter((x) => x.result === 'placeholder').length;
    if (placeholders) return; // blocked embeds are deliberately replaced; checked separately
    const d = comparePng(r.screenshotBeforeFreeze!, r.screenshot);
    expect(d.sizeMismatch).toBe(false);
    expect(d.ratio).toBeLessThanOrEqual(FREEZE_TOLERANCE);
  });

  it.each(['01-static', '05-canvas-chart', '06-svg-infographic', '10-interactive'])(
    '%s: the frozen document renders the same on its own, with no scripts',
    async (name) => {
      const src = dirSource(fixture(name));
      await withSandbox(src, {}, async (s) => {
        const first = await captureInSession(s, 'http://fixture.local/index.html', {});
        const url = s.serve('frozen.html', withBase(first.html, first.baseUrl));
        const again = await captureInSession(s, url, { freeze: false, fonts: false });
        const d = comparePng(first.screenshot, again.screenshot);
        expect(d.sizeMismatch).toBe(false);
        expect(d.ratio).toBeLessThanOrEqual(FREEZE_TOLERANCE);
      });
    },
  );
});

describe('static output', () => {
  it('removes scripts, inline handlers and noscript; keeps JSON data scripts', async () => {
    const r = await renderFixture(fixture('04-react-spa'));
    expect(r.html).not.toMatch(/<script(?![^>]*application\/(ld\+)?json)/i);
    expect(r.html).not.toMatch(/\son[a-z]+=/i);
    expect(r.html).toContain('Luigi’s Pizzeria'); // content React built is kept
    expect(r.html).toContain('data-ve-static');
  });
});

describe('canvas and WebGL', () => {
  it('Chart.js canvases become images', async () => {
    const r = await renderFixture(fixture('05-canvas-chart'));
    expect(r.freeze!.canvases).toHaveLength(2);
    expect(r.freeze!.canvases.every((c) => c.method === 'toDataURL')).toBe(true);
    expect(r.html).not.toContain('<canvas');
    expect((r.html.match(/data-ve-frozen="canvas"/g) ?? []).length).toBe(2);
  });

  it('canvases follow the render scale (print resolution at 300 dpi)', async () => {
    const r = await renderFixture(fixture('05-canvas-chart'), { scale: 300 / 96 });
    for (const c of r.freeze!.canvases) expect(c.effectiveDpi).toBeGreaterThanOrEqual(299);
  });

  it('a WebGL canvas drawn once is captured, not blank', async () => {
    const r = await renderFixture(freezeFixture('webgl'));
    expect(r.html).not.toContain('data-no-webgl');
    expect(r.freeze!.canvases[0]).toMatchObject({ webgl: true, method: 'toDataURL' });
    const png = PNG.sync.read(r.screenshot);
    // Canvas at (24,24), 300×200: blue background, orange square in the middle.
    const [cr, cg, cb] = pixel(png, 24 + 150, 24 + 100);
    const [br, bg, bb] = pixel(png, 24 + 20, 24 + 20);
    expect(cr).toBeGreaterThan(200); expect(cg).toBeGreaterThan(120); expect(cb).toBeLessThan(60);
    expect(br).toBeLessThan(80); expect(bg).toBeLessThan(140); expect(bb).toBeGreaterThan(200);
  });
});

describe('video', () => {
  it('uses the poster when there is one, otherwise the frame at t=0', async () => {
    const r = await renderFixture(freezeFixture('media'));
    expect(r.freeze!.videos.map((v) => v.method)).toEqual(['poster', 'frame']);
    expect(r.html).not.toContain('<video');
    const png = PNG.sync.read(r.screenshot);
    const [r1, g1, b1] = pixel(png, 24 + 20, 24 + 20); // poster: purple
    expect(r1).toBeGreaterThan(100); expect(g1).toBeLessThan(80); expect(b1).toBeGreaterThan(200);
    const [r2, g2, b2] = pixel(png, 24 + 160, 24 + 180 + 16 + 90); // second video frame: green
    expect(g2).toBeGreaterThan(130); expect(r2).toBeLessThan(60); expect(b2).toBeLessThan(110);
  });
});

describe('pseudo-elements', () => {
  it('converts resolvable ::before/::after into real elements and reports the rest', async () => {
    const r = await renderFixture(freezeFixture('pseudo'));
    expect(r.freeze!.pseudoConverted).toBe(7);
    expect(r.freeze!.pseudoSkipped).toHaveLength(3);
    expect(r.freeze!.pseudoSkipped.every((p) => p.content.startsWith('counter('))).toBe(true);
    expect(r.html).toContain('>NEW</span>');
    expect(r.html).toContain('> incl. VAT</span>');
    expect(r.html).toContain('> (example.com/shop)</span>'); // attr() resolved
    expect(r.html).toContain('>“</span>'); // \201C escape resolved
    expect(r.html).toMatch(/data-ve-pseudo-of="before"[^>]*><img src="[^"]*star\.svg"/);
  });
});

describe('animations and timers', () => {
  it('keeps the end state of finished animations once animations are switched off', async () => {
    const r = await renderFixture(fixture('10-interactive'));
    expect(r.freeze!.bakedProps).toBeGreaterThan(0);
    expect(r.html).toMatch(/class="fade-in"[^>]*style="[^"]*opacity: 1 !important/);
  });
});

describe('embeds and failed images', () => {
  it('replaces blocked iframes and images with labelled placeholders', async () => {
    const r = await renderFixture(fixture('12-cross-origin-iframe'));
    const ph = r.freeze!.rasterized;
    expect(ph.map((p) => [p.kind, p.result, p.reason])).toEqual(
      expect.arrayContaining([
        ['iframe', 'placeholder', 'blocked'],
        ['img', 'placeholder', 'blocked'],
      ]),
    );
    expect(r.html).toContain('Embedded content unavailable (maps.example.com)');
    expect(r.html).toContain('Image unavailable (cdn.example.com)');
    expect(r.html).not.toContain('<iframe');
  });
});
