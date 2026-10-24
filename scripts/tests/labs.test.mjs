/**
 * The labs subjects — "kya build/run karna hai?", answered from published data.
 *
 * A lab page that lies is worse than a lab page that is empty: it tells a learner that a runtime is
 * there for their topic, and the link opens something that has nothing to do with it. Three silent
 * failures are pinned here:
 *
 *   · a notebook the Labs page cannot place — it exists, it runs, and nothing links to it;
 *   · a lab route filed under a step the course index does not carry, so a subject shows no lab for
 *     a topic that has one (or worse, a lab for a topic that does not);
 *   · a "continue" suggestion that points at a finished notebook or at one the learner never opened.
 *
 * The pure rules are driven with fixtures AND against the real published pack. Zero dependencies —
 * node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// `labs.ts` imports the notebook key family from `core/platform/keys.ts`, so the engine graph needs
// the project's resolver (Vite's extensionless relative imports) exactly like coverage.test.mjs.
register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Both pure (no React, no store, no fetch), which is what makes them loadable here.
const lab = await load('src/core/learning/labs.ts');
const lp = await load('src/core/learning/paths.ts');

const index = JSON.parse(read('public/generated/courses/index.json'));
const authored = JSON.parse(read('content/courses/courses.json'));
const nbManifest = JSON.parse(read('public/notebooks/manifest.json'));
const banks = JSON.parse(read('public/generated/questions/manifest.json'));
const hub = read('src/features/labs/LabsHub.tsx');
const appSrc = read('src/app/App.tsx');

const LAB_FAMILY = lp.EXTRA_PATHS.filter((p) => p.group === 'lab').map((p) => p.route);
const TRACKS = [...appSrc
  .slice(appSrc.indexOf('export const TRACK_DEFS'), appSrc.indexOf('];', appSrc.indexOf('export const TRACK_DEFS')))
  .matchAll(/id: '([^']+)'[^\n]*?from: (\d+), to: (\d+)/g)]
  .map((m) => ({ id: m[1], from: Number(m[2]), to: Number(m[3]) }));

const section = (no, over = {}) => ({
  sectionId: `s${String(no).padStart(2, '0')}`, no, title: `Topic ${no}`, published: 20,
  byType: { coding: 5 }, ...over,
});
const notebook = (file, sectionId, over = {}) => ({
  file, title: file, topic: file, section: sectionId, level: 'beginner', cells: 10, codeCells: 4, ...over,
});

/* ------------------------------- the join -------------------------------- */

test('labs: a topic is the section, plus the lab its own step assigns', () => {
  const sections = [section(1), section(2), section(3)];
  const stepOf = { s01: 4, s02: 9 };
  const routesByStep = { 4: ['/notebooks', '/playground'], 9: [] };
  const notebooks = [notebook('a.ipynb', 's01'), notebook('b.ipynb', 's03')];
  const cellsRun = (f) => (f === 'a.ipynb' ? 3 : 0);

  const topics = lab.labTopics(sections, { id: 'x', from: 1, to: 3 }, stepOf, routesByStep, notebooks, cellsRun);
  assert.deepEqual(topics.map((t) => t.no), [1, 2, 3]);
  assert.deepEqual(topics[0].routes, ['/notebooks', '/playground'], 'the topic takes its step’s runtimes');
  assert.deepEqual(topics[1].routes, [], 'a step that files no lab gets none — never a neighbour’s');
  assert.equal(topics[0].step, 4);
  assert.equal(topics[2].step, null, 'a section missing from the index is null, never a guessed step');
  assert.deepEqual(
    lab.labTopics(sections, { id: 'x', from: 1, to: 2 }, stepOf, routesByStep, notebooks, cellsRun).map((t) => t.no),
    [1, 2], 'a topic outside the range is another subject’s',
  );

  // A notebook belongs to the SECTION it was authored for — not to the subject, not to the track.
  assert.deepEqual(topics[0].notebooks.map((n) => n.file), ['a.ipynb']);
  assert.deepEqual(topics[1].notebooks, []);
  assert.equal(topics[0].cellsRun, 3);
  assert.equal(topics[0].codeCells, 4);
  assert.equal(topics[0].exercises, 5, 'coding items are the exercises a lab card may count');
});

test('labs: a subject reports labs, notebooks and cells, and says when it has none', () => {
  const order = ['/playground', '/notebooks', '/sql', '/rag-lab'];
  const topics = [
    { id: 's01', no: 1, title: 'a', step: 4, routes: ['/notebooks'], notebooks: [notebook('a.ipynb', 's01')], cellsRun: 2, codeCells: 4, exercises: 5 },
    { id: 's02', no: 2, title: 'b', step: 9, routes: [], notebooks: [], cellsRun: 0, codeCells: 0, exercises: 0 },
  ];

  const s = lab.labSummary(topics, ['/notebooks', '/rag-lab', '/notebooks'], order);
  assert.deepEqual(s.labs, ['/notebooks', '/rag-lab'], 'routes dedupe and read in the registry’s own order');
  assert.equal(s.topics, 2);
  assert.equal(s.notebooks, 1);
  assert.equal(s.codeCells, 4);
  assert.equal(s.cellsRun, 2);
  assert.equal(s.exercises, 5);
  assert.equal(s.hasContent, true);

  const empty = lab.labSummary([{ ...topics[1] }], [], order);
  assert.equal(empty.hasContent, false, 'no runtime and no notebook reads as “no lab yet” — not as 0%');
  const none = lab.labSummary([], [], order);
  assert.equal(none.notebooks, 0);
  assert.equal(none.cellsRun, 0, 'nothing to divide by must not produce a number');
});

test('labs: continue points at the last notebook left unfinished, and at nothing else', () => {
  const notebooks = [notebook('a.ipynb', 's01'), notebook('b.ipynb', 's02'), notebook('c.ipynb', 's03')];
  const run = { 'a.ipynb': 2, 'b.ipynb': 4, 'c.ipynb': 1 };
  const attempts = {
    'nb:a.ipynb:0': { ts: 100 },
    'nb:b.ipynb:0': { ts: 900 },   // finished (4 of 4) → never suggested
    'nb:c.ipynb:0': { ts: 500 },
  };
  const cont = lab.continueLab(attempts, notebooks, (f) => run[f] ?? 0);
  assert.equal(cont.notebook.file, 'c.ipynb', 'the newest UNFINISHED notebook wins, not the newest overall');
  assert.equal(cont.done, 1);
  assert.equal(cont.total, 4);

  assert.equal(lab.continueLab({}, notebooks, () => 0), null, 'nothing opened is a null, not an empty card');
  assert.equal(
    lab.continueLab({ 'nb:a.ipynb:0': { ts: 1 } }, notebooks, (f) => (f === 'a.ipynb' ? 4 : 0)),
    null, 'a finished notebook is not “left off”');
  assert.equal(
    lab.continueLab({ 'nb:a.ipynb:0': {} }, notebooks, (f) => (f === 'a.ipynb' ? 1 : 0))?.lastAt, 0,
    'a record without a timestamp still continues — it just cannot win a tie on time');
});

/* ---------------------------- the real pack ------------------------------ */

test('labs: the index publishes the same lab map the course files carry', () => {
  const bySlug = new Map(index.courses.map((c) => [c.slug, c.lab_routes ?? {}]));
  for (const course of authored.courses) {
    assert.ok(bySlug.has(course.slug), `${course.slug} is not in the published index`);
  }
  for (const [rawStep, routes] of Object.entries(authored.labRoutes)) {
    const step = Number(rawStep);
    const owner = authored.courses.find((c) => c.steps.includes(step));
    assert.ok(owner, `step ${step} has a lab route but no course owns it`);
    assert.deepEqual(bySlug.get(owner.slug)[rawStep], routes,
      `step ${step}: the index must carry the authored lab routes for ${owner.slug}`);
  }
  for (const course of index.courses) {
    for (const routes of Object.values(course.lab_routes ?? {})) {
      for (const route of routes) {
        assert.ok(LAB_FAMILY.includes(route), `${course.slug} files ${route}, which is not a lab surface`);
      }
    }
  }
});

test('labs: every published notebook lands in exactly one subject', () => {
  const numbers = new Set(banks.sections.map((s) => s.no));
  const ranges = TRACKS.map(({ id, from, to }) => ({ id, from, to }));
  const placements = new Map(TRACKS.map((t) => [t.id, 0]));

  for (const nb of nbManifest.notebooks) {
    const no = Number(String(nb.section).replace(/^s/, ''));
    assert.ok(numbers.has(no), `${nb.file} names section ${nb.section}, which the bank does not publish`);
    const owners = ranges.filter((r) => no >= r.from && no <= r.to);
    assert.equal(owners.length, 1, `${nb.file} must belong to exactly one subject`);
    placements.set(owners[0].id, placements.get(owners[0].id) + 1);
  }
  assert.ok([...placements.values()].some((n) => n > 0), 'no notebook maps to any subject — the page would be empty');
});

test('labs: a subject reaches the lab its course files, including a later step’s', () => {
  const stepOf = lab.stepOfSections(index.courses);
  const routesByStep = lab.routesOfSteps(index.courses);
  const notebooks = nbManifest.notebooks;
  const rangeOf = (id) => TRACKS.find((t) => t.id === id);
  const view = (id) => {
    const range = rangeOf(id);
    const topics = lab.labTopics(banks.sections, range, stepOf, routesByStep, notebooks, () => 0);
    const routes = [...topics.flatMap((t) => t.routes), ...lab.courseRoutes(index.courses, range)];
    return { topics, summary: lab.labSummary(topics, routes, LAB_FAMILY) };
  };

  const python = view('python');
  assert.ok(python.summary.labs.includes('/notebooks'), 'the Python subject must reach the Notebook Lab');
  assert.equal(python.summary.notebooks, 4, 'the four authored Python notebooks are its notebooks');
  assert.ok(python.topics.every((t) => t.step !== null), 'every Python section must resolve to its step');

  // The RAG lab is filed under step 20 and NO section sits at step 20 — the course-level reachability
  // rule is the only reason a learner inside GenAI can open it. Losing it would be silent.
  const genai = view('genai');
  assert.ok(genai.summary.labs.includes('/rag-lab'), 'GenAI must reach the RAG lab its course assigns');
  assert.ok(genai.summary.labs.includes('/ai-lab'));

  assert.ok(view('sql').summary.labs.includes('/sql'), 'SQL must open the SQL Lab');
  assert.ok(view('data').summary.labs.includes('/numpy-pandas'), 'the data subject must open the NumPy + Pandas lab');
  assert.ok(view('agentic').summary.labs.includes('/agentic'));
  assert.ok(view('interview').summary.labs.includes('/projects'), 'the portfolio builds are a lab too');

  // Honest empty: the ML + NLP course files no runtime, and the page must say so instead of
  // borrowing a neighbour's lab.
  const ml = view('ml');
  assert.deepEqual(ml.summary.labs, []);
  assert.equal(ml.summary.hasContent, false);
  assert.ok(ml.summary.exercises > 0, 'and its coding exercises are still real content');
});

/* --------------------------------- the page ------------------------------ */

test('labs: the hub derives its labs, subjects and counts from published data', () => {
  assert.match(hub, /EXTRA_PATHS\.filter\(\(p\) => p\.group === 'lab'\)\.map\(\(p\) => p\.route\)/,
    'the global tools come from the registry — a new lab page must need no edit here');
  assert.match(hub, /TRACK_DEFS\.map\(/, 'the subjects are the track registry');
  assert.ok(!/\bfrom:\s*\d/.test(hub) && !/\bto:\s*\d/.test(hub), 'a range typed into the page is a second copy of the registry');

  assert.match(hub, /useCourseIndex\(\)/, 'which step a section is filed under comes from the course index');
  assert.match(hub, /useNotebooks\(\)/, 'the notebooks come from their manifest');
  assert.match(hub, /useBankManifest\(\)/, 'the exercise counts come from the bank manifest');
  assert.match(hub, /notebookCellsRunFor\(state\.attempts, file\)/, 'progress is cells actually run, from their own family');

  assert.match(hub, /labTopics\(/, 'the topic join is the engine’s');
  assert.match(hub, /labSummary\(/, 'so is the summary');
  assert.match(hub, /continueLab\(/, 'and the continue suggestion');
  assert.match(hub, /courseRoutes\(/, 'the course-level lab reachability is the engine’s rule too');
  assert.match(hub, /from '\.\.\/\.\.\/core\/learning\/labs'/, 'the rules live in the pure engine, not in the view');

  // One spelling of the notebook link, and the empty state the plan requires.
  assert.match(hub, /const notebookHref = \(file: string\) => `\/notebooks\?nb=\$\{file\}`/, 'the notebook link is built once');
  assert.ok(!/to=\{`\/notebooks\?nb=/.test(hub), 'and never spelled by hand');
  assert.match(hub, /no hands-on lab yet/, 'a topic with no notebook and no runtime must say so');
  assert.match(hub, /This subject has no hands-on lab yet/, 'and a subject with none must say it too');
});
