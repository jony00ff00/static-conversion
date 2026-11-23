# Plan: deterministic web-to-print editor (A4)

The editor takes HTML, CSS and JavaScript, renders it, splits it into components, and
arranges them on A4 pages. A live web preview sits next to an editable print preview,
and the result exports at print quality. **There is no LLM anywhere**: every step is
rule-based and gives the same result every time.

## Print format

- **A4 only**, 210 × 297 mm. Portrait by default, with a landscape toggle.
- **User-set margins**, defaulting to **placeholder** values: top 20, right 15,
  bottom 20, left 15 mm. The default content area is 180 × 257 mm.
  - Margins are set for the whole document, in 0.5 mm steps, minimum 0.
  - The content area must stay at least 50 × 50 mm.
- **Optional bleed**: 3 mm (placeholder), off by default.
- All defaults live in `src/config/printDefaults.ts`.
- Placements are stored in **mm from the top-left of the trim**, so changing the
  margins never moves anything already placed.

| Measure | Value |
|---|---|
| PDF page box | 595.28 × 841.89 pt |
| CSS size at 96 px/in | 793.7 × 1122.5 px |
| Export at 300 DPI | 2480 × 3508 px (2551 × 3579 with 3 mm bleed) |

## Workspace

```
┌──────────────┬──────────────────────┬──────────────────────┐
│ Components / │  WEB PREVIEW (live / │  PRINT PREVIEW (A4,  │
│ Layers /     │  frozen)             │  direct editing)     │
│ Pages        │                      │                      │
├──────────────┴──────────────────────┴──────────────────────┤
│ Inspector: source, overrides, margins, preflight issues     │
└──────────────────────────────────────────────────────────────┘
```

- **Linked selection:** selecting or hovering in either pane highlights the same
  element in the other, matched by its `data-wp-id`.
- **Drag from web to print:** dragging an element onto a page creates a component
  and places it in one step.
- **Live / Frozen toggle and "Capture this state":** for content that only appears
  after interaction, such as an open tab.
- **Proof view:** the server's Chromium render is the reference, shown with a diff
  overlay against the editor.

## Pipeline

1. **Ingestion** of pasted code, files or a URL. The page is rendered in a sandbox
   (see `docs/SANDBOX.md`).
2. **Settling:** network idle, fonts and images loaded, animations frozen, fixed
   clock and random seed.
3. **Stable IDs:** every element gets a `data-wp-id`, a hash of its structural path
   plus a short fingerprint of its own text.
4. **Freezing** JS output, captured as static content:
   - canvas → image
   - WebGL → captured image
   - video → poster frame
   - SVG → inline
   - `::before` / `::after` → real spans
   - cross-origin iframes → screenshot of that region
5. **Decomposition by score.** Signals: semantic tags, author hints, visual boxes,
   repeated structure, media elements, whitespace segmentation and size thresholds.
   - A granularity slider sets how coarse or fine the split is.
   - Saved rules apply on repeat imports.
6. **Components and style isolation:**
   - CSS extraction collects only the rules that apply to each component, with
     computed-style inlining as a fallback.
   - Components render in Shadow DOM so styles can't leak between them.
7. **Print editing:**
   - **Arrange:** move, resize, align and snap.
   - **Content:** edit text and images, hide child elements.
   - **Style:** inspector for type, colour and spacing.
   - All edits are stored as **overrides**. The web source is never changed.
8. **Fit and flow:**
   - Each placement can reflow (the default), scale or crop.
   - Overflow indicator for frames whose content doesn't fit.
   - Auto-paginate long content.
   - Linked frames, which carry the most schedule risk, so they're built last.
9. **Sync:** on re-import, old components are matched to new elements. A Changes
   panel shows what matched, what changed and what was removed.
10. **Export:**
    - `@page { size: A4; margin: 0 }`, with margins handled in the layout.
    - Playwright produces the PDF/PNG.
    - Ghostscript converts to CMYK PDF/X.
    - Preflight checks run before export.

## Known problems and their fixes

| Problem | Fix |
|---|---|
| Scale mismatch: a 1280 px web width placed in the 180 mm content area prints at about 53%, so 16 px text becomes about 6.4 pt | Capture-width setting (defaults to the content-area width), Reflow as the default fit, printed point size shown in the inspector |
| Fonts differ between the editor and the server | Collect fonts at import; flag missing fonts and show the replacement |
| Other browsers render differently | Proof view is the reference; Chromium-based editor is officially supported |
| Running untrusted JS on the server | Separate sandbox per render; container isolation in production |
| CMYK conversion can turn vectors into pixels or shift colours | Golden checks before and after conversion; plain RGB PDF kept as a fallback |
| Linked frames are the riskiest feature | Built last, and can be cut |

## Milestones

From M2 onwards **no milestone waits for a person to look at or print anything**. Each
check that used to need a person has an automated stand-in that runs in CI. The user
reviews once, at the end, using the final acceptance pack ([`ACCEPTANCE.md`](ACCEPTANCE.md)).

### How person-based checks are replaced

| Previously a person did this | Now automated as |
|---|---|
| Look at output and confirm it's right | Golden images with pixel-diff tolerances, plus a structural check of the DOM |
| Measure margins with a ruler | Geometry checked in the PDF itself and in rasterised PNGs, ±0.1 mm |
| Click around and confirm selection and highlights work | Playwright end-to-end tests that click, drag and type in the real editor |
| "Does it feel accurate?" (snapping, dragging) | Scripted drags with mm assertions on final positions; frame-time limits |
| Read for bad page breaks | Layout rule checks: no heading last on a page, no single stranded lines, table headers repeated, all text present exactly once |
| "Do the components make sense?" | Labelled reference trees for the fixtures, scored with boundary precision/recall |
| Check fonts and special characters | PDF font embedding plus text extraction compared with the source text; Unicode round-trip tests |
| Colour sign-off on paper | ΔE2000 between source colours and the ICC soft proof; out-of-gamut warnings |
| Fold or cut printed sheets | Panel, fold and cut-mark positions checked in the PDF to ±0.1 mm |
| A developer applies a patch | The exported patch is applied to the fixture, re-rendered, and compared with the edited print version |
| A new user follows the docs | Every command and example in the docs runs as a test |

### Milestone list

| # | Milestone | Automated exit checks |
|---|---|---|
| **M0** ✅ | Foundations: schema, sandbox, 12-fixture corpus, golden runner, CI | Fixtures render < 30 s with no errors; outside network blocked; infinite loop killed; renders repeat exactly; every element stamped |
| **M1** ✅ | Import (paste, folder, zip, URL); JS freezing; font report; single-page A4 PDF/PNG export | Page box exactly A4; PNG 2480 × 3508 at 300 dpi; margins ±0.1 mm in PDF and PNG; fonts embedded; vector text; frozen page matches live < 0.5 %; charts ≥ 300 dpi |
| **M2** ✅ | Side-by-side preview: web pane (live/frozen, capture state), read-only A4 print pane, linked selection, Proof view, calibrated 100 % zoom | Linked highlights hit the right element (30+ per fixture, boxes ±1 px); captured state is in the frozen DOM; editor vs Proof < 1 % diff; 100 % zoom = 793.7 × 1122.5 px; ruler 3.7795 px/mm ±0.5 %; no console errors; axe smoke check |
| **M3** ✅ | Decomposition: scoring, granularity slider, library, split/merge/promote/demote, select similar, saved rules, print presets, CSS extraction | Boundary precision and recall ≥ 0.9 against labelled trees at 3 granularities; isolated component vs source region < 1 % diff (fallback must also pass); repeated cards grouped; presets verified in the frozen DOM; rules repeat exactly; every component named, no duplicate names per page |
| **M4** ✅ | Arrange editing, multi-page, landscape, drag from web to print, margin inspector and drag lines, snapping and grid, capture width, point-size readout | Scripted drags land ±0.1 mm; snapping ±0.1 mm; margins never move placements; margin validation; export geometry = editor placements ±0.1 mm on random layouts with fixed seeds; point-size readout correct; undo restores exactly |
| **M5** ✅ | Content and style editing, overrides with revert, named snapshots, "differs from web" markers | One override and one undo step per edit; text edits never change structure; revert gives 0 px difference; web source never changed; overrides survive reload; Unicode round trip (accents, CJK, RTL, emoji) through the PDF; markers on every edited element |
| **M6** ✅ | Fit and flow: scale/reflow/crop, overflow flag, auto-paginate, linked frames (last, can be cut) | Mode behaviour by line counts and boxes; overflow flag exact; pagination rules on the article plus 20 generated documents; extracted PDF text = source text (nothing lost or duplicated), including across linked frames |
| **M7** | Source sync: re-import, 3-step matching, Changes panel, optional code pane | Unchanged source: 100 % matched and overrides kept; scripted change suite ≥ 95 % correctly sorted; no override dropped silently; removed source leaves an orphan; one-step undo |
| **M8** | Print production: bleed and crop marks, CMYK PDF/X with RGB fallback, TIFF/JPEG, preflight, soft proof | TrimBox 210 × 297 mm and marks ±0.1 mm; veraPDF valid; CMYK keeps text and vector paths; ΔE2000 ≤ 3 in gamut, out-of-gamut flagged; each preflight rule fires on its trigger fixture and stays quiet on a clean one |
| **M9** | A4 templates, auto-pack, master pages, data merge, patch export | Templates inside the content area for 50 random margin sets; tri-fold panels 99 mm and folds at 99/198 mm; step-and-repeat cards and marks ±0.1 mm; auto-pack repeatable, no overlaps; 50 CSV rows → 50 pages with every value found; exported patch applied and matches < 1 % |
| **M10** | Hardening, docs with runnable examples, `npm run acceptance` | 20 pages / 200 components: drag < 16 ms per frame, export < 60 s; crash recovery loses ≤ 5 s; every doc command runs in CI; full suite green in the pinned CI image |

### Final acceptance

`npm run acceptance` builds the review pack described in [`ACCEPTANCE.md`](ACCEPTANCE.md).
It covers the only things automation can't prove: how the user's printer places the
page, how colours look on paper, and whether the output is good enough to send to print.
Anything that fails the review becomes a new automated test before it's fixed.

## Checklist shown in the export dialog on every print job

- [ ] Proof checked; no differences
- [ ] Margins are the values you intended
- [ ] Preflight: no errors, every warning reviewed
- [ ] Body text readable (check the printed point size)
- [ ] All overrides reviewed
- [ ] Test page printed at **100% / Actual size**, not "Fit to page"
- [ ] Colours checked on paper (CMYK jobs)
