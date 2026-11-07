/**
 * The career workspace — resume readiness, local ATS checks and the next job-prep tick.
 *
 * The dangerous failure here is a number that looks authoritative but is not: an "ATS score" with
 * no denominator, an unmeasured check silently counted as a failure, or a readiness percentage that
 * averages four parts so a 1/2 profile outweighs twenty pitches. Every rule is driven with fixtures
 * here, and the page is checked for rendering the engine instead of re-deriving it.
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
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const {
  atsChecks, atsReport, careerWorkspace, keywordCoverage, nextChecklistAction,
  resumeReadiness, roleKeywords, storedAnswers,
} = await load('src/core/learning/career-workspace.ts');

const skills = [{ id: 'python', label: 'Python', pct: 70 }, { id: 'data', label: 'NumPy + Pandas', pct: 40 }];

const input = (over = {}) => ({
  answers: {},
  checklist: {},
  builds: { done: 0, total: 10 },
  defenses: { done: 0, total: 29 },
  role: 'AI Engineer',
  skills,
  answerTotal: 30,
  ...over,
});

test('career workspace: readiness sums real denominators instead of averaging percentages', () => {
  const resume = resumeReadiness(input({
    answers: { 'resume:chatbot:0': 'I built a chatbot.', 'resume:chatbot:1': '' },
    checklist: { github: true },
    builds: { done: 1, total: 4 },
    defenses: { done: 3, total: 29 },
  }));

  // 2 stored? No: one is blank, so it is NOT stored — that is the point of storedAnswers below.
  assert.equal(resume.parts[0].done, 1, 'a blank answer is not a written answer');
  assert.deepEqual(
    resume.parts.map((p) => [p.id, p.done, p.total, p.pct]),
    [
      ['pitches', 1, 30, 3],
      ['builds', 1, 4, 25],
      ['defenses', 3, 29, 10],
      ['profile', 1, 2, 50],
    ],
    'each part keeps its own denominator',
  );
  assert.equal(resume.done, 6, 'aggregate numerator');
  assert.equal(resume.total, 65, 'aggregate denominator');
  assert.equal(resume.pct, 9, '6/65 — not the average of 3, 25, 10 and 50');
  assert.deepEqual(resume.parts.map((p) => p.to), ['/defense', '/projects', '/defense', '/job-prep'],
    'every part points at the page that fixes it');
});

test('career workspace: storedAnswers ignores blank and whitespace-only answers', () => {
  assert.deepEqual(
    storedAnswers({ a: 'x', b: '   ', c: '', d: ' y ' }),
    ['x', ' y '],
    'only non-blank pitches count — an empty textarea is not progress',
  );
  assert.deepEqual(storedAnswers({}), []);
});

test('career workspace: role keywords come from the measured skills, not a hardcoded list', () => {
  const words = roleKeywords(skills);
  assert.ok(words.includes('python'), 'a skill word is a keyword');
  assert.ok(words.includes('numpy') && words.includes('pandas'), 'each half of a combined label counts');
  assert.ok(!words.includes('and'), 'joining words are not keywords');

  const coverage = keywordCoverage(['I used Python and numpy for the model.'], skills);
  assert.deepEqual(coverage, { matched: 2, total: 3, pct: 67 }, '2 of 3 keywords, honestly measured');
  assert.equal(keywordCoverage([], skills).pct, 0, 'no pitch, no coverage — never NaN');
});

test('career workspace: a check with no denominator is null, and null is excluded from the score', () => {
  const checks = atsChecks(input({ builds: { done: 3, total: 4 }, checklist: { github: true, linkedin: true } }));
  const byId = Object.fromEntries(checks.map((c) => [c.id, c]));

  assert.equal(byId['pitch-substance'].pass, null, 'no written answer to measure');
  assert.equal(byId.keywords.pass, null, 'no written answer to search');
  assert.equal(byId.placeholders.pass, null, 'nothing to inspect for filler');
  assert.equal(byId['pitch-complete'].pass, false, 'the pitch denominator exists, so 0/30 is a real fail');
  assert.equal(byId.builds.pass, true, '3 builds shipped');

  const report = atsReport(input({ builds: { done: 3, total: 4 }, checklist: { github: true, linkedin: true } }));
  // Measurable: pitch-complete (weight 3, fail), builds (3, pass), profile (1, pass) = 4/7.
  assert.equal(report.measurable, 3, 'three checks have a denominator');
  assert.equal(report.passed, 2);
  assert.equal(report.score, 57, 'weighted over measurable checks only');
  assert.deepEqual(report.missing.map((c) => c.id), ['pitch-complete'], 'the fail is the one to fix');
});

test('career workspace: nothing measurable means no score at all, not a fake 0%', () => {
  const report = atsReport(input({
    answerTotal: 0,
    builds: { done: 0, total: 0 },
    defenses: { done: 0, total: 0 },
    profileIds: [],
  }));
  assert.equal(report.score, null, 'no denominator, no ATS score');
  assert.equal(report.measurable, 0);
  assert.ok(report.checks.every((c) => c.pass === null), 'every check says "not measured yet"');
});

test('career workspace: filler text fails the placeholder check', () => {
  const dirty = atsChecks(input({ answers: { 'resume:chatbot:0': 'TODO write a real pitch here' } }));
  assert.equal(dirty.find((c) => c.id === 'placeholders').pass, false);

  const clean = atsChecks(input({ answers: { 'resume:chatbot:0': 'I shipped a chatbot that routes and validates every request.' } }));
  assert.equal(clean.find((c) => c.id === 'placeholders').pass, true);
  assert.equal(clean.find((c) => c.id === 'pitch-substance').pass, false, 'one short pitch is not 75% substantive');
});

test('career workspace: substantive pitches are measured against what was actually written', () => {
  const long = 'a'.repeat(140);
  const checks = atsChecks(input({ answers: { a: long, b: 'short', c: long, d: long } }));
  const substance = checks.find((c) => c.id === 'pitch-substance');
  assert.equal(substance.pass, true, '3 of 4 is above the 75% bar');
  assert.match(substance.detail, /3 of 4/);
});

test('career workspace: the next job-prep action is the first unticked item in authored order', () => {
  const cold = nextChecklistAction({});
  assert.equal(cold.item.id, 'resume-defense', 'the checklist order is the flow order');
  assert.equal(cold.remaining, 16);

  const started = nextChecklistAction({ 'resume-defense': true, github: true });
  assert.equal(started.item.id, 'linkedin');
  assert.equal(started.remaining, 14);

  const full = Object.fromEntries(
    ['resume-defense', 'github', 'linkedin', 'python-core', 'data-stack', 'ml-nlp', 'genai-agentic', 'apis',
      'mock-round-1', 'aloud', 'mistakes-clear', 'final', 'target-list', 'apply-5', 'referral', 'portfolio']
      .map((id) => [id, true]),
  );
  assert.equal(nextChecklistAction(full).item, null, 'nothing left to tick');
  assert.equal(nextChecklistAction(full).remaining, 0);
});

test('career workspace: the composition is cold only when no record exists at all', () => {
  assert.equal(careerWorkspace(input()).cold, true, 'no pitches, no ticks, no builds, no defenses');
  assert.equal(careerWorkspace(input({ checklist: { github: true } })).cold, false, 'one tick is a record');
  assert.equal(careerWorkspace(input({ builds: { done: 1, total: 3 } })).cold, false, 'one build is a record');
});

test('career workspace: the page renders the engine and the route is registered behind Protect', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/features/career/CareerWorkspace.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src/app/App.tsx'), 'utf8');
  const search = fs.readFileSync(path.join(ROOT, 'src/core/platform/search.ts'), 'utf8');
  const paths = fs.readFileSync(path.join(ROOT, 'src/core/learning/paths.ts'), 'utf8');
  const sitemap = fs.readFileSync(path.join(ROOT, 'public/sitemap.xml'), 'utf8');

  assert.match(page, /careerWorkspace\(/, 'the page composes the engine');
  assert.match(page, /resume\.parts/, 'every readiness part is rendered');
  assert.match(page, /ats\.checks/, 'the ATS checks are rendered');
  assert.match(page, /ats\.score === null|ats\.score !== null/, 'a missing score is shown as "not measured"');
  assert.match(page, /next\.item/, 'the next job-prep action is rendered');
  assert.match(page, /ats\.missing/, 'the failing checks drive the fixes');
  assert.doesNotMatch(page, /fetch\(/, 'the workspace never reaches the network');

  assert.match(app, /<Route path="\/career\/workspace" element=\{<Protect>/, 'the route is protected');
  assert.match(app, /to: '\/career\/workspace'/, 'and registered in NAV');
  assert.match(search, /route: '\/career\/workspace'/, 'Ctrl+K can find it');
  assert.match(paths, /'\/career\/workspace'/, 'the coverage test knows why it is not a path card');
  assert.match(sitemap, /\/career\/workspace/, 'the sitemap is regenerated for the new route');
});
