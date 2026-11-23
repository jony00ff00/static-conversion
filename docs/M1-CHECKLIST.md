# M1 — Render core and single-page A4 export: sign-off

## What M1 adds

| Part | Where |
|---|---|
| Import: paste (HTML + CSS + JS), folder, zip (zip-slip and size checks), URL (recorded once, then rendered offline) | `src/import/index.ts` |
| Freezing JS output: canvas and WebGL → images; video → poster or first frame; `::before`/`::after` → real elements; iframes and broken images → screenshots or labelled placeholders; animation end states kept; page timers stopped; scripts removed | `src/render/inPage.browser.js`, `src/render/sandbox.ts` |
| Font report: which font actually drew each piece of text; missing and substituted fonts; web fonts that failed to load | `src/render/fonts.ts` |
| Single-page A4 export to PDF and PNG with the placeholder margins, exact page size, exact margins, fonts embedded | `src/export/a4.ts`, `src/export/pdf.ts`, `src/export/png.ts` |
| Commands: `npm run export`, `npm run export:test-page` | `scripts/` |

## Automated checks (run `npm test`, 120 tests)

| Plan check | Test | Status |
|---|---|---|
| PDF page box is exactly 595.276 × 841.89 pt (A4), one page; landscape 841.89 × 595.276 | `tests/export.test.ts` | ✅ |
| PNG at 300 dpi is exactly 2480 × 3508 px and tagged 300 dpi; landscape 3508 × 2480 | `tests/export.test.ts` | ✅ |
| Content area lands at the exact margin, ± 0.1 mm, in PNG and PDF, for default and unusual margins, portrait and landscape | `tests/export.test.ts` | ✅ |
| Every font is embedded in the PDF | `tests/export.test.ts` | ✅ |
| Text and SVG text stay real text (vector, selectable) | `tests/export.test.ts` | ✅ |
| Canvas, SVG, WebGL and video freezing: frozen page differs from the live page by < 0.5 % of pixels (all 12 fixtures + 3 freeze fixtures) | `tests/freeze.test.ts` | ✅ (0.000 % on all except blocked embeds, which are replaced on purpose) |
| The frozen document, with no scripts, renders the same on its own | `tests/freeze.test.ts` | ✅ |
| Charts are captured at print resolution (≥ 300 dpi at 1:1) | `tests/export.test.ts` | ✅ |
| Missing/substituted fonts and failed web fonts are reported | `tests/fonts.test.ts` | ✅ |
| Paste, folder, zip and URL imports work; unsafe zips are rejected; a recorded URL renders after the site goes offline | `tests/import.test.ts` | ✅ |
| Every element keeps a stable `data-wp-id` (no ID changed from M0) | `tests/fixtures.test.ts`, golden files | ✅ |
| Fixtures and their A4 exports match the golden files | `tests/fixtures.test.ts` | ✅ |

### Things found and fixed while building M1

- **Chromium snaps positions to whole CSS pixels.** A 15 mm margin (56.69 px) was drawn at 57 px, which is 15.08 mm. The content area is now placed with a transform and an exact clip path, which aren't snapped.
- **Chromium rounds the PDF page box.** A4 came out at 594.96 × 841.92 pt. The page box is now rewritten to the exact A4 size after printing.
- **Frozen elements lost their layout when the page's CSS targeted the tag**, e.g. `video { display: block }`. Layout properties are now copied onto the replacement.
- **Stopping the page's timers hung forever** because of very large fake-clock timer IDs. Timers are now tracked as the page creates them.
- **Blocked images printed as broken-image icons.** They now become labelled placeholders.

## 👤 User checks

Sample files are in `docs/samples/`. To regenerate them, or make your own:

```bash
npm run export:test-page -- margin-test-page.pdf
npm run export:test-page -- odd.pdf --margins=10,25,30,12
npm run export -- fixtures/01-static out.pdf
```

### 1. Physical margin check (most important)

1. Print `docs/samples/margin-test-page.pdf` with the print dialog set to
   **100% / "Actual size"**. "Fit to page" will shrink it and the margins will be wrong.
2. With a ruler, measure from each paper edge to the red line:
   top **20 mm**, bottom **20 mm**, left **15 mm**, right **15 mm**.
3. Check the mm rulers printed along the paper edges against your ruler. The 100 mm mark should be at 100 mm.
4. Repeat with `margin-test-page-10-25-30-12.pdf`: top 10, right 25, bottom 30, left 12 mm.

| Margin | Expected | Measured (default) | Expected | Measured (odd) | Within ± 1 mm? |
|---|---|---|---|---|---|
| Top | 20 | | 10 | | ☐ |
| Right | 15 | | 25 | | ☐ |
| Bottom | 20 | | 30 | | ☐ |
| Left | 15 | | 12 | | ☐ |

If every margin is off by the same amount in one direction, the printer is shifting the
page, which is normal for office printers. If they're all slightly small, check the
dialog was set to 100%.

### 2. Fonts

1. Open `docs/samples/07-webfonts.pdf`. The heading and specimen should be in Inter
   (a clean sans-serif), and the last paragraph in a serif fallback (expected: it asks
   for a font that doesn't exist).
2. Open `docs/samples/01-static.pdf`. The site asks for Georgia. On this machine Georgia
   isn't installed, so it prints in Liberation Serif, and the export report warns about it.
   ☐ Decide whether that's acceptable, or whether the server needs the real fonts
   installed (needed to match the site exactly).
3. In any sample PDF, select and copy some text. It should paste as real text. ☐

### 3. Charts and images

1. Open `docs/samples/05-canvas-chart-shrink.pdf` and zoom to 400%. The bar and line
   charts should look crisp, not blurry. ☐
2. Open `docs/samples/01-static-300dpi.png` in an image viewer. It should report
   2480 × 3508 px at 300 dpi and look sharp at 100%. ☐

### 4. Layout looks right

1. Open `docs/samples/01-static.pdf`. The site is laid out at the content-area width
   (180 mm), so the hero wraps to fit. Check that nothing looks broken. ☐
2. Run `npm run export -- fixtures/12-cross-origin-iframe out.pdf`. The blocked map and
   logo should show as grey "unavailable" boxes, not broken icons. ☐

Signed off by: ____________  Date: ________
