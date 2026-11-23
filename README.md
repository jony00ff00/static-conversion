# visualeditor

A deterministic web-to-print editor. It takes HTML/CSS/JS, splits it into components,
and lays them out on **A4** pages with user-set margins. A live web preview sits next to
an editable print preview, and the result exports at print quality. No LLM is used.

- Full plan and milestones: [`docs/PLAN.md`](docs/PLAN.md)
- Render sandbox: [`docs/SANDBOX.md`](docs/SANDBOX.md)
- Current milestone sign-off: [`docs/M0-CHECKLIST.md`](docs/M0-CHECKLIST.md)

## Status: M0 — foundations and test harness

| Part | Where |
|---|---|
| Print defaults (A4, placeholder margins 20/15/20/15 mm) | `src/config/printDefaults.ts` |
| Document schema (page setup, margins, placements in mm) | `src/schema/document.ts` |
| Sandboxed, deterministic renderer | `src/render/sandbox.ts`, `src/render/*.browser.js` |
| Golden-file comparison | `src/golden/` |
| 12 test fixtures | `fixtures/` |
| Golden outputs (DOM, screenshot, metadata) | `golden/` |
| Tests | `tests/` |

## Getting started

Requires Node 20+.

```bash
npm install
npx playwright install chromium   # first time only
npm test
```

## Commands

| Command | What it does |
|---|---|
| `npm test` | Schema, sandbox, determinism and golden tests |
| `npm run typecheck` | TypeScript check |
| `npm run golden` | Render all fixtures and compare with `golden/` (diffs go to `.golden-diff/`) |
| `npm run golden:update` | Rewrite the golden files. **Review the changed images before committing.** |
| `npm run render -- <dir> <out>` | Render any folder of HTML/CSS/JS and save its frozen DOM and screenshot |
| `npm run fixtures:vendor` | Re-copy libraries and fonts into the fixtures from `node_modules` |

## Determinism

The same input always gives the same output: fixed clock, seeded `Math.random`, UTC,
fixed locale and colour profile, frozen animations, and no network access. Tests check
this by rendering every fixture twice and requiring identical DOM and pixels.
