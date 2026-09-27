/**
 * Flow tests — the gated course model and the "what happens after I finish this?" ladder.
 *
 * These run against the app's REAL engines (`src/engine/progress.ts`, `src/engine/advance.ts`)
 * loaded through `_ts-resolve.mjs`, and against the REAL curriculum in
 * `public/curriculum/sections.json`. Nothing here is a copy of the logic: a copy would keep
 * passing while the app broke, which is exactly how three bugs survived until now —
 *
 *   · debug tasks were counted in the Coding Lab's denominator, so the Coding score could never
 *     reach 100% and its item keys drifted;
 *   · stages a section has no content for (no debug task, no checkpoint bank) read as "not done",
 *     so the path could stall on a page that only says "nothing here";
 *   · the Defense stage demanded 70 while mastery demanded 60, so a passing defense still showed
 *     as an unfinished stage.
 *
 * Zero dependencies — built-in node:test runner with the project's TS resolver hook. `npm test`
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

// The app resolves `./progress` to `progress.ts` (bundler resolution); Node needs a nudge.
register('./_ts-resolve.mjs', import.meta.url);

const progress = await load('src/engine/progress.ts');
const advance = await load('src/engine/advance.ts');
const { STAGES, STAGE_PASS, codingTasks, debugTasks, stageApplies, stagePassed, sectionProgress, missingForMastery, isMastered } = progress;
const { planNextStep, nextItemIndex, nextOpenStage, openItems, stageTileState } = advance;

const sections = JSON.parse(read('public/curriculum/sections.json'));
const all = Array.isArray(sections) ? sections : sections.sections;
const BY_ID = (id) => all.find((s) => s.id === id);

/** A fresh learner: no attempts, no saved code — the state every section starts from. */
const blank = () => ({
  version: 1,
  profile: { name: 'T', goal: 'g', level: 'Beginner', dailyMinutes: 60, onboarded: false },
  xp: 0,
  streak: { current: 0, last: '' },
  attempts: {},
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

/** Mark every item gate of a stage done (what the stage components write). */
const finishItems = (state, sec, stage) => {
  for (let i = 0; i < advance.stageItems(sec, stage).count; i++) {
    state.attempts[`st:${sec.id}:${stage}${i}`] = { done: true };
  }
  return state;
};
/** Mark a whole stage's gate passed, using the same thresholds the engine publishes. */
const finishStage = (state, sec, stage) => {
  if (stage === 'learn') { state.attempts[`view:${sec.id}:learn`] = { done: true }; return state; }
  if (stage === 'mini' || stage === 'project') { state.attempts[`st:${sec.id}:${stage}`] = { done: true }; return state; }
  if (stage === 'debug') { state.attempts[`st:${sec.id}:debugdone`] = { done: true }; return state; }
  if (stage === 'coding' || stage === 'logic' || stage === 'solved') return finishItems(state, sec, stage);
  state.attempts[`st:${sec.id}:${stage}`] = { done: true, score: STAGE_PASS[stage] ?? 70 };
  return state;
};

test('flow: the Coding Lab list is the only coding list (debug tasks have their own stage)', () => {
  for (const sec of all) {
    const coding = codingTasks(sec);
    assert.equal(coding.length + debugTasks(sec).length, sec.coding.length, `${sec.id}: task lists must partition sec.coding`);
    assert.ok(!coding.some((c) => c.difficulty === 'debug'), `${sec.id}: a debug task leaked into the coding list`);
  }
  // The lesson must not roll its own filter again — that is what made the keys drift.
  const lesson = read('src/pages/Lesson.tsx');
  assert.ok(!/sec\.coding\.filter\(/.test(lesson), 'Lesson.tsx filters sec.coding inline; use codingTasks()/debugTasks()');
});

test('flow: coding progress reaches exactly 100% when every coding task is done', () => {
  // Regression: debug tasks used to sit in the denominator, so the score capped at 89% forever.
  for (const sec of all) {
    if (!debugTasks(sec).length) continue;
    const state = finishItems(blank(), sec, 'coding');
    const { tasks } = sectionProgress(sec, state);
    assert.equal(tasks.coding, 100, `${sec.id}: coding stuck at ${tasks.coding}% with all ${codingTasks(sec).length} tasks done`);
  }
});

test('flow: a stage a section has no content for never blocks mastery', () => {
  for (const sec of all) {
    for (const stage of ['debug', 'checkpoint']) {
      if (stageApplies(sec, stage)) continue;
      const state = blank();
      assert.equal(stagePassed(sec, state, stage), true, `${sec.id}: empty ${stage} stage must not block`);
      assert.equal(stageTileState(sec, state, stage), 'na', `${sec.id}: empty ${stage} tile must read n/a`);
      assert.deepEqual(
        missingForMastery(sec, state).filter((m) => m.toLowerCase().includes(stage)),
        [],
        `${sec.id}: ${stage} must not appear in the mastery list`,
      );
      // and the ladder must never send the learner there
      const step = nextOpenStage(sec, state, null);
      assert.notEqual(step, stage, `${sec.id}: the path pointed at an impossible ${stage} stage`);
    }
  }
});

test('flow: the defense gate is the same number everywhere (60)', () => {
  assert.equal(STAGE_PASS.defense, 60, 'the defense threshold lives in one table');
  const sec = BY_ID('s01');
  const state = finishStage(finishStage(finishStage(finishStage(finishStage(finishStage(finishStage(blank(), sec, 'learn'), sec, 'interview'), sec, 'coding'), sec, 'logic'), sec, 'debug'), sec, 'solved'), sec, 'mini');
  state.attempts[`st:${sec.id}:project`] = { done: true };
  state.attempts[`st:${sec.id}:defense`] = { done: true, score: 65 };
  assert.equal(stagePassed(sec, state, 'defense'), true, 'a 65 defense is a pass, not a permanently open stage');
  assert.deepEqual(missingForMastery(sec, state).filter((m) => m.includes('defense')), [], 'mastery must agree with the tile');
});

test('flow: nextItemIndex walks to the next open item and wraps back to a skipped one', () => {
  const sec = BY_ID('s01');
  const n = advance.stageItems(sec, 'coding').count;
  const state = blank();
  assert.equal(nextItemIndex(sec, state, 'coding', 0), 1, 'fresh stage → the item after the finished one');
  state.attempts[`st:${sec.id}:coding1`] = { done: true };
  assert.equal(nextItemIndex(sec, state, 'coding', 0), 2, 'skips a done item');
  // only the LAST item is open → the walk wraps around to it
  const only = blank();
  for (let i = 0; i < n - 1; i++) only.attempts[`st:${sec.id}:coding${i}`] = { done: true };
  assert.equal(nextItemIndex(sec, only, 'coding', 0), n - 1, 'a skipped last item is still found');
  const allDone = finishItems(blank(), sec, 'coding');
  assert.equal(nextItemIndex(sec, allDone, 'coding', 0), null, 'no open item → null');
  assert.equal(openItems(sec, allDone, 'coding'), 0);
});

test('flow: finishing an item offers the next item, then the next stage, then the next topic', () => {
  const sec = BY_ID('s01');

  // 1 — a fresh section: the coding item after the one just finished, same page
  const s1 = blank();
  const step1 = planNextStep(all, sec, s1, 'coding', 0);
  assert.equal(step1.kind, 'item');
  assert.equal(step1.index, 1);
  assert.equal(step1.route, '', 'an in-stage step must not navigate anywhere');
  assert.match(step1.label, /Task 2 \/ \d+/);

  // 2 — every coding item done: point at the next stage that still blocks
  const s2 = finishItems(blank(), sec, 'coding');
  const step2 = planNextStep(all, sec, s2, 'coding', 0);
  assert.equal(step2.kind, 'stage');
  assert.match(step2.route, new RegExp(`^/lesson/${sec.id}/[a-z]+$`));
  assert.ok(stageApplies(sec, step2.route.split('/').pop()), 'never suggest a stage the section does not have');

  // 3 — the whole section mastered: move to the next unmastered topic
  const s3 = blank();
  for (const stage of STAGES) finishStage(s3, sec, stage);
  assert.equal(isMastered(sec, s3), true, 'the simulation really mastered the section');
  const step3 = planNextStep(all, sec, s3, 'checkpoint');
  assert.equal(step3.kind, 'section');
  assert.notEqual(step3.route, `/lesson/${sec.id}/learn`);
  assert.match(step3.route, /^\/lesson\/s\d+\/learn$/);

  // 4 — the last section of the course: hand over to the review queue
  const last = all[all.length - 1];
  const s4 = blank();
  for (const stage of STAGES) finishStage(s4, last, stage);
  for (const other of all) for (const stage of STAGES) finishStage(s4, other, stage);
  const step4 = planNextStep(all, last, s4, 'checkpoint');
  assert.equal(step4.kind, 'review');
  assert.equal(step4.route, '/review');
});

test('flow: from any section, on any stage, the ladder always has somewhere honest to go', () => {
  for (const sec of all) {
    const state = blank();
    for (const stage of STAGES) {
      const step = planNextStep(all, sec, state, stage, 0);
      assert.ok(step, `${sec.id}/${stage}: the lesson has nothing to suggest`);
      if (step.kind !== 'item') {
        assert.match(step.route, /^\/(lesson|review)/, `${sec.id}/${stage}: ${step.route} is not a real route`);
        assert.ok(step.label.trim().length > 0, `${sec.id}/${stage}: the step needs a label`);
        assert.ok(step.hint.trim().length > 0, `${sec.id}/${stage}: the step needs a reason`);
      }
      if (step.kind === 'stage') {
        const target = step.route.split('/').pop();
        assert.ok(stageApplies(sec, target), `${sec.id}/${stage}: suggested the non-applicable ${target}`);
      }
    }
  }
});

test('flow: a stage is only ever left alone when its real gate is satisfied', () => {
  const sec = BY_ID('s02');
  const state = blank();
  state.attempts[`view:${sec.id}:learn`] = { done: true };
  state.attempts[`st:${sec.id}:interview`] = { done: true, score: 68 };

  // Learn has per-concept gates of its own, so the first thing it offers is the next concept…
  const inLearn = planNextStep(all, sec, state, 'learn', 0);
  assert.equal(inLearn.kind, 'item');
  assert.equal(inLearn.index, 1);

  // …and once its concepts are all run, the 68% interview gate is what the ladder points at.
  finishItems(state, sec, 'learn');
  const fromLearn = planNextStep(all, sec, state, 'learn', 0);
  assert.equal(fromLearn.kind, 'stage');
  assert.equal(fromLearn.route, `/lesson/${sec.id}/interview`, 'a 68% interview stage is still the open gate');

  // From the interview stage itself: the reason must admit the gate is short, not claim a pass.
  const fromInterview = planNextStep(all, sec, state, 'interview');
  assert.equal(fromInterview.kind, 'stage');
  assert.notEqual(fromInterview.route, `/lesson/${sec.id}/interview`, 'never re-offer the page you are on');
  assert.match(fromInterview.hint, /poora nahi hua|% kam/i, 'the reason must say the gate is not satisfied yet');

  // And once it is satisfied, the wording flips to a clean hand-off.
  state.attempts[`st:${sec.id}:interview`] = { done: true, score: 82 };
  const after = planNextStep(all, sec, state, 'interview');
  assert.match(after.hint, /clear — ab/i, 'a satisfied gate reads as clear');
});

test('flow: the lesson watches every stage a learner can finish (none can silently stall)', () => {
  // Regression found in the browser: `interview` was missing from the advance watcher, so grading
  // your last answer did nothing; and defense/checkpoint advanced on the mere EXISTENCE of an
  // attempt, so a defense scored 40% still offered to move you on.
  const lesson = read('src/pages/Lesson.tsx');
  const block = lesson.slice(lesson.indexOf('const scoredStage'), lesson.indexOf('const focusDone'));
  assert.ok(block.length > 0, 'Lesson.tsx must define focusKey before focusDone');
  for (const stage of ['interview', 'defense', 'checkpoint', 'coding', 'logic', 'learn', 'debug', 'mini', 'project']) {
    assert.ok(block.includes(`'${stage}'`), `${stage} is not watched — finishing it would stall the learner`);
  }
  assert.match(lesson, /focusDone = scoredStage \? stagePassed\(/, 'a scored stage must advance on stagePassed(), not on the attempt existing');

  // The distinction the component depends on, proved against the real engine:
  const sec = BY_ID('s01');
  const state = blank();
  state.attempts[`st:${sec.id}:defense`] = { done: true, score: 40 };
  assert.equal(stagePassed(sec, state, 'defense'), false, 'a 40% defense records an attempt but must not pass the gate');
  state.attempts[`st:${sec.id}:defense`] = { done: true, score: 60 };
  assert.equal(stagePassed(sec, state, 'defense'), true, 'the defense gate is 60%');
});

/** A learner who has mastered one section completely. */
const mastered = (sec) => {
  const s = blank();
  for (const stage of STAGES) finishStage(s, sec, stage);
  return s;
};

test('flow: the road ahead only ever lists real, still-open work', () => {
  // The preview is read BEFORE anything is finished, so it is the one screen with no completion to
  // react to. It must derive from the same gates anyway, or it becomes a wish list that sends the
  // learner to a page that is already done (or to a stage their topic does not even have).
  for (const sec of all) {
    for (const stage of STAGES) {
      const cases = [
        ['fresh', blank()],
        ['coding finished', finishItems(blank(), sec, 'coding')],
        ['section mastered', mastered(sec)],
      ];
      for (const [name, state] of cases) {
        const rows = advance.planAhead(all, sec, state, stage, 0);
        const where = `${sec.id}/${stage} (${name})`;
        assert.ok(rows.length >= 1, `${where}: the plan must never come back empty`);
        assert.equal(rows[0].now, true, `${where}: row 0 is what to do right now`);
        assert.equal(rows.filter((r) => r.now).length, 1, `${where}: exactly one NOW row`);
        assert.ok(rows.length <= 4, `${where}: ${rows.length} rows is a syllabus, not a glance`);

        for (const r of rows) {
          assert.ok(r.label && r.hint && r.minutes, `${where}: every row must explain itself`);
          if (r.kind === 'stage') {
            const st = r.route.split('/').pop();
            assert.ok(STAGES.includes(st), `${where}: ${r.route} does not point at a stage`);
            assert.ok(stageApplies(sec, st), `${where}: the plan suggests the impossible ${st} stage`);
            assert.ok(!stagePassed(sec, state, st), `${where}: the plan suggests ${st}, which is already passed`);
          }
          if (r.kind === 'item') {
            assert.equal(r.route, '', `${where}: an in-stage step must not navigate`);
            assert.equal(typeof r.index, 'number', `${where}: an item row must carry its index`);
            assert.ok(!state.attempts[`st:${sec.id}:${stage}${r.index}`], `${where}: the NOW item must still be open`);
          }
        }
      }
    }
  }
});

test('flow: the road ahead ends at the next topic, and admits what it left out', () => {
  const sec = BY_ID('s01');
  const state = blank();
  const rows = advance.planAhead(all, sec, state, 'learn', 0, 2);

  const nextSec = advance.nextOpenSection(all, state, sec.id);
  const last = rows[rows.length - 1];
  assert.equal(last.kind, 'section', 'the plan must hand over to the next topic');
  assert.equal(last.route, `/lesson/${nextSec.id}/learn`);

  // Two middle rows max, so s01's remaining stages are deliberately left out — and said so.
  const blocking = STAGES.filter((s) => s !== 'learn' && stageApplies(sec, s) && !stagePassed(sec, state, s));
  assert.ok(blocking.length > 2, 's01 should have more than two stages left to exercise the cap');
  assert.equal(rows.filter((r) => r.kind === 'stage' && !r.now).length, 2, 'the middle is capped at two');
  assert.match(last.hint, new RegExp(`Pehle is section ke ${blocking.length - 2} stage`), 'the exit must not overstate how short the list is');
});

test('flow: the preview describes the item on screen, not the one after it', () => {
  const sec = BY_ID('s01');
  const state = blank();
  // Sitting on task 3 with tasks 1-2 done: the preview must say "task 3", because that is the item
  // in front of the learner. (The post-completion card answers the other question — "what next?".)
  const onScreen = advance.planAhead(all, sec, state, 'coding', 2);
  assert.equal(onScreen[0].kind, 'item');
  assert.equal(onScreen[0].index, 2, 'the open item on screen is the next step');

  // Finish it and the preview rolls to the following open item, with no state change of its own.
  state.attempts[`st:${sec.id}:coding2`] = { done: true };
  const rolled = advance.planAhead(all, sec, state, 'coding', 2);
  assert.equal(rolled[0].index, 3, 'a finished item is never still offered');
});

test('flow: the in-stage selection is re-derived when the topic or the link changes', () => {
  // Seeded only once, the index is a position inside the PREVIOUS section's lists — so jumping to
  // the next topic dropped the learner halfway down a list they had never opened, or past the end
  // of a shorter one, and a fresh ?task= link on the page they were already on did nothing at all.
  const lesson = read('src/pages/Lesson.tsx');
  assert.match(
    lesson,
    /useEffect\(\(\) => \{ setSel\(seed\(\)\); \}, \[sec\.id, taskParam, cardParam\]\)/,
    'sel must be re-derived from the section id and the deep link, not seeded once',
  );
  assert.match(lesson, /nextItemIndex\(sec, state, 'coding', -1\)/, 'with no link, a lab resumes at the next open item');
});

test('flow: only stages with a real per-item gate offer "the next item"', () => {
  const sec = BY_ID('s01');
  for (const stage of ['coding', 'logic', 'solved', 'learn']) {
    assert.ok(stageItemsSafe(stage), `${stage}`);
  }
  // interview/defense/checkpoint/mini/project are scored or single gates — no item list.
  for (const stage of ['interview', 'defense', 'checkpoint', 'mini', 'project', 'debug']) {
    assert.equal(advance.stageItems(sec, stage), null, `${stage} must not invent an item list`);
  }
  function stageItemsSafe(stage) {
    const items = advance.stageItems(sec, stage);
    return !!items && (items.count > 0 ? typeof items.name(0) === 'string' : true);
  }
});
