/**
 * Owner content health — gaps in the published registries.
 *
 * The failure mode is an owner trusting a screen: a "0 questions" line when the manifest simply has
 * not loaded, a finding about content that is actually fine, or a page that re-derives its own rules
 * instead of reading the engine. Every rule is driven here with fixtures, and the page is checked for
 * composing the engine and living behind the admin guard.
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

const { contentHealth } = await load('src/core/learning/content-health.ts');

const course = (over = {}) => ({
  slug: 'python',
  name: 'Python Foundations',
  steps: 5,
  sections: 6,
  objectives: 4,
  prerequisites: 2,
  minutes: 360,
  ...over,
});

const section = (over = {}) => ({
  id: 's01',
  no: 1,
  title: 'Python core',
  interview: 10,
  coding: 8,
  logic: 4,
  checkpoint: 2,
  mini: true,
  builds: 2,
  bank: 40,
  ...over,
});

const input = (over = {}) => ({
  courses: [course()],
  sections: [section()],
  stepsExpected: 5,
  bank: { total: 900, sections: 1 },
  notebooks: 12,
  ownerCards: [{ slug: 'cafe', name: 'Café ML', hidden: false }],
  ...over,
});

test('content health: a clean catalog produces no findings', () => {
  const health = contentHealth(input());
  assert.deepEqual(health.findings, []);
  assert.deepEqual(health.counts, { high: 0, medium: 0, low: 0 });
  assert.equal(health.publishing.courses, 1);
  assert.equal(health.publishing.steps, 5);
  assert.equal(health.publishing.bankQuestions, 900);
});

test('content health: a null manifest says "not loaded", never zero', () => {
  const health = contentHealth(input({ bank: null, notebooks: null }));

  const bank = health.findings.find((f) => f.id === 'bank-not-loaded');
  assert.ok(bank, 'the unloaded manifest is reported as such');
  assert.match(bank.detail, /cannot be checked/i);
  assert.doesNotMatch(bank.detail, /0 questions/, 'an unloaded file is not reported as empty content');

  assert.equal(health.publishing.bankQuestions, null, 'the status shows a dash, not 0');
  assert.equal(health.publishing.notebooks, null);
  assert.ok(health.findings.some((f) => f.id === 'notebooks-not-loaded'));
});

test('content health: step coverage is checked against the roadmap, not the courses', () => {
  const short = contentHealth(input({ stepsExpected: 36 }));
  const finding = short.findings.find((f) => f.id === 'steps');
  assert.ok(finding);
  assert.equal(finding.severity, 'high');
  assert.match(finding.detail, /5 steps .* plans 36/);

  const noSteps = contentHealth(input({ courses: [course({ steps: 0 })], stepsExpected: 0 }));
  assert.ok(noSteps.findings.some((f) => f.id === 'courses-no-steps'), 'a course with no steps is its own gap');
});

test('content health: section gaps are named, capped and never invented', () => {
  const sections = [
    section({ id: 's01', no: 1, title: 'One', coding: 0 }),
    section({ id: 's02', no: 2, title: 'Two', coding: 0 }),
    section({ id: 's03', no: 3, title: 'Three', coding: 0 }),
    section({ id: 's04', no: 4, title: 'Four', coding: 0, bank: 0 }),
  ];
  const health = contentHealth(input({ sections, bank: { total: 900, sections: 4 } }));

  const coding = health.findings.find((f) => f.id === 'sections-no-coding');
  assert.match(coding.detail, /s01 One, s02 Two, s03 Three \+1 more/, 'the list is capped at four names');
  assert.equal(coding.severity, 'high');

  const emptyBank = health.findings.find((f) => f.id === 'bank-empty-sections');
  assert.match(emptyBank.detail, /s04 Four/);
  assert.equal(emptyBank.severity, 'high');
});

test('content health: only real gaps are reported — a section with builds is fine', () => {
  const health = contentHealth(input({
    sections: [section({ mini: false, builds: 3 })],
  }));
  assert.ok(!health.findings.some((f) => f.id === 'sections-no-build'), 'three builds is not a gap');
  assert.ok(!health.findings.some((f) => f.id === 'sections-no-logic'), 'logic cards exist');
});

test('content health: bank coverage compares manifest sections with the curriculum', () => {
  const health = contentHealth(input({
    bank: { total: 500, sections: 0 },
    sections: [section({ bank: 0 })],
  }));
  const coverage = health.findings.find((f) => f.id === 'bank-coverage');
  assert.equal(coverage.severity, 'medium');
  assert.match(coverage.detail, /0 bank sections for 1 curriculum/);
});

test('content health: owner cards distinguish visible, hidden and unreadable', () => {
  const hidden = contentHealth(input({
    ownerCards: [
      { slug: 'a', name: 'Café ML', hidden: true },
      { slug: 'b', name: 'Agents 101', hidden: false },
    ],
  }));
  assert.equal(hidden.publishing.ownerVisible, 1);
  assert.equal(hidden.publishing.ownerHidden, 1);
  assert.match(hidden.findings.find((f) => f.id === 'owner-cards-hidden').detail, /Café ML/);

  const unreadable = contentHealth(input({ ownerCards: null }));
  assert.equal(unreadable.publishing.ownerVisible, null, 'unknown is a dash, not zero');
  assert.ok(unreadable.findings.some((f) => f.id === 'owner-cards-unreachable'));
});

test('content health: attention is sorted high → medium → low', () => {
  const health = contentHealth(input({
    courses: [course({ objectives: 0, minutes: 0 })],
    sections: [section({ coding: 0, interview: 0 })],
  }));
  const ranks = health.attention.map((f) => f.severity);
  const order = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < ranks.length; i++) {
    assert.ok(order[ranks[i - 1]] <= order[ranks[i]], 'a lower severity never precedes a higher one');
  }
  assert.equal(health.attention.length, health.findings.length, 'attention is the same list, ordered');
  assert.equal(health.counts.high, health.findings.filter((f) => f.severity === 'high').length);
});

test('content health: the page composes the engine, behind the admin guard', () => {
  const page = fs.readFileSync(path.join(ROOT, 'src/features/owner/OwnerContentPage.tsx'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'src/app/App.tsx'), 'utf8');
  const search = fs.readFileSync(path.join(ROOT, 'src/core/platform/search.ts'), 'utf8');
  const paths = fs.readFileSync(path.join(ROOT, 'src/core/learning/paths.ts'), 'utf8');

  assert.match(page, /contentHealth\(/, 'the page asks the engine');
  assert.match(page, /health\.publishing/, 'publishing counts are rendered from the engine');
  assert.match(page, /health\.attention/, 'the attention list is rendered from the engine');
  assert.match(page, /health\.counts\.high/, 'severity counts come from the engine');
  assert.match(page, /user\.role !== 'admin'/, 'a non-administrator is sent away');
  assert.match(page, /=== null \? '—'/, 'an unloaded registry renders as a dash, not zero');
  assert.doesNotMatch(page, /fetch\(/, 'the owner page never reaches the network directly');

  assert.match(app, /<Route path="\/admin\/content" element=\{<Protect>/, 'the route is protected');
  assert.match(app, /to: '\/admin\/content'/, 'and registered in NAV');
  assert.match(
    fs.readFileSync(path.join(ROOT, 'src/features/auth/AdminUsersPage.tsx'), 'utf8'),
    /to="\/admin\/content"/,
    'the owner dashboard links the page — the owner rail itself stays one destination',
  );
  assert.match(search, /route: '\/admin\/content'/, 'Ctrl+K can find it');
  assert.match(paths, /'\/admin\/content'/, 'the coverage test knows why it is not a path card');
});
