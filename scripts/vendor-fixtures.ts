/**
 * Copies third-party libraries and fonts from node_modules into each fixture,
 * and compiles the Tailwind fixture's CSS. The output is committed so fixtures
 * are fully self-contained and never change unless this script is re-run.
 *
 *   npm run fixtures:vendor
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const fx = (...p: string[]) => path.join(root, 'fixtures', ...p);
// Read straight from node_modules: some packages' `exports` maps hide these files.
const mod = (spec: string) => path.join(root, 'node_modules', spec);

const copies: Array<[string, string]> = [
  [mod('bootstrap/dist/css/bootstrap.min.css'), fx('03-bootstrap', 'vendor', 'bootstrap.min.css')],
  [mod('react/umd/react.production.min.js'), fx('04-react-spa', 'vendor', 'react.production.min.js')],
  [mod('react-dom/umd/react-dom.production.min.js'), fx('04-react-spa', 'vendor', 'react-dom.production.min.js')],
  [mod('chart.js/dist/chart.umd.js'), fx('05-canvas-chart', 'vendor', 'chart.umd.js')],
  [mod('@fontsource/inter/files/inter-latin-400-normal.woff2'), fx('07-webfonts', 'fonts', 'inter-latin-400-normal.woff2')],
  [mod('@fontsource/inter/files/inter-latin-700-normal.woff2'), fx('07-webfonts', 'fonts', 'inter-latin-700-normal.woff2')],
  [mod('@fontsource/inter/files/inter-latin-400-italic.woff2'), fx('07-webfonts', 'fonts', 'inter-latin-400-italic.woff2')],
];

for (const [from, to] of copies) {
  await mkdir(path.dirname(to), { recursive: true });
  await copyFile(from, to);
  console.log('copied', path.relative(root, to));
}

const tw = fx('02-tailwind');
await mkdir(path.join(tw, 'vendor'), { recursive: true });
execFileSync(
  process.execPath,
  [mod('tailwindcss/lib/cli.js'), '-c', path.join(tw, 'tailwind.config.cjs'), '-i', path.join(tw, 'input.css'), '-o', path.join(tw, 'vendor', 'tailwind.css'), '--minify'],
  { stdio: 'inherit' },
);
console.log('compiled fixtures/02-tailwind/vendor/tailwind.css');
