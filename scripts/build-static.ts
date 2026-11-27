/**
 * Build the browser-only editor for GitHub Pages into `dist-static/` (or the
 * folder given as the first argument). All paths are relative, so the site
 * works from any sub-path such as https://user.github.io/static-conversion/.
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, clientBuildOptions, clientCss } from '../src/build/client.js';
import { RANDOM_SEED } from '../src/render/sandbox.js';

const out = path.resolve(process.argv[2] ?? path.join(ROOT, 'dist-static'));

async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const files: string[] = [];
  for (const e of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) files.push(...(await listFiles(dir, r)));
    else if (e.isFile()) files.push(r);
  }
  return files.sort();
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

await build({ ...clientBuildOptions({ static: true }), outfile: path.join(out, 'app.js'), minify: true, sourcemap: false });

const initJs = (await readFile(path.join(ROOT, 'src/render/init.browser.js'), 'utf8')).replaceAll('__SEED__', String(RANDOM_SEED));
await build({
  entryPoints: [path.join(ROOT, 'src/static/sw.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  outfile: path.join(out, 'sw.js'),
  define: { __INIT_JS__: JSON.stringify(initJs) },
  logLevel: 'silent',
});

await writeFile(path.join(out, 'app.css'), clientCss());
await writeFile(
  path.join(out, 'index.html'),
  `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Static Conversion</title><link rel="stylesheet" href="app.css"></head>
<body><div id="root"></div><script type="module" src="app.js"></script></body></html>
`,
);
// GitHub Pages: serve files as they are (no Jekyll processing).
await writeFile(path.join(out, '.nojekyll'), '');

// Test pages, with a manifest of their files (the browser can't list folders).
const fixturesDir = path.join(ROOT, 'fixtures');
const manifest: Record<string, string[]> = {};
for (const name of (await readdir(fixturesDir)).filter((n) => /^\d\d-/.test(n)).sort()) {
  manifest[name] = await listFiles(path.join(fixturesDir, name));
  await cp(path.join(fixturesDir, name), path.join(out, 'fixtures', name), { recursive: true });
}
await writeFile(path.join(out, 'fixtures.json'), JSON.stringify(manifest));

console.log(`Static site written to ${path.relative(process.cwd(), out) || '.'}`);
