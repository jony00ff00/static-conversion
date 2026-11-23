/**
 * Render every fixture and compare against golden files.
 *   npm run golden            # check
 *   npm run golden:update     # rewrite golden files (review the diff before committing!)
 *   npm run golden -- 05-canvas-chart   # one fixture
 */
import { checkGolden } from '../src/golden/check.js';
import { listFixtures } from '../src/golden/fixtures.js';

const args = process.argv.slice(2);
const update = args.includes('--update');
const only = args.filter((a) => !a.startsWith('--'));
const fixtures = only.length ? only : listFixtures();

let failed = 0;
for (const f of fixtures) {
  const o = await checkGolden(f, { update });
  if (!o.ok) failed++;
  const status = o.ok ? 'PASS' : 'FAIL';
  console.log(`${status}  ${f.padEnd(26)} ${String(o.durationMs).padStart(6)} ms  ${o.messages.join('; ')}`);
}
if (failed) {
  console.error(`\n${failed} fixture(s) failed. Diffs written to .golden-diff/`);
  process.exit(1);
}
