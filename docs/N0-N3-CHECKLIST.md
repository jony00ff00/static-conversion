# N0–N3 checklist: the Nodes tab

Built on branch `node-editor-plan` after [`NODE-PLAN.md`](NODE-PLAN.md). Everything is checked automatically; the
only manual review stays the final output.

## What was built

- **Engine** (`src/graph/`, pure TypeScript): `graph.ts` and `hash.ts` copied from Node CMS (`c22a45d`) and adapted
  (print port types `files`, `capture`, `components`, `setup`, `pages`, `document`; services in the evaluation
  context; no document merging). Nodes: Web Source, Capture, Components, Pick, Edit, Filter, Layout, Export.
- **Default graph**: every project, including ones saved before graphs existed, opens with
  project page → Capture → Components → Layout → Export, **linked to the Editor tab** (same capture, library and
  pages), so both tabs show the same thing. Linked Capture and Components nodes can be unlinked to use their own
  settings.
- **Nodes tab** beside the unchanged **Editor tab**: canvas, store, inspector shell, result panel, fields, groups,
  notes, minimap, palette, save / open graph file copied from Node CMS (each file names its source); the graph is
  saved with the project (server or, in the GitHub Pages build, IndexedDB). Graph files (`.web2print.json`) hold
  the graph only.
- **Web Source**: another page as pasted code, an .html file with its assets, or a zip; or the project page.
- **Capture**: its own width, presets, recorded steps and component rules (cached by source and settings), or the
  Editor tab's. The preview shows the frozen page, and a Live view with "Capture this state".
- **Components / Pick / Edit / Filter**: the library at a level of detail; picking by CSS selector or by clicking
  in the preview (with "similar"); text, style and hide edits on one component in the preview; keeping by kind or
  name, reordering, keeping the first N. The preview outlines what each node puts out.
- **Layout / Export**: show the Editor tab's pages (own layouts in N4, export from the graph in N5).

## Checks

| Planned check | Test | Status |
|---|---|---|
| Valid and refused connections with reasons (types, missing ports, self, loops) | `tests/graph-engine.test.ts` | ✅ |
| Cache: a second run or moving nodes re-runs nothing; a change re-runs only that node and what follows; moving a frame in the Editor tab re-runs only Layout | same | ✅ |
| v2 project → default graph gives exactly the Editor tab's document, components and page HTML | same | ✅ |
| The engine uses no React, DOM globals, storage or network | same | ✅ |
| Nodes tab opens the default graph, all nodes OK and linked; Editor tab document unchanged | `tests/e2e/n1-nodes-tab.test.ts` | ✅ |
| Build a graph by dragging from the palette and between handles; a wrong drop shows its reason | same | ✅ |
| Undo / redo (keys and buttons), separate from the Editor tab's | same | ✅ |
| The graph is saved with the project (survives a reload); save to a graph file → open gives the same graph | same | ✅ |
| Import → capture → frozen preview (styles applied, no scripts); a new width re-captures | `tests/e2e/n2-source-capture.test.ts` | ✅ |
| Live view and "Capture this state": into the project when linked, into the node when not | same | ✅ |
| A Capture node with the project's settings gives the same analysis and frozen HTML as the Editor tab, all 12 test pages | same | ✅ |
| Pick by selector and by click give the same components; clicking again takes one out; "similar" | `tests/e2e/n3-components.test.ts` | ✅ |
| An Edit node's text edit is the same override as the Editor tab's (M5); style edits; revert | same | ✅ |
| Changing the level of detail updates Components and Filter, never the capture; Filter order and first N | same | ✅ |
| GitHub Pages build: default graph, a page added and captured in the browser, pick by selector | `tests/e2e/static-pages.test.ts` | ✅ |

## Limits until N4–N6

- Layout and Export nodes only show the Editor tab's pages; components from other nodes can't be placed yet.
- Graph files don't carry the pages imported into Web Source nodes (they stay in the project).
- The Nodes tab's preview isn't resizable or detachable yet (Node CMS's is).
