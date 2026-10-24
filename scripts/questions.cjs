#!/usr/bin/env node
/** npm run questions:* — local content-pack pipeline. No network. */
const fs = require('fs');
const path = require('path');
const { validateBank, coverageGate, TYPES } = require('./lib/validate.cjs');
const {
  loadSections, bankExists, loadBank, saveBank, existingBankIds,
  seedAll, seedBank, mergeIntoBank, writeManifest, norm, textKey,
} = require('./lib/banks.cjs');
const { writeSearchIndex } = require('./searchindex.cjs');

/**
 * Next free per-type index — ids are APPENDED, never renumbered.
 *
 * Bank ids are positional (`s01:coding:19`) and the learner's self-grade keys are `qb:<id>`, so
 * inserting or re-sorting would silently re-point saved progress at a different question. Every
 * importer therefore appends at the end of its type, and this is the one place that decides where
 * "the end" is.
 */
function nextTypeIndex(bank, type) {
  let max = -1;
  for (const q of bank.questions) {
    if (q.type !== type) continue;
    const n = Number(String(q.id).split(':').pop());
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max + 1;
}

/**
 * The section's own extracted Q&A buckets, and how each one maps onto a bank record.
 *
 * The lesson renders these itself (`sec.interview`, `sec.coding`, …) and the SAME question often
 * ships in the bank too — 76% of the 736 bucket items are verbatim copies of that section's bank
 * items. The bucket copy wins on screen (it carries the gate key and the richer affordances), so
 * the bank is where a question must exist at all: anything that is NOT already in the bank is
 * what this table finds.
 *
 * `difficulty: 'debug'` entries are deliberately not absorbed — those belong to the Debug stage,
 * which renders them from `sec.coding`, and the bank's own `debug` type holds different material.
 */
const BUCKETS = [
  { key: 'interview', type: 'interview', q: (x) => x.q, a: (x) => x.a, note: (x) => [x.tip, x.fu].filter(Boolean).join(' '), fallback: 'Model answer ke key points se compare karo.' },
  { key: 'coding', type: 'coding', q: (x) => x.text, a: (x) => x.solution, note: (x) => x.check, fallback: 'Run the task, phir reference solution se compare karo.' },
  { key: 'logic', type: 'logic', q: (x) => x.text, a: (x) => x.answer, note: () => '', fallback: 'Pehle output predict karo, phir compare karo.' },
  { key: 'solved', type: 'solved', q: (x) => x.text, a: (x) => x.solution ?? x.result, note: (x) => x.result, fallback: 'Pehle khud solve karo, phir reference solution dekho.' },
  { key: 'checkpoint', type: 'checkpoint', q: (x) => x.q, a: (x) => x.key, note: () => '', fallback: 'Apne answer ko key points se self-grade karo.' },
];

/** Bucket difficulties include junk (`'interview code'`, `''`); the seeder's mapping already sanitises them. */
const bucketDifficulty = (d) => (['easy', 'medium', 'hard'].includes(d) ? d : d === 'debug' ? 'hard' : 'medium');

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

function cmdManifest() {
  const m = writeManifest();
  if (!m.sections.length) { warn('no banks yet — run: npm run questions:seed'); return; }
  ok(`manifest: ${m.sections.length} banks · ${m.published} published / ${m.total} questions → public/generated/questions/manifest.json`);
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
      const nq = norm(q.question);
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
    warn(`${crossSectionTexts} text(s) repeat across sections (${crossSectionCopies} copies — boilerplate that should be made section-specific)`);
  }
  console.log(sameSection.length ? `\n\x1b[31m${sameSection.length} same-section duplicate group(s)\x1b[0m` : '\x1b[32m✓ No same-section duplicates (cross-section repeats are reported separately)\x1b[0m');
}

/* ================================ quotas ================================ */

/** Display order — concept/"code kaise karte hain" first, defense next to checkpoint. */
const REPORT_TYPES = ['theory', 'interview', 'coding', 'logic', 'debug', 'solved', 'defense', 'checkpoint'];
const QUOTA_PER_TYPE = 20;

const TRACKS_DIR = path.join(__dirname, '..', 'content', 'tracks');
const trackBatchPrefix = (slug) => `track:${slug}:`;

/** Track slug → section range, straight from content/tracks (the single source of truth). */
function loadTrackRanges() {
  const idx = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, 'index.json'), 'utf8'));
  return idx.map((e) => {
    const t = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, `${e.slug}.json`), 'utf8'));
    return { slug: e.slug, title: t.title, sectionRange: t.sectionRange };
  });
}

const trackOfSection = (tracks, sid) => {
  const no = Number(String(sid).replace(/^s/, ''));
  return tracks.find((t) => no >= t.sectionRange.from && no <= t.sectionRange.to);
};

/** Per-track tally of BATCH-TAGGED (authored) items, plus every section's real total. */
function trackTally() {
  const tracks = loadTrackRanges();
  const sections = loadSections();
  return tracks.map((track) => {
    const perType = {};
    const bySection = [];
    for (const s of sections) {
      if (trackOfSection(tracks, s.id)?.slug !== track.slug) continue;
      if (!bankExists(s.id)) continue;
      const bank = loadBank(s.id);
      let authored = 0;
      for (const q of bank.questions) {
        if (String(q.batch ?? '').startsWith(trackBatchPrefix(track.slug))) {
          perType[q.type] = (perType[q.type] ?? 0) + 1;
          authored++;
        }
      }
      bySection.push({ id: s.id, no: s.no, title: s.title, total: bank.questions.length, authored });
    }
    return { track, perType, bySection, authored: Object.values(perType).reduce((a, b) => a + b, 0) };
  });
}

function cmdQuota() {
  const rows = trackTally();
  const pad = (v, n) => String(v).padEnd(n);
  let misses = 0;
  let shortSections = 0;
  console.log('\n— Authored quota report (target: +20 new items per type per track) —\n');
  console.log(pad('TRACK', 19) + pad('RANGE', 9) + REPORT_TYPES.map((t) => pad(t.slice(0, 6).toUpperCase(), 7)).join('') + 'NEW');
  for (const r of rows) {
    const cells = REPORT_TYPES.map((t) => {
      const n = r.perType[t] ?? 0;
      if (n !== QUOTA_PER_TYPE) misses++;
      return pad(n === QUOTA_PER_TYPE ? `${n}✓` : `${n}✕`, 7);
    });
    console.log(pad(r.track.slug, 19) + pad(`s${r.track.sectionRange.from}-${r.track.sectionRange.to}`, 9) + cells.join('') + String(r.authored).padEnd(5));
  }
  console.log('-'.repeat(76));
  console.log(`\nPer-section published total (baseline 50):`);
  for (const r of rows) {
    for (const s of r.bySection) {
      const met = s.total >= 50;
      if (!met) shortSections++;
      if (!met) console.log(`   ⚠ ${s.id} ${s.title.slice(0, 34).padEnd(36)} ${s.total}/50 (authored ${s.authored})`);
    }
  }
  const authoredTotal = rows.reduce((a, r) => a + r.authored, 0);
  const bankTotal = rows.reduce((a, r) => a + r.bySection.reduce((x, s) => x + s.total, 0), 0);
  console.log(`\nBanks inside tracks: ${bankTotal} items · authored in this pass: ${authoredTotal}`);
  if (!shortSections) console.log('Every section is at or above the 50-item baseline.');

  if (process.argv.includes('--report')) writeContentReport(rows, { bankTotal, authoredTotal });

  if (misses) { bad(`${misses} track/type cell(s) below the +${QUOTA_PER_TYPE} target`); process.exit(1); }
  if (shortSections && process.argv.includes('--strict')) { bad(`${shortSections} section(s) below the 50-item baseline`); process.exit(1); }
  ok(`every track carries exactly +${QUOTA_PER_TYPE} new items in all ${REPORT_TYPES.length} types`);
}

/** CONTENT-REPORT.md — every number here is recomputed from the banks/curriculum. */
function writeContentReport(rows, totals) {
  const sections = loadSections();
  const lines = [];
  lines.push('# Content report — AI Engineer Master Lab', '');
  lines.push(`Generated: ${new Date().toISOString()} · generated by \`npm run questions:quota -- --report\``, '');
  lines.push('## Per-section item counts', '');
  lines.push('| Section | Existing | New (authored) | Final |');
  lines.push('|---|---|---|---|');
  let ex = 0, nw = 0, fi = 0;
  for (const r of rows) for (const s of r.bySection) {
    ex += s.total - s.authored; nw += s.authored; fi += s.total;
    lines.push(`| ${s.id} · ${s.title} | ${s.total - s.authored} | +${s.authored} | ${s.total} |`);
  }
  lines.push(`| **TOTAL (tracks)** | **${ex}** | **+${nw}** | **${fi}** |`);
  lines.push('', '## Per-type quota (target +20 per type per track)', '');
  lines.push(`| Track | ${REPORT_TYPES.join(' | ')} | New |`);
  lines.push(`|---|${REPORT_TYPES.map(() => '---').join('|')}|---|`);
  for (const r of rows) lines.push(`| ${r.track.title} | ${REPORT_TYPES.map((t) => r.perType[t] ?? 0).join(' | ')} | ${r.authored} |`);
  const guided = sections.reduce((a, s) => a + (s.learn?.concepts ?? []).filter((c) => c.guide).length, 0);
  const concepts = sections.reduce((a, s) => a + (s.learn?.concepts ?? []).length, 0);
  const examples = sections.reduce((a, s) => a + (s.learn?.concepts ?? []).reduce((x, c) => x + (c.guide?.examples?.length ?? 0), 0), 0);
  const miniProjects = sections.filter((s) => s.mini?.name).length;
  const projectTiers = sections.reduce((a, s) => a + (s.projectLab ?? []).length, 0);
  const assessments = sections.reduce((a, s) => a + (s.checkpoint ?? []).length, 0);
  lines.push('', '## Learning content', '', '| Metric | Count |', '|---|---|');
  lines.push(`| Curriculum sections | ${sections.length} |`);
  lines.push(`| Learning topics (concepts) | ${concepts} |`);
  lines.push(`| Topics with an authored guide | ${guided} |`);
  lines.push(`| Runnable examples inside guides | ${examples} |`);
  lines.push(`| Mini projects | ${miniProjects} |`);
  lines.push(`| Project-lab tiers | ${projectTiers} |`);
  lines.push(`| Checkpoint questions (assessments) | ${assessments} |`);
  lines.push(`| Bank items (tracks) | ${totals.bankTotal} |`);
  lines.push(`| Authored items added in this pass | ${totals.authoredTotal} |`);

  // ---- 16-part topic workspaces: the structural half of the content pass, reported with
  // the same honesty as the counts above (what is finished, and what is still missing).
  const { partCoverage, PARTS } = require('./lib/packs.cjs');
  const structured = sections.filter((s) => s.topic);
  const items = structured.reduce((a, s) => {
    const t = s.topic;
    return a + Object.values(t.practice ?? {}).flat().length + t.coding.length + t.debugging.length;
  }, 0);
  // ---- Jupyter notebooks: cells executed while authoring vs cells the app runs itself.
  const nbManifest = path.join(__dirname, '..', 'public', 'notebooks', 'manifest.json');
  if (fs.existsSync(nbManifest)) {
    const m = JSON.parse(fs.readFileSync(nbManifest, 'utf8'));
    const cells = m.notebooks.reduce((a, n) => a + n.codeCells, 0);
    const verified = m.notebooks.reduce((a, n) => a + (n.verifiedCells ?? 0), 0);
    const appOnly = m.notebooks.reduce((a, n) => a + (n.appRuntimeCells ?? 0), 0);
    lines.push('', '## Jupyter notebooks (Notebook Lab)', '', '| Notebook | Topic | Section | Code cells | Verified while authoring | Run in app (numpy/pandas) |', '|---|---|---|---|---|---|');
    for (const n of m.notebooks) {
      lines.push(`| ${n.title} | ${n.topic} | ${n.section} | ${n.codeCells} | ${n.verifiedCells ?? 0} | ${n.appRuntimeCells ?? 0} |`);
    }
    lines.push('', `${m.notebooks.length} notebooks · ${cells} code cells · ${verified} executed for real · ${appOnly} run in the app's bundled runtime.`);
  }

  lines.push('', '## Topic workspaces (16-part structure)', '');
  lines.push(`${structured.length}/${sections.length} sections restructured into the full topic workspace ` +
    `(intro → theory → syntax → examples → real-world → interview → practice → coding → debugging → ` +
    `challenges → simple/medium/hard projects → improvements → interview tasks → revision).`);
  lines.push('', `${items} practice/coding/debugging items inside those workspaces.`, '');
  lines.push('| Section | Topic | Parts | Practice | Coding | Debug | Projects |', '|---|---|---|---|---|---|---|');
  for (const s of sections) {
    if (!s.topic) { lines.push(`| ${s.id} | _not yet structured_ | 0/${PARTS.length} | 0 | 0 | 0 | 0 |`); continue; }
    const t = s.topic;
    const practice = Object.values(t.practice ?? {}).flat().length;
    const cov = partCoverage(s);
    lines.push(`| ${s.id} | ${t.topic} | ${cov.done}/${PARTS.length} | ${practice} | ${t.coding.length} | ${t.debugging.length} | ${t.projects.length} |`);
  }
  lines.push('');
  fs.writeFileSync(path.join(__dirname, '..', 'CONTENT-REPORT.md'), lines.join('\n'));
  ok('wrote CONTENT-REPORT.md');
}

/* ========================= authored track expansion ======================== */

/** Short keys keep a 160-item authored file readable; long keys still work. */
const TYPE_ALIAS = {
  concept: 'theory', theory: 'theory', interview: 'interview', coding: 'coding', code: 'coding',
  logic: 'logic', debug: 'debug', debugging: 'debug', bug: 'debug', solved: 'solved', practice: 'solved',
  realworld: 'solved', defense: 'defense', projectdefense: 'defense', checkpoint: 'checkpoint',
};
const PRIORITY_OF = { must_know: 'P0', interview_critical: 'P0', high_value: 'P1', production: 'P1', advanced: 'P2' };

function cmdExpandTrack() {
  const slug = arg('track');
  const file = arg('file');
  if (!slug || !file) { bad('usage: npm run questions:expand-track -- --track=python-core --file=content/questions/expansion/python-core.json'); process.exit(2); }
  const today = arg('version') || new Date().toISOString().slice(0, 10);
  const batch = arg('batch') || `track:${slug}:v1`;
  const tracks = loadTrackRanges();
  const track = tracks.find((t) => t.slug === slug);
  if (!track) { bad(`unknown track "${slug}" (have: ${tracks.map((t) => t.slug).join(', ')})`); process.exit(2); }

  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(doc) ? doc : (doc.items ?? doc.questions ?? []);
  const problems = [];
  const bySection = new Map();
  items.forEach((raw, i) => {
    const at = `${path.basename(file)}[${i}]`;
    const sid = String(raw.sectionId ?? raw.s ?? '').toLowerCase();
    if (!sid) { problems.push(`${at}: sectionId missing`); return; }
    const owner = trackOfSection(tracks, sid);
    if (!owner || owner.slug !== slug) {
      problems.push(`${at}: ${sid} is not inside track "${slug}" (s${track.sectionRange.from}-s${track.sectionRange.to})`);
      return;
    }
    const type = TYPE_ALIAS[String(raw.type ?? raw.t ?? '').toLowerCase()];
    if (!type) { problems.push(`${at}: unknown type "${raw.type ?? raw.t}"`); return; }
    const importance = raw.importance ?? raw.i ?? 'high_value';
    if (!PRIORITY_OF[importance]) { problems.push(`${at}: unknown importance "${importance}"`); return; }
    const record = {
      sectionId: sid,
      type,
      difficulty: raw.difficulty ?? raw.d ?? 'medium',
      importance,
      priority: raw.priority ?? PRIORITY_OF[importance],
      status: raw.status ?? 'PUBLISHED',
      question: String(raw.question ?? raw.q ?? '').trim(),
      answer: String(raw.answer ?? raw.a ?? '').trim(),
      explanation: String(raw.explanation ?? raw.x ?? '').trim(),
      source: raw.source ?? 'authored',
      sourceVersion: raw.sourceVersion ?? today,
      verifiedAt: raw.verifiedAt ?? today,
      tags: [...new Set([...(raw.tags ?? []), 'authored', slug])],
      batch: raw.batch ?? batch,
    };
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid).push(record);
  });
  if (problems.length) {
    bad(`${problems.length} problem(s) in the authored file`);
    problems.slice(0, 10).forEach((p) => console.log('   · ' + p));
    process.exit(1);
  }

  const nextIndex = nextTypeIndex;

  const banks = new Map();
  for (const sid of bySection.keys()) {
    if (!bankExists(sid)) { bad(`${sid}: no bank yet — run: npm run questions:seed`); process.exit(1); }
    banks.set(sid, loadBank(sid));
  }
  let added = 0, skipped = 0;
  const staged = new Map();
  for (const [sid, records] of bySection) {
    const bank = banks.get(sid);
    const counter = new Map();
    const withIds = records.map((r) => {
      const key = r.type;
      if (!counter.has(key)) counter.set(key, nextIndex(bank, key));
      const idx = counter.get(key);
      counter.set(key, idx + 1);
      return { ...r, id: `${sid}:${key}:${idx}` };
    });
    // mergeIntoBank skips duplicate ids AND duplicate question text, so re-running is a no-op.
    const res = mergeIntoBank(bank, withIds, sid);
    added += res.added.length;
    skipped += res.skipped.byId + res.skipped.byText;
    staged.set(sid, res.added.length);
  }

  let failures = 0;
  for (const [sid, bank] of banks) {
    const { problems: p } = validateBank(bank);
    if (!p.length) continue;
    bad(`${sid}: ${p.length} validation problem(s) after merge`);
    p.slice(0, 6).forEach((x) => console.log('   · ' + x));
    failures += p.length;
  }
  if (failures) { bad('nothing written — the file would break the bank'); process.exit(1); }

  for (const [sid, bank] of banks) if (staged.get(sid)) saveBank(bank);
  const m = writeManifest();
  ok(`${slug}: +${added} item(s) merged across ${[...staged].filter(([, n]) => n).length} bank(s) · batch ${batch}${skipped ? ` (${skipped} already present, skipped)` : ''}`);
  console.log(`   manifest: ${m.total} total / ${m.published} published`);
  for (const [sid, n] of staged) if (n) console.log(`   · ${sid}: +${n}`);
}

function cmdExpand() {
  const sid = arg('topic') || arg('section');
  const file = arg('file');
  if (!sid || !file) { bad('usage: npm run questions:expand -- --section=s01 --file=new-questions.json'); process.exit(2); }
  const section = loadSections().find((s) => s.id === sid);
  if (!section && !bankExists(sid)) { bad(`unknown section "${sid}"`); process.exit(2); }
  const bank = bankExists(sid) ? loadBank(sid) : seedBank(section).bank;
  const incoming = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(incoming) ? incoming : incoming.questions;
  const { added, skipped, byStatus } = mergeIntoBank(bank, items, sid);
  const { problems } = validateBank(bank);
  if (problems.length) { bad(`validation failed after merge: ${problems.length} problem(s)`); problems.slice(0, 8).forEach((p) => console.log('   · ' + p)); process.exit(1); }
  saveBank(bank);
  writeManifest();
  const skippedDupes = skipped.byId + skipped.byText;
  const statuses = Object.entries(byStatus).map(([k, v]) => `${v} ${k}`).join(', ') || 'nothing';
  ok(`${sid}: +${added.length} question(s) added (${statuses})${skippedDupes ? `, ${skippedDupes} duplicate(s) skipped` : ''}. DRAFT entries stay out of the learner UI until PUBLISHED.`);
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

/* ======================= absorb the section's own Q&A ======================= */

/**
 * `sections.json` carries ~25 extracted Q&A items per section in the buckets the lesson renders
 * itself. 502 of the 736 are verbatim copies of that section's bank items — the lesson panel
 * skips those at render time, because the bucket copy carries the gate key — but 234 exist ONLY
 * there, and `tools/extract.mjs` REGENERATES sections.json from the PDF. So a re-extract would
 * delete them.
 *
 * This pass appends exactly those items to their own section's bank, which makes the bank the
 * complete question set for a section and gives every extracted question a permanent home.
 *
 * Honesty rules match the seeder: a question under 8 characters, or one without an answer, is
 * skipped and counted — never invented. Re-running is a no-op (duplicate text is skipped), no
 * existing id moves, and nothing is written unless every affected bank still validates.
 *
 *   node scripts/questions.cjs absorb            # dry run: show what would be added
 *   node scripts/questions.cjs absorb --write    # apply + rewrite the manifest
 */
function cmdAbsorb() {
  const WRITE = process.argv.includes('--write');
  const version = arg('version') || new Date().toISOString().slice(0, 10);
  const sections = arg('section') ? loadSections().filter((s) => s.id === arg('section')) : loadSections();
  if (!sections.length) { bad(`unknown section "${arg('section')}"`); process.exit(2); }

  console.log(`\n— Section Q&A absorb (${WRITE ? 'write' : 'dry run'}) —\n`);

  const banks = new Map();
  const rows = [];
  const totals = { added: 0, byType: {}, tooShort: 0, missingAnswer: 0, alreadyInBank: 0, otherSection: 0 };

  // A question text may live in exactly ONE bank — `questions.test.cjs` enforces that globally.
  // A build step must never be able to write a state its own test rejects, so the whole pack is
  // indexed up front and anything already owned elsewhere is left where it is (its own stage still
  // renders it). Measured: 0 of the current candidates collide, so this is a guard, not a filter.
  const ownerOfText = new Map();
  for (const sid of existingBankIds()) {
    for (const q of loadBank(sid).questions) {
      const k = textKey(q.question);
      if (!ownerOfText.has(k)) ownerOfText.set(k, sid);
    }
  }

  for (const section of sections) {
    if (!bankExists(section.id)) { warn(`${section.id}: no bank — run: npm run questions:seed`); continue; }
    const bank = loadBank(section.id);
    const known = new Set(bank.questions.map((q) => textKey(q.question)));
    const counters = new Map();
    const records = [];
    const local = { tooShort: 0, missingAnswer: 0, alreadyInBank: 0, otherSection: 0 };

    for (const b of BUCKETS) {
      for (const it of (section[b.key] ?? [])) {
        // The Debug stage renders its own tasks from `sec.coding`; the bank's `debug` type holds
        // different material, so absorbing these would put one question in two stages at once.
        if (it.difficulty === 'debug') continue;
        const question = String(b.q(it) ?? '').trim();
        const answer = String(b.a(it) ?? '').trim();
        if (question.length < 8) { local.tooShort++; continue; }
        if (answer.length < 2) { local.missingAnswer++; continue; }
        const key = textKey(question);
        // Against EVERY type, not just its own: the bank rejects a repeated question text
        // anywhere inside one file, so a cross-type repeat would break the pack.
        if (known.has(key)) { local.alreadyInBank++; continue; }
        const owner = ownerOfText.get(key);
        if (owner && owner !== section.id) { local.otherSection++; continue; }
        known.add(key);
        ownerOfText.set(key, section.id);
        if (!counters.has(b.type)) counters.set(b.type, nextTypeIndex(bank, b.type));
        const idx = counters.get(b.type);
        counters.set(b.type, idx + 1);
        const note = String(b.note(it) ?? '').trim();
        records.push({
          id: `${section.id}:${b.type}:${idx}`,
          sectionId: section.id,
          type: b.type,
          difficulty: bucketDifficulty(it.difficulty),
          importance: 'high_value',
          priority: 'P1',
          status: 'PUBLISHED',
          question,
          answer,
          // A drill carries no written explanation; state the method instead of inventing one.
          explanation: note || b.fallback,
          source: 'authored',
          sourceVersion: version,
          verifiedAt: version,
          tags: ['section-qna'],
        });
      }
    }

    if (!records.length) {
      totals.tooShort += local.tooShort; totals.missingAnswer += local.missingAnswer;
      totals.alreadyInBank += local.alreadyInBank; totals.otherSection += local.otherSection;
      continue;
    }

    const { added, skipped } = mergeIntoBank(bank, records, section.id);
    // mergeIntoBank's own duplicate guard is the second net: anything it refused is already there.
    local.alreadyInBank += skipped.byId + skipped.byText;
    const counts = added.reduce((acc, q) => { acc[q.type] = (acc[q.type] ?? 0) + 1; return acc; }, {});
    for (const [t, n] of Object.entries(counts)) totals.byType[t] = (totals.byType[t] ?? 0) + n;
    totals.added += added.length;
    totals.tooShort += local.tooShort; totals.missingAnswer += local.missingAnswer;
    totals.alreadyInBank += local.alreadyInBank; totals.otherSection += local.otherSection;
    rows.push({ section, bank, added: added.length, counts, local });
    banks.set(section.id, bank);
  }

  const pad = (v, n) => String(v).padEnd(n);
  console.log(`${pad('SECTION', 9)}${pad('TOPIC', 34)}${pad('NEW', 5)}PER TYPE`);
  for (const r of rows) {
    const byType = Object.entries(r.counts).map(([t, n]) => `${t}:${n}`).join(' ');
    console.log(`${pad(r.section.id, 9)}${pad(String(r.section.title).slice(0, 32), 34)}${pad(r.added, 5)}${byType}`);
    if (WRITE) saveBank(r.bank);
  }
  console.log('-'.repeat(80));
  console.log(`${pad('TOTAL', 9)}${pad(`${rows.length} bank(s) changed`, 34)}${pad(totals.added, 5)}${Object.entries(totals.byType).map(([t, n]) => `${t}:${n}`).join(' ')}`);
  console.log(`\nAlready in their section's bank (skipped): ${totals.alreadyInBank}`);
  console.log(`Skipped as unusable: ${totals.tooShort} too short, ${totals.missingAnswer} without an answer`);
  if (totals.otherSection) console.log(`Left in place (the text already belongs to another bank): ${totals.otherSection}`);

  if (!rows.length) { ok(totals.added ? 'nothing to do' : 'every extracted question already lives in its own section\'s bank'); return; }

  // Validate the whole affected set before anything hits disk — a half-absorbed pack is worse
  // than an unabsorbed one, and the id/text rules are exactly what this pass can break.
  const failures = [];
  for (const [sid, bank] of banks) {
    const { problems } = validateBank(bank);
    for (const p of problems) failures.push(`${sid}: ${p}`);
  }
  if (failures.length) {
    bad(`${failures.length} validation problem(s) — nothing written`);
    failures.slice(0, 10).forEach((p) => console.log('   · ' + p));
    process.exit(1);
  }
  if (!WRITE) {
    console.log('\nDry run — nothing written. Apply with: npm run questions:absorb -- --write');
    return;
  }
  const m = writeManifest();
  ok(`absorbed ${totals.added} section Q&A item(s) into ${rows.length} bank(s) · manifest: ${m.total} total / ${m.published} published`);
}

/* ==================== the V15 playbook (a second source) ==================== */

/**
 * `npm run questions:playbook` merges the file `scripts/playbook.cjs` produces into the per-section
 * banks. That script owns the PARSING (what the document says); this command owns the LANDING
 * (which bank an item ends up in), so a parser change can never silently rewrite the app's data.
 *
 * Same house rules as the absorb pass, because they are the rules the tests enforce:
 *  · a question text may live in exactly ONE bank — every bank's text is indexed up front and an
 *    item whose text already belongs somewhere else is dropped, not duplicated;
 *  · a question under 8 characters or one without an answer is skipped and counted, never invented;
 *  · ids are appended at the end of their type, so no learner key (`qb:<id>`) can move;
 *  · re-running is a no-op;
 *  · the affected banks are validated AS A SET before anything is written.
 *
 *   node scripts/questions.cjs playbook             # dry run
 *   node scripts/questions.cjs playbook --write      # apply + rewrite the manifest
 *
 * The manifest's count fields (totals and per-chapter) are re-derived from the banks in the write
 * pass, so a question this import refuses can never leave a count the learner cannot fill.
 */
function cmdPlaybook() {
  const WRITE = process.argv.includes('--write');
  const file = arg('file') || 'content/questions/expansion/playbook-v15.json';
  const version = arg('version') || 'playbook-v15';
  if (!fs.existsSync(file)) {
    bad(`missing ${file} — build it first: node scripts/playbook.cjs --pdf="<path-to-V15.pdf>" --write`);
    process.exit(2);
  }
  const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
  const items = Array.isArray(pack) ? pack : (pack.items ?? []);
  if (!items.length) { bad(`${file} carries no items`); process.exit(2); }

  console.log(`\n— Playbook V15 import (${WRITE ? 'write' : 'dry run'}) —\n`);
  console.log(`  file     : ${file}`);
  console.log(`  items    : ${items.length}${pack.source ? `  ${pack.source}` : ''}`);

  // One text, one bank — indexed across EVERY bank before anything is considered.
  const ownerOfText = new Map();
  for (const sid of existingBankIds()) {
    for (const q of loadBank(sid).questions) {
      const k = textKey(q.question);
      if (!ownerOfText.has(k)) ownerOfText.set(k, sid);
    }
  }

  const bySection = new Map();
  const dropped = { tooShort: 0, missingAnswer: 0, ownBank: 0, otherBank: 0, unknownType: 0 };
  for (const it of items) {
    const sid = String(it.sectionId ?? '').trim();
    const question = String(it.question ?? '').trim();
    const answer = String(it.answer ?? '').trim();
    if (!sid) { dropped.unknownType++; continue; }
    if (question.length < 8) { dropped.tooShort++; continue; }
    if (answer.length < 2) { dropped.missingAnswer++; continue; }
    if (!TYPE_ALIAS[String(it.type ?? '').toLowerCase()]) { dropped.unknownType++; continue; }
    const key = textKey(question);
    const owner = ownerOfText.get(key);
    if (owner === sid) { dropped.ownBank++; continue; }
    if (owner) { dropped.otherBank++; continue; }
    ownerOfText.set(key, sid);
    if (!bySection.has(sid)) bySection.set(sid, []);
    bySection.get(sid).push({ ...it, question, answer });
  }

  const today = new Date().toISOString().slice(0, 10);
  const banks = new Map();
  const rows = [];
  const totals = { added: 0, byType: {} };
  for (const [sid, list] of [...bySection.entries()].sort()) {
    if (!bankExists(sid)) { warn(`${sid}: no bank — run: npm run questions:seed`); continue; }
    const bank = loadBank(sid);
    const known = new Set(bank.questions.map((q) => textKey(q.question)));
    const counters = new Map();
    const records = [];
    for (const it of list) {
      const key = textKey(it.question);
      if (known.has(key)) { dropped.ownBank++; continue; }
      known.add(key);
      const type = TYPE_ALIAS[String(it.type).toLowerCase()];
      const importance = PRIORITY_OF[it.importance] ? it.importance : 'high_value';
      if (!counters.has(type)) counters.set(type, nextTypeIndex(bank, type));
      const idx = counters.get(type);
      counters.set(type, idx + 1);
      records.push({
        id: `${sid}:${type}:${idx}`,
        sectionId: sid,
        type,
        difficulty: ['easy', 'medium', 'hard', 'expert'].includes(it.difficulty) ? it.difficulty : 'medium',
        importance,
        priority: PRIORITY_OF[importance],
        status: 'PUBLISHED',
        question: it.question,
        answer: it.answer,
        explanation: String(it.explanation ?? '').trim() || 'Playbook ke related section se verify karo.',
        // The bank's own provenance fields. `sourceVersion` names the document; the `pb:<chapter>`
        // tag on every item is what the Playbook page and the bank's filter chip read back.
        source: 'authored',
        sourceVersion: version,
        verifiedAt: today,
        tags: [...new Set([...(it.tags ?? []), 'playbook'])],
      });
    }
    if (!records.length) continue;
    const { added, skipped } = mergeIntoBank(bank, records, sid);
    dropped.ownBank += skipped.byId + skipped.byText;
    const counts = added.reduce((acc, q) => { acc[q.type] = (acc[q.type] ?? 0) + 1; return acc; }, {});
    for (const [t, n] of Object.entries(counts)) totals.byType[t] = (totals.byType[t] ?? 0) + n;
    totals.added += added.length;
    banks.set(sid, bank);
    rows.push({ sid, bank, added: added.length, counts });
  }

  const pad = (v, n) => String(v).padEnd(n);
  const sections = loadSections();
  console.log('');
  console.log(`${pad('SECTION', 9)}${pad('TOPIC', 34)}${pad('NEW', 5)}PER TYPE`);
  for (const r of rows) {
    const s = sections.find((x) => x.id === r.sid);
    console.log(`${pad(r.sid, 9)}${pad(String(s ? s.title : '??').slice(0, 32), 34)}${pad(r.added, 5)}${Object.entries(r.counts).map(([t, n]) => `${t}:${n}`).join(' ')}`);
  }
  console.log('-'.repeat(80));
  console.log(`${pad('TOTAL', 9)}${pad(`${rows.length} bank(s)`, 34)}${pad(totals.added, 5)}${Object.entries(totals.byType).map(([t, n]) => `${t}:${n}`).join(' ')}`);
  console.log(`\nAlready present (skipped): ${dropped.ownBank}`);
  if (dropped.otherBank) console.log(`Dropped — the text already belongs to another bank: ${dropped.otherBank}`);
  console.log(`Skipped as unusable: ${dropped.tooShort} too short, ${dropped.missingAnswer} without an answer, ${dropped.unknownType} with an unknown type`);

  if (!rows.length) {
    ok('nothing to do — every playbook item already lives in its section');
    // The derived view is still (re)written: it is a view of the BANKS, so re-running this command
    // must be able to repair it even when the merge itself has nothing left to add.
    if (WRITE) ok(`playbook view → public/generated/playbook/items.json (${writePlaybookView(version)} item(s), derived from the banks)`);
    return;
  }

  const failures = [];
  for (const [sid, bank] of banks) {
    const { problems } = validateBank(bank);
    for (const p of problems) failures.push(`${sid}: ${p}`);
  }
  if (failures.length) {
    bad(`${failures.length} validation problem(s) — nothing written`);
    failures.slice(0, 10).forEach((p) => console.log('   · ' + p));
    process.exit(1);
  }
  if (!WRITE) {
    console.log('\nDry run — nothing written. Apply with: npm run questions:playbook -- --write');
    return;
  }
  for (const [, bank] of banks) saveBank(bank);
  const m = writeManifest();
  ok(`imported ${totals.added} playbook item(s) into ${rows.length} bank(s) · manifest: ${m.total} total / ${m.published} published`);
  const n = writePlaybookView(version);
  ok(`playbook view → public/generated/playbook/items.json (${n} item(s), derived from the banks)`);
}

/**
 * A compact, DERIVED view of everything the playbook contributed, for the pages that must not pull
 * all 11 MB of banks (Interview Mode's "Playbook V15" source reads this one file).
 *
 * Read back out of the banks AFTER the merge — never from the expansion file — so it cannot
 * disagree with what the learner can actually practise, and rewritten by the same command that
 * writes those banks. `selfGrade` marks the document's own method lines ("answer verbally first…"):
 * those are rubrics, not model answers, so a keyword score against them would be noise.
 *
 * The manifest's own count fields are re-derived from this list in the same pass
 * (syncPlaybookManifest), so the parse and the banks cannot drift apart either.
 */
function writePlaybookView(version) {
  const items = [];
  for (const sid of existingBankIds().sort()) {
    const bank = loadBank(sid);
    for (const q of bank.questions) {
      const tags = q.tags ?? [];
      if (!tags.includes('playbook')) continue;
      items.push({
        id: q.id,
        sectionId: sid,
        sectionTitle: bank.title ?? '',
        type: q.type,
        difficulty: q.difficulty,
        chapter: String(tags.find((t) => /^pb:\d+$/.test(t)) ?? '').replace('pb:', ''),
        question: q.question,
        answer: q.answer,
        selfGrade: tags.includes('method-answer'),
      });
    }
  }
  const file = path.join('public', 'generated', 'playbook', 'items.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), sourceVersion: version, count: items.length, items }, null, 1));
  if (syncPlaybookManifest(items)) ok('playbook manifest → public/generated/playbook/manifest.json (counts re-derived from the banks, so both artifacts agree)');
  return items.length;
}

/**
 * The manifest's count fields were parsed from the DOCUMENT (`scripts/playbook.cjs`); the view is
 * the BANKS' truth. The import refuses a question whose text another bank already owns, so the two
 * can legitimately disagree — and when they do, everything that subtracts or divides them prints a
 * target the learner can never reach (`npm run courses` warns about exactly this). Re-derive every
 * count from the items just written, keeping the manifest's own key order and the fields only the
 * parse knows (generatedAt, source, pages, labs, mini projects, method answers). Returns true only
 * when a count really changed, so the file's bytes survive untouched otherwise.
 */
function syncPlaybookManifest(items) {
  const file = path.join('public', 'generated', 'playbook', 'manifest.json');
  if (!fs.existsSync(file)) return false;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = JSON.stringify(manifest, null, 1);

  /** Tally `rows` by `key`, keeping the manifest's own key order; a key that falls to zero is dropped. */
  const retally = (prev, rows, key) => {
    const counts = new Map();
    for (const r of rows) counts.set(r[key], (counts.get(r[key]) ?? 0) + 1);
    const out = {};
    for (const k of Object.keys(prev ?? {})) if (counts.has(k)) out[k] = counts.get(k);
    for (const [k, n] of counts) if (!(k in out)) out[k] = n;
    return out;
  };

  manifest.totals.items = items.length;
  manifest.totals.byType = retally(manifest.totals.byType, items, 'type');
  manifest.totals.bySection = retally(manifest.totals.bySection, items, 'sectionId');
  for (const ch of manifest.chapters ?? []) {
    const own = items.filter((it) => it.chapter === ch.no);
    ch.sections = retally(ch.sections, own, 'sectionId');
    ch.byType = retally(ch.byType, own, 'type');
    ch.items = own.length;
    // Same rule as the parse: the chapter's own section is its biggest recipient.
    const [top] = Object.entries(ch.sections).sort((a, b) => b[1] - a[1])[0] ?? [];
    if (top) ch.sectionId = top;
  }

  const after = JSON.stringify(manifest, null, 1);
  if (after === before) return false;
  fs.writeFileSync(file, after);
  return true;
}

const cmd = process.argv[2];
const commands = { seed: cmdSeed, validate: cmdValidate, report: cmdReport, coverage: cmdCoverage, duplicates: cmdDuplicates, expand: cmdExpand, 'expand-track': cmdExpandTrack, quota: cmdQuota, import: cmdImport, export: cmdExport, manifest: cmdManifest, absorb: cmdAbsorb, playbook: cmdPlaybook };

/**
 * Commands that can rewrite a bank file, and therefore invalidate the derived search index.
 *
 * The index is a view of the banks (scripts/searchindex.cjs). Refreshing it here — in the one place
 * that knows a bank was just written — is what keeps Ctrl+K from offering a question the banks no
 * longer contain, or hiding one they just gained. `export`/`report`/`validate` read only.
 */
const WRITES_BANKS = new Set(['seed', 'expand', 'expand-track', 'import', 'absorb', 'playbook']);

if (commands[cmd]) {
  commands[cmd]();
  if (WRITES_BANKS.has(cmd) && process.argv.includes('--write') && !process.exitCode) {
    const index = writeSearchIndex();
    ok(`search index → public/generated/search/index.json (${index.counts.items} questions searchable)`);
  }
} else {  console.error('usage: node scripts/questions.cjs seed|validate|report|coverage|duplicates|expand|expand-track|quota|import|export|manifest|absorb|playbook [--options]'); process.exit(2); }
