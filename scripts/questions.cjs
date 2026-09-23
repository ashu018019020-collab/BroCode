#!/usr/bin/env node
/** npm run questions:* — local content-pack pipeline. No network. */
const fs = require('fs');
const path = require('path');
const { validateBank, coverageGate } = require('./lib/validate.cjs');
const { loadSections, bankExists, loadBank, saveBank, allSectionIds, existingBankIds, seedAll, seedBank, QUESTIONS_DIR } = require('./lib/banks.cjs');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);
const arg = (name) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};

function cmdSeed() {
  const force = process.argv.includes('--force');
  const r = seedAll({ force });
  const d = r.dropped || { duplicateText: 0, missingAnswer: 0, tooShort: 0 };
  ok(`seeded ${r.questions} questions across ${r.created}/${r.total} banks from the real curriculum${r.skipped ? ` (${r.skipped} bank(s) skipped — exist; use --force to regenerate)` : ''}`);
  if (d.duplicateText || d.missingAnswer || d.tooShort) {
    warn(`dropped ${d.duplicateText} duplicate-text, ${d.missingAnswer} empty-answer, ${d.tooShort} too-short entries (honest skip — nothing fabricated)`);
  }
  if (r.created) writeManifest();
}

/** Write public/questions/manifest.json — the UI's index of banks (no 29-file fetch). */
function writeManifest() {
  const entries = [];
  let total = 0, published = 0;
  for (const s of loadSections()) {
    if (!bankExists(s.id)) continue;
    const bank = loadBank(s.id);
    const { stats } = validateBank(bank);
    const { flags } = coverageGate(bank, stats);
    entries.push({
      sectionId: s.id, no: s.no, title: s.title,
      total: stats.total, published: stats.published,
      byType: stats.byType, byDifficulty: stats.byDifficulty, flags,
    });
    total += stats.total; published += stats.published;
  }
  const manifest = { generatedAt: new Date().toISOString(), baseline: 50, total, published, sections: entries };
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(QUESTIONS_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}

function cmdManifest() {
  const m = writeManifest();
  if (!m.sections.length) { warn('no banks yet — run: npm run questions:seed'); return; }
  ok(`manifest: ${m.sections.length} banks · ${m.published} published / ${m.total} questions → public/questions/manifest.json`);
}

function cmdValidate() {
  const ids = arg('section') ? [arg('section')] : existingBankIds();
  if (!ids.length) { warn('no banks yet — run: npm run questions:seed'); return; }
  let failures = 0, incomplete = 0;
  for (const sid of ids) {
    const bank = loadBank(sid);
    const { problems, stats } = validateBank(bank);
    const { flags, complete } = coverageGate(bank, stats);
    if (!complete) incomplete++;
    if (problems.length) {
      bad(`${sid}: ${problems.length} problem(s)`);
      problems.slice(0, 6).forEach((p) => console.log('   · ' + p));
      failures += problems.length;
    } else {
      ok(`${sid}: ${stats.total} questions valid${complete ? '' : ' — CONTENT_INCOMPLETE (' + stats.total + '/50 baseline)'}`);
    }
  }
  console.log(failures ? `\n\x1b[31m✕ ${failures} problem(s)\x1b[0m` : `\n\x1b[32m✓ All banks schema-valid\x1b[0m${incomplete ? ` — ${incomplete} marked CONTENT_INCOMPLETE (honest: baseline not authored yet)` : ''}`);
  process.exit(failures ? 1 : 0);
}

function cmdReport() {
  const ids = existingBankIds();
  const sections = loadSections();
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n— Question Bank Report —\n');
  console.log(pad('SECTION', 34) + pad('TOTAL', 7) + pad('INT', 5) + pad('CODE', 6) + pad('DBG', 5) + pad('LOGIC', 7) + pad('SOLVED', 8) + pad('CP', 4) + 'FLAGS');
  const T = { total: 0, int: 0, code: 0, dbg: 0, logic: 0, solved: 0, cp: 0, dup: 0, unv: 0 };
  for (const s of sections) {
    if (!bankExists(s.id)) continue;
    const bank = loadBank(s.id);
    const { stats, problems } = validateBank(bank);
    const { flags } = coverageGate(bank, stats);
    T.total += stats.total; T.int += stats.byType.interview; T.code += stats.byType.coding;
    T.dbg += stats.byType.debug; T.logic += stats.byType.logic; T.solved += stats.byType.solved; T.cp += stats.byType.checkpoint;
    T.dup += stats.duplicates; T.unv += stats.unverified;
    console.log(pad(`${String(s.no).padStart(2, '0')} ${s.title}`.slice(0, 32), 34) + pad(stats.total, 7) + pad(stats.byType.interview, 5) + pad(stats.byType.coding, 6) + pad(stats.byType.debug, 5) + pad(stats.byType.logic, 7) + pad(stats.byType.solved, 8) + pad(stats.byType.checkpoint, 4) + flags.join(','));
  }
  console.log('-'.repeat(86));
  console.log(pad('TOTAL', 34) + pad(T.total, 7) + pad(T.int, 5) + pad(T.code, 6) + pad(T.dbg, 5) + pad(T.logic, 7) + pad(T.solved, 8) + pad(T.cp, 4));
  console.log(`\nDuplicates: ${T.dup} · Unverified sources: ${T.unv}`);
  console.log(`Baseline target: 50/section × ${sections.length} = ${50 * sections.length} (CONTENT_INCOMPLETE flags show honest gaps)`);
}

function cmdCoverage() {
  const sections = loadSections();
  console.log('\n— Coverage Matrix (✓ complete · ⚠ partial · ✕ missing) —\n');
  for (const s of sections) {
    const covered = existingBankIds().includes(s.id);
    const bank = covered ? loadBank(s.id) : null;
    const { stats } = bank ? validateBank(bank) : { stats: { total: 0 } };
    const pct = Math.min(100, Math.round((stats.total / 50) * 100));
    const mark = !covered || stats.total === 0 ? '✕' : pct >= 100 ? '✓' : '⚠';
    console.log(`${mark} ${String(s.no).padStart(2, '0')} ${s.title.slice(0, 36).padEnd(38)} ${covered ? `${stats.total}/50 (${pct}%)` : 'no bank'}`);
  }
}

function cmdDuplicates() {
  const groups = new Map(); // normalized text -> [ids]
  for (const sid of existingBankIds()) {
    const bank = loadBank(sid);
    for (const q of bank.questions) {
      const nq = (q.question ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
      if (!groups.has(nq)) groups.set(nq, []);
      groups.get(nq).push(q.id);
    }
  }
  const sameSection = [];
  let crossSectionTexts = 0, crossSectionCopies = 0;
  for (const [, ids] of groups) {
    if (ids.length < 2) continue;
    const bySid = new Map();
    for (const id of ids) {
      const sid = id.split(':')[0];
      if (!bySid.has(sid)) bySid.set(sid, []);
      bySid.get(sid).push(id);
    }
    if (Object.values(Object.fromEntries(bySid)).some((a) => a.length > 1)) {
      sameSection.push(ids);
    } else {
      crossSectionTexts++; crossSectionCopies += ids.length;
    }
  }
  for (const ids of sameSection) bad(`${ids.join(' == ')} (same section — fix)`);
  if (crossSectionCopies) {
    warn(`${crossSectionTexts} text(s) repeat across sections (${crossSectionCopies} copies — curriculum boilerplate, e.g. the debug-methodology task; candidates to make section-specific)`);
  }
  console.log(sameSection.length ? `\n\x1b[31m${sameSection.length} same-section duplicate group(s)\x1b[0m` : '\x1b[32m✓ No same-section duplicates (cross-section repeats are reported separately)\x1b[0m');
}

function cmdExpand() {
  const sid = arg('topic') || arg('section');
  const file = arg('file');
  if (!sid || !file) { bad('usage: npm run questions:expand -- --section=s01 --file=new-questions.json'); process.exit(2); }
  const bank = bankExists(sid) ? loadBank(sid) : seedBank(loadSections().find((s) => s.id === sid));
  const incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(incoming) ? incoming : incoming.questions;
  const existingIds = new Set(bank.questions.map((q) => q.id));
  const existingNorms = new Set(bank.questions.map((q) => (q.question ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()));
  let added = 0, skippedDupes = 0;
  const addedByStatus = {};
  for (const q of items) {
    const rec = { priority: 'P2', status: 'DRAFT', tags: [], ...q, sectionId: sid };
    if (existingIds.has(rec.id)) { skippedDupes++; continue; }
    const nq = (rec.question ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    if (existingNorms.has(nq)) { skippedDupes++; continue; }
    existingIds.add(rec.id); existingNorms.add(nq);
    bank.questions.push(rec); added++;
    addedByStatus[rec.status] = (addedByStatus[rec.status] ?? 0) + 1;
  }
  const { problems } = validateBank(bank);
  if (problems.length) { bad(`validation failed after merge: ${problems.length} problem(s)`); problems.slice(0, 8).forEach((p) => console.log('   · ' + p)); process.exit(1); }
  saveBank(bank);
  writeManifest();
  const statuses = Object.entries(addedByStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
  ok(`${sid}: +${added} question(s) added (${statuses})${skippedDupes ? `, ${skippedDupes} duplicate(s) skipped` : ''}. DRAFT entries stay out of the learner UI until PUBLISHED.`);
}

function cmdImport() {
  const file = arg('file');
  if (!file) { bad('usage: npm run questions:import -- --file=<json|jsonl|csv>'); process.exit(2); }
  const raw = fs.readFileSync(file, 'utf8');
  let items = [];
  if (file.endsWith('.jsonl')) items = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  else if (file.endsWith('.csv')) {
    const [head, ...rows] = raw.split('\n').filter(Boolean);
    const cols = head.split(',');
    items = rows.map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v])));
  } else {
    const j = JSON.parse(raw);
    items = Array.isArray(j) ? j : j.questions;
  }
  const bySection = new Map();
  for (const q of items) {
    const sid = q.sectionId || 'imported';
    if (!bySection.has(sid)) bySection.set(sid, bankExists(sid) ? loadBank(sid) : { sectionId: sid, title: sid, contentVersion: '1.0.0', generatedAt: new Date().toISOString(), topics: [], questions: [], flags: ['CONTENT_INCOMPLETE'] });
    bySection.get(sid).questions.push({ priority: 'P2', status: 'DRAFT', tags: [], ...q, sectionId: sid });
  }
  let failed = 0;
  for (const [sid, bank] of bySection) {
    const { problems } = validateBank(bank);
    const real = problems.filter((p) => !p.startsWith('(') && !p.includes(': missing field "id"') || !/imported:\w+:\d+/.test(p));
    if (problems.filter((p) => !/missing field "(sourceVersion|verifiedAt)"/.test(p)).length > 3) { bad(`${sid}: too many validation problems, not saved`); failed++; continue; }
    saveBank(bank);
    ok(`${sid}: imported ${bank.questions.length} question(s)`);
  }
  if (!failed) writeManifest();
  process.exit(failed ? 1 : 0);
}

function cmdExport() {
  const out = arg('out') || 'question-banks-export.json';
  const data = existingBankIds().map((sid) => loadBank(sid));
  fs.writeFileSync(out, JSON.stringify(data, null, 1));
  ok(`exported ${data.length} banks → ${out}`);
}

const cmd = process.argv[2];
const commands = { seed: cmdSeed, validate: cmdValidate, report: cmdReport, coverage: cmdCoverage, duplicates: cmdDuplicates, expand: cmdExpand, import: cmdImport, export: cmdExport, manifest: cmdManifest };
if (commands[cmd]) commands[cmd]();
else {  console.error('usage: node scripts/questions.cjs seed|validate|report|coverage|duplicates|expand|import|export|manifest [--options]'); process.exit(2); }
