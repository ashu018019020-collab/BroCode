#!/usr/bin/env node
/**
 * Print the ADVISORY cross-module duplicate report for Pandas Mastery tasks.
 *
 * The generation gate (`scripts/pandas-course.cjs`) hard-fails a copied statement or solution but
 * says nothing about a repeated title, because a shared title can be a legitimate variation. This
 * report surfaces all three kinds for a human to review, and it always exits 0: findings are a
 * prompt to dedupe or document an intended warm-up, not a build failure.
 *
 * The documented warm-ups in `WARMUP_ALLOWLIST` are exempt, so the intentional repetitions in every
 * module are not noise.
 *
 * Usage:
 *   node scripts/pandas-diversity-report.cjs           readable report (always exit 0)
 *   node scripts/pandas-diversity-report.cjs --json    machine-readable findings
 *   node scripts/pandas-diversity-report.cjs --check   CI guard: exit 1 on a repeated statement or
 *                                                     solution outside the documented warm-ups
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { crossModuleDuplicateReport, WARMUP_ALLOWLIST } = require('./lib/pandas-diversity.cjs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'pandas-mastery');
const readJSON = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

const modules = fs.readdirSync(SRC)
  .filter((file) => /^modules-.*\.json$/.test(file))
  .sort()
  .flatMap((file) => readJSON(path.join(SRC, file)));

for (const file of fs.readdirSync(SRC).filter((name) => /^deepening.*\.json$/.test(name)).sort()) {
  const layer = readJSON(path.join(SRC, file));
  for (const [id, pack] of Object.entries(layer)) {
    const target = modules.find((module) => module.id === id);
    if (!target) continue;
    target.topics.push(...(pack.topics || []));
    target.debug.push(...(pack.debug || []));
    target.tasks.push(...(pack.tasks || []));
  }
}

const report = crossModuleDuplicateReport(modules);
const KIND_ORDER = ['title', 'statement', 'solution'];
const CHECK = process.argv.includes('--check');

if (CHECK) {
  const blocking = report.findings.filter((finding) => finding.kind !== 'title');
  if (blocking.length) {
    console.error(`pandas-diversity: ${blocking.length} blocking duplicate(s)`);
    for (const finding of blocking) console.error(`  · ${finding.message}`);
    process.exit(1);
  }
  const titles = report.counts.title;
  console.log(`pandas-diversity: ok — no repeated statements or solutions outside the documented warm-ups${titles ? ` (${titles} advisory title repeat(s))` : ''}`);
} else if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ ...report, warmups: WARMUP_ALLOWLIST.map((entry) => entry.title) }, null, 2));
} else {
  console.log('\n— Pandas cross-module duplicate report (ADVISORY) —\n');
  console.log(`Documented warm-ups (exempt only when both tasks are documented warm-ups): ${WARMUP_ALLOWLIST.map((entry) => entry.title).join(' · ')}\n`);

  if (!report.findings.length) {
    console.log('No cross-module duplicates outside the documented warm-ups.');
  } else {
    for (const kind of KIND_ORDER) {
      const findings = report.findings.filter((finding) => finding.kind === kind);
      if (!findings.length) continue;
      console.log(`${kind.toUpperCase()} repeats (${findings.length}):`);
      for (const finding of findings) {
        console.log(`  · ${finding.moduleId} ${finding.task} → ${finding.ownerModuleId} ${finding.ownerTask}`);
        if (finding.fingerprint) {
          console.log(`      same semantic fingerprint: ${finding.fingerprint.slice(0, 160)}`);
        }
      }
      console.log('');
    }

    console.log(`${report.findings.length} finding(s): ${KIND_ORDER.map((kind) => `${report.counts[kind]} ${kind}`).join(', ')}.`);
    console.log('Advisory only — the generation gate fails on repeated statements/solutions, not titles.');
  }
}
