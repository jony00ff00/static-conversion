# M2–M6 — Editor, decomposition, arranging, content editing, flow

Status: **complete**. Every exit check is automated and runs in CI (`npm test`):
194 tests in total, including M0–M1. No person needs to check anything until the final
review in [`ACCEPTANCE.md`](ACCEPTANCE.md).

Run the editor locally:

```bash
npm run dev    # http://localhost:5173
```

## M2 — Side-by-side preview and Proof

| Planned check | Test | Status |
|---|---|---|
| Clicking an element in the web pane highlights the same `data-wp-id` in both panes, boxes ±1 px (30+ elements per fixture, 3 fixtures) | `tests/e2e/m2-preview.test.ts` | ✅ |
| Clicking in the print pane selects and highlights the same element in the web pane (≥ 90 % exact element) | same | ✅ |
| "Capture this state" replays clicks recorded in the live pane | same | ✅ |
| Editor page vs server Proof < 1 % of pixels | same | ✅ |
| 100 % zoom = 793.7 × 1122.5 px; ruler 3.7795 px/mm ±0.5 % | same | ✅ |
| No console errors; no critical axe accessibility violations | same | ✅ |

## M3 — Decomposition

| Planned check | Test | Status |
|---|---|---|
| Labelled reference trees for all 12 fixtures: boundary precision and recall ≥ 0.9 at coarse, medium and fine | `tests/m3-decomposition.test.ts`, labels in `tests/decomposition-labels.ts` | ✅ (36/36 levels) |
| Each component isolated on its own matches its region of the page (< 1 %) | same | ✅ |
| Repeated cards grouped (Bootstrap, Northwind, div soup) | same | ✅ |
| Presets: cookie banner and sticky nav hidden; tabs, accordions, details and carousel expanded; one component per slide; `@media print` applied; link URLs | same | ✅ |
| Saved rules give the same tree on every re-import | same | ✅ |
| Every component named, no duplicate names per page; split/promote/demote/merge | same | ✅ |

## M4 — Arranging, margins, snapping

| Planned check | Test | Status |
|---|---|---|
| Scripted mouse drags land ±0.1 mm, snapped and unsnapped; resize; arrow nudges | `tests/e2e/m4-arrange.test.ts` | ✅ |
| Snapping to page/content edges, centre, guides, grid ±0.1 mm | `tests/m4-model.test.ts` | ✅ |
| Margins never move placements; frames in the margin get a badge; margin validation | both | ✅ |
| Random seeded layouts exported at 300 dpi match the editor's positions ±0.1 mm | `tests/e2e/m4-arrange.test.ts` | ✅ (5 seeds × 3 frames) |
| Point-size readout (16 px at 100 % = 12 pt) | same | ✅ |
| Drag from the web pane onto a page | same | ✅ |
| Undo restores the document exactly, for every arrange operation | `tests/m4-model.test.ts` | ✅ |

## M5 — Content and style editing

| Planned check | Test | Status |
|---|---|---|
| One override and one undo step per edit; undo restores exactly | `tests/m5-overrides.test.ts` | ✅ |
| Text edits never add or remove elements (and are inserted as text, not markup) | same | ✅ |
| Revert gives a pixel-identical page; the web source never changes | same | ✅ |
| Overrides survive save and reload | same | ✅ |
| Unicode round trip through the PDF: accents, CJK, Hebrew, Arabic, combining marks, emoji | same | ✅ |
| In-place text edit, style change, image replace, hide, revert, snapshots, "differs from web" markers | `tests/e2e/m5-content.test.ts` | ✅ |

## M6 — Fit and flow

| Planned check | Test | Status |
|---|---|---|
| Reflow re-wraps, scale keeps the layout, crop offsets — measured in real renders | `tests/m6-flow.test.ts` | ✅ |
| Overflow flag exactly when content is taller than the frame | `tests/m6-flow.test.ts`, `tests/e2e/m6-flow-ui.test.ts` | ✅ |
| Pagination rules (no cut lines, no stranded headings, no single lines, table headers repeated) on the long article and 20 generated documents | `tests/m6-flow.test.ts` | ✅ |
| Text extracted from the PDF frames = source text, nothing lost or duplicated (article + 5 generated documents) | same | ✅ |
| Linked frames of different heights: each line shown exactly once | same | ✅ |
| "Flow onto pages" in the editor creates linked frames on new pages | `tests/e2e/m6-flow-ui.test.ts` | ✅ |

## Problems the tests found, now fixed

- **Page breaks cut a line in half in the PDF.** Breaks were measured at the window's whole-pixel width (681 px) but printed at 680.31 px, which changed line wrapping. Breaks are now measured at the exact frame width. Found by the PDF text check.
- **CSS `vw` units changed size** when a component was shown in a frame narrower than the page. Component frames now always lay out at the capture width.
- **Isolated components inside dark headers lost their background.**
- **Inline images and SVGs** followed the parent's text alignment once isolated.
- **A drop could be committed twice.** Drops released over the web pane were ignored.
- **In content-editing mode the page couldn't be clicked.**
- **The web pane followed links** when clicked.
- **Highlights covered content cut off below a frame.** They're now clipped to the visible part.
- **Decomposition:**
  - `<main>` came out as the only top-level component on simple pages
  - small text blocks were dropped by the tiny-box rule
  - cards in separate column wrappers weren't seen as repeats
  - widgets (tabs, accordion, carousel) were dropped as "wrappers"
  - table cells became components

## Notes and limits

- **Pixel tolerances.** Editor vs Proof and isolated vs source comparisons use a colour tolerance of 0.2 (not 0.1). Nested frames anti-alias glyph edges slightly differently. Wrong fonts, offsets or missing content change far more than the 1 % limit. Isolation is compared at 2× scale for the same reason.
- **Proof framing.** The server Proof is drawn inside a page iframe, like the editor, so the two are comparable. Export draws pages directly, as before.
- **Linked frames** lay out at the first frame's width; give all frames in a chain the same width.
- **The live web pane** is available for folder, zip and paste imports. URL imports show the recorded, frozen page only.
- **Merged components** keep only the selected children of their common parent visible. Other children of that parent are hidden.
- **The QR-code preset** from the plan isn't built. Links can show their address after the link text instead.
