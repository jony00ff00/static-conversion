# M0 — Foundations and test harness: sign-off

## Automated checks (run `npm test`)

| Check | Test | Status |
|---|---|---|
| Every fixture renders without page errors in < 30 s | `tests/fixtures.test.ts` | ✅ passing (~1 s each) |
| Outside fetch / image / WebSocket requests are blocked | `tests/sandbox.test.ts` | ✅ passing |
| Files outside the import directory can't be read | `tests/sandbox.test.ts` | ✅ passing |
| Infinite-loop page is killed at the time limit | `tests/sandbox.test.ts` | ✅ passing |
| Same fixture rendered twice → identical DOM and pixels | `tests/fixtures.test.ts` | ✅ passing |
| Every element has a `data-wp-id` | `tests/fixtures.test.ts` | ✅ passing |
| Output matches stored golden files | `tests/fixtures.test.ts`, `npm run golden` | ✅ passing locally — see note below |
| A4 / margin / placement schema rules | `tests/schema.test.ts` | ✅ passing |

**Note on golden screenshots:** the stored screenshots in `golden/` were generated in the
development container. CI runs in the official Playwright image, whose system fonts may
differ (fixtures using Georgia/Arial/Verdana fall back to whatever is installed). If the
first CI run fails only on pixel differences, regenerate inside that image with
`npm run golden:update`, review the images, and commit them.

## 👤 User checks

1. Run `npm run golden:update` (or use the committed files) and open each
   `golden/<fixture>/screenshot.png`.
2. Open each `fixtures/<fixture>/index.html` in a normal browser (Chrome) and compare.
   Expected differences, by design:
   - **04-react-spa**: date shows 2026-01-01 and a fixed "ref" code (fixed clock and random seed).
   - **10-interactive**: the spinner is frozen and the fade-in text is fully visible.
   - **12-cross-origin-iframe**: the map frame is empty and the logo is missing (outside requests blocked).
   - **11-print-media-darkmode**: the cookie banner is visible (print presets come in M3).
3. Tick off each fixture below when the screenshot matches what you see in the browser
   (apart from the expected differences above).

| Fixture | Matches browser |
|---|---|
| 01-static | ☐ |
| 02-tailwind | ☐ |
| 03-bootstrap | ☐ |
| 04-react-spa | ☐ |
| 05-canvas-chart | ☐ |
| 06-svg-infographic | ☐ |
| 07-webfonts | ☐ |
| 08-long-article | ☐ |
| 09-div-soup | ☐ |
| 10-interactive | ☐ |
| 11-print-media-darkmode | ☐ |
| 12-cross-origin-iframe | ☐ |

Signed off by: ____________  Date: ________
