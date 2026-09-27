/**
 * Engine + honesty tests.
 *
 * Three kinds of check live here:
 *  1. Behavioural tests of the offline retrieval engine (real chunk → vector →
 *     rank → extract pipeline, run through Node's TypeScript stripping).
 *  2. Behavioural tests of the exam engine and the offline coach — both are kept
 *     free of runtime imports so Node can load them directly.
 *  3. Structural invariants over the app source: every sidebar destination must
 *     resolve to a real route, no page may ship a placeholder, and every i18n
 *     key used by a page must exist in the English pack.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Windows needs a file:// URL for dynamic ESM imports of absolute paths.
const rag = await import(pathToFileURL(path.join(ROOT, 'src/engine/rag.ts')).href);
const exam = await import(pathToFileURL(path.join(ROOT, 'src/engine/exam.ts')).href);
const coach = await import(pathToFileURL(path.join(ROOT, 'src/engine/coach.ts')).href);

/* ----------------------------- RAG engine ----------------------------- */

test('tokenize drops stop words and single characters', () => {
  const toks = rag.tokenize('The list of the a tuples and hai ka');
  assert.ok(!toks.includes('the'));
  assert.ok(!toks.includes('a'));
  assert.ok(toks.includes('list'));
  assert.ok(toks.includes('tuples'));
});

test('chunkText keeps short documents whole and splits long ones', () => {
  const short = rag.chunkText('one two three four', 60, 12);
  assert.deepEqual(short, ['one two three four']);

  const words = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
  const parts = rag.chunkText(words, 50, 10);
  assert.ok(parts.length > 1, 'long document must split into several chunks');
  for (const p of parts) assert.ok(p.split(' ').length <= 50, 'chunk must respect the size cap');
  // Overlap: consecutive chunks share words.
  const first = parts[0].split(' ').slice(-10).join(' ');
  assert.ok(parts[1].startsWith(first.slice(0, 12)) || parts[1].includes(first.split(' ').pop()));
});

test('buildChunks numbers sources when a document splits', () => {
  const words = Array.from({ length: 120 }, (_, i) => `w${i}`).join(' ');
  const chunks = rag.buildChunks([{ text: words, source: 'doc' }], 40, 5);
  assert.ok(chunks.length > 1);
  assert.match(chunks[1].source, /#2$/);
  assert.equal(chunks[0].id, 0);
  assert.deepEqual(chunks.map((c) => c.id), chunks.map((_, i) => i));
});

test('index + retrieve ranks the passage that actually answers the query', () => {
  const chunks = rag.buildChunks([
    { text: 'A list is mutable so you can append and remove items after creation.', source: 'list' },
    { text: 'A tuple is immutable and cannot be changed after it is created.', source: 'tuple' },
    { text: 'A dictionary stores key value pairs and answers lookups quickly.', source: 'dict' },
  ], 60, 10);
  const index = rag.buildIndex(chunks);
  const hits = rag.retrieve(index, 'is a tuple immutable?', 2);
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].source, 'tuple', 'retrieval must rank the tuple passage first');
  assert.ok(hits[0].score > 0);
  // Scores are sorted descending.
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i - 1].score >= hits[i].score);
});

test('indexing is deterministic for the same corpus', () => {
  const docs = [{ text: 'Python functions accept default arguments and keyword arguments.', source: 'fn' }];
  const a = rag.buildIndex(rag.buildChunks(docs, 60, 10));
  const b = rag.buildIndex(rag.buildChunks(docs, 60, 10));
  assert.equal(a.terms, b.terms);
  assert.deepEqual(Array.from(a.vectors[0]), Array.from(b.vectors[0]));
});

test('retrieve returns nothing rather than a wrong answer when there is no overlap', () => {
  const index = rag.buildIndex(rag.buildChunks([{ text: 'Python lists are mutable sequences.', source: 'l' }], 60, 10));
  assert.deepEqual(rag.retrieve(index, 'kubernetes helm chart', 3), []);
});

test('answerFrom only ever quotes retrieved text', () => {
  const chunks = rag.buildChunks([
    { text: 'Use a with block to open a file so it always closes. Reading with open returns a string.', source: 'files' },
    { text: 'NumPy arrays are fixed size and support vectorised maths.', source: 'numpy' },
  ], 60, 10);
  const index = rag.buildIndex(chunks);
  const hits = rag.retrieve(index, 'how do I open a file', 2);
  const { text, used } = rag.answerFrom('how do I open a file', hits);
  assert.ok(used.length >= 1);
  assert.match(text, /with block/i);
  // Every quoted sentence must exist verbatim in the corpus it came from.
  for (const sentence of text.split('\n')) {
    const clean = sentence.replace(/\s*\[[^\]]+\]$/, '').trim();
    if (!clean) continue;
    assert.ok(chunks.some((c) => c.text.includes(clean)), `answer sentence not found in source corpus: ${clean}`);
  }
});

/* ----------------------- structural invariants ----------------------- */

const appSrc = read('src/App.tsx');

test('every sidebar destination resolves to a real route', () => {
  const navTargets = [...appSrc.matchAll(/\{\s*to:\s*'([^']+)'/g)].map((m) => m[1]);
  const routePaths = [...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(navTargets.length >= 20, `expected the full nav set, saw ${navTargets.length}`);
  for (const to of navTargets) {
    assert.ok(routePaths.includes(to), `sidebar link ${to} has no matching <Route path>`);
  }
});

test('every page component referenced by a route exists on disk', () => {
  // Handles both the eager `import X from './pages/X'` form and the
  // code-split `const X = lazy(() => import('./pages/X'))` form.
  const imports = [
    ...[...appSrc.matchAll(/^import\s+\w+\s+from\s+'\.\/pages\/([^']+)';/gm)].map(([, p]) => p),
    ...[...appSrc.matchAll(/lazy\(\(\)\s*=>\s*import\('\.\/pages\/([^']+)'\)\)/g)].map(([, p]) => p),
  ];
  assert.ok(imports.length >= 20, `expected 20+ page imports, saw ${imports.length}`);
  for (const p of imports) {
    const file = path.join(ROOT, 'src/pages', p.endsWith('.tsx') ? p : `${p}.tsx`);
    assert.ok(fs.existsSync(file), `missing page file for route import: ${p}`);
  }
});

test('no page ships a placeholder or lorem ipsum', () => {
  const dir = path.join(ROOT, 'src/pages');
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.tsx')) continue;
    const src = fs.readFileSync(path.join(dir, f), 'utf8').toLowerCase();
    for (const bad of ['coming soon', 'lorem ipsum', 'placeholder text', 'todo:', 'fixme']) {
      assert.ok(!src.includes(bad), `${f} contains a placeholder marker: "${bad}"`);
    }
  }
});

test('every i18n key used by the shell and dashboard exists in the English pack', () => {
  const locales = read('src/i18n/locales.ts');
  const enBlock = locales.slice(locales.indexOf('export const en ='), locales.indexOf('export type LocaleKey'));
  const defined = new Set([...enBlock.matchAll(/'([a-z][\w.]*)':/g)].map((m) => m[1]));
  for (const file of ['src/App.tsx', 'src/pages/Dashboard.tsx', 'src/pages/LearningPath.tsx', 'src/pages/Playground.tsx', 'src/pages/Lesson.tsx']) {
    const src = read(file);
    for (const m of src.matchAll(/\bt\('([^']+)'\)/g)) {
      const key = m[1];
      if (key.includes('${')) continue;
      assert.ok(defined.has(key), `${file} uses missing locale key "${key}"`);
    }
  }
});

test('the offline assistant never claims to be network-backed', () => {
  const src = read('src/engine/assistant.ts');
  assert.ok(/no network/i.test(src) || /Offline/i.test(src), 'assistant must document that it is offline');
  // It must be built on the deterministic retrieval engine, not a fetch call.
  assert.ok(!/fetch\(/.test(src), 'offline assistant must not perform network requests');
});

/* ------------------------- exam mode (timed paper) ------------------------- */

/** Minimal but schema-shaped bank question. */
const question = (id, sectionId, type, difficulty, status = 'PUBLISHED') => ({
  id, sectionId, type, difficulty, status,
  importance: 'must_know', priority: 'P1',
  question: `Question ${id}`, answer: `Answer ${id}`, explanation: '',
  source: 'curriculum', tags: ['topic'],
});

const pool = (sectionId, questions) => ({
  sectionId, sectionTitle: sectionId.toUpperCase(), questions,
});

const multiPool = (sections, perSection) =>
  Array.from({ length: sections }, (_, s) => {
    const sid = `s0${s + 1}`;
    return pool(sid, Array.from({ length: perSection }, (_, i) => question(`${sid}:interview:${i}`, sid, 'interview', 'medium')));
  });

test('exam selection is deterministic for a seed and rearranges across seeds', () => {
  const pools = multiPool(5, 10);
  const bp = { ...exam.DEFAULT_BLUEPRINT, size: 10 };

  const a = exam.selectExamQuestions(pools, bp, {}, 42).map((q) => q.id);
  const b = exam.selectExamQuestions(pools, bp, {}, 42).map((q) => q.id);
  const c = exam.selectExamQuestions(pools, bp, {}, 43).map((q) => q.id);

  assert.deepEqual(a, b, 'the same seed must rebuild the exact same paper');
  assert.notDeepEqual(a, c, 'a different seed must produce a different paper');
  assert.equal(new Set(a).size, a.length, 'a question may never appear twice in one paper');
});

test('a mixed paper spreads across sections instead of draining one bank', () => {
  const paper = exam.selectExamQuestions(multiPool(5, 10), { ...exam.DEFAULT_BLUEPRINT, size: 10 }, {}, 99);
  const perSection = {};
  for (const q of paper) perSection[q.sectionId] = (perSection[q.sectionId] ?? 0) + 1;
  assert.equal(Object.keys(perSection).length, 5, 'a 10-question mixed paper should touch every section');
  for (const n of Object.values(perSection)) assert.ok(n <= 3, `one section took ${n} of 10 questions`);
});

test('a paper only ever contains questions the blueprint allows', () => {
  const pools = [pool('s01', [
    question('s01:coding:1', 's01', 'coding', 'hard'),
    question('s01:coding:2', 's01', 'coding', 'easy'),
    question('s01:interview:1', 's01', 'interview', 'hard'),
    question('s01:coding:3', 's01', 'coding', 'hard', 'DRAFT'),
    question('s01:theory:1', 's01', 'theory', 'hard'),
  ])];
  const bp = { ...exam.DEFAULT_BLUEPRINT, size: 20, focus: 'coding', difficulty: 'hard' };

  assert.equal(exam.availableCount(pools, bp), 1, 'drafts and other types must be excluded');
  const paper = exam.selectExamQuestions(pools, bp, {}, 7);
  assert.deepEqual(paper.map((q) => q.id), ['s01:coding:1']);
  assert.equal(exam.matchesFocus(question('x', 's01', 'theory', 'easy'), 'mixed'), false, 'theory is never examined');
});

test('a short pool yields a short paper — never a padded or duplicated one', () => {
  const pools = [pool('s01', [
    question('s01:logic:1', 's01', 'logic', 'easy'),
    question('s01:logic:2', 's01', 'logic', 'easy'),
    question('s01:logic:3', 's01', 'logic', 'easy'),
  ])];
  const bp = { ...exam.DEFAULT_BLUEPRINT, size: 12, focus: 'logic' };
  const paper = exam.selectExamQuestions(pools, bp, {}, 3);

  assert.equal(exam.availableCount(pools, bp), 3);
  assert.equal(paper.length, 3, 'the paper must be short rather than padded');
  assert.equal(new Set(paper.map((q) => q.id)).size, 3);
  // Every paper question carries its own answer, so grading works offline later.
  for (const q of paper) assert.ok(q.answer && q.sectionTitle);
});

test('unseen questions are preferred when the learner has a history', () => {
  const pools = [pool('s01', Array.from({ length: 6 }, (_, i) => question(`s01:logic:${i}`, 's01', 'logic', 'easy')))];
  const bp = { ...exam.DEFAULT_BLUEPRINT, size: 3, focus: 'logic' };
  const attempts = {
    'qb:s01:logic:0': { done: true },
    'qb:s01:logic:1': { done: false },
    'qb:s01:logic:2': { done: true },
  };
  const paper = exam.selectExamQuestions(pools, bp, attempts, 5).map((q) => q.id);
  assert.deepEqual([...paper].sort(), ['s01:logic:3', 's01:logic:4', 's01:logic:5']);
});

test('an ungraded paper reports NO score instead of a zero', () => {
  const session = {
    questions: [question('a', 's01', 'logic', 'easy'), question('b', 's01', 'logic', 'easy')],
    answers: { a: 'kuch likha' },
    grades: {},
    flags: [],
  };
  const s = exam.summariseExam(session);

  assert.equal(s.pct, null, 'pct must be null, never 0, before anything is graded');
  assert.equal(s.graded, 0);
  assert.equal(s.ungraded, 2);
  assert.equal(s.answered, 1);
  assert.equal(exam.readiness(s).ready, false, 'results cannot be filed with zero grades');
});

test('section and type tallies add up to the paper totals', () => {
  const session = {
    questions: [
      question('q1', 's01', 'interview', 'easy'),
      question('q2', 's01', 'logic', 'easy'),
      question('q3', 's02', 'logic', 'easy'),
    ],
    answers: {}, grades: { q1: false, q2: true }, flags: [],
  };
  const s = exam.summariseExam(session);
  const sum = (k) => s.bySection.reduce((n, sec) => n + sec[k], 0);

  assert.equal(s.bySection.length, 2);
  assert.equal(sum('total'), s.total, 'per-section totals must cover the whole paper');
  assert.equal(sum('correct'), s.correct);
  assert.equal(sum('wrong'), s.wrong);
  assert.equal(sum('ungraded'), s.ungraded, 'a section must report the questions left ungraded in it');
  const s01 = s.bySection.find((x) => x.sectionId === 's01');
  assert.deepEqual([s01.total, s01.correct, s01.wrong, s01.ungraded], [2, 1, 1, 0]);
  const s02 = s.bySection.find((x) => x.sectionId === 's02');
  assert.deepEqual([s02.total, s02.correct, s02.wrong, s02.ungraded], [1, 0, 0, 1]);
  // Sections the learner struggled with sort first, so the report leads with them.
  assert.equal(s.bySection[0].sectionId, 's01');
});

test('self-grading writes real state and skips ungraded questions entirely', () => {
  const session = {
    questions: [
      question('q1', 's01', 'interview', 'easy'),
      question('q2', 's02', 'logic', 'easy'),
      question('q3', 's02', 'logic', 'easy'),
    ],
    answers: { q1: 'mera jawab', q2: 'galat jawab' },
    grades: { q1: true, q2: false },
    flags: [],
  };
  const writes = exam.buildExamWrites(session, {});

  assert.equal(writes.entries.length, 2, 'the ungraded question must produce no write at all');
  assert.ok(!writes.entries.some((e) => e.questionId === 'q3'), 'ungraded ≠ wrong');
  assert.equal(writes.correct, 1);
  assert.equal(writes.wrong, 1);
  assert.equal(writes.xp, exam.XP_PER_CORRECT, 'XP is granted for the one correct answer');

  const right = writes.entries.find((e) => e.questionId === 'q1');
  const bad = writes.entries.find((e) => e.questionId === 'q2');
  assert.equal(right.mistake, undefined, 'a correct answer must not file a mistake');
  assert.equal(right.reviewReset, false, 'a correct answer must not reset spaced repetition');
  assert.equal(right.answer, 'mera jawab', "the learner's own answer is kept on the attempt");

  assert.ok(bad.mistake, 'a wrong answer must file a mistake');
  assert.equal(bad.mistake.type, 'logic', 'the mistake bucket follows the question type');
  assert.equal(bad.mistake.myAnswer, 'galat jawab');
  assert.ok(bad.mistake.correct.includes('q2'), 'the model answer is stored for review');
  assert.equal(bad.reviewReset, true, 'a wrong answer puts the section back in the review queue');
});

test('a question already answered correctly cannot pay XP twice', () => {
  const session = {
    questions: [question('q1', 's01', 'interview', 'easy')],
    answers: { q1: 'phir se sahi' }, grades: { q1: true }, flags: [],
  };
  const writes = exam.buildExamWrites(session, { 'qb:q1': { done: true, tries: 1 } });

  assert.equal(writes.xp, 0, 'XP must be granted only the first time');
  assert.equal(writes.entries[0].correct, true, 'the attempt is still refreshed');
  assert.equal(writes.entries[0].tries, 2, 'the try counter still advances');
});

test('the exam clock never runs backwards past zero', () => {
  assert.equal(exam.formatClock(65000), '01:05');
  assert.equal(exam.formatClock(59999), '01:00', 'a partial second must still read as a full second');
  assert.equal(exam.formatClock(-5000), '00:00');
  assert.equal(exam.defaultMinutes(8), 20);
  assert.equal(exam.defaultMinutes(1), 5, 'the floor keeps tiny papers realistic');
});

/* ------------------- offline coach (mistakes + spaced repetition) ------------------- */

const section = (id, title = id.toUpperCase()) => ({ id, title });
const SECTION_POOL = [section('s01', 'Variables'), section('s02', 'Operators'), section('s07', 'Loops')];

const mistake = (id, over = {}) => ({
  id, section: 's01', topic: 'Loops', question: `Q${id}`, myAnswer: 'galat', correct: 'sahi',
  type: 'code', date: '2026-09-20', attempts: 1, fixed: false, ...over,
});

/** A schedule stub, so the ranking maths never depends on the wall clock. */
const schedule = (level, over = {}) => ({
  level, intervalDays: [1, 3, 7, 14, 30][level], due: false, daysLeft: 3, overdueDays: 0,
  text: `level ${level}`, nextText: 'next', ...over,
});

const stateWith = (mistakes, review = {}) => ({ mistakes, review });

test('coach: a question-bank mistake drives the queue, not just coding-lab bugs', () => {
  // Three coding-lab failures in s01 versus one Question Bank interview failure in s02.
  const state = stateWith([
    mistake('a', { section: 's01', type: 'code', source: 'lab' }),
    mistake('b', { section: 's01', type: 'code', source: 'lab' }),
    mistake('c', { section: 's01', type: 'code', source: 'lab' }),
    mistake('d', { section: 's02', type: 'interview', source: 'bank', topic: 'Operators' }),
  ]);
  const ranked = coach.rankCandidates(state, SECTION_POOL);

  assert.equal(ranked[0].sectionId, 's01', 'three failures still outweigh one');
  const s02 = ranked.find((c) => c.sectionId === 's02');
  assert.equal(s02.bankMistakes, 1, 'the bank mistake must be visible to the coach');
  assert.equal(s02.score, 10, '3 failures + 5 (bank) away from the leader');
  assert.ok(s02.reasons.some((r) => /Question Bank/.test(r)), `reason must name the source: ${s02.reasons}`);
});

test('coach: a bank mistake outranks an equal pile of lab mistakes', () => {
  const lab = coach.rankCandidates(stateWith([mistake('a', { section: 's01', source: 'lab' })]), SECTION_POOL)[0];
  const bank = coach.rankCandidates(stateWith([mistake('a', { section: 's01', source: 'bank', type: 'interview' })]), SECTION_POOL)[0];
  assert.ok(bank.score > lab.score, `bank (${bank.score}) should outrank lab (${lab.score})`);
  assert.ok(coach.isBankMistake(mistake('x', { source: 'exam' })), 'exam failures count as graded-question failures');
  assert.equal(coach.isBankMistake(mistake('x', { source: 'lab' })), false);
});

test('coach: legacy records without a source are still classified honestly', () => {
  assert.equal(coach.sourceOf(mistake('1', { section: 'mock', source: undefined })), 'mock');
  assert.equal(coach.sourceOf(mistake('2', { section: 'final', source: undefined })), 'final');
  assert.equal(coach.sourceOf(mistake('3', { section: 'interview-mode', source: undefined })), 'interview');
  assert.equal(coach.sourceOf(mistake('4', { section: 'playground', source: undefined })), 'lab');
  assert.equal(coach.sourceOf(mistake('5', { section: 's07', source: undefined })), 'lesson');
});

test('coach: an overdue section with no mistakes still gets re-taught', () => {
  const opts = { scheduleOf: () => schedule(1, { due: true, overdueDays: 4, daysLeft: 0 }) };
  const ranked = coach.rankCandidates(stateWith([], { s07: { level: 1, last: '2026-08-01' } }), SECTION_POOL, opts);

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].sectionId, 's07');
  assert.equal(ranked[0].openMistakes, 0);
  assert.ok(ranked[0].reasons.some((r) => /4 din late/.test(r)), `reason must state the lateness: ${ranked[0].reasons}`);
});

test('coach: a level-0 section outranks one on a comfortable interval', () => {
  const weak = coach.scheduleUrgency(schedule(0, { daysLeft: 1 }));
  const settled = coach.scheduleUrgency(schedule(3, { daysLeft: 12 }));
  assert.ok(weak > settled, `level 0 (${weak}) must outrank level 3 (${settled})`);
  assert.equal(coach.scheduleUrgency(null), 0, 'a section with no schedule adds no urgency');
  assert.ok(
    coach.scheduleUrgency(schedule(2, { due: true, overdueDays: 9 })) > coach.scheduleUrgency(schedule(2, { due: true, overdueDays: 1 })),
    'the longer a section is overdue, the higher it climbs',
  );
});

test('coach: retakes quote the learner’s own failure and route back to its surface', () => {
  const state = stateWith([
    mistake('from-lesson', { section: 's07', source: 'lesson', attempts: 1, type: 'code' }),
    mistake('from-bank', { section: 's07', source: 'bank', attempts: 1, type: 'logic', question: 'Logic Q', myAnswer: 'main galat tha', correct: 'sahi jawab' }),
  ]);
  const retakes = coach.buildRetakes(section('s07'), state);

  assert.equal(retakes.length, 2);
  assert.equal(retakes[0].id, 'from-bank', 'question-bank failures come first');
  assert.equal(retakes[0].label, 'Question Bank self-grade · logic');
  assert.equal(retakes[0].myAnswer, 'main galat tha', "the learner's own answer must be quoted back");
  assert.equal(retakes[0].correct, 'sahi jawab');
  assert.equal(retakes[0].route, '/questions', 'a bank failure retries in the bank, not the lab');
  assert.equal(retakes[1].route, '/lesson/s07/coding', 'a lesson failure routes to that section stage');

  // Each surface sends the learner back to where the failure actually happened.
  const routes = {
    exam: ['/exam', 's02'], lab: ['/playground', 'playground'], mock: ['/mock', 'mock'],
    interview: ['/interview', 'interview-mode'], final: ['/final', 'final'], bank: ['/questions', 's02'],
  };
  for (const [source, [route, sid]] of Object.entries(routes)) {
    assert.equal(coach.mistakeRoute(mistake('x', { source, section: sid })).route, route, `${source} → ${route}`);
  }
});

test('coach: the drill follows the type the learner keeps failing', () => {
  const interviewFail = stateWith([mistake('a', { section: 's07', type: 'interview', source: 'bank' })]);
  assert.equal(coach.failingType(section('s07'), interviewFail), 'interview');

  // A bank drill must be published, of the failing type, and never one already passed.
  const bank = [
    { ...question('q1', 's07', 'interview', 'medium'), difficulty: 'hard' },
    { ...question('q2', 's07', 'interview', 'medium'), difficulty: 'easy' },
    { ...question('q3', 's07', 'logic', 'easy') },
    { ...question('q4', 's07', 'interview', 'easy', 'DRAFT') },
  ];
  const pick = coach.nextBankDrill(bank, 'interview', new Set(['q1']));
  assert.equal(pick.question.id, 'q2', 'the answered q1 and the draft q4 are both ineligible');
  assert.equal(pick.bankType, 'interview');

  // The question already shown as a retake must not be handed back as the drill.
  const avoided = coach.nextBankDrill(bank, 'interview', new Set(), ['Question q2']);
  assert.equal(avoided.question.id, 'q1');

  // Nothing eligible → no drill, rather than a random one.
  assert.equal(coach.nextBankDrill([bank[2]], 'interview', new Set()), null);
  // A logic failure asks for a logic question, not another coding task.
  assert.equal(coach.nextBankDrill(bank, 'logic', new Set()).question.id, 'q3');
});

test('coach: the chosen section always comes with a reason from real state', () => {
  const state = stateWith([mistake('a', { section: 's01', source: 'bank', type: 'interview', attempts: 2 })]);
  const opts = { scheduleOf: (id) => (id === 's01' ? schedule(0, { due: true, overdueDays: 1, daysLeft: 0, text: 'level 0 · 1 din late' }) : null) };
  const picked = coach.coachSectionFor(state, SECTION_POOL, section('s07'), 'frontier fallback', opts);

  assert.equal(picked.section.id, 's01');
  assert.match(picked.why, /Variables/);
  assert.match(picked.why, /open mistake/);
  assert.match(picked.why, /Question Bank/);
  assert.match(picked.why, /1 din late/, 'the schedule is part of the reasoning');
  assert.equal(picked.schedule.level, 0);

  // With nothing to re-teach it falls back to the frontier section.
  const clean = coach.coachSectionFor(stateWith([]), SECTION_POOL, section('s07'), 'frontier fallback', { scheduleOf: () => null });
  assert.equal(clean.section.id, 's07');
  assert.equal(clean.why, 'frontier fallback');
  assert.deepEqual(clean.candidates, []);
});

test('every mistake writer records where the failure came from', () => {
  const writers = {
    'src/pages/QuestionBank.tsx': /source: 'bank'/,
    'src/pages/Playground.tsx': /mistakeFromDiagnostic/,
    'src/pages/Lesson.tsx': /source: 'lesson'/,
    'src/pages/MockInterviews.tsx': /source: 'mock'/,
    'src/pages/InterviewMode.tsx': /source: 'interview'/,
    'src/pages/FinalAssessment.tsx': /source: 'final'/,
    // The notebook cell files through the tutor's factory, which tags `source: 'lab'`.
    'src/components/NotebookCells.tsx': /mistakeFromDiagnostic/,
    'src/engine/exam.ts': /source: 'exam'/,
    'src/engine/tutor.ts': /source: 'lab'/,
  };
  for (const [file, pattern] of Object.entries(writers)) {
    assert.match(read(file), pattern, `${file} must tag the source of a mistake it files`);
  }
});

test('the coach teaches from the bank and states its schedule truthfully', () => {
  const src = read('src/engine/tutor.ts');
  assert.match(src, /buildRetakes/, 'mistakes must lead the coach session');
  assert.match(src, /coachSchedule/, 'the review schedule must be part of the session');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(src), 'the coach must stay offline');
  const review = read('src/engine/review.ts');
  assert.match(review, /export const INTERVALS = \[1, 3, 7, 14, 30\]/, 'review.ts stays the single owner of the interval ladder');
  // The ladder must not be duplicated anywhere else in the app source.
  const dir = path.join(ROOT, 'src');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const file of walk(dir)) {
    if (!/\.tsx?$/.test(file) || file.endsWith('review.ts')) continue;
    assert.ok(!/\[1,\s*3,\s*7,\s*14,\s*30\]/.test(fs.readFileSync(file, 'utf8')),
      `${path.relative(ROOT, file)} duplicates the spaced-repetition ladder`);
  }
});

test('the exam page scores from self-grades, never from typed text', () => {
  const src = read('src/pages/ExamMode.tsx');
  assert.match(src, /buildExamWrites/, 'state writes must go through the pure exam engine');
  assert.match(src, /applyExamWrites/, 'attempts, mistakes and review must land in one atomic write');
  assert.ok(!/keywordScore|questionRubric/.test(src), 'exam marks must never be derived by matching words');
  assert.match(src, /neutral/, 'ungraded questions must be surfaced as neutral, not wrong');
});
