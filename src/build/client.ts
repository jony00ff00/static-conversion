/**
 * esbuild options for the editor client, shared by the dev server and the
 * static (GitHub Pages) build. The static build runs capture and flow
 * measurement in the browser, so it embeds the in-page helpers as text.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BuildOptions } from 'esbuild';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
const text = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

export function clientBuildOptions(o: { static: boolean }): BuildOptions {
  return {
    entryPoints: [path.join(ROOT, 'src', 'client', 'main.tsx')],
    bundle: true,
    format: 'esm',
    jsx: 'automatic',
    target: 'es2022',
    logLevel: 'silent',
    define: {
      'process.env.NODE_ENV': '"production"',
      __STATIC__: String(o.static),
      __IN_PAGE_JS__: o.static ? JSON.stringify(text('src/render/inPage.browser.js')) : '""',
      // Both builds: the Nodes tab and the Editor tab's layouts measure flow in the browser.
      __FLOW_JS__: JSON.stringify(text('src/flow/layout.browser.js')),
    },
  };
}

/** The app's stylesheet: its own, React Flow's and the Nodes tab's (copied from Node CMS, scoped to .nodes-app). */
export function clientCss(): string {
  return [
    text('src/client/app.css'),
    text('node_modules/@xyflow/react/dist/style.css'),
    text('src/client/nodes/nodes.css'),
  ].join('\n');
}
