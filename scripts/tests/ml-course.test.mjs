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
const courseSearch = await import(pathToFileURL(path.join(ROOT, 'src/core/learning/ncourse.ts')).href);
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
      if (!entry.options) continue;
      const expected = entry.format === 'truefalse' ? 2 : 3;
      assert.equal(entry.options.length, expected, `${entry.id}: ${expected} options`);
      assert.equal(new Set(entry.options).size, expected, `${entry.id}: distinct options`);
      assert.ok(entry.options.includes(entry.answer), `${entry.id}: answer must be an option`);
    }
  }
});

test('ml course: every authored question is answered and the expansion reaches every module', () => {
  for (const module of artifact.modules) {
    for (const section of ['interview', 'logic', 'defense', 'checkpoint']) {
      for (const entry of module.sections[section]) {
        assert.ok(String(entry.answer ?? '').trim(), `${entry.id}: ${section} answer is empty`);
      }
    }
    for (const entry of module.sections.coding) {
      assert.ok(entry.starter && entry.solution && entry.expected, `${entry.id}: coding task is incomplete`);
    }
    // Expansion batch 1: one new authored interview, coding and logic record per tied module.
    assert.ok(module.sections.interview.filter((entry) => !entry.code).length >= 2, `${module.id}: no new interview record`);
    assert.ok(module.sections.coding.length >= 2, `${module.id}: no new coding record`);
    assert.ok(module.sections.logic.filter((entry) => !entry.code).length >= 1, `${module.id}: no new logic record`);
  }
});

test('ml course: every module keeps the authored checkpoint formats beside its MCQs', () => {
  for (const module of artifact.modules) {
    const checkpoints = module.sections.checkpoint;
    assert.ok(checkpoints.length >= 50, `${module.id}: expected at least 50 checkpoints`);
    assert.ok(checkpoints.filter((entry) => entry.format === 'mcq').length >= 2, `${module.id}: original MCQs must remain`);
    for (const format of ['truefalse', 'blank', 'rubric']) {
      assert.ok(checkpoints.filter((entry) => entry.format === format).length >= 2, `${module.id}: at least two ${format} checkpoints`);
    }
    assert.equal(checkpoints.filter((entry) => entry.format === 'output').length, 1, `${module.id}: one output checkpoint`);
    for (const entry of checkpoints) {
      assert.ok(String(entry.answer ?? '').trim(), `${entry.id}: answer is empty`);
      assert.ok(String(entry.why ?? '').trim(), `${entry.id}: explanation is empty`);
      if (entry.format === 'truefalse') {
        assert.deepEqual(entry.options, ['True', 'False'], `${entry.id}: true/false options`);
        assert.ok(entry.options.includes(entry.answer), `${entry.id}: true/false answer`);
      }
      if (entry.format === 'blank') {
        assert.ok(entry.code.includes('___'), `${entry.id}: blank marker`);
        assert.equal(entry.code.replace('___', entry.answer), entry.solution, `${entry.id}: blank restores its solution`);
        assert.ok(entry.solution && entry.expected, `${entry.id}: blank solution and output`);
      }
      if (entry.format === 'output') {
        assert.ok(entry.code, `${entry.id}: output checkpoint needs code`);
      }
      if (entry.format === 'rubric') {
        assert.equal(entry.rubric.length, 3, `${entry.id}: three rubric criteria`);
        assert.ok(entry.rubric.every((line) => line.trim()), `${entry.id}: non-empty rubric`);
      }
    }
  }
});

test('ml course: the published target is met by real records, not padding', () => {
  assert.equal(artifact.stats.targetTotal, 13500);
  assert.equal(artifact.stats.bank.target, 500);
  assert.equal(artifact.stats.bank.perModule, 500);
  assert.equal(artifact.stats.bank.shortfall, 0);
  assert.equal(artifact.stats.bank.shortPerModule, 0);
  assert.equal(artifact.stats.entries, 13500);
  for (const module of artifact.modules) assert.ok(module.entries >= 500, `${module.id}: ${module.entries} records`);
});

test('ml course: the shared record search reaches the lesson that teaches the topic', () => {
  const hits = courseSearch.searchCourse(artifact.modules, 'overfitting', 10);
  assert.ok(hits.some((hit) => hit.moduleId === 'ml09' && hit.section === 'learn'),
    'record search must reach the ML Learn lesson, not only a module title');
  assert.ok(hits.every((hit) => hit.title && hit.snippet), 'every search hit must carry published text');
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
    for (const entry of module.sections.checkpoint) {
      if (entry.format === 'blank') {
        runs.push([`${entry.id}:solution`, entry.solution, entry.expected]);
        runs.push([`${entry.id}:filled`, entry.code.replace('___', entry.answer), entry.expected]);
      }
      if (entry.format === 'output') runs.push([entry.id, entry.code, entry.answer]);
    }
  }
  for (const [id, code, expected] of runs) {
    const result = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${id}: Python failed: ${result.stderr.trim()}`);
    assert.equal(result.stdout.trim(), expected, `${id}: output does not match the published expectation`);
  }
  assert.ok(runs.length >= 189, `expected Learn, Coding Lab and checkpoint executions, got ${runs.length}`);
});
