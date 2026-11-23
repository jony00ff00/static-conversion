import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXED_TIME, FIXTURE_ORIGIN, RenderTimeoutError, renderFixture, resolveFixturePath } from '../src/render/sandbox.js';

const sf = (name: string) => path.join(import.meta.dirname, 'sandbox-fixtures', name);
const textOf = (html: string, id: string) => html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`))?.[1];

describe('sandbox', () => {
  it('blocks requests to outside hosts', async () => {
    const r = await renderFixture(sf('external-fetch'));
    expect(textOf(r.html, 'out')).toBe('blocked');
    expect(r.blockedRequests).toEqual(
      expect.arrayContaining(['https://evil.example.com/steal?x=1', 'http://tracker.example.net/pixel.gif']),
    );
  });

  it('blocks WebSockets', async () => {
    const r = await renderFixture(sf('websocket'));
    expect(textOf(r.html, 'out')).not.toBe('LEAKED');
    expect(r.blockedRequests).toContain('wss://socket.example.com/live');
  });

  it('does not serve files outside the fixture directory', async () => {
    const r = await renderFixture(sf('traversal'));
    expect(textOf(r.html, 'out')).not.toBe('LEAKED');
  });

  it('resolveFixturePath rejects traversal and foreign origins', () => {
    const root = sf('traversal');
    expect(resolveFixturePath(root, `${FIXTURE_ORIGIN}/index.html`)).toBe(path.join(root, 'index.html'));
    // The URL parser normalises %2e%2e to ".." and clamps it at the root, so this stays inside.
    expect(resolveFixturePath(root, `${FIXTURE_ORIGIN}/%2e%2e/secret.txt`)).toBe(path.join(root, 'secret.txt'));
    // An encoded slash survives URL parsing; the path check must catch it.
    expect(resolveFixturePath(root, `${FIXTURE_ORIGIN}/..%2fsecret.txt`)).toBeNull();
    expect(resolveFixturePath(root, 'https://example.com/index.html')).toBeNull();
  });

  it('kills a page stuck in an infinite loop at the time limit', async () => {
    const started = Date.now();
    await expect(renderFixture(sf('infinite-loop'), { timeoutMs: 3_000 })).rejects.toBeInstanceOf(RenderTimeoutError);
    // Limit + up to 5 s for browser teardown.
    expect(Date.now() - started).toBeLessThan(9_000);
  });

  it('fixes the clock and seeds Math.random', async () => {
    const a = await renderFixture(sf('date-random'));
    const b = await renderFixture(sf('date-random'));
    expect(textOf(a.html, 'date')).toBe(FIXED_TIME.toISOString());
    expect(textOf(a.html, 'rand')).toBe(textOf(b.html, 'rand'));
  });
});
