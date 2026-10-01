/**
 * The canonical roadmap — 36 steps in learning order.
 *
 * This is the file that makes the re-ordering safe. The Learning Path now prints ONE sequence: the
 * master roadmap, with the Playbook V15 document's 36 chapters spread across it in the order a
 * learner should actually meet them (chapter 16 next to Python, chapter 02 after data, the
 * interview bank near the end). Two things can go wrong silently when a list is re-ordered, and
 * neither throws:
 *
 *   · a chapter falls off the road — its items become unreachable from the path (and the numbers
 *     the page prints stop adding up to the document);
 *   · a step is left with no track, or with a track that does not exist, so its links point
 *     nowhere and its progress reads as nothing.
 *
 * So the mapping is asserted against the REAL manifest and the REAL item view, and the arithmetic
 * is driven with fixtures. Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Pure (no value imports), which is what makes it loadable here.
const rm = await load('src/core/learning/roadmap.ts');

const manifest = JSON.parse(read('public/generated/playbook/manifest.json'));
const itemsView = JSON.parse(read('public/generated/playbook/items.json'));
const banks = JSON.parse(read('public/generated/questions/manifest.json'));

/** The 8 tracks, read from the real TRACK_DEFS so a renamed id fails here instead of on screen. */
const appSrc = read('src/app/App.tsx');
const defsBlock = appSrc.slice(appSrc.indexOf('export const TRACK_DEFS'), appSrc.indexOf('];', appSrc.indexOf('export const TRACK_DEFS')));
const TRACKS = [...defsBlock.matchAll(/id: '([^']+)'[^\n]*?from: (\d+), to: (\d+)/g)]
  .map((m) => ({ id: m[1], from: Number(m[2]), to: Number(m[3]) }));
const TRACK_IDS = new Set(TRACKS.map((t) => t.id));
const SECTIONS = banks.sections.map((s) => ({ id: s.sectionId, no: s.no, title: s.title }));
const CHAPTERS = manifest.chapters;
const ITEMS = itemsView.items.map((it) => ({ id: it.id, chapter: it.chapter }));

/* ------------------------------ the sequence ---------------------------- */

test('roadmap: 36 steps, numbered 1…36 with no gap and no repeat', () => {
  assert.equal(rm.STEP_COUNT, 36, 'the master roadmap is 36 steps');
  assert.deepEqual(rm.STEPS.map((s) => s.no), Array.from({ length: 36 }, (_, i) => i + 1));
});

test('roadmap: every step carries real content — a goal and its topics', () => {
  for (const s of rm.STEPS) {
    assert.ok(s.title && s.title.trim().length > 3, `step ${s.no} has no title`);
    assert.ok(s.goal && s.goal.trim().length > 10, `step ${s.no} says nothing about when it is done`);
    assert.ok(s.topics.length >= 3, `step ${s.no} lists ${s.topics.length} topics`);
    for (const topic of s.topics) assert.ok(topic.trim().length > 2, `step ${s.no}: empty topic`);
    assert.ok(rm.STEP_KINDS.includes(s.kind), `step ${s.no}: unknown kind ${s.kind}`);
  }
});

test('roadmap: the phases tile the 36 steps — contiguous, no overlap, one tone each', () => {
  let next = 1;
  const tones = new Set();
  for (const p of rm.PHASES) {
    assert.equal(p.first, next, `phase ${p.id} must start where the previous one ended`);
    assert.ok(p.last >= p.first, `phase ${p.id} ends before it starts`);
    next = p.last + 1;
    assert.ok(!tones.has(p.tone), `phase ${p.id} reuses the tone ${p.tone} — neighbouring phases would blur`);
    tones.add(p.tone);
  }
  assert.equal(next - 1, rm.STEP_COUNT, 'the phases must cover every step');
  assert.equal(rm.phaseOf(1).id, 'orientation', 'the road opens with orientation');
  assert.equal(rm.phaseOf(rm.STEP_COUNT).id, 'career', 'the road ends with the interview and the plan');
  // Every step must be reachable from exactly one phase — the lookup is what the page renders.
  for (const s of rm.STEPS) {
    const hits = rm.PHASES.filter((p) => rm.stepsOfPhase(p).some((x) => x.no === s.no));
    assert.equal(hits.length, 1, `step ${s.no} sits in ${hits.length} phases`);
    assert.equal(rm.phaseOf(s.no).id, hits[0].id);
  }
});

/* ------------------- the re-ordering loses no chapter -------------------- */

test('roadmap: every chapter of the document is on the road exactly once', () => {
  const onRoad = rm.STEPS.flatMap((s) => s.chapters);
  assert.equal(onRoad.length, new Set(onRoad).size, 'a chapter is mapped to two steps');
  const real = new Set(CHAPTERS.map((c) => c.no));
  assert.equal(real.size, 36, 'the document is 36 chapters — the road is 36 steps');
  for (const no of real) assert.ok(onRoad.includes(no), `chapter ${no} is on no step — its items would be unreachable`);
  for (const no of onRoad) assert.ok(real.has(no), `the road maps a chapter the document does not have: ${no}`);
  // The document order and the learning order are deliberately different; if they ever coincide,
  // the roadmap is not doing its job any more.
  const order = rm.STEPS.flatMap((s) => s.chapters);
  assert.notDeepEqual(order, [...order].sort(), 'the road is in document order — the re-ordering is gone');
});

test('roadmap: the master roadmap is the ten stages, in this order', () => {
  // The stage list is the product decision the rest of the page hangs off, and it is the one thing a
  // hand edit to the steps array can silently break — a step moved across a boundary re-colours the
  // stage it left and empties the one it entered. So the ORDER is asserted here, not just tiling.
  assert.deepEqual(rm.PHASES.map((p) => p.id), [
    'orientation', 'dataFoundation', 'python', 'analytics', 'dataEngineering',
    'mlNlp', 'genai', 'agents', 'build', 'career',
  ]);
  const at = (needle) => rm.STEPS.findIndex((s) => s.title.toLowerCase().includes(needle));
  // Two edges are load-bearing: data before the tool that transforms it, pipelines before models.
  assert.ok(at('statistics') < at('python core'), 'Python must come AFTER the data foundation');
  assert.ok(at('data engineering foundation') < at('machine learning foundation'), 'data engineering must come BEFORE machine learning');
  assert.ok(at('numpy') < at('sql'), 'the analysis stack reads in order: NumPy → Pandas → SQL');
  // …and the number line agrees: every stage is entered where the one before it ended.
  assert.deepEqual(rm.STEPS.slice(0, 8).map((s) => s.no), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(rm.STEPS[0].title.toLowerCase().includes('role map'), true, 'step 1 is the role map');
});

test('roadmap: the six curriculum-only steps are the ones with no chapter', () => {
  // Python, NumPy, Pandas, ML, ML engineering, NLP are taught by the curriculum's own sections.
  assert.deepEqual(rm.STEPS.filter((s) => !s.chapters.length).map((s) => s.no), [4, 6, 7, 13, 14, 15]);
  for (const s of rm.STEPS.filter((x) => !x.chapters.length)) {
    assert.ok(s.track && TRACK_IDS.has(s.track), `step ${s.no} has no chapter and no track to fall back to`);
  }
});

test('roadmap: stepOfChapter is the inverse of the mapping the page renders', () => {
  for (const s of rm.STEPS) {
    for (const ch of s.chapters) assert.equal(rm.stepOfChapter(ch), s.no, `chapter ${ch} points at the wrong step`);
  }
  assert.equal(rm.stepOfChapter('99'), null, 'a chapter that is not on the road must resolve to nothing');
});

/* --------------------- the numbers the page will print ------------------- */

test('roadmap: every step resolves to a real track, from its own content', () => {
  const stats = rm.chapterStats(CHAPTERS, null, () => false);
  for (const s of rm.STEPS) {
    const track = rm.stepTrack(s, stats, SECTIONS, TRACKS);
    assert.ok(track && TRACK_IDS.has(track), `step ${s.no} ("${s.title}") resolves to ${track}`);
  }
  // Resolved from the chapters, not from a hand-written id: step 19 is chapter 03, whose items went
  // to the GenAI section — so the step reports GenAI while a stale hand-written id could say 'ml'.
  const step19 = rm.STEPS.find((s) => s.no === 19);
  assert.equal(rm.stepTrack(step19, stats, SECTIONS, TRACKS), 'genai');
  assert.equal(rm.stepTrack(step19, stats, SECTIONS, TRACKS), rm.trackOfSection('s22', SECTIONS, TRACKS));
  assert.equal(rm.trackOfSection('nope', SECTIONS, TRACKS), null, 'an unknown section belongs to no track');
});

test('roadmap: the steps account for every imported item, exactly once', () => {
  const stats = rm.chapterStats(CHAPTERS, ITEMS, () => false);
  const perStep = rm.STEPS.map((s) => rm.stepStat(s, stats));
  const total = perStep.reduce((a, s) => a + s.items, 0);
  assert.equal(total, ITEMS.length, `the road shows ${total} of the ${ITEMS.length} imported items`);
  // Chapters the banks took nothing from are reading chapters, not steps with a 0% ring.
  const concepts = perStep.reduce((a, s) => a + s.concepts, 0);
  assert.ok(concepts > 0, 'some chapters are concept chapters — they must be counted as such');
  assert.equal(
    perStep.reduce((a, s) => a + s.chapters, 0) + concepts,
    36,
    'every chapter is either a practice chapter or a concept chapter',
  );
});

test('roadmap: practised counts come from the caller, and are never invented', () => {
  const none = rm.chapterStats(CHAPTERS, ITEMS, () => false);
  for (const s of rm.STEPS) assert.equal(rm.stepStat(s, none).practised, 0, `step ${s.no} claims practice that did not happen`);

  // Every other item counts as practised: a measured, partial figure — never 0 and never all of it.
  const isTouched = (id) => Number(id.slice(id.lastIndexOf(':') + 1)) % 2 === 0;
  const some = rm.chapterStats(CHAPTERS, ITEMS, isTouched);
  const step35 = rm.STEPS.find((s) => s.no === 35);
  const stat35 = rm.stepStat(step35, some);
  const expected = ITEMS.filter((it) => step35.chapters.includes(it.chapter)).length;
  assert.ok(stat35.items >= expected, 'a step counts the items of every chapter it carries');
  assert.ok(stat35.practised > 0 && stat35.practised < stat35.items, 'measured practice must be partial, not all-or-nothing');
  assert.ok(stat35.topSection !== null, 'a step with items must offer a Practice target');

  // Before items.json lands the manifest still gives an item count, but nothing is practised yet.
  const fallback = rm.chapterStats(CHAPTERS, null, isTouched);
  const items = rm.STEPS.map((s) => rm.stepStat(s, fallback)).reduce((a, s) => a + s.items, 0);
  assert.equal(items, manifest.totals.items, 'the manifest fallback must cover the document’s own item count');
  assert.equal(rm.STEPS.map((s) => rm.stepStat(s, fallback)).reduce((a, s) => a + s.practised, 0), 0);
});

test('roadmap: a step the document never reached reports no items at all', () => {
  const stats = rm.chapterStats(CHAPTERS, ITEMS, () => false);
  for (const no of [4, 6, 7, 13, 14, 15]) {
    const s = rm.STEPS.find((x) => x.no === no);
    const st = rm.stepStat(s, stats);
    assert.equal(st.items, 0);
    assert.equal(st.chapters, 0);
    assert.equal(st.pdfPage, null, `step ${no} must not point at a PDF page it does not have`);
    assert.equal(st.topSection, null, `step ${no} must not offer a Practice link it cannot fill`);
  }
});

/* ------------------------------ lesson routing --------------------------- */

test('roadmap: a step with no chapter falls back to its track’s own sections', () => {
  const stats = rm.chapterStats(CHAPTERS, ITEMS, () => false);
  const step6 = rm.STEPS.find((s) => s.no === 6); // NumPy — curriculum only
  const secs = rm.stepSections(step6, stats, SECTIONS, TRACKS);
  assert.ok(secs.length > 0, 'a curriculum-only step must still have a lesson to open');
  for (const s of secs) assert.ok(s.no >= 17 && s.no <= 18, `NumPy should open in the data track, saw s${s.no}`);
  assert.deepEqual(secs.map((s) => s.no), [...secs.map((s) => s.no)].sort((a, b) => a - b), 'sections must read in order');

  // A step with chapters uses exactly those sections — read from the manifest's own routing, so a
  // re-import that moves chapter 29 to another section fails here instead of on screen.
  const sqlStep = rm.STEPS.find((s) => s.no === 8); // SQL, chapter 29
  const ch29 = CHAPTERS.find((c) => c.no === '29');
  const routed = SECTIONS.filter((s) => ch29.sections[s.id] !== undefined).map((s) => s.no);
  assert.ok(routed.length > 0, 'chapter 29 must route to at least one section');
  assert.deepEqual(rm.stepSections(sqlStep, stats, SECTIONS, TRACKS).map((s) => s.no), routed);
});

test('roadmap: every practice notebook is reachable from the step that teaches its topic', () => {
  // A notebook is filed under the SECTION it practices (`metadata.aiml.section`, published in the
  // manifest), and a step is defined by the sections it teaches — so the join is already implied by
  // the data. This test is what keeps it true: if a notebook is filed against a section no step
  // teaches, it silently becomes reachable only from the Notebook Lab shelf, which is exactly the
  // "second, competing places to learn" the path is supposed to have absorbed.
  const notebooks = JSON.parse(read('public/notebooks/manifest.json')).notebooks;
  assert.ok(notebooks.length >= 5, 'the five authored notebooks must stay published');
  const stats = rm.chapterStats(CHAPTERS, ITEMS, () => false);
  const ids = new Set(SECTIONS.map((s) => s.id));
  for (const nb of notebooks) {
    assert.ok(ids.has(nb.section), `${nb.file} is filed under ${nb.section}, which is not a section`);
    const step = rm.STEPS.find((s) => rm.stepSections(s, stats, SECTIONS, TRACKS).some((sec) => sec.id === nb.section));
    assert.ok(step, `${nb.file} sits on no step — it would exist only on the Lab shelf`);
  }
});

test('roadmap: masteryOf distinguishes "nothing measured" from "nothing done"', () => {
  assert.equal(rm.masteryOf([], () => 0), null);
  assert.equal(rm.masteryOf(['s1', 's2'], () => 0), 0);
  assert.equal(rm.masteryOf(['s1', 's2'], (id) => (id === 's1' ? 40 : 60)), 50);
  assert.equal(rm.masteryOf(['s1'], () => 33.4), 33);
});

/* --------------------------- the pages mount it -------------------------- */

test('roadmap: the Learning Path renders the master spine, not a second track grid', () => {
  const page = read('src/features/learning/LearningPath.tsx');
  assert.match(page, /from '\.\.\/\.\.\/core\/learning\/roadmap'/, 'the page must read the canonical order from the engine');
  assert.match(page, /STEPS\.map\(/, 'the 36 steps are what the page draws');
  assert.match(page, /PHASES\.map\(/, 'the phases are drawn as dividers on the same spine');
  // The chapter index of the document is not duplicated here: each step links to it.
  assert.ok(!/chapterIndex/.test(page), 'the document’s chapter list is being re-implemented on the path');
});

test('roadmap: the extra paths continue the 36 steps instead of restarting at 09', () => {
  const grid = read('src/components/learning/PathGrid.tsx');
  assert.match(grid, /STEP_COUNT/, 'PathGrid must number on from the last roadmap step');
  assert.match(grid, /FIRST_EXTRA_NO = STEP_COUNT \+ 1/, 'the extra paths restart their own numbering');
  assert.ok(!/FIRST_EXTRA_NO = 9\b/.test(grid), 'the old first-extra number is back — two steps would share a node');
});

test('roadmap: the Playbook chapter index points back at the step it is read at', () => {
  const pb = read('src/features/practice/Playbook.tsx');
  assert.match(pb, /stepOfChapter/, 'the document view must name the step each chapter belongs to');
  assert.match(pb, /\/path#s/, 'a chapter must link to its step on the roadmap');
});
