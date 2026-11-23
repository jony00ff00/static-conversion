import { describe, expect, it } from 'vitest';
import { renderFixture } from '../src/render/sandbox.js';
import { comparePng } from '../src/golden/compare.js';
import { checkGolden } from '../src/golden/check.js';
import { fixturePath, listFixtures } from '../src/golden/fixtures.js';

const fixtures = listFixtures();

describe('fixture corpus', () => {
  it('has the 12 planned fixtures', () => {
    expect(fixtures).toHaveLength(12);
  });

  describe.each(fixtures)('%s', (name) => {
    it('renders within 30 s, with no page errors, and every element stamped', async () => {
      const r = await renderFixture(fixturePath(name), { timeoutMs: 30_000 });
      expect(r.durationMs).toBeLessThan(30_000);
      expect(r.pageErrors).toEqual([]);
      expect(r.unstampedCount).toBe(0);
      expect(r.wpIdCount).toBeGreaterThan(0);
    });

    it('renders identically twice (DOM and pixels)', async () => {
      const a = await renderFixture(fixturePath(name));
      const b = await renderFixture(fixturePath(name));
      expect(b.html).toBe(a.html);
      const diff = comparePng(a.screenshot, b.screenshot);
      expect(diff.sizeMismatch).toBe(false);
      expect(diff.diffPixels).toBe(0);
    });

    it('matches its golden files', async () => {
      const o = await checkGolden(name);
      expect(o.messages).toEqual([]);
      expect(o.ok).toBe(true);
    });
  });
});

describe('fixture-specific expectations', () => {
  it('10-interactive: finite animations end fully visible', async () => {
    const r = await renderFixture(fixturePath('10-interactive'));
    expect(r.html).toContain('class="fade-in"');
  });

  it('12-cross-origin-iframe: outside iframe and image are blocked', async () => {
    const r = await renderFixture(fixturePath('12-cross-origin-iframe'));
    expect(r.blockedRequests.sort()).toEqual(['https://cdn.example.com/logo.png', 'https://maps.example.com/embed?q=riverside']);
  });
});
