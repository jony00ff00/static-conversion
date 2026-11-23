/**
 * Export a web page to one A4 page.
 *
 *   npm run export -- <input> <output.pdf|.png> [options]
 *
 * <input>: a folder, a .zip, an .html file, or an http(s) URL (recorded once, then rendered offline).
 * Options:
 *   --margins=20,15,20,15   top,right,bottom,left in mm (or one value for all sides)
 *   --landscape             A4 landscape
 *   --fit=clip|shrink       clip (default) cuts off what doesn't fit; shrink scales the page down
 *   --capture-width=680     width in CSS px the page is laid out at (default: content-area width)
 *   --dpi=300               PNG resolution (also used for canvases/screenshots in the PDF)
 *   --guides                draw margin guides and mm rulers
 *   --report=report.json    write the full export report
 */
import { writeFile } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { exportA4, type ExportFit } from '../src/export/a4.js';
import { importDirectory, importUrl, importZip } from '../src/import/index.js';
import { parseArgs, parseMargins } from './cli-args.js';

const { positional, flags } = parseArgs(process.argv.slice(2));
const [input, output] = positional;
if (!input || !output || !/\.(pdf|png)$/i.test(output)) {
  console.error('usage: npm run export -- <folder|file.zip|file.html|url> <output.pdf|output.png> [--margins=t,r,b,l] [--landscape] [--fit=clip|shrink] [--capture-width=px] [--dpi=300] [--guides] [--report=file.json]');
  process.exit(2);
}

async function resolveInput(arg: string) {
  if (/^https?:\/\//i.test(arg)) return importUrl(arg);
  const s = await stat(arg).catch(() => null);
  if (!s) throw new Error(`Input not found: ${arg}`);
  if (s.isDirectory()) return importDirectory(arg);
  if (/\.zip$/i.test(arg)) return importZip(arg);
  if (/\.html?$/i.test(arg)) return importDirectory(path.dirname(arg), path.basename(arg));
  throw new Error('Input must be a folder, .zip, .html file or http(s) URL');
}

const imported = await resolveInput(input);
const format = output.toLowerCase().endsWith('.pdf') ? 'pdf' : 'png';
const { data, report } = await exportA4(imported.source, {
  format,
  pageSetup: {
    orientation: flags.landscape ? 'landscape' : 'portrait',
    marginsMm: parseMargins(flags.margins),
  },
  fit: (typeof flags.fit === 'string' ? flags.fit : 'clip') as ExportFit,
  captureWidthPx: typeof flags['capture-width'] === 'string' ? Number(flags['capture-width']) : undefined,
  dpi: typeof flags.dpi === 'string' ? Number(flags.dpi) : undefined,
  guides: !!flags.guides,
});
await writeFile(output, data);
if (typeof flags.report === 'string') await writeFile(flags.report, JSON.stringify(report, null, 2));

const m = report.pageSetup.marginsMm;
console.log(`Wrote ${output}`);
console.log(`  A4 ${report.pageSetup.orientation}, margins ${m.top}/${m.right}/${m.bottom}/${m.left} mm, content area ${report.contentAreaMm.width} × ${report.contentAreaMm.height} mm`);
console.log(`  laid out at ${report.captureWidthPx} px, scale ${report.scale}, smallest text ${report.smallestTextPt ?? '–'} pt` + (report.pngSizePx ? `, ${report.pngSizePx.width} × ${report.pngSizePx.height} px at ${report.dpi} dpi` : ''));
if (report.warnings.length) {
  console.log('  Warnings:');
  for (const w of report.warnings) console.log(`   - ${w}`);
}
