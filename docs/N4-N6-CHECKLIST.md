# N4–N6 checklist: layouts, export and the finished Nodes tab

Built on branch `node-editor-plan` after [`NODE-PLAN.md`](NODE-PLAN.md), following [N0–N3](N0-N3-CHECKLIST.md).
Everything is checked automatically; the only manual review stays the final output.

## What was built

- **Layout** nodes with pages of their own (the default graph's stays linked to the project's pages). Their
  components can come from several pages: each records its capture, is refreshed from the inputs on every run, and
  is drawn from its own frozen page, with edits made upstream (Edit nodes) on top. **Make a separate layout**
  copies the project's pages into a Layout node.
- **Page Setup** (orientation, margins) for the layouts and flows it is connected to.
- **Flow**: the first component (or each, from a new page) over as many pages as it needs, with the break rules,
  measured in the browser.
- **The Editor tab edits Layout nodes**: **Pages** in its toolbar switches between the project's pages and each
  Layout node. On a Layout, the library is what comes into the node, changes are saved in the graph, and flowing
  and linking measure in the browser; project-only controls (detail, presets, live view, snapshots, proof) hide.
- **One undo history** across both tabs (`src/client/undo-log.ts`).
- **Combine**: pages from several layouts and flows as one document. **Export**: PDF or a PNG of page 1 from its
  inspector (Print / Save PDF in the browser-only version); a Layout's pages export from the Editor tab too.
- **On the server** the graph runs with the same engine (`src/server/graph-run.ts`): captures from the disk cache,
  flow measured in the sandbox, added pages served to the sandbox under `/__src/<id>/` so a document can mix pages.
- Components from added pages are scoped by their page, and re-importing into a Web Source keeps the page's id,
  so placements survive a re-capture.
- **Starter graphs** (Brochure; Flyer + article), added next to the graph in a named group with a note, as one undo
  step. Groups, notes and the minimap come from Node CMS.

## Checks

| Planned check | Test | Status |
|---|---|---|
| A v2 project's pages, copied into a Layout node, draw the same in the Editor tab (< 0.5 % of pixels; 3 test pages) | `tests/e2e/n4-layout.test.ts` | ✅ |
| Every existing editor e2e test passes unchanged on the Editor tab (M2–M6, overflow, groups, capture steps) | `tests/e2e/m*.test.ts`, `groups-overflow-ui`, `capture-steps` | ✅ |
| The Editor tab places components from two pages on a Layout node; saved in the graph, not the project | `n4-layout` | ✅ |
| Page Setup sets the layout's orientation and margins | same | ✅ |
| Flow matches the server's "Flow onto pages" slices exactly (long article) | same | ✅ |
| Undo in one tab undoes an edit made in the other; redo too | same | ✅ |
| PDF page count and exact A4 page boxes (595.276 × 841.89 pt) for two sample graphs | `tests/e2e/n5-export.test.ts` | ✅ |
| Golden pages for the two sample graphs (brochure; flyer from two pages + an article flowed, combined) | same (`golden/graphs/`) | ✅ |
| Re-importing a changed page updates the export, with its placements kept | same | ✅ |
| Export node and the Editor tab on a Layout export PDFs; the project's pages are unchanged | same | ✅ |
| Starters add their nodes in a group with a note, as one undo step | `tests/e2e/n6-canvas.test.ts` | ✅ |
| A collapsed group is one box with its outside connections; expands; its frame moves every member; nothing re-evaluates | same | ✅ |
| The minimap draws every node in its type's colour | same | ✅ |
| A 40-node graph: editing one node re-runs only that node (and nodes still waiting), in under a second; no capture re-runs; moving nodes runs nothing | same | ✅ |
| GitHub Pages build: separate layout in the Editor tab, Flow measured in the browser, printing from an Export node | `tests/e2e/static-pages.test.ts` | ✅ |
| Golden files regenerated on CI (fixtures and sample graphs) | `.github/workflows/golden-update.yml` | ✅ |

## Limits

- Graph files hold the graph only; pages imported into Web Source nodes stay in the project.
- Mixing portrait and landscape parts in one Combine uses the first part's orientation (with a warning).
- Proof (the server comparison overlay) is for the project's pages only.
