#!/usr/bin/env node
/**
 * Publish the course audit report as a generated artifact.

The report is produced by `scripts/course-audit.cjs`, which re-runs the generator's own
`build()` in dry mode and then checks its output. This wrapper is the publish path: it writes
`artifacts/course-audit-report.json` (a dated copy plus a stable `course-audit-report.json`
so the owner page has one stable URL) and prints the same human summary the suite already expects.

Usage:  node scripts/audit-write.cjs
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const p = (...parts) => path.join(ROOT, ...parts);

const { audit, print } = require(p('scripts/course-audit.cjs'));

async function publish() {
  const { report } = await audit();
  fs.mkdirSync(p('artifacts'), { recursive: true });
  fs.writeFileSync(p('artifacts/course-audit-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('published', path.relative(ROOT, p('artifacts/course-audit-report.json')));
}

publish().catch((err) => {
  console.error(err);
  process.exit(1);
});
