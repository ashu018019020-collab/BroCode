/**
 * Machine Learning — Zero to Professional contracts.
 *
 * The course ships 27 modules with all ten workspace sections. This test holds the published
 * artifact to the authored record: real counts, unique ids/questions, valid checkpoint answers,
 * and separate `mmod:` progress keys. It also executes every Learn sample and every Coding Lab
 * solution against the local Python 3 interpreter when one is available; without it the execution
 * check is a skip, never a pass.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'generated', 'ml-course', 'index.json'), 'utf8'));
register('./_ts-resolve.mjs', import.meta.url);
const engine = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/mcourse.ts')).href);
const SECTIONS = ['learn', 'interview', 'coding', 'logic', 'debug', 'practice', 'miniProject', 'projectLab', 'defense', 'checkpoint'];

test('ml course: 27 modules, in the authored order', () => {
  assert.equal(artifact.course.id, 'ml-mastery');
  assert.equal(artifact.course.slug, 'ml');
  assert.equal(artifact.modules.length, 27);
  artifact.modules.forEach((module, index) => {
    assert.equal(module.id, `ml${String(index + 1).padStart(2, '0')}`);
    assert.equal(module.no, index + 1);
    assert.ok(module.title && module.goal, `${module.id} needs a title and goal`);
  });
  assert.equal(artifact.stats.modules, 27);
});

test('ml course: every module holds all ten sections, and its counts are real', () => {
  for (const module of artifact.modules) {
    for (const section of SECTIONS) {
      assert.ok(module.sections[section].length > 0, `${module.id}: ${section} is empty`);
      assert.equal(module.counts[section], module.sections[section].length);
    }
    assert.equal(module.entries, Object.values(module.counts).reduce((a, b) => a + b, 0));
  }
  assert.equal(artifact.stats.entries, artifact.modules.reduce((sum, module) => sum + module.entries, 0));
  assert.equal(Object.values(artifact.stats.bySection).reduce((a, b) => a + b, 0), artifact.stats.entries);
});

test('ml course: records are unique and every checkpoint answer is one of its options', () => {
  const ids = new Set();
  for (const module of artifact.modules) {
    for (const section of SECTIONS) {
      const titles = new Set();
      for (const entry of module.sections[section]) {
        assert.ok(!ids.has(entry.id), `duplicate id ${entry.id}`);
        ids.add(entry.id);
        const title = entry.title || entry.q || '';
        assert.ok(title, `${entry.id}: a record needs a title or question`);
        assert.ok(!titles.has(title), `${entry.id}: duplicate question "${title}"`);
        titles.add(title);
        assert.ok(['easy', 'medium', 'hard'].includes(entry.difficulty), `${entry.id}: bad difficulty`);
      }
    }
    for (const entry of module.sections.checkpoint) {
      assert.equal(entry.options.length, 3, `${entry.id}: three options`);
      assert.equal(new Set(entry.options).size, 3, `${entry.id}: distinct options`);
      assert.ok(entry.options.includes(entry.answer), `${entry.id}: answer must be an option`);
    }
  }
});

test('ml course: the published target is honest, not padded', () => {
  assert.equal(artifact.stats.targetTotal, 13500);
  assert.equal(artifact.stats.bank.target, 500);
  assert.equal(artifact.stats.bank.perModule, Math.round(artifact.stats.entries / 27));
  assert.equal(artifact.stats.bank.shortfall, 27 * 500 - artifact.stats.entries);
  assert.equal(artifact.stats.bank.shortPerModule, 500 - artifact.stats.bank.perModule);
  assert.ok(artifact.stats.entries > 0 && artifact.stats.entries < 13500);
});

test('ml course: mmod: is its own family and a module needs every section', () => {
  assert.equal(engine.mSectionKey('ml01', 'learn'), 'mmod:ml01:learn');
  assert.ok(!engine.mSectionKey('ml01', 'learn').startsWith('nmod:'));
  assert.equal(engine.mIsModuleComplete('ml01', {}), false);
  const attempts = {};
  SECTIONS.forEach((section) => { attempts[engine.mSectionKey('ml01', section)] = { done: true }; });
  assert.equal(engine.mIsModuleComplete('ml01', attempts), true);
  assert.equal(engine.mProgress([{ id: 'ml01' }, { id: 'ml02' }], attempts).modulesDone, 1);
  assert.equal(engine.mProgress([{ id: 'ml01' }, { id: 'ml02' }], attempts).sectionsDone, 10);
  assert.deepEqual(engine.mNextPlace([{ id: 'ml01' }, { id: 'ml02' }], attempts), { moduleId: 'ml02', section: 'learn' });
  assert.equal(engine.mSectionsDone('ml01', attempts), 10);
});

test('ml course: Learn samples and Coding Lab solutions match real Python output', (t) => {
  const python = spawnSync('python3', ['-c', 'print("ok")'], { encoding: 'utf8' });
  if (python.status !== 0) {
    t.skip('python3 is not available');
    return;
  }
  const runs = [];
  for (const module of artifact.modules) {
    for (const entry of module.sections.learn) if (entry.code) runs.push([entry.id, entry.code, entry.output]);
    for (const entry of module.sections.coding) runs.push([entry.id, entry.solution, entry.expected]);
  }
  for (const [id, code, expected] of runs) {
    const result = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${id}: Python failed: ${result.stderr.trim()}`);
    assert.equal(result.stdout.trim(), expected, `${id}: output does not match the published expectation`);
  }
  assert.ok(runs.length >= 70, `expected the Learn and Coding Lab runs, got ${runs.length}`);
});
