# Plan: a node-based web-to-print editor

Status: plan only, on branch `node-editor-plan`. Nothing here is built yet.

Reference: the node editor in Node CMS (`jony00ff00/cms-test-23nov26`, commit `c22a45d`), where a project is a
graph of **Document Source → Selector → Snippet → Output**. This plan takes its architecture and canvas features
and applies them to the web-to-print pipeline that the current editor runs as fixed steps.

## Why nodes

Today the pipeline is fixed and hidden: one source → capture → decomposition → library → pages → export. A graph
makes each step visible and reusable:

- **Re-run on change.** When the web page changes, re-import it; every page built from it updates, because the
  layout refers to components by their stable IDs, not by copies.
- **Several sources in one document.** Two sites, or a site plus a pasted cover page, feed one set of pages.
- **Rules instead of hand work.** "Every product card, 6 per page in a 2 × 3 grid" is a node, not 30 drags.
- **Variants.** One capture feeds an A4 brochure and a one-page flyer, side by side.

Hand layout stays: the current page editor becomes the editor of a **Layout** node (see below), so simple projects
work exactly as today.

## What we take from Node CMS

| Node CMS | Here |
|---|---|
| `src/engine` is pure TS (no React, no DOM), tested with Vitest, purity enforced by a test | Same: `src/graph/` engine. Capture and measurement, which need a browser, are **services** passed in `EvalContext` |
| `NodeDefinition` { type, label, description, typed `inputs` / `outputs` ports, `defaultConfig`, `dependencies`, `evaluate` } | Same shape, one file per node in `src/graph/nodes/`, registered in `index.ts` |
| `PortType` union; `edgeError` refuses wrong types, double connections and loops with a plain reason | Same, with print port types (below); `any` for utility inputs |
| Cached evaluation: results keyed by a hash of config, inputs and `dependencies` (e.g. file hash); stale runs dropped | Same; capture results are cached by source hash + capture settings, so dragging a frame never re-captures |
| React Flow canvas (`@xyflow/react`): one generic node component drawn from its definition, ports as named handles, deletable edges, refusal message on a wrong drop | Same |
| Inspector: one editor per node type, plus a result panel (warnings, info such as "12 components") | Same; existing panels (presets, recorded steps, page setup, overrides) move into node editors |
| Preview follows the selected node; a Selector shows its input with matches highlighted | Same: Capture shows the frozen page; Pick highlights its picks on the page; Layout shows A4 pages |
| Groups (named, coloured, collapsible to one box with its outside ports), notes, minimap, palette, multi-select, duplicate, project file save/open, undo/redo | Same, reused nearly as written |

## Port types

What travels along a connection:

| Type | Value |
|---|---|
| `files` | Imported files (paste, .html with assets, zip; URL recording in the local version) |
| `capture` | A frozen page: frozen HTML, analysis (nodes, boxes, base URL), warnings |
| `components` | An ordered list of component definitions (each refers to a capture and stable `data-wp-id`s), with their overrides |
| `setup` | Page setup: A4, orientation, margins (one Page Setup node can feed several layouts) |
| `pages` | Laid-out A4 pages: placements, chains, page setup |
| `document` | Ordered pages ready to export |

## Nodes

| Node | In → Out | Does | Built from |
|---|---|---|---|
| **Web Source** | – → `files` | Paste, .html (+ assets), zip, test page; URL in the local version | `src/import`, `src/static/backend.ts` |
| **Capture** | `files` → `capture` | Capture width, presets, "Capture this state" steps, print styles | `render/sandbox.ts`, `static/capture.ts` |
| **Components** | `capture` → `components` | The decomposition library: granularity, split / merge / always / never rules | `compose/tree.ts` |
| **Pick** | `capture` → `components` | Components chosen by CSS selector, by click in the preview, or "similar to this" (repeat key) | linked selection, `buildTree` |
| **Edit** | `components` → `components` | Text, style, visibility and image overrides | M5 overrides |
| **Filter / Sort** | `components` → `components` | Keep the first N, by kind, by text match; reorder | new |
| **Page Setup** | – → `setup` | A4, orientation, margins | `schema/document.ts` |
| **Layout** | `components` (many), `setup` → `pages` | Hand layout: the current page editor, drag, resize, group resize/crop, guides, snapping | `client/Editor.tsx`, `model/ops.ts` |
| **Flow** | `components`, `setup` → `pages` | Long content over as many pages as needed, break rules | `flow/paginate.ts` |
| **Grid** | `components`, `setup` → `pages` | N per page in rows × columns, gutters, fit mode, repeat onto new pages | new, on `model/ops.ts` |
| **Combine** | `pages` (many) → `document` | Pages in order (cover, then flow, then grid…) | new |
| **Export** | `document` → – | PDF / PNG at 300 dpi (local), print dialog (Pages build); export checklist | `export/`, `static/capture.ts` |

The **Layout** node keeps today's editing. Its config stores placements by component ID; when the upstream
capture changes, placements follow their component, and ones whose component disappeared are shown as missing
(warning plus a red frame) instead of being dropped. This is how Node CMS anchors follow text.

## Screen layout

Like Node CMS: **palette · canvas · inspector · preview**, with panels that can be minimised and a preview that can
be resized or opened in its own window. The preview follows the selected node:

- Web Source / Capture: the frozen web page (Live tab and recorded steps on Capture).
- Components / Pick / Edit: the web page with that node's components outlined; clicking adds or removes one.
- Layout / Flow / Grid / Combine: the A4 pages. On a Layout node, **Edit pages** opens the full side-by-side editor
  (web | pages) that exists today, scoped to that node.

A new project starts with the default graph **Web Source → Capture → Components → Layout → Export**, already
connected, so the first screen behaves like today's editor.

## Engine and services

- `src/graph/` (pure TS): `Graph` { nodes, edges, groups?, notes? }, `NodeDefinition`, `edgeError`, topological
  order, cached `evaluateGraph`. No DOM: a purity test fails the build otherwise, as in Node CMS.
- `EvalContext.services`: `capture(files, settings)`, `measureFlow(html, width)` and `render(pages)`. The local
  version calls the server (Playwright); the Pages build uses the in-browser iframe capture that exists now.
- Undo/redo: the graph and each Layout node's document go through one history (the current `History` pattern).
- Storage: graph + files in the project file (`.web2print.json`), saved to the server or IndexedDB as now.
- Migration: an existing project (`schemaVersion: 2`) opens as the default graph with its document as the Layout
  node's config; `schemaVersion: 3` stores the graph.

## Milestones

Every milestone ends with automated checks; as before, the only manual review is the final output.

| # | Milestone | Automated checks |
|---|---|---|
| N0 | **Engine**: graph model, port types, `edgeError`, ordering, cached async evaluation, services interface, migration from v2 | Unit tests: valid / refused connections with reasons, loops, cache hits (moving a node or a frame does not re-evaluate), v2 → v3 round trip opens identically |
| N1 | **Canvas**: React Flow canvas, palette, generic node, ports, inspector shell, result panel, undo, project file; both builds | e2e: build the default graph by dragging; wrong drop shows its reason; undo/redo; save → open gives the same graph |
| N2 | **Source + Capture nodes**, preview following the selection, Live tab and recorded steps on Capture | e2e: import → capture → frozen preview; the capture's analysis equals the current pipeline's for the 12 test pages |
| N3 | **Components, Pick, Edit, Filter** nodes, outlines and click-to-pick in the preview | e2e: pick by selector and by click give the same IDs; overrides match M5 results; changing granularity updates downstream |
| N4 | **Layout, Flow, Grid, Page Setup** nodes; Layout embeds today's editor | e2e: a v2 project's pages render pixel-identical (< 0.5 %) through the graph; Grid places 6 cards per page exactly (± 0.1 mm); Flow matches `autoPaginate` slices |
| N5 | **Combine + Export**, multi-source documents | PDF page count and exact A4 page boxes, golden PDFs for two sample graphs; re-capturing a changed source updates the export with placements kept |
| N6 | Groups, notes, minimap, starter graphs (brochure, flyer, catalogue), performance, docs, Pages build | e2e on collapsed groups; a 40-node graph edits without re-capturing; golden files regenerated on CI |

## Risks

- **Capture is slow** (seconds). Cache by content hash and settings, run it only when its inputs change, and show
  a per-node "running" state; dragging frames or nodes never re-captures.
- **IDs after a source changes.** `data-wp-id` is a hash of the element's path and own text, so edited text or moved
  elements get new IDs. Keep a fallback match (same tag + nearest text + position) and report anything not found.
- **More concepts for simple projects.** The default graph and "Edit pages" keep the first-run experience the same;
  the node view is there when needed.
- **React version.** This app uses React 18; React Flow 12 supports 18 and 19, so no upgrade is needed.

## Open decisions

1. Should the node canvas be the first screen, or a "Flow" tab next to today's editor (recommended for N1–N4,
   then switch the default once N5 passes)?
2. Is Grid / repeat layout (catalogues) a priority, or is hand layout plus Flow enough for the first release?
3. Copy Node CMS's canvas code into this repo, or extract a shared package both use (more work now, one place to
   fix later)?
