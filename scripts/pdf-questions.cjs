#!/usr/bin/env node
/**
 * pdf-questions.cjs — import the V10 "Senior Visual Answer Edition" Q&A PDF into the
 * per-section question banks (public/generated/questions/sNN.json).
 *
 *   node scripts/pdf-questions.cjs --pdf="<path-to.pdf>"          # dry run: report only
 *   node scripts/pdf-questions.cjs --pdf="<path>" --write         # merge + rewrite manifest
 *   node scripts/pdf-questions.cjs --section=s07                  # one section only
 *   node scripts/pdf-questions.cjs --fresh                        # ignore the cached layout text
 *   node scripts/pdf-questions.cjs --write --reset                # drop every imported record and re-import
 *
 * `--reset` removes only records this importer wrote (those carrying `pdfStage`), so a
 * change to the curation rules can be re-applied without touching seeded or authored
 * content — and without a destructive `git checkout` of files others may have edited.
 *
 * House rules this follows (same as scripts/learn.cjs):
 *   · `pdftotext -layout` only — the layout is what makes the items parseable;
 *   · the extracted text is cached in .freebuff/ (gitignored) so re-runs are cheap;
 *   · DRY RUN by default; nothing is written without --write;
 *   · every drop is reported — no silent skipping, nothing invented.
 *
 * Safety: the curated set is validated (whole-bank) BEFORE anything is saved, and the
 * global question-text uniqueness of `questions.test.cjs` is asserted up front, so this
 * command can never leave the content pack in a state the test suite rejects.
 */
const fs = require('fs');
const path = require('path');
const { validateBank, coverageGate, norm, TYPES } = require('./lib/validate.cjs');
const { loadSections, bankExists, loadBank, saveBank, seedBank, mergeIntoBank, writeManifest } = require('./lib/banks.cjs');
const {
  STAGE_TO_TYPE, HIGHLIGHT_RULE, HIGHLIGHT_TAG, DIFF_RANK,
  parseLayout, extractLayout, curate, isHighlighted, withIds,
} = require('./lib/pdfqa.cjs');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.freebuff', 'pdfqa-layout.txt');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (name) => {
  const a = argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=').slice(1).join('=') : undefined;
};
const PDF = val('pdf') || process.env.PDFQA_PDF || null;
const ONLY = (val('section') || '').toLowerCase() || null;
const WRITE = has('--write');
const FRESH = has('--fresh');
const RESET = has('--reset');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);
const dim = (m) => `\x1b[2m${m}\x1b[0m`;
const pad = (v, n) => String(v).padEnd(n);
const num = (v, n) => String(v).padStart(n);
const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

/** Records are appended by `mergeIntoBank`; put the highlights back in front, stably. */
function partitionBank(bank) {
  const hl = bank.questions.filter(isHighlighted)
    .sort((a, b) => (DIFF_RANK[b.difficulty] ?? 0) - (DIFF_RANK[a.difficulty] ?? 0) || (a.pdfPage ?? 0) - (b.pdfPage ?? 0));
  const rest = bank.questions.filter((q) => !isHighlighted(q));
  bank.questions = [...hl, ...rest];
  return hl.length;
}

function main() {
  /* ------------------------------ extract ------------------------------ */
  let layout;
  try {
    layout = extractLayout(PDF, { cacheFile: CACHE, fresh: FRESH });
  } catch (err) {
    bad(err.message);
    console.log('   usage: node scripts/pdf-questions.cjs --pdf="<path-to.pdf>" [--write] [--reset] [--section=sNN] [--fresh]');
    process.exit(2);
  }

  const { items, problems } = parseLayout(layout.text);
  const sections = loadSections();

  /* ------------------------------ curate ------------------------------- */
  const { records, report } = curate(items, { sections });

  const wanted = ONLY ? sections.filter((s) => s.id === ONLY) : sections;
  if (ONLY && !wanted.length) { bad(`unknown section "${ONLY}"`); process.exit(2); }

  console.log(`\n— V10 PDF → question banks ${WRITE ? '\x1b[1m(write)\x1b[0m' : '(dry run)'} —\n`);
  console.log(`  source        : ${layout.fromCache ? `${CACHE} ${dim('(cached layout text)')}` : PDF}`);
  console.log(`  parsed        : ${num(report.parsed, 6)} items  ${dim(`${report.pages} pages · ${Object.keys(STAGE_TO_TYPE).length} stages · ${TYPES.length} bank types`)}`);
  console.log(`  duplicates    : ${num(report.dropped.intraSection, 6)} dropped  ${dim('(repeat question inside one section — strongest variant kept)')}`);
  console.log(`  section-tied  : ${num(report.crossSection.families, 6)} families / ${report.crossSection.items} items ${dim('(repeated across sections → section name injected, coverage kept)')}`);
  if (report.forked) console.log(`  forked        : ${num(report.forked, 6)}        ${dim('(needed the extra section id to stay unique)')}`);
  console.log(`  unusable      : ${num(report.dropped.unusable, 6)}        ${dim('(no section / no type / too short)')}`);
  console.log(`  answer tidy   : ${num(report.answerClauseTrimmed, 6)}        ${dim('(duplicate "Use:" clause removed — same text lives in explanation)')}`);
  console.log(`  concept tags  : ${num(report.vocabulary, 6)} terms ${dim('(vocabulary read off the PDF + the curriculum)')}`);
  console.log(`  highlighted   : ${num(report.highlighted, 6)}        ${dim(HIGHLIGHT_RULE)}`);
  const bands = {};
  for (const [sid, b] of Object.entries(report.sectionBands)) bands[b] = (bands[b] ?? 0) + 1;
  console.log(`  top bands     : ${Object.entries(bands).map(([b, n]) => `${b} in ${n} section(s)`).join(' · ')}`);
  if (report.sectionsWithoutLabels.length) warn(`  ${report.sectionsWithoutLabels.length} section(s) carry no priority band: ${report.sectionsWithoutLabels.join(' ')}`);
  if (report.unmatchedConcept) console.log(`  concept tag   : ${num(report.unmatchedConcept, 6)} items had no template concept → matched the section vocabulary`);

  /* ---------------------------- size estimate --------------------------- */
  const payload = [...records.values()].flat();
  const bytes = Buffer.byteLength(JSON.stringify(payload));
  const before = sections.reduce((n, s) => n + (bankExists(s.id) ? fs.statSync(path.join(ROOT, 'public', 'generated', 'questions', `${s.id}.json`)).size : 0), 0);
  console.log(`\n  curated       : ${num(payload.length, 6)} records across ${records.size} section(s) · ${mb(bytes)} of JSON ${dim(`(pack on disk now: ${mb(before)})`)}`);

  /* --------------------------- per-section table ------------------------- */
  const COLS = ['theory', 'interview', 'coding', 'logic', 'debug', 'solved', 'defense', 'checkpoint'];
  console.log(`\n  ${pad('SECTION', 30)}${num('ADD', 5)}${num('HL', 5)}  ${pad('BAND', 10)}${COLS.map((c) => pad(c.slice(0, 6), 7)).join('')}`);
  console.log(`  ${'-'.repeat(30 + 5 + 5 + 2 + 10 + COLS.length * 7)}`);
  for (const s of report.perSection) {
    if (ONLY && s.sid !== ONLY) continue;
    const cells = COLS.map((c) => pad(s.byType[c] ?? 0, 7)).join('');
    console.log(`  ${pad(`${s.sid} ${s.title}`.slice(0, 28), 30)}${num(s.added, 5)}${num(s.highlighted, 5)}  ${pad(s.band ?? '—', 10)}${cells}`);
  }

  if (problems.length) {
    warn(`\n  ${problems.length} page problem(s) — items skipped, never guessed:`);
    problems.slice(0, 8).forEach((p) => console.log(`    · ${p}`));
    if (problems.length > 8) console.log(dim(`    … ${problems.length - 8} more`));
  }

  /* ------------------------------- merge -------------------------------- */
  const staged = new Map();
  for (const sec of wanted) {
    const incoming = records.get(sec.id) ?? [];
    if (!incoming.length) continue;
    const bank = bankExists(sec.id) ? loadBank(sec.id) : seedBank(sec).bank;
    let removed = 0;
    if (RESET) {
      const before = bank.questions.length;
      bank.questions = bank.questions.filter((q) => q.pdfStage === undefined);
      removed = before - bank.questions.length;
    }
    const res = mergeIntoBank(bank, withIds(bank, incoming, sec.id), sec.id);
    staged.set(sec.id, { bank, added: res.added.length, skipped: res.skipped.byId + res.skipped.byText, removed });
  }

  const addedTotal = [...staged.values()].reduce((n, s) => n + s.added, 0);
  const skippedTotal = [...staged.values()].reduce((n, s) => n + s.skipped, 0);
  const removedTotal = [...staged.values()].reduce((n, s) => n + s.removed, 0);
  if (RESET) console.log(`\n  reset         : −${removedTotal} previously imported record(s) removed ${dim('(only records this importer wrote)')}`);
  console.log(`\n  merge         : +${addedTotal} new · ${skippedTotal} already present ${dim('(re-running this command is a no-op)')}`);

  // Nothing is written until every touched bank validates clean.
  const failures = [];
  for (const [sid, s] of staged) {
    partitionBank(s.bank);
    const { problems: p } = validateBank(s.bank);
    const { flags } = coverageGate(s.bank, validateBank(s.bank).stats);
    s.flags = flags;
    if (p.length) failures.push([sid, p]);
  }

  // Global uniqueness across ALL banks — the invariant `questions.test.cjs` enforces.
  const collisions = [];
  const seen = new Map();
  for (const sid of sections.map((s) => s.id)) {
    if (!bankExists(sid) && !staged.has(sid)) continue;
    const bank = staged.get(sid)?.bank ?? loadBank(sid);
    for (const q of bank.questions) {
      const k = norm(q.question);
      const prev = seen.get(k);
      if (prev && prev.split(' ')[0] !== sid) collisions.push(`"${q.question.slice(0, 64)}" → ${prev} and ${sid} (${q.id})`);
      else if (!prev) seen.set(k, `${sid} (${q.id})`);
    }
  }

  if (failures.length || collisions.length) {
    bad('nothing written — the merge would leave the content pack invalid');
    for (const [sid, p] of failures) {
      console.log(`   · ${sid}: ${p.length} validation problem(s)`);
      p.slice(0, 5).forEach((x) => console.log(`       ${x}`));
    }
    if (collisions.length) {
      console.log(`   · ${collisions.length} cross-bank duplicate question text(s):`);
      collisions.slice(0, 5).forEach((c) => console.log(`       ${c}`));
    }
    process.exit(1);
  }

  if (!WRITE) {
    console.log(dim('\n  dry run — re-run with --write to merge into public/generated/questions/*.json'));
    return;
  }

  for (const [sid, s] of staged) if (s.added || s.removed) saveBank(s.bank);
  const m = writeManifest();
  ok(`merged +${addedTotal} item(s) into ${[...staged.values()].filter((s) => s.added).length} bank(s)`);
  console.log(`   manifest: ${m.total} total / ${m.published} published across ${m.sections.length} sections`);
  for (const [sid, s] of staged) if (s.added || s.removed) console.log(`   · ${sid}: ${s.removed ? `−${s.removed} ` : ''}+${s.added} (${s.flags.join(',') || 'complete'})`);
  console.log(dim(`   highlight tag: ${HIGHLIGHT_TAG} · ${HIGHLIGHT_RULE}`));
}

main();
