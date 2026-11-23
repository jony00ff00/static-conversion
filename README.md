# static-conversion

A deterministic web-to-print editor. It takes HTML/CSS/JS, splits it into components,
and lays them out on **A4** pages with user-set margins. A live web preview sits next to
an editable print preview, and the result exports at print quality. No LLM is used.

- Full plan and milestones: [`docs/PLAN.md`](docs/PLAN.md)
- Render sandbox: [`docs/SANDBOX.md`](docs/SANDBOX.md)
- Milestone checks: [`docs/M0-CHECKLIST.md`](docs/M0-CHECKLIST.md), [`docs/M1-CHECKLIST.md`](docs/M1-CHECKLIST.md), [`docs/M2-M6-CHECKLIST.md`](docs/M2-M6-CHECKLIST.md)
- Final review (the only manual check): [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md)
- Sample outputs: [`docs/samples/`](docs/samples/)

## Status: M6 — editor with decomposition, arranging, content editing and multi-page flow

| Part | Where |
|---|---|
| Print defaults (A4, placeholder margins 20/15/20/15 mm) | `src/config/printDefaults.ts` |
| Document schema (page setup, margins, placements in mm) | `src/schema/document.ts` |
| Import: paste, folder, zip, URL | `src/import/` |
| Sandboxed, deterministic renderer and freezing | `src/render/sandbox.ts`, `src/render/*.browser.js` |
| Font report | `src/render/fonts.ts` |
| A4 export (PDF, PNG) | `src/export/` |
| Editor document model, operations, snapping | `src/model/` |
| Component tree, isolation, page composition (shared by editor and server) | `src/compose/` |
| Pagination: layout measurement and break rules | `src/flow/` |
| Editor server and API | `src/server/` |
| Editor UI (React) | `src/client/` |
| Golden-file comparison | `src/golden/` |
| 12 test fixtures, plus freeze fixtures | `fixtures/`, `tests/freeze-fixtures/` |
| Golden outputs (DOM, screenshot, A4 export, summary) | `golden/` |
| Tests | `tests/` |

## Getting started

Requires Node 20+, and poppler-utils for the PDF tests (`apt install poppler-utils` or `brew install poppler`).

```bash
npm install
npx playwright install chromium   # first time only
npm test
```

Run the editor:

```bash
npm run dev    # then open http://localhost:5173
```

Import a test page, pasted code, a zip or a URL. The web page appears on the left and
the A4 pages on the right. Drag components from the library or the web page onto a
page, double-click a frame to edit its text, and use **Flow onto pages** for long
content. **Export PDF** downloads the result.

Export a page from the command line:

```bash
npm run export -- fixtures/01-static out.pdf
npm run export -- https://example.com out.png --margins=18 --fit=shrink
npm run export:test-page -- margin-test-page.pdf
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the editor at http://localhost:5173 (`PORT` to change; projects are stored in `data/`) |
| `npm test` | Every automated check, unit and end-to-end (about 4 minutes) |
| `npm run typecheck` | TypeScript check |
| `npm run golden` | Render all fixtures and compare with `golden/` (diffs go to `.golden-diff/`) |
| `npm run golden:update` | Rewrite the golden files. **Review the changed images before committing.** |
| `npm run export -- <input> <out.pdf\|out.png> [options]` | Export a folder, .zip, .html file or URL to one A4 page. Options: `--margins=t,r,b,l`, `--landscape`, `--fit=clip\|shrink`, `--capture-width=px`, `--dpi=300`, `--guides`, `--report=file.json` |
| `npm run export:test-page -- [out.pdf] [--margins=…]` | Margin test page with mm rulers, for the physical print check |
| `npm run render -- <dir> <out>` | Render any folder of HTML/CSS/JS and save its frozen DOM and screenshot |
| `npm run fixtures:vendor` | Re-copy libraries and fonts into the fixtures from `node_modules` |

## How export works

1. The source is rendered offline, at the **content-area width** (680 px for the default
   180 mm), so text keeps its intended size on paper, and at print resolution (300 dpi).
2. JavaScript output is frozen into a static document (canvas → image, video → frame,
   pseudo-elements → real elements, blocked embeds → placeholders) and scripts are removed.
3. The frozen document is placed in the A4 content area, at the exact mm position, and
   printed to PDF (vector text, fonts embedded) or captured as PNG.
4. A report lists font substitutions, content cut off at the bottom or right, the smallest
   text size on paper, and anything blocked or rasterised.

On the command line, content taller than one page is cut off (`--fit=clip`, the default)
or scaled down to fit (`--fit=shrink`). In the editor, **Flow onto pages** paginates it
instead.

## Determinism

The same input always gives the same output: fixed clock, seeded `Math.random`, UTC,
fixed locale and colour profile, frozen animations, and no network access. Tests check
this by rendering every fixture twice and requiring identical DOM and pixels.
