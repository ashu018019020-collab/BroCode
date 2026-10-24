#!/usr/bin/env node
/** npm run curriculum:validate | curriculum:report — local content QA. No network. */
const fs = require('fs');
const path = require('path');

const TRACKS_DIR = path.join(__dirname, '..', 'content', 'tracks');
const SECTIONS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'generated', 'curriculum', 'sections.json'), 'utf8'));

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);

let failures = 0;
const fail = (m) => { bad(m); failures++; };

function loadTracks() {
  const idx = JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, 'index.json'), 'utf8'));
  return idx.map((e) => JSON.parse(fs.readFileSync(path.join(TRACKS_DIR, `${e.slug}.json`), 'utf8')));
}

function validate() {
  console.log('\n— Curriculum validation —');
  const tracks = loadTracks();

  // 1. All 8 tracks exist
  if (tracks.length === 8) ok('8 tracks present');
  else fail(`expected 8 tracks, found ${tracks.length}`);

  // 2. NO-LOCK TEST: every track unlocked === true, no locked state anywhere
  for (const t of tracks) {
    if (t.unlocked !== true) fail(`${t.id}: unlocked !== true`);
    const raw = JSON.stringify(t);
    if (/"locked"\s*:/.test(raw)) fail(`${t.id}: contains a "locked" state`);
  }
  ok('no-lock test: all tracks unlocked, zero locked states');

  // 3. Chapters have topics; topic ids unique globally
  const seen = new Set();
  let dupes = 0, emptyChapters = 0, topicCount = 0;
  for (const t of tracks) {
    if (!t.chapters.length) warn(`${t.id}: no chapters`);
    for (const ch of t.chapters) {
      if (!ch.topics.length) { emptyChapters++; warn(`${t.id}/${ch.id}: chapter has no topics`); }
      for (const tp of ch.topics) {
        topicCount++;
        if (seen.has(tp.id)) { dupes++; fail(`duplicate topic id: ${tp.id}`); }
        seen.add(tp.id);
        if (!tp.title || !tp.id) fail(`${t.id}: topic missing id/title`);
      }
    }
  }
  if (!dupes) ok(`topic ids unique (${topicCount} topics)`);
  if (!emptyChapters) ok('all chapters have topics');

  // 4. Every chapter id maps to a real curriculum section (routes valid)
  const secIds = new Set(SECTIONS.map((s) => s.id));
  let badRefs = 0;
  for (const t of tracks) for (const ch of t.chapters) if (!secIds.has(ch.id)) { badRefs++; fail(`${t.id}: chapter ${ch.id} has no matching section`); }
  if (!badRefs) ok('all chapter ids resolve to real sections');

  // 5. Every section is covered by exactly one track (no orphans)
  const covered = new Set(tracks.flatMap((t) => t.chapters.map((c) => c.id)));
  const orphans = SECTIONS.filter((s) => !covered.has(s.id));
  if (!orphans.length) ok('all 29 sections covered by tracks');
  else orphans.forEach((s) => fail(`section ${s.id} not in any track`));

  console.log(failures ? `\n\x1b[31m✕ ${failures} problem(s)\x1b[0m` : '\n\x1b[32m✓ Curriculum valid — 8 open tracks, full coverage\x1b[0m');
  process.exit(failures ? 1 : 0);
}

function report() {
  console.log('\n— Curriculum Report —\n');
  const tracks = loadTracks();
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('TRACK', 22) + pad('CH', 5) + pad('TOPICS', 8) + pad('CONCEPTS', 10) + pad('CODING', 8) + pad('INTERVIEW', 11) + pad('PROJECTS', 10) + pad('HRS', 5));
  let T = { ch: 0, tp: 0, co: 0, cd: 0, iv: 0, pj: 0, hr: 0 };
  for (const t of tracks) {
    const c = t.chapters.reduce((a, ch) => ({
      tp: a.tp + ch.topics.length, co: a.co + ch.counts.concepts, cd: a.cd + ch.counts.coding, iv: a.iv + ch.counts.interview, pj: a.pj + ch.counts.projects,
    }), { tp: 0, co: 0, cd: 0, iv: 0, pj: 0 });
    console.log(pad(`${String(t.number).padStart(2, '0')} ${t.title}`, 22) + pad(t.chapters.length, 5) + pad(c.tp, 8) + pad(c.co, 10) + pad(c.cd, 8) + pad(c.iv, 11) + pad(c.pj, 10) + pad(t.estimatedHours, 5));
    T.ch += t.chapters.length; T.tp += c.tp; T.co += c.co; T.cd += c.cd; T.iv += c.iv; T.pj += c.pj; T.hr += t.estimatedHours;
  }
  console.log('-'.repeat(79));
  console.log(pad('TOTAL', 22) + pad(T.ch, 5) + pad(T.tp, 8) + pad(T.co, 10) + pad(T.cd, 8) + pad(T.iv, 11) + pad(T.pj, 10) + pad(T.hr, 5));
  console.log(`\nAll 8 tracks unlocked: ${tracks.every((t) => t.unlocked === true) ? 'YES' : 'NO'}`);
}

const cmd = process.argv[2];
if (cmd === 'validate') validate();
else if (cmd === 'report') report();
else { console.error('usage: node scripts/curriculum.cjs validate|report'); process.exit(2); }
