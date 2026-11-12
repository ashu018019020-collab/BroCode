/**
 * Question-bank honesty (Part 6 of the brief).
 *
 * The brief asks for 500 unique items per module and forbids claiming a count the pack does not hold.
 * These tests recompute every category and difficulty from the published sections and compare them
 * with the manifest the generator publishes, so the UI can print a real number instead of "500+".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/numpy-course/index.json'), 'utf8'));

const countBy = (list, key) => list.reduce((acc, e) => {
  const value = e[key] || 'unset';
  acc[value] = (acc[value] || 0) + 1;
  return acc;
}, {});

function derive(m) {
  const s = m.sections;
  const categories = {
    concept: s.interview.filter((e) => !e.code).length + s.defense.length,
    output: s.logic.length + s.interview.filter((e) => e.code).length + s.checkpoint.filter((e) => e.options).length,
    coding: s.coding.length,
    debugging: s.debug.length,
    quiz: s.checkpoint.filter((e) => e.options).length,
    written: s.checkpoint.filter((e) => e.rubric).length,
    project: s.miniProject.length + s.projectLab.length,
    scenario: s.interview.filter((e) => e.scenario).length,
  };
  const all = Object.values(s).flat();
  return { total: all.length, categories, difficulty: countBy(all, 'difficulty') };
}

test('the manifest matches the records the artifact actually holds', () => {
  assert.ok(artifact.stats.bank, 'stats.bank is missing');
  assert.equal(artifact.stats.bank.total, artifact.stats.entries);
  for (const m of artifact.modules) {
    const real = derive(m);
    const claimed = artifact.stats.bank.modules[m.id];
    assert.ok(claimed, `${m.id}: no manifest row`);
    assert.equal(claimed.total, real.total, `${m.id}: total mismatch`);
    assert.deepEqual(claimed.categories, real.categories, `${m.id}: category mismatch`);
    assert.deepEqual(claimed.difficulty, real.difficulty, `${m.id}: difficulty mismatch`);
  }
});

test('no module claims 500 items while holding fewer', () => {
  for (const m of artifact.modules) {
    const claimed = artifact.stats.bank.modules[m.id];
    assert.ok(claimed.total < 500, `${m.id} claims ${claimed.total}`);
  }
  assert.equal(artifact.stats.bank.target, 500);
  assert.ok(artifact.stats.bank.shortPerModule > 0, 'shortfall must be stated');
});

test('scenario questions are authored, answered and tagged', () => {
  const scenarios = artifact.modules.flatMap((m) => m.sections.interview.filter((e) => e.scenario));
  assert.ok(scenarios.length >= 40, `only ${scenarios.length} scenario questions`);
  for (const e of scenarios) {
    assert.ok(e.q.trim().length > 40, `${e.id}: scenario prompt too short`);
    assert.ok(e.answer.trim().length > 40, `${e.id}: scenario answer too short`);
  }
});

test('every question id is unique and every difficulty is set', () => {
  const ids = new Set();
  for (const m of artifact.modules) {
    for (const list of Object.values(m.sections)) {
      for (const e of list) {
        assert.ok(!ids.has(e.id), `duplicate id ${e.id}`);
        ids.add(e.id);
        assert.ok(['easy', 'medium', 'hard'].includes(e.difficulty), `${e.id}: difficulty ${e.difficulty}`);
      }
    }
  }
});
