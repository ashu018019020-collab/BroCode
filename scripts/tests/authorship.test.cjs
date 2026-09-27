/**
 * Authorship invariants — the "1,280 authored items + guide layer" pass, locked as tests.
 *
 * These are not style checks: they are the honesty gates for hand-written content.
 *   · every authored item must carry provenance (source/sourceVersion/verifiedAt/batch);
 *   · the quota must hold exactly (8 tracks x 8 types x 20 = 1,280), derived from the
 *     records themselves rather than from a separate table that could drift;
 *   · `defense` must be a real first-class type, not a label glued onto interview items;
 *   · every authored guide must be complete, and every runnable example must be marked
 *     verified:true/false — no example is allowed to pretend it ran when it did not;
 *   · every required topic in content/curriculum/topics must reach a guide.
 *
 * Zero dependencies — built-in node:test runner. `npm test`
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const QUESTIONS_DIR = path.join(ROOT, 'public', 'questions');
const TOPICS_DIR = path.join(ROOT, 'content', 'curriculum', 'topics');
const SECTIONS_JSON = path.join(ROOT, 'public', 'curriculum', 'sections.json');

const { TYPES, validateBank } = require('../lib/validate.cjs');

const QUOTA_PER_TYPE = 20;
const TRACK_COUNT = 8;
const AUTHORED_TOTAL = QUOTA_PER_TYPE * TYPES.length * TRACK_COUNT; // 1,280

const bankFiles = fs.readdirSync(QUESTIONS_DIR).filter((f) => /^s\d+\.json$/.test(f)).sort();
const bankIds = bankFiles.map((f) => f.replace(/\.json$/, ''));
const items = () => bankIds.flatMap((sid) => JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, `${sid}.json`), 'utf8')).questions.map((q) => ({ ...q, sectionId: q.sectionId ?? sid })));

const isoDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/.test(v);

/* --------------------------- defense as a type --------------------------- */

test('authored: defense is a first-class question type', () => {
  assert.ok(TYPES.includes('defense'), 'defense must be in the validator TYPES list');
  // A defense record must pass the same validation as every other type.
  const rec = (over = {}) => ({
    id: 's29:defense:0', sectionId: 's29', type: 'defense', difficulty: 'medium',
    importance: 'high_value', priority: 'P1', status: 'PUBLISHED',
    question: 'System kitna scale karega — 60 second answer do?', answer: 'Bottleneck + plan ke saath, numbers me.',
    explanation: 'numbers', tip: '', tags: [], source: 'authored', sourceVersion: '2026-09-24',
    verifiedAt: '2026-09-24', createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z',
    ...over,
  });
  const bank = (questions) => ({ sectionId: 's29', title: 'Resume Project Interview Labs', questions });
  const problems = validateBank(bank([rec()])).problems;
  assert.deepEqual(problems, [], `defense record must validate cleanly: ${problems.join('; ')}`);
  assert.ok(validateBank(bank([rec({ type: 'nonsense' })])).problems.length > 0,
    'an unknown type must still be rejected');
});

test('authored: every bank record uses a known type', () => {
  const bad = [];
  for (const it of items()) if (!TYPES.includes(it.type)) bad.push(`${it.sectionId} ${it.id}: ${it.type}`);
  assert.deepEqual(bad, []);
});

/* ------------------------------- the quota ------------------------------- */

test('authored: exactly 1,280 items = 8 batches x 8 types x 20', () => {
  const batches = new Map();
  for (const it of items()) {
    // Only this pass's batches. `source: 'authored'` is older than the guided pack — the
    // pre-existing hand-written exports carry it too, so the batch id is the scoping key.
    if (!String(it.batch ?? '').startsWith('track:')) continue;
    const key = it.batch;
    assert.ok(key, `${it.sectionId} ${it.id}: authored item without a batch id`);
    if (!batches.has(key)) batches.set(key, { total: 0, byType: {} });
    const b = batches.get(key);
    b.total++;
    b.byType[it.type] = (b.byType[it.type] ?? 0) + 1;
  }

  assert.equal(batches.size, TRACK_COUNT, `expected ${TRACK_COUNT} authored batches, got ${[...batches.keys()].join(', ')}`);

  const total = [...batches.values()].reduce((n, b) => n + b.total, 0);
  assert.equal(total, AUTHORED_TOTAL, `authored item total must be ${AUTHORED_TOTAL}`);

  for (const [batch, b] of batches) {
    assert.equal(b.total, QUOTA_PER_TYPE * TYPES.length, `${batch}: expected ${QUOTA_PER_TYPE * TYPES.length} items`);
    for (const type of TYPES) {
      assert.equal(b.byType[type] ?? 0, QUOTA_PER_TYPE, `${batch}: expected ${QUOTA_PER_TYPE} "${type}" items, got ${b.byType[type] ?? 0}`);
    }
    // Nothing outside the declared vocabulary may hide in a batch.
    const extra = Object.keys(b.byType).filter((t) => !TYPES.includes(t));
    assert.deepEqual(extra, [], `${batch}: unexpected types`);
  }
});

test('authored: every authored record carries provenance and a real id', () => {
  const problems = [];
  const tracks = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'tracks', 'index.json'), 'utf8')).map((t) => t.slug));

  for (const it of items()) {
    if (!String(it.batch ?? '').startsWith('track:')) continue;
    assert.equal(it.source, 'authored', `${it.id}: guided-pack item must be marked authored`);
    const at = `${it.sectionId} ${it.id}`;
    if (!/^s\d{2}:[a-z]+:\d+$/.test(it.id)) problems.push(`${at}: id shape`);
    if (!it.id.startsWith(`${it.sectionId}:`)) problems.push(`${at}: id/section mismatch`);
    if (it.id.split(':')[1] !== it.type) problems.push(`${at}: id segment "${it.id.split(':')[1]}" != type "${it.type}"`);
    if (!isoDate(it.sourceVersion)) problems.push(`${at}: sourceVersion is not an ISO date`);
    if (!isoDate(it.verifiedAt)) problems.push(`${at}: verifiedAt is not an ISO date`);
    const tags = Array.isArray(it.tags) ? it.tags : [];
    if (!tags.includes('authored')) problems.push(`${at}: missing the "authored" tag`);
    const trackTag = tags.find((t) => tracks.has(t));
    if (!trackTag) problems.push(`${at}: no track tag (${tags.join(',')})`);
    if (it.batch && !String(it.batch).startsWith(`track:${trackTag}:`)) problems.push(`${at}: batch does not match track tag`);
  }
  assert.deepEqual(problems.slice(0, 12), [], `${problems.length} provenance problem(s)`);
});

/* -------------------------------- the guides ------------------------------- */

const sections = JSON.parse(fs.readFileSync(SECTIONS_JSON, 'utf8'));
const normTitle = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();
const guidedConcepts = sections.flatMap((s) => (s.learn?.concepts ?? []).filter((c) => c.guide).map((c) => ({ section: s.id, title: c.title, guide: c.guide })));

test('guides: every authored guide is complete and honestly labelled', () => {
  assert.ok(guidedConcepts.length >= 8, `expected at least one guide per track, found ${guidedConcepts.length}`);

  const strings = ['what', 'why', 'whereUsed', 'howItWorks', 'syntax', 'realWorld', 'miniChallenge', 'debugTask', 'interviewTip'];
  const lists = ['prereqs', 'commonMistakes', 'bestPractices', 'related', 'revision'];
  const problems = [];

  for (const { section, title, guide } of guidedConcepts) {
    const at = `${section}/${title}`;
    if (guide.authored !== true) problems.push(`${at}: authored flag missing`);
    for (const k of strings) if (!String(guide[k] ?? '').trim()) problems.push(`${at}: ${k} empty`);
    for (const k of lists) if (!Array.isArray(guide[k]) || !guide[k].length) problems.push(`${at}: ${k} empty`);
    if (!Array.isArray(guide.practice) || !guide.practice.length) problems.push(`${at}: practice missing`);
    for (const p of guide.practice ?? []) if (!p.text || !p.difficulty) problems.push(`${at}: practice entry incomplete`);
    if (!Array.isArray(guide.interview) || !guide.interview.length) problems.push(`${at}: interview Q&A missing`);
    for (const iq of guide.interview ?? []) if (!iq.q || !iq.a) problems.push(`${at}: interview entry incomplete`);
    if (!Array.isArray(guide.howToCode) || !guide.howToCode.length) problems.push(`${at}: howToCode missing`);
    for (const h of guide.howToCode ?? []) if (!h.step || !h.detail) problems.push(`${at}: step entry incomplete`);

    if (!Array.isArray(guide.examples) || !guide.examples.length) { problems.push(`${at}: no examples`); continue; }
    for (const ex of guide.examples) {
      if (!['basic', 'intermediate', 'advanced'].includes(ex.level)) problems.push(`${at}: bad example level "${ex.level}"`);
      if (!String(ex.code ?? '').trim()) problems.push(`${at}: example without code`);
      if (!Array.isArray(ex.explain) || !ex.explain.length) problems.push(`${at}: example without line-by-line explanation`);
      if (!String(ex.output ?? '').trim()) problems.push(`${at}: example without output`);
      if (typeof ex.verified !== 'boolean') problems.push(`${at}: example verified flag must be boolean`);
    }
    // An unverified example must be honest about why: it needs a bundle, not a run.
    for (const ex of guide.examples.filter((e) => e.verified === false)) {
      if (!/import\s+\w+|from\s+\w+\s+import/.test(ex.code)) problems.push(`${at}: unverified example without a third-party import`);
    }
  }
  assert.deepEqual(problems.slice(0, 12), [], `${problems.length} guide problem(s)`);
});

test('guides: the batch did not carry local machine paths or shell output into the lessons', () => {
  const leaks = [];
  for (const { section, guide } of guidedConcepts) {
    const text = JSON.stringify(guide);
    if (/[A-Z]:\\\\|\/tmp\/|\/home\/|C:\\\\Users/.test(text)) leaks.push(`${section}: absolute path in guide`);
    if (/Traceback \(most recent call last\)/.test(text)) leaks.push(`${section}: traceback leaked into a guide`);
  }
  assert.deepEqual(leaks, []);
});

test('guides: every required topic reaches an authored guide', () => {
  assert.ok(fs.existsSync(TOPICS_DIR), 'content/curriculum/topics must exist');
  const reqs = fs.readdirSync(TOPICS_DIR).filter((f) => f.endsWith('.json'));
  assert.equal(reqs.length, TRACK_COUNT, `expected ${TRACK_COUNT} required-topic files`);

  const problems = [];
  for (const f of reqs) {
    const req = JSON.parse(fs.readFileSync(path.join(TOPICS_DIR, f), 'utf8'));
    const range = req.sectionRange ?? {};
    const pool = sections.filter((s) => (!range.from || s.no >= range.from) && (!range.to || s.no <= range.to));
    const titles = pool.flatMap((s) => (s.learn?.concepts ?? []).map((c) => normTitle(c.title)));
    const guided = new Set(pool.flatMap((s) => (s.learn?.concepts ?? []).filter((c) => c.guide).map((c) => normTitle(c.title))));
    const topics = req.topics ?? [];
    if (!topics.length) problems.push(`${req.track}: no required topics listed`);

    for (const topic of topics) {
      const want = normTitle(topic);
      const match = titles.find((t) => t === want || t.includes(want) || want.includes(t));
      if (!match) { problems.push(`${req.track}: "${topic}" has no lesson`); continue; }
      if (!guided.has(match)) problems.push(`${req.track}: "${topic}" has no authored guide`);
    }
  }
  assert.deepEqual(problems, []);
});
