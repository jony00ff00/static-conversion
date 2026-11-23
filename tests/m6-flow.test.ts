import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

process.env.VE_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 've-m6-'));

const { createProject, autoPaginate, reflowChain, renderPages, htmlForServer, measureFlow } = await import('../src/server/projects.js');
const { computeSlices, checkSlices } = await import('../src/flow/breaks.js');
const ops = await import('../src/model/ops.js');
const { composePageHtml } = await import('../src/compose/page.js');
const { contentRectMm, mmToPx } = await import('../src/model/geometry.js');
const { withSandbox } = await import('../src/render/sandbox.js');
const { poppler, writeTmp } = await import('./helpers.js');
type FlowLayout = import('../src/flow/breaks.js').FlowLayout;
type ProjectState = Awaited<ReturnType<typeof createProject>>;
type EditorDocument = import('../src/model/types.js').EditorDocument;

/* ----------------------------------------------------------- generators */

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = 'print layout frame page break heading paragraph table header row line widow orphan flow column margin content area text keeps together never split across pages repeat'.split(' ');

/** A seeded document: headings, paragraphs of varying length, lists and tables with headers. */
function generateDoc(seed: number) {
  const r = rng(seed);
  const words = (n: number) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
  const parts: string[] = [`<h1>Generated document ${seed}</h1>`];
  const sections = 4 + Math.floor(r() * 5);
  for (let s = 0; s < sections; s++) {
    parts.push(`<h2>Section ${s + 1} ${words(3)}</h2>`);
    const paras = 1 + Math.floor(r() * 4);
    for (let p = 0; p < paras; p++) parts.push(`<p>${words(15 + Math.floor(r() * 140))}.</p>`);
    if (r() < 0.35) parts.push(`<ul>${Array.from({ length: 2 + Math.floor(r() * 5) }, () => `<li>${words(4 + Math.floor(r() * 10))}</li>`).join('')}</ul>`);
    if (r() < 0.4) {
      const rows = 5 + Math.floor(r() * 30);
      parts.push(
        `<table><thead><tr><th>Ref</th><th>Item</th><th>Value</th></tr></thead><tbody>${Array.from({ length: rows }, (_, i) => `<tr><td>${s}.${i}</td><td>${words(2)}</td><td>${Math.floor(r() * 1000)}</td></tr>`).join('')}</tbody></table>`,
      );
    }
  }
  return {
    html: parts.join('\n'),
    css: 'body{margin:0;font:15px/1.5 Georgia,serif;color:#222}h1{font-size:30px}h2{margin-top:24px}table{border-collapse:collapse;width:100%;font:13px Arial,sans-serif}th,td{border:1px solid #bbb;padding:4px 6px;text-align:left}thead th{background:#eee}',
  };
}

/* --------------------------------------------------------------- helpers */

/** Paginate the whole page component from page 1. */
async function paginate(s: ProjectState) {
  const doc = ops.deletePlacements(s.document, ['pl-page']);
  const r = await autoPaginate({ ...s, document: doc }, 'page', 'page-1');
  const chain = r.document.chains.find((c) => c.id === r.chainId)!;
  return { document: r.document, layout: r.layout, slices: chain.slices };
}

/** Character multiset (whitespace ignored, NFKC) — order-independent equality of text. */
function chars(text: string) {
  const m = new Map<string, number>();
  for (const ch of text.normalize('NFKC').replace(/\s+/g, '')) m.set(ch, (m.get(ch) ?? 0) + 1);
  return m;
}
const sameChars = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

/** Words visible inside each page's frames in the exported PDF (pdftotext -bbox), minus repeated table headers. */
function visiblePdfText(pdf: Buffer, doc: EditorDocument, slicesByPlacement: Map<string, { headerPx: number }>) {
  const html = poppler('pdftotext', ['-bbox', writeTmp(pdf, 'f.pdf'), '-']);
  const pages = html.split('<page ').slice(1);
  const ptPerPx = 0.75;
  const out: string[] = [];
  pages.forEach((pg, i) => {
    const pageId = doc.pages[i]!.id;
    const frames = doc.placements.filter((p) => p.pageId === pageId);
    for (const m of pg.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)) {
      const [x, y, , y2] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
      const word = m[5]!.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
      const cy = (y + y2) / 2;
      const inFrame = frames.find((f) => {
        const fx = mmToPx(f.xMm) * ptPerPx;
        const fy = mmToPx(f.yMm) * ptPerPx;
        return x >= fx - 1 && x <= fx + mmToPx(f.wMm) * ptPerPx + 1 && cy >= fy && cy <= fy + mmToPx(f.hMm) * ptPerPx;
      });
      if (!inFrame) continue;
      const headerPt = (slicesByPlacement.get(inFrame.id)?.headerPx ?? 0) * ptPerPx;
      if (headerPt && cy < mmToPx(inFrame.yMm) * ptPerPx + headerPt) continue; // repeated header
      out.push(word);
    }
  });
  return out.join(' ');
}

/** Source text as it is laid out (visible text of the body, in the sandbox). */
async function sourceText(s: ProjectState) {
  const def = s.document.components.page!;
  return withSandbox(s.meta.source, { viewport: { width: 680, height: 900 } }, async (sb) => {
    await sb.page.goto(sb.serve('t.html', htmlForServer(s)(def, mmToPx(contentRectMm(s.document.pageSetup).w))));
    return (await sb.page.evaluate('document.body.innerText')) as string;
  });
}

/* ------------------------------------------------------- the checker works */

describe('M6: the pagination checker catches each rule', () => {
  const layout: FlowLayout = {
    height: 300,
    blocks: [
      { top: 0, bottom: 20, kind: 'heading', tag: 'H2' },
      { top: 30, bottom: 130, kind: 'text', tag: 'P' },
      { top: 140, bottom: 300, kind: 'row', tag: 'TABLE-START' },
    ],
    lines: Array.from({ length: 5 }, (_, i) => ({ top: 30 + i * 20, bottom: 30 + i * 20 + 18, block: 1 })).concat([{ top: 2, bottom: 18, block: 0 }]),
    tables: [{ top: 140, bottom: 300, thead: { top: 140, bottom: 160 }, rows: [{ top: 160, bottom: 200 }, { top: 200, bottom: 250 }, { top: 250, bottom: 300 }] }],
  };
  const sl = (a: number, b: number, header?: boolean) => ({ placementId: `f${a}`, startPx: a, endPx: b, overflow: false, header: header ? { startPx: 140, endPx: 160 } : undefined });

  it('flags a heading left at the end of a frame', () => {
    expect(checkSlices(layout, [sl(0, 25), sl(25, 300)]).map((i) => i.rule)).toContain('heading-last');
  });
  it('flags a single stranded line', () => {
    expect(checkSlices(layout, [sl(0, 49), sl(49, 300)]).map((i) => i.rule)).toContain('widow-orphan');
  });
  it('flags a cut line', () => {
    expect(checkSlices(layout, [sl(0, 75), sl(75, 300)]).map((i) => i.rule)).toContain('line-cut');
  });
  it('flags a continued table without its header', () => {
    expect(checkSlices(layout, [sl(0, 200), sl(200, 300)]).map((i) => i.rule)).toContain('header-missing');
    expect(checkSlices(layout, [sl(0, 200), sl(200, 300, true)]).map((i) => i.rule)).not.toContain('header-missing');
  });
  it('computeSlices avoids all of them on the same layout', () => {
    const slices = computeSlices(layout, [{ placementId: 'a', heightPx: 70 }], { unlimited: true });
    expect(checkSlices(layout, slices)).toEqual([]);
  });
});

/* -------------------------------------------------- real documents, real layout */

describe('M6: auto-paginate keeps every rule', () => {
  it('long article: no rule broken, headers repeated, PDF text = source text', async () => {
    const s = await createProject({ type: 'fixture', name: '08-long-article' });
    const { document, layout, slices } = await paginate(s);
    expect(slices.filter((x) => x.endPx > x.startPx).length).toBeGreaterThanOrEqual(5);
    expect(document.pages.length).toBe(slices.length);
    expect(checkSlices(layout, slices)).toEqual([]);
    expect(slices.some((x) => x.header)).toBe(true);
    const pdf = await renderPages({ ...s, document }, { format: 'pdf' });
    const headers = new Map(slices.map((x) => [x.placementId, { headerPx: x.header ? x.header.endPx - x.header.startPx : 0 }]));
    expect(sameChars(chars(visiblePdfText(pdf, document, headers)), chars(await sourceText(s)))).toBe(true);
  }, 180_000);

  it('20 generated documents: no rule broken; text in frames = source text (first 5 checked in the PDF)', async () => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = await createProject({ type: 'paste', ...generateDoc(seed) });
      const { document, layout, slices } = await paginate(s);
      expect(checkSlices(layout, slices), `seed ${seed}`).toEqual([]);
      expect(slices.at(-1)!.endPx, `seed ${seed}`).toBeCloseTo(layout.height, 0);
      if (seed <= 5) {
        const pdf = await renderPages({ ...s, document }, { format: 'pdf' });
        const headers = new Map(slices.map((x) => [x.placementId, { headerPx: x.header ? x.header.endPx - x.header.startPx : 0 }]));
        const got = chars(visiblePdfText(pdf, document, headers));
        const want = chars(await sourceText(s));
        if (!sameChars(got, want)) {
          const keys = new Set([...got.keys(), ...want.keys()]);
          console.log(`seed ${seed} char diffs:`, [...keys].filter((k) => got.get(k) !== want.get(k)).map((k) => `${JSON.stringify(k)} pdf=${got.get(k) ?? 0} src=${want.get(k) ?? 0}`).join('; '));
        }
        expect(sameChars(got, want), `seed ${seed}`).toBe(true);
      }
    }
  }, 600_000);
});

/* ------------------------------------------------------------- fit modes */

/** Lay out one placement on a page and measure a paragraph inside its frame. */
async function measureIn(s: ProjectState, doc: EditorDocument, selector: string) {
  return withSandbox(s.meta.source, { viewport: { width: 800, height: 1200 } }, async (sb) => {
    await sb.page.goto(sb.serve('page.html', composePageHtml(doc, 'page-1', htmlForServer({ ...s, document: doc }))));
    const inner = sb.page.frames().find((f) => f !== sb.page.mainFrame())!;
    return (await inner.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      const r = document.createRange(); r.selectNodeContents(el);
      const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
      const b = el.getBoundingClientRect();
      return { lines: tops.size, x: b.left, y: b.top, w: b.width };
    })()`)) as { lines: number; x: number; y: number; w: number };
  });
}

describe('M6: fit modes', () => {
  it('reflow re-wraps text, scale keeps the layout, crop offsets the content', async () => {
    const s = await createProject({ type: 'fixture', name: '08-long-article' });
    const at = (w: number, fit: 'reflow' | 'scale' | 'crop', extra: object = {}) => {
      let d = ops.setPlacementRect(s.document, 'pl-page', { x: 15, y: 20, w, h: 200 });
      d = ops.updatePlacement(d, 'pl-page', { fit, ...extra });
      return d;
    };
    const narrowR = await measureIn(s, at(60, 'reflow'), 'article > p:nth-of-type(2)');
    const wideR = await measureIn(s, at(150, 'reflow'), 'article > p:nth-of-type(2)');
    expect(narrowR.lines).toBeGreaterThan(wideR.lines);
    const narrowS = await measureIn(s, at(60, 'scale'), 'article > p:nth-of-type(2)');
    const wideS = await measureIn(s, at(150, 'scale'), 'article > p:nth-of-type(2)');
    expect(narrowS.lines).toBe(wideS.lines);
    const crop0 = await measureIn(s, at(100, 'crop'), 'article > p:nth-of-type(2)');
    const crop1 = await measureIn(s, at(100, 'crop', { cropXPx: 40, cropYPx: 300 }), 'article > p:nth-of-type(2)');
    // In the component's own coordinates nothing moves; the frame shows a different part.
    expect(crop1.y).toBeCloseTo(crop0.y, 3);
    expect(crop1.lines).toBe(crop0.lines);
  }, 120_000);

  it('the overflow flag is set exactly when content is taller than the frame', async () => {
    const s = await createProject({ type: 'fixture', name: '07-webfonts' });
    const layout = await measureFlow(s, s.document.components.page!, mmToPx(180));
    const short = computeSlices(layout, [{ placementId: 'a', heightPx: layout.height - 40 }]);
    expect(short[0]!.overflow).toBe(true);
    const tall = computeSlices(layout, [{ placementId: 'a', heightPx: layout.height + 1 }]);
    expect(tall.every((x) => !x.overflow)).toBe(true);
  }, 60_000);
});

/* ---------------------------------------------------------- linked frames */

describe('M6: linked frames', () => {
  it('text flows through frames of different heights with nothing lost or duplicated', async () => {
    const s = await createProject({ type: 'paste', ...generateDoc(101) });
    let d = ops.addPage(s.document, 'page-2');
    d = ops.addPage(d, 'page-3');
    const c = contentRectMm(d.pageSetup);
    d = ops.setPlacementRect(d, 'pl-page', { x: c.x, y: c.y + 100, w: 120, h: c.h - 100 });
    const def = d.components.page!;
    d = ops.placeComponent(d, def, 'page-2', { xMm: c.x, yMm: c.y, wMm: 120, hMm: c.h, fit: 'reflow' }, 'f2');
    d = ops.placeComponent(d, def, 'page-3', { xMm: c.x + 30, yMm: c.y, wMm: 120, hMm: c.h, fit: 'reflow' }, 'f3');
    d = ops.linkFrames(d, ['pl-page', 'f2', 'f3'], 'ch1');
    const r = await reflowChain({ ...s, document: d }, 'ch1');
    const slices = r.document.chains[0]!.slices;
    expect(checkSlices(r.layout, slices)).toEqual([]);
    const shown = slices.reduce((sum, x) => sum + (x.endPx - x.startPx), 0);
    if (!slices.at(-1)!.overflow) expect(shown).toBeCloseTo(r.layout.height, 0);
    // Each line is inside exactly one frame.
    for (const ln of r.layout.lines) {
      expect(slices.filter((x) => ln.top >= x.startPx - 0.5 && ln.bottom <= x.endPx + 0.5).length).toBeLessThanOrEqual(1);
    }
  }, 120_000);

  it('frames in a chain must show the same component', () => {
    const s = { ...ops.newEditorDocument({ captureWidthPx: 680, documentHeightPx: 10, baseUrl: '', pageBg: '#fff', nodes: [], warnings: [] }, 'b', 680) };
    const other = ops.placeComponent(s, { id: 'x', name: 'x', kind: 'card', rootWpId: 'x', widthPx: 10, heightPx: 10, bg: '#fff', minFontPx: null }, 'page-1', { xMm: 0, yMm: 0 }, 'X');
    expect(() => ops.linkFrames(other, ['pl-page', 'X'])).toThrow(/same component/);
  });
});
