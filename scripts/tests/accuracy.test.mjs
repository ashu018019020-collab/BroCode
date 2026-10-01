/**
 * "Kitna sahi hai, percentage me" — the answer-accuracy layer, the assistant that can now answer
 * about the item on screen, and the previous/next line under every notebook.
 *
 * Three ways this could go wrong without anything crashing, which is what these tests watch for:
 *
 *   1. A percentage that was never measured. An unanswered item must read `—`, never 0%, because
 *      0% is a verdict the learner did not earn.
 *   2. An assistant that answers about the TOPIC when it was asked about one QUESTION — the whole
 *      point of passing the item in is that "hint" and "kitna sahi" become specific. Scoring a
 *      V15 method line as if it were a model answer would be the same lie wearing a number.
 *   3. A navigation control that exists in one surface and not the others. The line under the
 *      notebook is the shared engine's, so every notebook in the app gets it — and that is a
 *      structural fact worth pinning.
 *
 * Zero dependencies: node:test plus the project's TS resolver hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const acc = await load('src/core/assessment/accuracy.ts');
const { quickAnswer, quickScoreAnswer, quickHint, quickAccuracy, askLocal } = await load('src/core/ai/assistant.ts');

const raw = JSON.parse(read('public/generated/curriculum/sections.json'));
const sections = Array.isArray(raw) ? raw : raw.sections;

/** A learner with a few graded answers — the shape every surface really writes. */
const learner = (attempts = {}) => ({
  version: 1,
  profile: { name: 'T', goal: 'g', level: 'Beginner', dailyMinutes: 60, onboarded: true },
  xp: 0,
  streak: { current: 0, last: '' },
  attempts,
  bookmarks: [],
  mistakes: [],
  review: {},
  interviewAnswers: {},
  defenseAnswers: {},
  savedCode: {},
  settings: { reduceMotion: false },
  activity: {},
  notes: [],
  jobPrep: {},
  readNotifs: [],
});

const MODEL = 'ETL me transform load se pehle hota hai. ELT me raw data pehle warehouse me load karte hain, phir transform karte hain. ELT modern cloud warehouse ke liye better hai.';

/* ------------------------------ the maths ------------------------------ */

test('accuracy: an unmeasured answer is null, never a fabricated 0%', () => {
  assert.equal(acc.attemptPct(undefined), null, 'no attempt = nothing measured');
  assert.equal(acc.attemptPct({ answer: 'kuch likha' }), null, 'written but ungraded = still unmeasured');
  assert.equal(acc.attemptPct({ done: true }), 100);
  assert.equal(acc.attemptPct({ done: false }), 0);
  assert.equal(acc.attemptPct({ done: false, score: 55 }), 55, 'a measured score outranks the self-grade');
  assert.equal(acc.attemptPct({ score: 250 }), 100, 'clamped, so a bad write cannot print 250%');
  assert.equal(acc.pctText(null), '—');
  assert.equal(acc.pctText(0), '0%');
  assert.equal(acc.accuracyLine({ answered: 0, graded: 0, correct: 0, pct: null, avg: null }), 'Abhi tak koi answer nahi');
  assert.equal(acc.accuracyLine({ answered: 4, graded: 0, correct: 0, pct: null, avg: 40 }), '4 answer likhe — grade abhi nahi kiya');
});

test('accuracy: the rubric refuses to score what it cannot measure', () => {
  assert.equal(acc.rubricFor('', MODEL), null, 'empty answer');
  assert.equal(acc.rubricFor('haan', MODEL), null, 'too short to be an answer');
  assert.equal(acc.rubricFor('ETL vs ELT kuch', 'Haan.'), null, 'model answer too short to build a rubric from');

  const good = acc.rubricFor('ETL me transform load se pehle hota hai, ELT me raw data pehle warehouse me load karte hain phir transform karte hain', MODEL);
  assert.ok(good && good.pct > 0, 'a real answer scores');
  const partial = acc.rubricFor('ETL me transform pehle', MODEL);
  assert.ok(partial && partial.pct < good.pct, 'a partial answer scores lower than a complete one');
  assert.ok(partial.missing.length > 0, 'and it names what is missing');
});

test('accuracy: tally separates answered, graded and measured', () => {
  const t = acc.tally([
    { done: true, score: 80 },
    { done: false, score: 20 },
    { answer: 'likha par grade nahi kiya' },
  ]);
  assert.equal(t.answered, 3);
  assert.equal(t.graded, 2);
  assert.equal(t.correct, 1);
  assert.equal(t.pct, 50, 'correct / graded');
  assert.equal(t.avg, 50, 'mean of the measured percentages');
  assert.deepEqual(acc.tally([]), { answered: 0, graded: 0, correct: 0, pct: null, avg: null });
});

test('accuracy: each family reads its own stored keys', () => {
  const state = learner({
    'qb:s19:interview:0': { done: true, score: 90 },
    'qb:s19:interview:1': { done: false, score: 30 },
    'qb:s22:interview:0': { done: true },
    'lab:interview:123': { done: true, score: 70 },
    'nb:python-lists.ipynb:cell1': { done: true, score: 100 },
    'nb:python-loops.ipynb:cell1': { done: true, score: 0 },
    'st:s19:project': { done: true },
  });

  assert.equal(acc.bankAccuracy(state).answered, 3, 'only qb: answers');
  assert.equal(acc.bankAccuracy(state).pct, 67, '2 of 3 correct');
  assert.equal(acc.bankAccuracy(state, 's19').answered, 2, 'section filter = key prefix');
  assert.equal(acc.bankAccuracy(state, 's19').correct, 1);
  assert.equal(acc.bankAccuracy(state, 's99').answered, 0);

  const bySection = acc.bankAccuracyBySection(state);
  assert.deepEqual(Object.keys(bySection).sort(), ['s19', 's22']);
  assert.equal(bySection.s19.pct, 50);

  assert.equal(acc.notebookAccuracy(state, 'python-lists.ipynb').pct, 100);
  assert.equal(acc.notebookAccuracy(state, 'python-loops.ipynb').pct, 0, 'a raising cell is a real 0, not a missing value');
  assert.equal(acc.notebookAccuracy(state, 'other.ipynb').answered, 0, 'a notebook cannot read another session');

  assert.equal(acc.interviewAccuracy(state).answered, 1);
  assert.equal(acc.interviewAccuracy(state).pct, 100);
});

/* ------------------- the assistant, scoped to one question ------------------- */

const Q = {
  text: 'ETL vs ELT?',
  model: MODEL,
  sectionId: 's19',
  type: 'interview',
  source: 'Playbook V15 · ch.18',
};

test('assistant: "poora answer" answers the item, and never dresses a method up as an answer', () => {
  const withAnswer = quickAnswer(learner(), sections, { question: { ...Q, mine: '' } });
  assert.match(withAnswer.text, /ETL me transform load se pehle/, 'the model answer is the answer');
  assert.ok(withAnswer.sources.length > 0 && withAnswer.sources[0].route.length > 1);

  const method = quickAnswer(learner(), sections, {
    question: { text: 'Production me latency spike aaye to?', model: 'pehle metrics dekho, phir bottleneck isolate karo', sectionId: 's24', type: 'checkpoint', source: 'Playbook V15 · ch.20', methodOnly: true },
  });
  assert.match(method.text, /METHOD/i, 'a method line is labelled as a method');
  assert.match(method.text, /pehle metrics dekho/, 'and its text is reproduced, not paraphrased');

  const nothing = quickAnswer(learner(), sections);   // no question in context
  assert.match(nothing.text, /Kis question ka answer/, 'it asks which item instead of guessing');
});

test('assistant: "kitna sahi" scores the learner\'s own words with the same rubric as the page', () => {
  const mine = 'ETL me transform load se pehle hota hai, ELT me pehle load phir transform';
  const expected = acc.rubricFor(mine, MODEL);
  const scoped = { question: { ...Q, mine } };

  const answer = quickScoreAnswer(learner(), sections, scoped);
  assert.ok(expected, 'the rubric has something to measure');
  assert.match(answer.text, new RegExp(`${expected.pct}%`), 'the percentage the assistant prints is the rubric score');
  if (expected.missing.length) assert.match(answer.text, /chhoot gaye/, 'missing points are named');

  const empty = quickScoreAnswer(learner(), sections, { question: { ...Q, mine: '   ' } });
  assert.match(empty.text, /likha nahi/, 'with nothing written it says so rather than scoring nothing');
  assert.doesNotMatch(empty.text, /\b\d+%\b/, 'and invents no percentage');

  const method = quickScoreAnswer(learner(), sections, { question: { ...Q, mine, methodOnly: true } });
  assert.doesNotMatch(method.text, /rubric score/, 'a method-only item is never rubric-scored');
});

test('assistant: a hint with a question in context is about THAT item, and escalates', () => {
  const first = quickHint(learner(), sections, { question: { ...Q, mine: '' } }, 0);
  assert.match(first.text, /ETL vs ELT/, 'the first rung quotes the question on screen');
  const third = quickHint(learner(), sections, { question: { ...Q, mine: 'ETL me transform pehle' } }, 2);
  assert.ok(third.text.length > first.text.length, 'asking again reveals more, not the same lines');
  assert.match(third.text, /Structure:/, 'the structure rung names how the answer is shaped');
  assert.notEqual(first.text, third.text);
});

test('assistant: accuracy reports the real numbers, and admits when there are none', () => {
  const blank = quickAccuracy(learner(), sections);
  assert.match(blank.text, /koi answer record nahi/);

  const state = learner({
    'qb:s19:interview:0': { done: true, score: 90 },
    'qb:s19:interview:1': { done: false, score: 30 },
    'qb:s22:interview:0': { done: true, score: 100 },
  });
  const report = quickAccuracy(state, sections);
  assert.match(report.text, /67%/, '2 of 3 correct, as a percentage');
  assert.match(report.text, /73%/, 'and the rubric average of what was written');
  assert.match(report.text, /kamzor/i, 'weak sections are ranked, weakest first');
});

test('assistant: typed questions route to the item actions', () => {
  const ctx = { question: { ...Q, mine: 'ETL me transform pehle' } };
  const answered = askLocal('poora answer do', sections, learner(), ctx);
  assert.match(answered.text, /ETL me transform load se pehle/, '"poora answer do" answers the item');
  const scored = askLocal('mera answer kitna sahi hai', sections, learner(), ctx);
  assert.match(scored.text, /rubric score/, '"kitna sahi" scores it');
  // Without a question in context the same request must still say something true, not crash.
  const solo = askLocal('mera answer kitna sahi hai', sections, learner());
  assert.ok(solo.text.length > 10);
});

/* ------------------- the line under every notebook ------------------- */

test('notebook nav: previous/next sits under every notebook, from the shared engine', () => {
  const cells = read('src/components/code/NotebookCells.tsx');
  // One row, in the engine, so a lesson task, the lab and question-bank practice all get it.
  assert.match(cells, /className="nb-nav"/, 'the navigation line must be part of the notebook engine');
  assert.match(cells, /Pichla cell/, 'cell-step back');
  assert.match(cells, /Agla cell/, 'cell-step forward');
  assert.match(cells, /const moveCell = useCallback\(\(dir: -1 \| 1\)/, 'both directions share one walker');
  assert.match(cells, /export interface NbNav/, 'the notebook-step contract is exported');
  assert.match(cells, /nav\?\.prev && /, 'a previous notebook renders only when the caller has one');
  // Cell stepping must work with no list at all, and the row must sit after the cells it walks.
  assert.ok(cells.indexOf('className="nb-nav"') > cells.indexOf('{all.map((cell, cellIndex) =>'), 'below the cells');
  assert.ok(cells.indexOf('className="nb-nav"') < cells.indexOf('{showStdin && ('), 'above the program input');

  // The surfaces that own a notebook list must pass the steps in, or the right-hand buttons vanish.
  assert.match(read('src/components/code/JupyterNotebook.tsx'), /nav=\{\{ prev: step\(-1\), next: step\(1\) \}\}/, 'the in-lesson shelf wires it');
  assert.match(read('src/features/labs/NotebookLab.tsx'), /nav=\{\{ prev: step\(-1\), next: step\(1\) \}\}/, 'the Notebook Lab wires it');
  assert.match(read('src/features/labs/NotebookLab.tsx'), /const step = \(d: -1 \| 1\)/, 'from its own ordered list');
  assert.match(read('src/styles.css'), /^\.nb-nav \{/m, 'and the row has real styles');
});

test('surfaces: a ring with nothing measured says so instead of drawing 0%', () => {
  // `ProgressRing` prints `${pct}%` in its centre, so the accuracy block had to pass `pct ?? 0` to
  // keep the ring's arc empty — and the ring then stated a literal "0%" over zero graded answers,
  // which reads as a verdict. The optional `text` lets a caller draw an empty ring and print a dash.
  const ui = read('src/components/ui/ui.tsx');
  assert.match(ui, /text\?: string \}/, 'ProgressRing must accept a text override');
  assert.match(ui, /\{text \?\? `\$\{pct\}%`\}/, 'and must still default to the real percentage');

  const progress = read('src/features/progress/Progress.tsx');
  const ring = progress.match(/<ProgressRing pct=\{bank\.pct[^/]*\/>/s)?.[0] ?? '';
  assert.match(ring, /text=\{pctText\(bank\.pct\)\}/, 'the accuracy ring prints a dash when unmeasured');
});

test('surfaces: a stage panel reports the accuracy of ITS OWN questions', () => {
  // The stage line reads "tumne 3/123 grade kiye · answer accuracy X%" — one sentence, so both
  // numbers must come from the same set. Using the section-wide figure there printed, live,
  // "tumne 0/123 grade kiye · answer accuracy 100% (1/1 sahi)" on /lesson/s19/interview, because
  // an s19 theory answer graded in another stage counted.
  const src = read('src/components/learning/StageQnA.tsx');
  assert.match(src, /tally\(items\.map\(\(q\) => attemptOf\(q\.id\)\)/, 'accuracy over this stage items');
  assert.ok(!/bankAccuracy\(state, sectionId\)/.test(src), 'never the whole section behind a stage line');
});

test('surfaces: track accuracy ranks only tracks with GRADED answers', () => {
  const progress = read('src/features/progress/Progress.tsx');
  // A track where answers were written but none graded has no percentage; ranking it would print
  // "SQL (0/0 sahi) —" as the weakest track, which is what the live page showed before this.
  assert.match(progress, /\.filter\(\(r\) => r\.graded > 0\)/, 'ungraded tracks are not ranked');
  assert.ok(!/\.filter\(\(r\) => r\.answered > 0\)/.test(progress), 'answered-but-ungraded is not a ranking');
  assert.match(progress, /if \(!rows\.length\) return null;/, 'and the block hides itself when there is nothing to rank');
});

test('notebook nav: each cell shows the percentage of its last run', () => {
  const cells = read('src/components/code/NotebookCells.tsx');
  assert.match(cells, /score=\{attemptPct\(state\.attempts\[notebookCell\(slug, cell\.id\)\]\)\}/,
    'the cell reads its own stored score');
  assert.match(cells, /\{score\}%/, 'and prints it as a percentage');
  assert.match(cells, /notebookAccuracy\(state, slug\)/, 'the toolbar reports the notebook-wide pass rate');
});
