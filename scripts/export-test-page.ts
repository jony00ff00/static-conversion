/**
 * Margin test page: print at 100% / "Actual size" and measure with a ruler.
 *
 *   npm run export:test-page -- [output.pdf] [--margins=20,15,20,15] [--landscape]
 */
import { writeFile } from 'node:fs/promises';
import { exportA4 } from '../src/export/a4.js';
import { importPaste } from '../src/import/index.js';
import { parseArgs, parseMargins } from './cli-args.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const output = positional[0] ?? 'margin-test-page.pdf';
const { source } = await importPaste({
  html: `<div class="fill"><h1>Margin test page</h1>
<ol>
<li>Print this page at <strong>100% / “Actual size”</strong> — not “Fit to page”.</li>
<li>The grey box is the content area. Its edges should sit exactly on the red line.</li>
<li>Measure from each paper edge to the red line with a ruler. It should match the label in each margin (± 1 mm for printer tolerance).</li>
<li>The rulers on the paper edges are in mm; long ticks every 10 mm.</li>
</ol>
<p class="small">Text sizes: <span style="font-size:8pt">8 pt</span> · <span style="font-size:10pt">10 pt</span> · <span style="font-size:12pt">12 pt</span> · <span style="font-size:16pt">16 pt</span></p></div>`,
  css: `html,body{margin:0;height:100%;font-family:sans-serif;color:#111}
.fill{box-sizing:border-box;min-height:100vh;background:#e5e7eb;padding:24px}
h1{margin-top:0}.small{color:#374151}`,
});
const { data, report } = await exportA4(source, {
  format: output.toLowerCase().endsWith('.png') ? 'png' : 'pdf',
  pageSetup: { orientation: flags.landscape ? 'landscape' : 'portrait', marginsMm: parseMargins(flags.margins) },
  guides: true,
});
await writeFile(output, data);
const m = report.pageSetup.marginsMm;
console.log(`Wrote ${output} — margins ${m.top}/${m.right}/${m.bottom}/${m.left} mm (top/right/bottom/left), ${report.pageSetup.orientation}`);
