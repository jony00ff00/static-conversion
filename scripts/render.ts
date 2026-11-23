/** Render one directory and write dom.html + screenshot.png to an output dir.
 *   npm run render -- <input-dir> <output-dir> [--width=1280]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderFixture } from '../src/render/sandbox.js';

const [input, output] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!input || !output) {
  console.error('usage: npm run render -- <input-dir> <output-dir> [--width=1280]');
  process.exit(2);
}
const widthArg = process.argv.find((a) => a.startsWith('--width='));
const width = widthArg ? Number(widthArg.split('=')[1]) : 1280;
const r = await renderFixture(path.resolve(input), { viewport: { width, height: 800 } });
await mkdir(output, { recursive: true });
await writeFile(path.join(output, 'dom.html'), r.html);
await writeFile(path.join(output, 'screenshot.png'), r.screenshot);
console.log(JSON.stringify({ durationMs: r.durationMs, wpIdCount: r.wpIdCount, blockedRequests: r.blockedRequests, pageErrors: r.pageErrors }, null, 2));
