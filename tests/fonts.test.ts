import { describe, expect, it } from 'vitest';
import { importPaste } from '../src/import/index.js';
import { renderFixture, renderSource } from '../src/render/sandbox.js';
import { fixture } from './helpers.js';

describe('font report', () => {
  it('confirms self-hosted web fonts and flags a missing font', async () => {
    const r = await renderFixture(fixture('07-webfonts'));
    const f = r.fonts!;
    const inter = f.groups.filter((g) => g.requested === 'InterLocal');
    expect(inter.map((g) => `${g.weight} ${g.style}`).sort()).toEqual(['400 italic', '400 normal', '700 normal']);
    expect(inter.every((g) => g.status === 'ok' && g.used[0]?.isCustomFont)).toBe(true);
    const missing = f.groups.find((g) => g.requested === 'DefinitelyMissingFont');
    expect(missing?.status).toBe('substituted');
    expect(f.warnings.some((w) => w.includes('"DefinitelyMissingFont"'))).toBe(true);
    expect(f.fontFiles.filter((u) => u.endsWith('.woff2'))).toHaveLength(3);
    expect(f.failedFaces).toEqual([]);
  });

  it('reports generic families as generic, not as a problem', async () => {
    const { source } = await importPaste({ html: '<p style="font-family: sans-serif">Generic</p>' });
    const r = await renderSource(source);
    expect(r.fonts!.groups.find((g) => g.requested === 'sans-serif')?.status).toBe('generic');
    expect(r.fonts!.warnings).toEqual([]);
  });

  it('flags a web font that could not be downloaded (blocked outside URL)', async () => {
    const { source } = await importPaste({
      html: '<p class="x">Remote font</p>',
      css: `@font-face{font-family:"RemoteFace";src:url(https://fonts.example.com/remote.woff2) format("woff2")}
            .x{font-family:"RemoteFace",serif}`,
    });
    const r = await renderSource(source);
    expect(r.fonts!.failedFaces).toContain('RemoteFace');
    expect(r.fonts!.groups.find((g) => g.requested === 'RemoteFace')?.status).toBe('substituted');
    expect(r.fonts!.warnings.some((w) => w.includes('Web font "RemoteFace" failed to load'))).toBe(true);
  });
});
