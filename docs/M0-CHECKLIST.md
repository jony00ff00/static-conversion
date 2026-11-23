# M0 — Foundations and test harness

Status: **complete**. All exit checks are automated and run in CI (`npm test`).

| Check | Test | Status |
|---|---|---|
| Every fixture renders without page errors in < 30 s | `tests/fixtures.test.ts` | ✅ (~1 s each) |
| Outside fetch / image / WebSocket requests are blocked | `tests/sandbox.test.ts` | ✅ |
| Files outside the import directory can't be read | `tests/sandbox.test.ts` | ✅ |
| A page stuck in an infinite loop is killed at the time limit | `tests/sandbox.test.ts` | ✅ |
| Same fixture rendered twice → identical DOM and pixels | `tests/fixtures.test.ts` | ✅ |
| Every element has a stable `data-wp-id` | `tests/fixtures.test.ts` | ✅ |
| Output matches the stored golden files | `tests/fixtures.test.ts`, `npm run golden` | ✅ |
| A4, margin and placement schema rules | `tests/schema.test.ts` | ✅ |

The fixture screenshots used to be compared with a real browser by hand. That check is
now covered by the golden files, and by the freeze tests added in M1, which compare
every frozen page with the live page. Whether the rendered output looks right overall
is part of the single final review in [`ACCEPTANCE.md`](ACCEPTANCE.md).

## Note on golden screenshots

The golden screenshots were generated in the development container. CI runs in the
pinned Playwright image, whose system fonts may differ: fixtures that ask for
Georgia, Arial or Verdana fall back to whatever is installed. If CI fails **only** on
pixel differences, regenerate the goldens inside that image with
`npm run golden:update`, check that the diffs are font-only, and commit them.
