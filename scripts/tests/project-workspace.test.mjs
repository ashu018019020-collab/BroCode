/**
 * The Project Lab's model — "which build, in what order, and have I defended it?".
 *
 * The page's failure mode is quiet: a card that says "not built" while Career counts the build (the
 * gate is the RECORD, not its `.done` flag), a defense badge that never appears because the section
 * was scored, or a "next build" that points at chapter 1 for a learner on chapter 9. None of those
 * throw, so the pure rules are driven with fixtures here and the screen is checked for reading the
 * model instead of re-deriving it.
 *
 * Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** Resolve from the project root: a bare relative specifier would resolve against scripts/tests. */
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const { projectBriefs, nextBuild, projectSummary } = await load(
  'src/core/learning/project-workspace.ts',
);

const mini = (over = {}) => ({
  name: 'Mini build',
  what: 'Build a small thing',
  use: '',
  architecture: 'Input → validate → respond',
  files: 'app.py',
  buildTarget: 'It runs end to end',
  output: 'ok',
  code: 'print("ok")',
  explanation: 'Why it works',
  interview: 'Why did you validate first?',
  edgeCases: ['empty input'],
  ...over,
});

const lab = (over = {}) => ({
  tier: 'Real Project',
  name: 'Lab build',
  what: 'Ship a real service',
  architecture: 'API → service → database',
  files: 'src/**',
  buildTarget: 'Deployed and documented',
  code: '',
  followUp: 'What would you change at 10x?',
  defense: 'How do you know it is correct?',
  debugCue: 'A timeout on the first call',
  ...over,
});

const section = (id, no, over = {}) => ({
  id,
  no,
  title: `Section ${no}`,
  mini: null,
  projectLab: [],
  ...over,
});

test('project workspace: every build appears once, with a stable key', () => {
  const sections = [
    section('s01', 1, { mini: mini(), projectLab: [lab(), lab({ name: 'Second lab' })] }),
    section('s02', 2, { mini: mini({ name: 'Other mini' }) }),
  ];
  const briefs = projectBriefs(sections, {});

  assert.equal(briefs.length, 4, 'one mini + two labs + one mini');
  assert.equal(new Set(briefs.map((b) => b.key)).size, 4, 'keys are unique');
  assert.deepEqual(
    briefs.map((b) => b.key),
    ['mini:s01', 'lab:s01:0', 'lab:s01:1', 'mini:s02'],
    'curriculum order is preserved — the page reads it in the order the plan teaches it',
  );
  assert.equal(briefs[0].tier, 'Mini Project', 'a mini project is labelled as one');
  assert.equal(briefs[1].tier, 'Real Project', 'the lab keeps its authored tier');
  assert.equal(briefs[1].route, '/lesson/s01/project', 'the build links to its own lesson stage');
  assert.equal(briefs[0].route, '/lesson/s01/mini', 'a mini build links to the mini stage');
});

test('project workspace: the gate is the record, not the .done flag', () => {
  const sections = [section('s01', 1, { mini: mini(), projectLab: [lab()] })];
  // A scored build record: no `done`, exactly the shape a defense/score write leaves behind.
  const briefs = projectBriefs(sections, { 'st:s01:project': { score: 85, tries: 1 } });

  assert.equal(briefs[1].built, true, 'a scored project record counts as built');
  assert.equal(briefs[0].built, false, 'the mini stage is a different gate and stays open');
  assert.equal(
    projectSummary(briefs).built,
    1,
    'the header count agrees with the card flag — both read the same field',
  );
});

test('project workspace: a section defense shows its status and its real score', () => {
  const sections = [section('s01', 1, { mini: mini(), projectLab: [lab()] }), section('s02', 2, { mini: mini() })];
  const briefs = projectBriefs(sections, { 'st:s01:defense': { done: true, score: 82 } });

  assert.equal(briefs[0].defended, true, 'the defended section says so');
  assert.equal(briefs[0].defenseScore, 82, 'and prints the stored score, not a guess');
  assert.equal(briefs[1].defended, true, 'the defense gate is per SECTION, so its lab shares it');
  assert.equal(briefs[2].defended, false, 'an undefended section is not marked defended');
  assert.equal(briefs[2].defenseScore, null, 'with no score to print');
  assert.equal(projectSummary(briefs).defended, 2, 'the summary counts defended briefs');
});

test('project workspace: the build path is authored order, and empty beats are skipped', () => {
  const sections = [section('s01', 1, { projectLab: [lab({ files: '', debugCue: '' })] })];
  const [brief] = projectBriefs(sections, {});

  assert.deepEqual(
    brief.steps.map((s) => s.label),
    ['What you build', 'Architecture', 'Build target', 'Explain it'],
    'an empty field is omitted instead of printed as a blank beat',
  );
  assert.deepEqual(brief.steps.map((s) => s.no), [1, 2, 3, 4], 'numbers are contiguous reading order');
  assert.ok(brief.steps.every((s) => !!s.detail.trim()), 'no step has an empty detail');
  assert.match(brief.steps[0].detail, /Ship a real service/, 'the first beat is the problem');
  assert.match(brief.steps[3].detail, /How do you know it is correct/, 'the last beat is the defense question');
});

test('project workspace: the next build prefers a chapter the learner has started', () => {
  const sections = [
    section('s01', 1, { mini: mini() }),
    section('s02', 2, { mini: mini({ name: 'Second' }) }),
  ];

  // s01 is already built; s02 was started → s02's build is the one that can be finished.
  const briefs = projectBriefs(sections, { 'st:s01:mini': { done: true } });
  assert.equal(nextBuild(briefs, (sid) => (sid === 's02' ? 40 : 0)).key, 'mini:s02');

  // Nothing started → the first unbuilt build in curriculum order, never a random one.
  const fresh = projectBriefs(sections, {});
  assert.equal(nextBuild(fresh, () => 0).key, 'mini:s01');

  // A started section that is already built is not suggested again.
  const onlyLater = projectBriefs(sections, { 'st:s02:mini': { done: true } });
  assert.equal(nextBuild(onlyLater, () => 90).key, 'mini:s01');

  // Everything built → null, so the page can say "all done" instead of picking one anyway.
  const all = projectBriefs(sections, { 'st:s01:mini': { done: true }, 'st:s02:mini': { done: true } });
  assert.equal(nextBuild(all, () => 100), null);
});

test('project workspace: the summary never divides by zero', () => {
  assert.deepEqual(projectSummary([]), { total: 0, built: 0, defended: 0, pct: 0 });
  const briefs = projectBriefs([section('s01', 1, { mini: mini(), projectLab: [lab()] })], {
    'st:s01:mini': { done: true },
    'st:s01:defense': { score: 0 },
  });
  assert.deepEqual(projectSummary(briefs), { total: 2, built: 1, defended: 2, pct: 50 });
});

test('project workspace: the page renders the model instead of re-deriving the rules', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/features/projects/ProjectLab.tsx'), 'utf8');

  assert.match(page, /projectBriefs\(sections, state\.attempts\)/, 'the page builds its list with the model');
  assert.match(page, /nextBuild\(projects, masteryOf\)/, 'the next build comes from the model');
  assert.match(page, /projectSummary\(projects\)/, 'the header numbers come from the model');
  assert.match(page, /Defense pending/, 'an undefended build says so');
  assert.match(page, /p\.defenseScore/, 'a defended build prints its score');
  assert.match(page, /p\.steps\.map/, 'the ordered build path is rendered');
  assert.doesNotMatch(page, /s\.projectLab\.forEach/, 'the page does not re-implement the brief shaping');
  assert.doesNotMatch(
    page,
    /attempts\[stageKey\]\?\.done/,
    'the page must not read the gate as `.done` — a scored record would be dropped',
  );
});
