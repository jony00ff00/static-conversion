# Browser-only version (GitHub Pages)

**Live:** https://jony00ff00.github.io/static-conversion/

The same editor, built to run with no server. On every push to `main`,
`.github/workflows/pages.yml` builds it with `npm run build:static` and pushes the result to
the `gh-pages` branch, which GitHub Pages serves (Settings → Pages → *Deploy from a branch*,
`gh-pages`, `/ (root)`).

## How it works

| Server version | Browser-only version |
|---|---|
| Playwright opens the source in a sandboxed Chromium | A hidden iframe in the visitor's browser opens it |
| Project files on disk (`data/`) | Project files and documents in IndexedDB (this browser only) |
| Files served by the editor server | Files served by a service worker (`src/static/sw.ts`) at `vfs/<project>/…` |
| Fixed clock and seed through Playwright and an init script | The service worker injects the same init script plus a fixed `Date` |
| Network blocked by request routing | Network limited by a Content-Security-Policy on served pages |
| Flow measured in the sandbox | Flow measured in a hidden iframe of the exact frame width |

Capture, freezing and decomposition run the same in-page code
(`src/render/inPage.browser.js`, `src/flow/layout.browser.js`), and pagination uses the
same break rules (`src/flow/paginate.ts`). `tests/e2e/static-parity.test.ts` checks that
the browser finds the same elements, component kinds and boxes as the server for four test pages.

## What is different

- **Import from URL** is turned off: browsers can't read other sites' pages. Save the page
  and import it as a zip.
- **Export** opens the browser's print dialog. Choose *Save as PDF*, paper *A4*, margins
  *None*. Pages are A4 through `@page`, but the PDF comes from the visitor's browser, so
  exact page-box sizes and embedded fonts are not checked as they are on the server.
- **Proof** (comparing the editor with a server render) is hidden.
- **Embeds and broken images** always become placeholders (the server can screenshot
  same-origin iframes).
- **Use the site's print styles** bakes the `@media print` rules in, but can't emulate print
  media for scripts that check it.
- **No font report**: it needs the browser's DevTools protocol.
- **Security:** imported code runs on the github.io origin of this site, in the visitor's own
  browser. Only import code you trust; it could read other projects saved in the same browser.

## Run it locally

```bash
npm run build:static
```

```bash
npm run preview:static   # http://localhost:5174/static-conversion/
```

`tests/e2e/static-pages.test.ts` builds the site and checks import, freezing with a fixed
clock, placeholders, flow onto pages, print export, and the disabled URL import.
