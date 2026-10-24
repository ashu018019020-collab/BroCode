/**
 * Question-pipeline tests. Zero dependencies — uses the built-in node:test runner.
 *   npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { validateBank, coverageGate } = require('../lib/validate.cjs');
const {
  seedBank, mergeIntoBank, loadSections, existingBankIds, loadBank,
  QUESTIONS_DIR, MANIFEST_PATH, BASELINE_PER_SECTION, norm,
} = require('../lib/banks.cjs');

/** A tiny synthetic section — the seeder must never invent content for it. */
const section = (extra = {}) => ({
  id: 's99',
  title: 'Test Section',
  learn: { concepts: [{ title: 'C1' }, { title: 'C2' }] },
  interview: [],
  coding: [],
  logic: [],
  solved: [],
  checkpoint: [],
  ...extra,
});

const q = (question, answer, type = 'interview', more = {}) => ({ difficulty: 'medium', importance: 'must_know', question, answer, explanation: 'why', tags: [], ...more });

/**
 * The lesson stages that carry bank content, read from the single owner — `STAGE_QNA` in
 * src/core/data/questions.ts — rather than typed out here. `project` is deliberately absent: the PDF
 * has no project band, so Project Lab has no bank stage and the manifest must not grow one.
 */
const LESSON_STAGES = [...fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'core', 'data', 'questions.ts'), 'utf8')
  .matchAll(/^ {2}(\w+): \{ types: \[[^\]]+\](?:, tag: '[^']+')?, label:/gm)].map((m) => m[1]);
assert.ok(LESSON_STAGES.length >= 9, 'the lesson stage list must be readable from its own declaration');

/* ----------------------------- seeder honesty ----------------------------- */

test('seeder: keeps real content and numbers ids per type', () => {
  const { bank, count } = seedBank(section({
    interview: [{ q: 'Variable kya hota hai?', a: 'Naam ka object se binding.' }],
    coding: [{ difficulty: 'easy', text: 'Print hello world today', solution: '', check: '' }],
    logic: [{ kind: 'predict', text: 'x = 1 ka type?', answer: 'int' }],
  }));
  assert.equal(count, 3);
  assert.deepEqual(bank.questions.map((x) => x.id), ['s99:interview:0', 's99:coding:0', 's99:logic:0']);
  assert.ok(bank.questions.every((x) => x.source === 'curriculum'));
  assert.ok(bank.questions.every((x) => x.status === 'PUBLISHED'));
});

test('seeder: skips duplicate question text and enriches the placeholder answer', () => {
  const { bank, skipped } = seedBank(section({
    coding: [{ difficulty: 'medium', text: 'Swap do variables bina temp ke', solution: '', check: '' }],
    solved: [{ difficulty: 'medium', text: 'Swap do variables bina temp ke', solution: 'a, b = b, a', result: '5 9' }],
  }));
  assert.equal(skipped.duplicateText, 1);
  assert.equal(bank.questions.length, 1, 'duplicate text must not create a second record');
  assert.equal(bank.questions[0].answer, 'a, b = b, a', 'placeholder answer replaced by the real solution');
});

test('seeder: drops empty answers and too-short questions instead of inventing them', () => {
  const { bank, skipped } = seedBank(section({
    interview: [{ q: 'Valid question here?', a: 'Answer.' }],
    logic: [
      { kind: 'predict', text: 'Answer missing wala logic', answer: '' },
      { kind: 'why', text: 'ab', answer: 'short question text' },
    ],
    checkpoint: [{ q: 'Checkpoint without key', key: '   ' }],
  }));
  assert.equal(skipped.missingAnswer, 2, 'one empty logic answer + one empty checkpoint key');
  assert.equal(skipped.tooShort, 1);
  assert.equal(bank.questions.length, 1);
  assert.ok(bank.questions.every((x) => x.answer && x.answer.trim().length >= 2));
});

test('seeder is deterministic (same input → identical bank payload)', () => {
  const src = section({ interview: [{ q: 'Deterministic question?', a: 'Yes.' }] });
  const stamp = '2026-01-01T00:00:00.000Z';
  assert.deepEqual(seedBank(src, stamp).bank, seedBank(src, stamp).bank);
});

/* ------------------------------- validator ------------------------------- */

/** A valid record; tests override single fields to prove each rule bites. */
const rec = (over = {}) => ({
  id: 's99:interview:0', sectionId: 's99', type: 'interview', difficulty: 'medium',
  importance: 'must_know', priority: 'P0', status: 'PUBLISHED',
  question: 'A perfectly fine question?', answer: 'A perfectly fine answer.',
  explanation: 'because', source: 'curriculum', tags: [], ...over,
});

const bankOf = (questions) => ({ sectionId: 's99', title: 'T', contentVersion: '1.0.0', generatedAt: 'x', topics: [], questions, flags: [] });

test('validator: accepts a well-formed record', () => {
  assert.deepEqual(validateBank(bankOf([rec()])).problems, []);
});

test('validator: rejects bad enums and missing fields', () => {
  const cases = [
    [{ type: 'essay' }, 'bad type'],
    [{ difficulty: 'impossible' }, 'bad difficulty'],
    [{ importance: 'urgent' }, 'bad importance'],
    [{ priority: 'P9' }, 'bad priority'],
    [{ status: 'LIVE' }, 'bad status'],
    [{ question: 'short' }, 'question too short'],
    [{ answer: '' }, 'answer missing/empty'],
    [{ explanation: '' }, 'missing explanation'],
    [{ sectionId: 's01' }, 'sectionId mismatch'],
  ];
  for (const [over, label] of cases) {
    const { problems } = validateBank(bankOf([rec(over)]));
    assert.ok(problems.length > 0, `expected a problem for ${label}`);
  }
});

test('validator: catches duplicate ids and duplicate question text', () => {
  const dupId = validateBank(bankOf([rec(), rec({ question: 'Different question here?' })])).problems;
  assert.ok(dupId.some((p) => p.includes('duplicate id')), 'duplicate id must be reported');

  const renamed = rec({ id: 's99:interview:1' });
  const dupText = validateBank(bankOf([rec(), renamed])).problems;
  assert.ok(dupText.some((p) => p.includes('exact duplicate')), 'duplicate text must be reported');
});

test('validator: version-sensitive sources need provenance', () => {
  const { problems } = validateBank(bankOf([rec({ source: 'official-docs' })]));
  assert.ok(problems.some((p) => p.includes('sourceVersion')));
  const ok = validateBank(bankOf([rec({ source: 'official-docs', sourceVersion: '1.0.0', verifiedAt: '2026-09-24' })]));
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.stats.unverified, 0);
});

test('validator: stats are honest about unpublished records', () => {
  const { stats } = validateBank(bankOf([rec(), rec({ id: 's99:1', question: 'Second question here?', status: 'DRAFT' })]));
  assert.equal(stats.total, 2);
  assert.equal(stats.published, 1);
});

/* ----------------------------- coverage gate ----------------------------- */

test('coverageGate: below baseline is incomplete and flagged', () => {
  const bank = bankOf(Array.from({ length: 49 }, (_, i) => rec({ id: `s99:${i}`, question: `Question number ${i}?` })));
  const { stats } = validateBank(bank);
  const { flags, complete } = coverageGate(bank, stats);
  assert.equal(complete, false);
  assert.ok(flags.includes('CONTENT_INCOMPLETE'));
});

test('coverageGate: baseline with drafts still counts as incomplete', () => {
  const questions = Array.from({ length: 50 }, (_, i) => rec({ id: `s99:${i}`, question: `Question number ${i}?`, status: i === 0 ? 'DRAFT' : 'PUBLISHED' }));
  const bank = bankOf(questions);
  const { stats } = validateBank(bank);
  assert.equal(coverageGate(bank, stats).complete, false, 'a draft must not be counted as delivered content');
});

test('coverageGate: full published baseline is complete and unflagged', () => {
  const bank = bankOf(Array.from({ length: 50 }, (_, i) => rec({ id: `s99:${i}`, question: `Question number ${i}?` })));
  const { stats } = validateBank(bank);
  const { flags, complete } = coverageGate(bank, stats);
  assert.equal(complete, true);
  assert.deepEqual(flags, []);
});

/* --------------------------- merge / idempotency -------------------------- */

test('mergeIntoBank: skips duplicate ids and texts, keeps the originals untouched', () => {
  const bank = bankOf([rec()]);
  const before = JSON.parse(JSON.stringify(bank));
  const { added, skipped, byStatus } = mergeIntoBank(bank, [
    rec({ answer: 'OVERWRITE ATTEMPT' }),
    rec({ id: 's99:interview:1' }),
    rec({ id: 's99:interview:2', question: 'A genuinely new question?', status: 'PUBLISHED' }),
  ], 's99');
  assert.equal(skipped.byId, 1);
  assert.equal(skipped.byText, 1);
  assert.equal(added.length, 1);
  assert.deepEqual(byStatus, { PUBLISHED: 1 });
  assert.equal(bank.questions[0].answer, before.questions[0].answer, 'existing record must not be mutated');
  assert.equal(bank.questions.length, 2);
});

test('mergeIntoBank: applying the same import twice is a no-op', () => {
  const bank = bankOf([]);
  const items = [rec(), rec({ id: 's99:interview:1', question: 'Another question here?' })];
  mergeIntoBank(bank, items, 's99');
  const afterFirst = bank.questions.length;
  const second = mergeIntoBank(bank, items, 's99');
  assert.equal(second.added.length, 0);
  assert.equal(bank.questions.length, afterFirst);
});

/* --------------------------- real content pack --------------------------- */

const bankIds = existingBankIds();

test('content pack: every bank is schema-valid and matches its filename', () => {
  assert.ok(bankIds.length > 0, 'banks must be seeded (npm run questions:seed)');
  for (const sid of bankIds) {
    const bank = loadBank(sid);
    assert.equal(bank.sectionId, sid, `${sid}.json declares a different sectionId`);
    const { problems } = validateBank(bank);
    assert.deepEqual(problems, [], `${sid} has validation problems:\n${problems.slice(0, 5).join('\n')}`);
  }
});

test('content pack: every bank belongs to a real curriculum section', () => {
  const known = new Set(loadSections().map((s) => s.id));
  for (const sid of bankIds) assert.ok(known.has(sid), `${sid} is not a curriculum section`);
});

test('content pack: incomplete banks are flagged, complete ones are not (honesty invariant)', () => {
  for (const sid of bankIds) {
    const bank = loadBank(sid);
    const { stats } = validateBank(bank);
    const { flags, complete } = coverageGate(bank, stats);
    const flagged = flags.includes('CONTENT_INCOMPLETE') || (bank.flags ?? []).includes('CONTENT_INCOMPLETE');
    if (!complete) assert.ok(flagged, `${sid} is below baseline but not flagged CONTENT_INCOMPLETE`);
    if (complete) assert.equal(flagged, false, `${sid} meets the baseline but is still flagged`);
  }
});

test('content pack: no duplicate question text within a single bank', () => {
  for (const sid of bankIds) {
    const bank = loadBank(sid);
    const seen = new Map();
    for (const item of bank.questions) {
      const n = norm(item.question);
      assert.equal(seen.has(n), false, `${sid}: "${item.question}" repeats (${item.id} vs ${seen.get(n)})`);
      seen.set(n, item.id);
    }
  }
});

test('content pack: no question text repeats across banks (no boilerplate debt)', () => {
  const seen = new Map();            // normalized question -> "<sid> (<id>)"
  const offenders = [];
  for (const sid of bankIds) {
    for (const item of loadBank(sid).questions) {
      const n = norm(item.question);
      const where = `${sid} (${item.id})`;
      const prev = seen.get(n);
      if (prev && prev.split(' ')[0] !== sid) offenders.push(`"${item.question.slice(0, 70)}" → ${prev} and ${where}`);
      else if (!prev) seen.set(n, where);
    }
  }
  assert.deepEqual(offenders, [], `cross-section boilerplate (make it section-specific):\n${offenders.slice(0, 10).join('\n')}`);
});

test('norm: keeps operator symbols so distinct questions never collapse', () => {
  // Regression: a blanket [^a-z0-9] strip merged these two real questions into one key.
  assert.notEqual(norm('= aur == me fark?'), norm('/ aur // me fark?'));
  assert.notEqual(norm('7 // 2 kya deta hai?'), norm('7 / 2 kya deta hai?'));
  // Decorative punctuation is still ignored, so wrapper characters cannot hide a repeat.
  assert.equal(norm('`a = b` assignment'), norm('"a = b" assignment'));
  assert.equal(norm('Print(1),  phir  Print(2)'), norm('print(1) phir print(2)'));
  // And a genuine repeat still collides (the detector must keep working).
  assert.equal(norm('Same Question Here'), norm('same question here '));
});

/* ------------------------------- manifest ------------------------------- */

test('manifest: matches the banks on disk and never overstates coverage', () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'manifest.json must exist (npm run questions:manifest)');
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  assert.equal(manifest.sections.length, bankIds.length);

  let total = 0, published = 0;
  for (const entry of manifest.sections) {
    const bank = loadBank(entry.sectionId);
    const { stats } = validateBank(bank);
    assert.equal(entry.total, stats.total, `${entry.sectionId}: manifest total is stale`);
    assert.equal(entry.published, stats.published, `${entry.sectionId}: manifest published count is stale`);
    assert.ok(entry.published <= entry.total);

    // The lesson's per-stage counts read these two fields, so they must match the banks exactly —
    // a stale byStage would put a wrong number on a stage tile.
    let mini = 0;
    for (const q of bank.questions) if ((q.tags ?? []).includes('mini-project')) mini++;
    assert.equal(entry.miniProject, mini, `${entry.sectionId}: manifest miniProject is stale`);
    assert.ok(mini <= entry.byType.coding, `${entry.sectionId}: mini-project items are coding items`);

    // `byStage` is keyed by LESSON stage and counts what that stage's panel really shows, so it
    // must be checked against the lesson's own stage list, not a copy kept here. The two
    // rule-free properties are checked here: every stage is a real lesson stage, no stage is
    // over-counted, and the counts never exceed what is published. They legitimately fall SHORT
    // of `published`, because a stage skips the questions it renders itself — that deficit is
    // the one part that needs the rule, and lessonqna.test.mjs verifies it against the running
    // functions, where the TypeScript module can actually be executed.
    const stageKeys = Object.keys(entry.byStage ?? {});
    assert.deepEqual(stageKeys.sort(), LESSON_STAGES.slice().sort(), `${entry.sectionId}: byStage must be keyed by lesson stage`);
    let assigned = 0;
    for (const [st, n] of Object.entries(entry.byStage)) {
      assert.ok(Number.isInteger(n) && n >= 0, `${entry.sectionId}: byStage.${st} must be a count`);
      assert.ok(n <= entry.published, `${entry.sectionId}: byStage.${st} (${n}) cannot exceed published (${entry.published})`);
      assigned += n;
    }
    assert.ok(assigned <= entry.published,
      `${entry.sectionId}: stage counts (${assigned}) cannot exceed published (${entry.published})`);
    assert.equal(entry.byStage.mini, entry.miniProject, `${entry.sectionId}: the Mini Project stage is the tagged coding items`);

    total += entry.total;
    published += entry.published;
  }
  assert.equal(manifest.total, total);
  assert.equal(manifest.published, published);
  assert.equal(manifest.baseline, BASELINE_PER_SECTION);

  // Honest coverage claim: the manifest's own percentage must be computable from real numbers.
  const claims = manifest.sections.filter((s) => !s.flags.includes('CONTENT_INCOMPLETE'));
  for (const c of claims) assert.equal(c.published >= manifest.baseline, true, `${c.sectionId} claims complete below baseline`);
});

test('pipeline files live inside public/generated/questions', () => {
  assert.ok(fs.existsSync(QUESTIONS_DIR), 'questions directory must exist');
  assert.equal(fs.existsSync(`${QUESTIONS_DIR}/manifest.json`), true);
});
