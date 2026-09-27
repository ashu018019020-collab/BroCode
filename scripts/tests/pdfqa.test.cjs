/**
 * PDF Q&A import invariants — the V10 "Senior Visual Answer Edition" pass, locked as tests.
 *
 * These are not style checks; they are the honesty gates for the largest content import in
 * this project (13,582 PDF items → 10,890 bank records):
 *   · the band line (`HIGH  BASIC` and `AI ENGINEER CRITICAL  BASIC`) must never leak into
 *     a question — a mis-parse there would ship the page furniture as exam text;
 *   · curation may drop a repeated question but must never drop section coverage, and the
 *     question text it writes must stay globally unique (the content pack's own gate);
 *   · a highlight must mean something: the PDF's top band intersect its SENIOR tier, never
 *     the band alone (16 sections are labelled CRITICAL wholesale — 61% of the document);
 *   · imported records must carry provenance and must NOT carry a `batch` id, which the UI
 *     reads as "hand-written" and the authorship quota counts.
 *
 * Zero dependencies — built-in node:test runner. `npm test`
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  STAGES, STAGE_TO_TYPE, STAGE_TAG, BANDS, HIGHLIGHT_TAG, HIGHLIGHT_DIFFICULTIES,
  bandTokens, isBandLine, parseLayout, curate, conceptFor, buildVocabulary, topBandOf,
  cleanAnswer, disambiguate, isHighlighted, withIds, joinLines, tidyText,
} = require('../lib/pdfqa.cjs');
const { norm, TYPES } = require('../lib/validate.cjs');
const { mergeIntoBank } = require('../lib/banks.cjs');

const ROOT = path.join(__dirname, '..', '..');
const QUESTIONS_DIR = path.join(ROOT, 'public', 'questions');

/* ------------------------------ band parsing ------------------------------ */

test('pdfqa: reads both band layouts and never mistakes prose for a band line', () => {
  // Sections 01-12 and 25 print two cells; sections 13-24 and 26-29 print three.
  assert.deepEqual(bandTokens('HIGH  BASIC'), { pdfImportance: 'HIGH', pdfDifficulty: 'BASIC' });
  assert.deepEqual(bandTokens('CORE  SENIOR'), { pdfImportance: 'CORE', pdfDifficulty: 'SENIOR' });
  assert.deepEqual(bandTokens('AI ENGINEER CRITICAL  BASIC'), { pdfImportance: 'CRITICAL', pdfDifficulty: 'BASIC' });
  assert.deepEqual(bandTokens('CRITICAL  ADVANCED'), { pdfImportance: 'CRITICAL', pdfDifficulty: 'ADVANCED' });

  // Question prose says the level in lowercase, so it can never be read as a band.
  assert.equal(bandTokens('Explain: Type Casting ko senior level par explain karo aur ek AI/data use case batao.'), null);
  assert.equal(bandTokens('Answer: FALSE. Edge cases are part of correctness.'), null);
  assert.equal(bandTokens(''), null);
  assert.equal(isBandLine('Use: normalize karne ke liye.'), false);
});

/* -------------------------------- parsing -------------------------------- */

/** One synthetic page carrying a three-cell band, a split MINI PROJECT fragment and an impact line. */
const PAGE = [
  'AI ENGINEER MASTER LAB | V10 SENIOR VISUAL EDITION   SECTION 07 | for & while Loops',
  '',
  'Hinglish | 29 Sections | Answer + Code + Edge Case',
  '',
  '01 LEARN 02 INTERVIEW 03 CODING LAB 04 LOGIC  05 DEBUG 06 PRACTICE 07 MINI PROJECT 08 DEFENSE 09 CHECKPOINT',
  '',
  '07. MINI PROJECT',
  '',
  'Build & Apply | 52 answered items | Basic -> Intermediate -> Advanced -> Senior',
  '',
  'AI ENGINEER CRITICAL  BASIC',
  '',
  'Mini Project : Profile Data Card ka variant #2 build karo jisme Data Types core requirement ho.',
  'Input ->',
  '',
  'ANSWER / SOLUTION',
  '',
  'process -> output, one failure path aur done condition likho. Model build: Goal = X.',
  '',
  'HIGH  SENIOR',
  '',
  'Explain: Type Casting ko senior level par explain karo aur ek AI/data use case batao.',
  '',
  'ANSWER / SOLUTION',
  '',
  'Type Casting: value ko another compatible type me convert karna. Use: normalize ke liye.',
  '',
  'USE / IMPACT normalize karne ke liye.',
  '',
  'Learn -> Apply -> Practice -> Debug -> Interview -> Build -> Defend -> Master | S01 / 01   Page 87',
].join('\n');

test('pdfqa: parses a page into items with band, page and stage — furniture excluded', () => {
  const { items } = parseLayout(`${PAGE}\f`);
  assert.equal(items.length, 2);

  const [mini, learn] = items;
  assert.equal(mini.sid, 's07');
  assert.equal(mini.page, 1);
  assert.equal(mini.stage, 'MINI PROJECT');
  assert.deepEqual([mini.pdfImportance, mini.pdfDifficulty], ['CRITICAL', 'BASIC']);
  // The template splits the answer's first fragment above the ANSWER marker; it must be
  // handed back to the answer instead of being glued onto the question.
  assert.equal(mini.question, 'Mini Project : Profile Data Card ka variant #2 build karo jisme Data Types core requirement ho.');
  assert.ok(mini.answer.startsWith('Input -> process -> output, one failure path'), mini.answer);

  assert.equal(learn.stage, 'MINI PROJECT');
  assert.deepEqual([learn.pdfImportance, learn.pdfDifficulty], ['HIGH', 'SENIOR']);
  assert.equal(learn.question, 'Explain: Type Casting ko senior level par explain karo aur ek AI/data use case batao.');
  assert.equal(learn.answer, 'Type Casting: value ko another compatible type me convert karna. Use: normalize ke liye.');
  assert.equal(learn.impact, 'normalize karne ke liye.');

  // Page furniture must never reach a record.
  for (const it of items) {
    assert.doesNotMatch(it.question, /AI ENGINEER MASTER LAB|answered items|Page \d+|Learn -> Apply/);
    assert.doesNotMatch(it.answer, /answered items|Page \d+/);
  }
});

test('pdfqa: rejoins wrapped words and hyphenated breaks', () => {
  assert.equal(joinLines(['implement', 'karo.']), 'implement karo.');
  assert.equal(joinLines(['per-', 'formance task']), 'performance task');
  assert.equal(joinLines(['  spaced ', '', 'out  ']), 'spaced out');
});

/* ------------------------------- vocabulary ------------------------------- */

test('pdfqa: every PDF stage maps onto an existing bank type (no new type is ever added)', () => {
  assert.equal(STAGES.length, 9);
  assert.equal(Object.keys(STAGE_TO_TYPE).length, 9);
  for (const stage of STAGES) {
    assert.ok(TYPES.includes(STAGE_TO_TYPE[stage]), `${stage} maps to a valid bank type`);
  }
  // MINI PROJECT has no schema type of its own, so it reuses coding and is tagged.
  assert.equal(STAGE_TO_TYPE['MINI PROJECT'], 'coding');
  assert.equal(STAGE_TAG['MINI PROJECT'], 'mini-project');
});

/* --------------------------------- curated -------------------------------- */

const SECTIONS = [
  { id: 's01', no: 1, title: 'Variables & Data Types', learn: { concepts: [{ title: 'Naming Rules & Conventions' }] } },
  { id: 's02', no: 2, title: 'Operators', learn: { concepts: [] } },
];

const item = (over = {}) => ({
  sid: 's01',
  page: 8,
  stage: 'LEARN',
  pdfImportance: 'HIGH',
  pdfDifficulty: 'SENIOR',
  question: 'Explain: Type Casting ko senior level par explain karo aur ek AI/data use case batao.',
  answer: 'Type Casting: value ko another compatible type me convert karna. Use: normalize karne ke liye.',
  impact: 'normalize karne ke liye.',
  ...over,
});

test('pdfqa: a question repeated inside one section keeps its strongest variant only', () => {
  const weak = item({ pdfImportance: 'CORE', pdfDifficulty: 'BASIC', page: 9, answer: 'Type Casting: chhota jawab. Use: normalize karne ke liye.' });
  const strong = item({ pdfImportance: 'HIGH', pdfDifficulty: 'SENIOR', page: 8 });
  const { records, report } = curate([weak, strong], { sections: SECTIONS });
  const recs = records.get('s01');
  assert.equal(recs.length, 1, 'the repeat must not become a second record');
  assert.equal(report.dropped.intraSection, 1);
  assert.equal(recs[0].difficulty, 'expert', 'the stronger variant won');
  assert.ok(isHighlighted(recs[0]));
});

test('pdfqa: a question repeated across sections is made section-specific, not dropped', () => {
  const same = 'Practice : Edge task: missing, empty, duplicate ya invalid input handle karo.';
  const a = item({ sid: 's01', stage: 'PRACTICE', question: same, pdfImportance: 'CORE', pdfDifficulty: 'BASIC' });
  const b = item({ sid: 's02', stage: 'PRACTICE', question: same, pdfImportance: 'CRITICAL', pdfDifficulty: 'BASIC' });
  const { records, report } = curate([a, b], { sections: SECTIONS });
  assert.equal(report.crossSection.families, 1);
  const q1 = records.get('s01')[0].question;
  const q2 = records.get('s02')[0].question;
  assert.notEqual(norm(q1), norm(q2), 'the pair must no longer collide');
  assert.match(q1, /Variables & Data Types/);
  assert.match(q2, /Operators/);
  // The original text survives inside the rewritten question — nothing was thrown away.
  assert.ok(q1.endsWith('missing, empty, duplicate ya invalid input handle karo.'));
});

test('pdfqa: highlight is the section top band intersected with SENIOR, and maps cleanly', () => {
  const { records } = curate([
    item({ pdfImportance: 'HIGH', pdfDifficulty: 'SENIOR' }),                                  // highlighted
    item({ question: 'Define: Data Types ko senior level par explain karo aur ek use case batao.', pdfImportance: 'HIGH', pdfDifficulty: 'ADVANCED' }),
    item({ question: 'Predict: None type ko senior level par explain karo aur ek use case batao.', pdfImportance: 'CORE', pdfDifficulty: 'SENIOR' }),
  ], { sections: SECTIONS });
  const recs = records.get('s01');
  const hl = recs.filter(isHighlighted);
  assert.equal(hl.length, 1, 'only top band x SENIOR is highlighted');
  assert.deepEqual([hl[0].importance, hl[0].priority], ['must_know', 'P0']);
  assert.ok(hl[0].tags.includes(HIGHLIGHT_TAG));
  // The PDF's own ordering survives in `importance` for the unhighlighted records.
  const others = recs.filter((r) => !isHighlighted(r));
  assert.deepEqual(others.map((r) => r.importance).sort(), ['advanced', 'high_value']);
  // Highlights are written first so the Question Bank shows them first.
  assert.equal(recs[0].tags.includes(HIGHLIGHT_TAG), true);
});

test('pdfqa: a section whose every item is CRITICAL still highlights only its top tier', () => {
  const crit = (over) => item({ sid: 's02', pdfImportance: 'CRITICAL', ...over });
  const { records, report } = curate([
    crit({ pdfDifficulty: 'SENIOR' }),
    crit({ pdfDifficulty: 'BASIC', question: 'Define: Operators ko basic level par explain karo aur ek use case batao.' }),
  ], { sections: SECTIONS });
  assert.equal(report.sectionBands.s02, 'CRITICAL');
  const recs = records.get('s02');
  assert.equal(recs.filter(isHighlighted).length, 1, 'the band alone would have flagged every item');
  assert.equal(recs.filter(isHighlighted)[0].difficulty, 'expert');
});

test('pdfqa: the section vocabulary tags templates that carry no concept slot', () => {
  const learn = item({ pdfImportance: 'HIGH', pdfDifficulty: 'SENIOR' });
  const scenario = item({
    stage: 'CHECKPOINT',
    question: 'Checkpoint : Scenario: Type Casting fail ho raha hai; first diagnostic kya hoga?',
    answer: 'Answer: input validate karo. Why: bad payload downstream todega.',
    impact: '',
    pdfImportance: 'CORE',
    pdfDifficulty: 'BASIC',
  });
  const vocab = buildVocabulary([learn, scenario], SECTIONS[0].learn.concepts.map((c) => c.title));
  const { concept } = conceptFor(scenario, vocab);
  assert.equal(concept, 'Type Casting', 'the concept came from the PDF\'s own LEARN items');
  const { records } = curate([learn, scenario], { sections: SECTIONS });
  const rec = records.get('s01').find((r) => r.type === 'checkpoint');
  assert.equal(rec.tags[0], 'Type Casting');
  assert.match(rec.explanation, /^Why: /);
});

test('pdfqa: the duplicate "Use:" clause is removed only when the impact already carries it', () => {
  const drop = item();
  assert.equal(cleanAnswer(drop), 'Type Casting: value ko another compatible type me convert karna.');
  const keep = item({ impact: 'ek bilkul different line.' });
  assert.match(cleanAnswer(keep), /Use: normalize karne ke liye\./);
  const noImpact = item({ impact: '' });
  assert.match(cleanAnswer(noImpact), /Use: normalize karne ke liye\./);
});

test('pdfqa: tidyText fixes the template punctuation without touching wording', () => {
  // The generator prints its stage label with a space before the colon.
  assert.equal(tidyText('Coding : Dynamic Typing ko use karke task karo.', { punctuation: true }), 'Coding: Dynamic Typing ko use karke task karo.');
  assert.equal(tidyText('Practice  (Sets): Edge task: x handle karo.', { punctuation: true }), 'Practice (Sets): Edge task: x handle karo.');
  assert.equal(tidyText('Checkpoint : MCQ: X ka use?', { punctuation: true }), 'Checkpoint: MCQ: X ka use?');
  // Answers keep their own punctuation (code lives there), only whitespace collapses.
  assert.equal(tidyText('dict me {"a" : 1} likho  aur  chalao'), 'dict me {"a" : 1} likho aur chalao');
  assert.equal(tidyText('dono .5 par kya hoga?', { punctuation: true }), 'dono .5 par kya hoga?');
});

test('pdfqa: disambiguation is deterministic and mentions the section', () => {
  const q = 'Practice : Edge task: missing, empty, duplicate ya invalid input handle karo.';
  assert.equal(disambiguate(q, 'Sets'), 'Practice (Sets): Edge task: missing, empty, duplicate ya invalid input handle karo.');
  assert.equal(disambiguate(q, 'Sets'), disambiguate(q, 'Sets'));
  assert.notEqual(norm(disambiguate(q, 'Sets')), norm(disambiguate(q, 'Tuples')));
  // A question with no leading label still gets the section attached.
  assert.match(disambiguate('Koi label nahi wala question?', 'Sets'), /^Sets — /);
});

test('pdfqa: ids are appended deterministically, so re-running the import is a no-op', () => {
  const bank = { sectionId: 's01', title: 'T', contentVersion: '1.0.0', generatedAt: 'x', topics: [], questions: [], flags: [] };
  const { records } = curate([item(), item({ stage: 'CHECKPOINT', question: 'Checkpoint : Quick: type() ka one-line definition + one pitfall bolo.', answer: 'Answer: type batata hai. Why: clarity.' })], { sections: SECTIONS });
  const recs = records.get('s01');

  const first = withIds(bank, recs, 's01');
  const again = withIds(bank, recs, 's01');
  assert.deepEqual(first.map((r) => r.id), again.map((r) => r.id), 'ids must be reproducible');
  assert.deepEqual([...new Set(first.map((r) => r.id))].length, first.length, 'ids must be unique');
  for (const r of first) assert.match(r.id, new RegExp(`^s01:${r.type}:\\d+$`));

  const merge = mergeIntoBank(bank, first, 's01');
  assert.equal(merge.added.length, recs.length);
  const second = mergeIntoBank(bank, first, 's01');
  assert.equal(second.added.length, 0, 'the same import must not add a second copy');
  assert.equal(second.skipped.byId + second.skipped.byText, recs.length);
});

test('pdfqa: a fresh bank starts at index 0 and existing ids are never renumbered', () => {
  const bank = {
    sectionId: 's01', title: 'T', contentVersion: '1.0.0', generatedAt: 'x', topics: [],
    questions: [{ id: 's01:theory:7', type: 'theory' }, { id: 's01:theory:9', type: 'theory' }],
    flags: [],
  };
  const ids = withIds(bank, [{ type: 'theory' }, { type: 'theory' }], 's01').map((r) => r.id);
  assert.deepEqual(ids, ['s01:theory:10', 's01:theory:11']);
});

/* ------------------- invariants over the shipped content pack ------------------- */

const bankFiles = fs.existsSync(QUESTIONS_DIR)
  ? fs.readdirSync(QUESTIONS_DIR).filter((f) => /^s\d+\.json$/.test(f)).sort()
  : [];
const banks = () => bankFiles.map((f) => JSON.parse(fs.readFileSync(path.join(QUESTIONS_DIR, f), 'utf8')));

test('pdfqa: imported records are identifiable, traceable and never marked authored', () => {
  const imported = banks().flatMap((b) => b.questions).filter((q) => q.pdfStage !== undefined);
  assert.ok(imported.length > 0, 'the V10 import must be present in the pack');
  for (const q of imported) {
    assert.ok(Number.isInteger(q.pdfPage) && q.pdfPage >= 1, `${q.id}: pdfPage must be a real page`);
    assert.ok(STAGES.includes(q.pdfStage), `${q.id}: unknown pdfStage "${q.pdfStage}"`);
    assert.ok(BANDS.includes(q.pdfImportance), `${q.id}: unknown pdfImportance "${q.pdfImportance}"`);
    assert.equal(q.source, 'curriculum', `${q.id}: imported records are curriculum-sourced`);
    // A `batch` would make isAuthored() label this as hand-written and would feed the
    // authored quota report, which asserts exactly 1,280 track-tagged items.
    assert.equal(q.batch, undefined, `${q.id}: an imported record must not carry a batch id`);
  }
});

test('pdfqa: every section received all nine stages (no section lost coverage)', () => {
  for (const b of banks()) {
    const stages = new Set(b.questions.filter((q) => q.pdfStage !== undefined).map((q) => q.pdfStage));
    assert.deepEqual([...stages].sort(), [...STAGES].sort(), `${b.sectionId}: missing stages ${STAGES.filter((s) => !stages.has(s)).join(', ')}`);
  }
});

test('pdfqa: a highlight always means must_know + P0 and sorts ahead of everything else', () => {
  let highlighted = 0;
  let imported = 0;
  for (const b of banks()) {
    let seenPlain = false;
    for (const q of b.questions) {
      if (q.pdfStage !== undefined) imported++;
      const hl = isHighlighted(q);
      if (hl) {
        highlighted++;
        assert.equal(q.importance, 'must_know', `${q.id}: highlighted items are must-know`);
        assert.equal(q.priority, 'P0', `${q.id}: highlighted items are P0`);
        assert.equal(seenPlain, false, `${q.id}: a highlight appeared after a non-highlighted item`);
      } else {
        seenPlain = true;
      }
    }
  }
  assert.ok(highlighted > 0, 'the import must highlight something');
  // The rule is deliberately an intersection: the bare priority band would flag 61% of the
  // document and stop meaning "most important". A sanity ceiling keeps that from creeping back.
  const share = highlighted / imported;
  assert.ok(share < 0.35, `highlights must stay a selection, got ${(share * 100).toFixed(1)}% of imported items`);
});

test('pdfqa: imported text is tidy — no double spaces, no space before a colon', () => {
  const offenders = [];
  for (const b of banks()) {
    for (const q of b.questions) {
      if (q.pdfStage === undefined) continue;
      if (/  /.test(q.question)) offenders.push(`${q.id}: double space → ${q.question.slice(0, 60)}`);
      if (/\s+[:,;]/.test(q.question)) offenders.push(`${q.id}: space before punctuation → ${q.question.slice(0, 60)}`);
      if (/^\s|\s$/.test(q.question)) offenders.push(`${q.id}: untrimmed question`);
    }
  }
  assert.deepEqual(offenders, [], `imported questions must be typographically clean:\n${offenders.slice(0, 5).join('\n')}`);
});

test('pdfqa: every section has at least one highlight, and difficulty maps 1:1', () => {
  const MAP = { BASIC: 'easy', INTERMEDIATE: 'medium', ADVANCED: 'hard', SENIOR: 'expert' };
  const ft = fs.readFileSync(path.join(__dirname, '..', 'lib', 'pdfqa.cjs'), 'utf8');
  for (const b of banks()) {
    const imported = b.questions.filter((q) => q.pdfStage !== undefined);
    assert.ok(imported.some(isHighlighted), `${b.sectionId}: every section shows its most important items`);
    for (const q of imported) assert.ok(Object.values(MAP).includes(q.difficulty), `${q.id}: difficulty outside the map`);
  }
  // Locked in one place so a future change has to be deliberate.
  assert.match(ft, /HIGHLIGHT_RULE\s*=/);
  assert.match(ft, /'MUST-KNOW'/);
  assert.ok(HIGHLIGHT_DIFFICULTIES.includes('SENIOR'));
});
