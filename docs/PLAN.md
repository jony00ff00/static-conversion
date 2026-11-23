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

Each milestone lists its **automated checks** (exit criteria in CI) and its
**👤 user checks** (a person must look at or print the output and sign off).

| # | Milestone | Key automated checks | 👤 User checks |
|---|---|---|---|
| **M0** | Foundations: schema, sandbox, 12-fixture corpus, golden runner, CI | Fixtures render < 30 s with no errors; outside network blocked; infinite loop killed; renders repeat exactly; every element stamped | Compare fixture screenshots with a real browser (`docs/M0-CHECKLIST.md`) |
| **M1** | Render core and single-page A4 export; font collection; JS freezing | PDF page box 595.28 × 841.89 pt; PNG 2480 × 3508; content box at (15, 20) mm ±0.1; fonts embedded; canvas/SVG diff < 0.5% | Print at **100%** and measure margins with a ruler (±1 mm); fonts correct; charts sharp |
| **M2** | Side-by-side preview, linked selection, Proof view | Selection lines up across panes; editor vs Proof < 1% pixel diff; 100% zoom = 793.7 × 1122.5 px | Click-test highlights; on-screen ruler calibration; Proof shows no visible differences |
| **M3** | Decomposition, component library, rules and presets, CSS extraction | Golden component trees at 3 granularities; isolated component vs source < 1% diff; presets work | Components make sense; names are sensible; check components that fell back to inlining; screen-only clutter hidden correctly |
| **M4** | Arrange editing, margin inspector, snapping, capture width | Margin validation; placements don't move when margins change; snapping within 0.1 mm; landscape is 297 × 210 | Print unusual margins and measure; layout feels accurate; body text ≥ about 9 pt |
| **M5** | Content and style editing, overrides, undo | One override and one undo step per edit; revert gives a pixel-exact original; web source untouched | Edits show in editor and Proof; full undo works; special characters correct in the PDF |
| **M6** | Fit and flow: modes, overflow, auto-paginate, linked frames (last) | No lines cut at page breaks; table headers repeat; no text lost or duplicated in linked frames | Read the paginated article for bad page breaks |
| **M7** | Source sync and re-mapping, Changes panel | ≥ 95% correct sorting on scripted source changes; no overrides lost | Review every "changed" item; decide on orphaned components |
| **M8** | Print production: bleed, CMYK PDF/X, preflight, soft proof | PDF/X validates; vectors kept; each preflight rule fires on its trigger fixture | **Physical test print** and colour sign-off; trim at crop marks; printer's preflight approval |
| **M9** | A4 templates, auto-pack, masters, data merge, patch export | Templates stay inside margins; tri-fold panels 99 mm; auto-pack repeats exactly; 50 CSV rows → 50 pages | Fold the tri-fold; cut the step-and-repeat sheet; spot-check the merge; developer applies a patch |
| **M10** | Hardening and release | 20 pages / 200 components stay smooth; export < 60 s; crash recovery | End-to-end test on three real sites; a new user completes a project from the docs |

## Checklist shown in the export dialog on every print job

- [ ] Proof checked; no differences
- [ ] Margins are the values you intended
- [ ] Preflight: no errors, every warning reviewed
- [ ] Body text readable (check the printed point size)
- [ ] All overrides reviewed
- [ ] Test page printed at **100% / Actual size**, not "Fit to page"
- [ ] Colours checked on paper (CMYK jobs)
