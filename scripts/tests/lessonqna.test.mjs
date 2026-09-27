/**
 * Lesson stage Q&A contracts — the rules that put the question bank INSIDE each stage.
 *
 * The PDF's per-stage Q&A (LEARN → theory, INTERVIEW → interview, CODING LAB → coding, …) is
 * the practice material for that stage, so it belongs on the stage itself. Three things can
 * silently go wrong, and none of them crashes:
 *
 *   · a stage is missed, so one whole stage still sends the learner off to another page;
 *   · the panel writes its OWN progress key, splitting a learner's history in two;
 *   · the panel starts touching the mastery gates, which would change what "Mastered" means —
 *     practice must not silently raise or lower a completion threshold.
 *
 * Plus the counting: the stage tiles and the hero stats read a per-stage number, and a number
 * that disagrees with the questions behind it is worse than no number.
 *
 * Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const lesson = read('src/pages/Lesson.tsx');
const chrome = read('src/components/SectionChrome.tsx');
const qna = read('src/components/StageQnA.tsx');
const data = read('src/data/questions.ts');

/** The nine stages the PDF actually has; `project` is not one of them. */
const STAGES_WITH_QNA = ['checkpoint', 'coding', 'debug', 'defense', 'interview', 'learn', 'logic', 'mini', 'solved'];

test('lessonqna: every stage with bank content mounts its own Q&A, and Project Lab does not', () => {
  for (const st of STAGES_WITH_QNA) {
    const n = (lesson.match(new RegExp(`stage="${st}"`, 'g')) || []).length;
    assert.equal(n, 1, `Lesson must mount StageQnA exactly once for "${st}" (found ${n})`);
  }
  // The PDF has no project band, so Project Lab has no bank stage and must not pretend to.
  assert.ok(!/stage="project"/.test(lesson), 'Project Lab has no bank stage to mount');
  assert.ok(!/^\s{2}project:/m.test(data), 'STAGE_QNA must not invent a project mapping');
});

test('lessonqna: the stage → bank mapping is one source of truth for panel and counts', () => {
  const declared = [...data.matchAll(/^ {2}(\w+): \{ types: \[([^\]]+)\](?:, tag: '([^']+)')?, label:/gm)]
    .map(([, stage, types, tag]) => ({ stage, types, tag }));
  assert.deepEqual(declared.map((d) => d.stage).sort(), STAGES_WITH_QNA, 'STAGE_QNA must cover exactly those stages');

  // MINI PROJECT reuses the `coding` type, so the tag is the only thing separating the two
  // stages — both the panel filter and the manifest split depend on it.
  assert.equal(declared.find((d) => d.stage === 'mini').tag, 'mini-project');
  assert.match(declared.find((d) => d.stage === 'coding').types, /'coding'/);

  // One helper decides what a stage holds, and the tile/hero counters read the same map. The
  // panel passes the stage's OWN question texts, so a question the stage already renders is not
  // asked a second time further down the same page.
  assert.match(data, /export function stageQuestions\(/);
  assert.match(data, /export const STAGE_QNA/);
  assert.match(qna, /stageQuestions\(bank, stage, owns\)/);
  assert.match(qna, /stageOwnTexts\(stage, section\)/);
  assert.match(lesson, /manifestStageCount\(bankManifest, sec\.id, st\)/);
});

test('lessonqna: practicing in a stage writes the bank key, and never a mastery gate', () => {
  assert.match(qna, /bankAttempt\(q\.id\)/, 'the panel must reuse the Question Bank attempt key');
  assert.match(qna, /recordAttempt\(bankAttempt\(q\.id\)/, 'grading must persist under that same key');
  // No gate key may appear here: practice is not a gate, and a stray stageAttempt would make
  // the panel able to pass a stage the learner has not actually finished.
  for (const gate of ['stageAttempt', 'itemAttempt', 'debugDone', 'learnView', 'finalTaskAttempt', 'interviewAnswer', 'lessonDefenseAnswer']) {
    assert.ok(!qna.includes(gate), `StageQnA must not touch "${gate}" — it is practice, not a gate`);
  }
});

test('lessonqna: drafts never leak into a lesson', () => {
  assert.match(data, /if \(q\.status !== 'PUBLISHED'\) return false;/, 'stageQuestions must filter drafts, as the bank UI does');
  assert.match(qna, /if \(bank && !items\.length\) return null;/, 'a stage with no questions stays quiet');
});

test('lessonqna: the stage tile badge shows a real count and survives a not-applicable stage', () => {
  assert.match(chrome, /countOf\?: \(st: Stage\) => number \| null/, 'StageGrid must accept a per-stage count');
  assert.match(chrome, /\{count\} Q&A/, 'the tile must render the count');
  // Checkpoint is outside several topics' mastery gates yet still carries ~56 questions, so the
  // badge cannot be suppressed by `na` — that is exactly the case that looked like failed content.
  assert.ok(!/na \|\| !countOf/.test(chrome), 'the badge must not be hidden just because the stage is not applicable');
  assert.match(chrome, /mastery gate nahi/, 'a not-applicable stage with questions must say so honestly');
});

test('lessonqna: the stage ↔ type mapping has exactly one owner', () => {
  // The bug this locks: `TYPE_STAGE` was a second, hand-written copy of the mapping and it
  // disagreed with STAGE_QNA (`solved → coding`), so the Practice button on a solved question
  // opened Coding Lab — a stage whose panel does not contain that question. One map means one
  // behaviour; a new table is the failure mode, so the name is banned across src/.
  const srcFiles = fs.readdirSync(path.join(ROOT, 'src'), { recursive: true })
    .filter((f) => /\.(ts|tsx)$/.test(String(f)))
    .map((f) => `src/${String(f).replace(/\\/g, '/')}`);
  assert.ok(srcFiles.length > 50, 'the src/ scan must see the whole app, not a stale directory');
  // A *declaration* is what matters, not the word: the surviving mention is this file's own
  // explanation of what went wrong, and deleting history to satisfy a grep is not a lock.
  const withTable = srcFiles.filter((f) => /\bTYPE_STAGE\b\s*[:=]/.test(read(f)));
  assert.deepEqual(withTable, [], 'TYPE_STAGE is a second copy of the mapping — derive it from STAGE_QNA');

  // Both bank surfaces reach a lesson through that one function, and neither builds its own id.
  for (const f of ['src/pages/QuestionBank.tsx', 'src/pages/ExamMode.tsx']) {
    const src = read(f);
    assert.match(src, /stageForQuestion\(q\)/, `${f} must route through stageForQuestion`);
    assert.match(src, /\/lesson\/\$\{[^}]+\}\/\$\{stageForQuestion\(q\)\}/, `${f} must not invent its own stage id`);
  }
});

/**
 * Executed, not pattern-matched: Node 22.18+/24 strips the types, so the test can drive the real
 * `stageForQuestion` + `stageQuestions` over a synthetic bank and assert the property that was
 * measurably broken — a question's link opens the stage that renders that question.
 */
test('lessonqna: every question links to the stage that really renders it', async (t) => {
  if (!process.features.typescript) return t.skip('needs a Node that strips TypeScript types (22.18+ / 24)');
  const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  const { STAGE_QNA, QUESTION_TYPES, stageQuestions, stageForQuestion } = await load('src/data/questions.ts');
  assert.equal(typeof stageForQuestion, 'function', 'the mapping must be derived in code, not by hand');

  // The lesson's own stage list, read from its single owner (`src/engine/progress.ts`): that file
  // imports extensionless './keys', which Node's type stripping cannot resolve, so the declaration
  // is parsed rather than imported — still the one source, never a copy kept in the test.
  const stageList = (read('src/engine/progress.ts').match(/export const STAGES = \[([^\]]+)\]/) ?? [])[1] ?? '';
  const LESSON_STAGES = [...stageList.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(LESSON_STAGES.length >= 9, 'the lesson stage list must be readable from its own declaration');

  const q = (type, tags = []) => ({
    id: `q:${type}${tags.length ? `:${tags[0]}` : ''}`, sectionId: 's01', type, tags,
    status: 'PUBLISHED', difficulty: 'easy', question: type, answer: 'a',
  });
  const bank = { sectionId: 's01', questions: [...QUESTION_TYPES.map((t) => q(t)), q('coding', ['mini-project'])] };

  for (const item of bank.questions) {
    const stage = stageForQuestion(item);
    assert.ok(LESSON_STAGES.includes(stage), `${item.type} links to "${stage}", which is not a lesson stage`);
    assert.ok(stage in STAGE_QNA, `${item.type} links to "${stage}", which mounts no Q&A panel`);
    assert.ok(stageQuestions(bank, stage).some((x) => x.id === item.id),
      `${item.type} → "${stage}": the panel does not contain the question it was linked from`);
  }

  // The two ends that were wrong or ambiguous, pinned by name.
  assert.equal(stageForQuestion(q('solved')), 'solved', 'solved belongs to the Solved stage, never Coding Lab');
  assert.equal(stageForQuestion(q('coding')), 'coding');
  assert.equal(stageForQuestion(q('coding', ['mini-project'])), 'mini');
  assert.equal(stageQuestions(bank, 'coding').length, 1, 'Coding Lab must not claim the mini-project item');
});

/**
 * The two things a written answer must never lose: the place it is stored, and the fact that it is
 * stored at all. Every answer box in the app used to be `useState('')`, so a refresh mid-sentence
 * dropped the text and the mistake tracker had to file a placeholder like "(self-grade: galat)"
 * because there was nothing else to file.
 */
test('lessonqna: a written answer has one home, and every box writes to it', () => {
  // One reader and one writer, and they live with the store that persists them.
  assert.match(read('src/offline/store.ts'), /export function savedAnswer\(state: AppState, key: string\)/);
  assert.match(read('src/offline/store.ts'), /export function saveAnswer\(key: string, text: string\)/);
  assert.match(read('src/offline/store.ts'), /export function useSavedAnswer\(key: string\)/);

  // The surfaces that ask a question all go through it, keyed by the same key their grade uses.
  for (const [file, key] of [
    ['src/components/StageQnA.tsx', 'bankAttempt(q.id)'],
    ['src/pages/QuestionBank.tsx', 'bankAttempt(q.id)'],
  ]) {
    assert.match(read(file), new RegExp(`useSavedAnswer\\(${key.replace(/[.()]/g, '\\$&')}\\)`), `${file} must persist the typed answer`);
  }
  assert.match(lesson, /useSavedAnswer\(itemAttempt\(sec\.id, 'logic', safeIdx\)\)/, 'the logic drill must keep its answer');
  assert.match(lesson, /useSavedAnswer\(debugDone\(sec\.id\)\)/, 'the debug explanation must keep its text');

  // The placeholder that proved the text was never captured is gone from the bank surfaces.
  assert.ok(!/\(self-grade: galat\)/.test(read('src/pages/QuestionBank.tsx')), 'the bank must file the learner\'s own words');
  assert.ok(!/\(stage Q&A: galat\)/.test(qna), 'the stage panel must file the learner\'s own words');
});

/**
 * The bank notebook. Practising a coding question in place is only useful if the code survives, so
 * its storage slot must be its own family — `code:qb:<id>` — and must not collide with the
 * `qb:<id>` attempt record, which the bank page counts by prefix.
 */
test('lessonqna: the question-bank notebook saves code under its own key family', async (t) => {
  if (!process.features.typescript) return t.skip('needs a Node that strips TypeScript types (22.18+ / 24)');
  const { bankAttempt, codeSlot, BANK_CODE_PREFIX, BANK_ATTEMPT_PREFIX } = await import(
    pathToFileURL(path.join(ROOT, 'src/engine/keys.ts')).href);
  const id = 's17:coding:3';
  assert.equal(codeSlot.bank(id), `code:qb:${id}`);
  assert.notEqual(codeSlot.bank(id), bankAttempt(id), 'saved code and the attempt record are different things');
  assert.ok(codeSlot.bank(id).startsWith(BANK_CODE_PREFIX));
  // The bank page counts its own grades with `startsWith('qb:')`; saved code must not answer that.
  assert.ok(!codeSlot.bank(id).startsWith(BANK_ATTEMPT_PREFIX), 'saved code must not look like a graded question');

  // Mounted only when the learner asks for it — a kernel per question would sink the page.
  for (const file of ['src/components/StageQnA.tsx', 'src/pages/QuestionBank.tsx']) {
    const src = read(file);
    assert.match(src, /storageKey=\{codeSlot\.bank\(q\.id\)\}/, `${file} must key the notebook per question`);
    assert.match(src, /\{notebook && \(/, `${file} must build the notebook lazily`);
  }
});

/**
 * Executed against the REAL pack, not a fixture: the number on a stage tile must be the number of
 * questions the panel below it shows.
 *
 * The tile reads the manifest and the panel filters the bank, and those are two different files
 * written by two different programs (the build mirror in `scripts/lib/banks.cjs` and the runtime in
 * `src/data/questions.ts`). They can only import each other in one direction, so this is the lock
 * that keeps them one number: if either the dedupe or the stage filter drifts, this fails.
 */
test('lessonqna: every stage tile count equals what that stage really shows', async (t) => {
  if (!process.features.typescript) return t.skip('needs a Node that strips TypeScript types (22.18+ / 24)');
  const { STAGE_QNA, stageQuestions, stageOwnTexts } = await import(
    pathToFileURL(path.join(ROOT, 'src/data/questions.ts')).href);
  const manifest = JSON.parse(read('public/questions/manifest.json'));
  const sections = JSON.parse(read('public/curriculum/sections.json'));
  const sectionById = new Map(sections.map((s) => [s.id, s]));
  const stages = Object.keys(STAGE_QNA);

  let checked = 0, deduped = 0;
  for (const entry of manifest.sections) {
    const section = sectionById.get(entry.sectionId);
    assert.ok(section, `${entry.sectionId}: bank without a curriculum section`);
    const bank = JSON.parse(read(`public/questions/${entry.sectionId}.json`));
    for (const stage of stages) {
      const shown = stageQuestions(bank, stage, stageOwnTexts(stage, section));
      assert.equal(entry.byStage[stage], shown.length,
        `${entry.sectionId}/${stage}: the tile says ${entry.byStage[stage]}, the panel shows ${shown.length}`);
      const withoutOwn = stageQuestions(bank, stage);
      assert.ok(shown.length <= withoutOwn.length, `${stage}: dedupe can only remove questions, never add`);
      deduped += withoutOwn.length - shown.length;
      checked++;
    }
  }
  assert.ok(checked >= 29 * 9, 'every section × stage pair must be checked');
  assert.ok(deduped > 0, 'the pack has known duplicate Q&A — a dedupe of 0 means the rule stopped working');
});

test('lessonqna: the hero stats answer "how much can I practise here"', () => {
  assert.match(lesson, /l: 'Learn Q&A'/);
  assert.match(lesson, /l: 'Q&A Total'/);
  assert.match(lesson, /bankManifest\?\.sections\.find\(\(s\) => s\.sectionId === sec\.id\)\?\.published/);
  // The taxonomy counts stay as the pre-manifest fallback rather than becoming the number.
  assert.match(lesson, /\?\? sec\.learn\.concepts\.length/);
});
