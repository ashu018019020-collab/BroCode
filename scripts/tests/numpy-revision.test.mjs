/**
 * The revision plan.
 *
 * It must rank the course's real untouched sections, weakest module first, and never suggest a
 * section that is already recorded. The plan is derived from the same attempt keys `numpyReport`
 * counts, so these fixtures are the only difference from the live page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
register('./_ts-resolve.mjs', import.meta.url);

const ncourse = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/ncourse.ts')).href);

function moduleFixture(id, no, recordedSections = []) {
  return {
    id,
    no,
    title: `Module ${no}`,
    level: 'beginner',
    hours: 1,
    goal: '',
    counts: {},
    entries: 0,
    sections: Object.fromEntries(ncourse.N_SECTIONS.map((s) => [s.key, []])),
    _recorded: recordedSections,
  };
}

function attemptsFor(modules) {
  return Object.fromEntries(modules.flatMap((m) => m._recorded.map((section) => [ncourse.nSectionKey(m.id, section), { done: true }])));
}

test('the plan ranks the module with the fewest records first', () => {
  const a = moduleFixture('a', 1, ['learn', 'interview']);
  const b = moduleFixture('b', 2, []);
  const modules = [a, b];
  const plan = ncourse.revisionPlan(modules, attemptsFor(modules), 5);
  assert.equal(plan.length, 5);
  assert.equal(plan[0].moduleId, 'b', 'the untouched module is the weakest');
  assert.equal(plan[0].section, 'learn', 'and its earliest section comes first');
  assert.equal(plan[0].rank, 1);
  assert.equal(plan[0].recorded, 0);
  assert.match(plan[0].reason, /0\/10/);
  assert.ok(plan.every((item) => item.moduleId === 'b'), 'only the weakest module fills this slice');
});

test('ties fall back to module order, then section order', () => {
  const a = moduleFixture('a', 2, []);
  const b = moduleFixture('b', 1, []);
  const modules = [a, b];
  const plan = ncourse.revisionPlan(modules, attemptsFor(modules), 20);
  assert.equal(plan[0].moduleId, 'b', 'equal records rank by module number, not array order');
  assert.deepEqual(plan.slice(0, 3).map((item) => item.section), ['learn', 'interview', 'coding']);
});

test('recorded sections never appear, and a limit caps the plan', () => {
  const a = moduleFixture('a', 1, ['learn', 'interview', 'coding']);
  const modules = [a];
  const plan = ncourse.revisionPlan(modules, attemptsFor(modules), 3);
  assert.equal(plan.length, 3);
  assert.ok(plan.every((item) => !['learn', 'interview', 'coding'].includes(item.section)));
  assert.deepEqual(plan.map((item) => item.section), ['logic', 'debug', 'practice']);
  assert.equal(ncourse.revisionPlan(modules, attemptsFor(modules), 0).length, 0);
});

test('a fully recorded course has nothing left to revise', () => {
  const all = ncourse.N_SECTIONS.map((s) => s.key);
  const a = moduleFixture('a', 1, all);
  assert.deepEqual(ncourse.revisionPlan([a], attemptsFor([a]), 8), []);
});
