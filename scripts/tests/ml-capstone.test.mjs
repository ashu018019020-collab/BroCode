/**
 * The ML course ends in one assessable project, not just a module lab.
 *
 * This holds the published capstone to the same contract as NumPy: three tiers with requirements,
 * deliverables and stretch work, ordered milestones, a rubric whose weights total 100, and a starter
 * whose stored output is what Python actually printed. The certificate test proves that completion
 * and capstone evidence are separate measured conditions.
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

test('the ML capstone ships with a brief, dataset note and a starter that printed something', () => {
  const capstone = artifact.capstone;
  assert.ok(capstone, 'artifact.capstone is missing');
  assert.ok(capstone.title.length > 10 && capstone.brief.length > 80, 'capstone needs a real brief');
  assert.ok(capstone.dataset.length > 60, 'capstone needs a dataset note');
  assert.ok(capstone.starter.code.includes('import numpy as np'), 'starter must be runnable NumPy');
  assert.ok(capstone.starter.output.trim().length > 40, 'starter output was not executed');
  assert.match(capstone.starter.output, /base rate: 0\.33/);
});

test('three ML tiers each carry requirements, deliverables and a stretch goal', () => {
  assert.equal(artifact.capstone.tiers.length, 3);
  assert.deepEqual(artifact.capstone.tiers.map((tier) => tier.name), ['Beginner', 'Intermediate', 'Advanced']);
  for (const tier of artifact.capstone.tiers) {
    assert.ok(tier.goal.length > 30, `${tier.name}: no goal`);
    assert.ok(tier.requirements.length >= 3, `${tier.name}: fewer than three requirements`);
    assert.ok(tier.deliverables.length >= 1, `${tier.name}: no deliverable`);
    assert.ok(tier.stretch.length >= 1, `${tier.name}: no stretch goal`);
    for (const requirement of tier.requirements) assert.ok(requirement.length > 25, `${tier.name}: thin requirement`);
  }
});

test('ML milestones order the work and the weighted rubric totals one hundred', () => {
  assert.ok(artifact.capstone.milestones.length >= 4);
  assert.ok(artifact.capstone.milestones.every((milestone) => milestone.title && milestone.detail.length > 40));
  const weights = artifact.capstone.rubric.reduce((sum, row) => sum + row.weight, 0);
  assert.equal(weights, 100, `rubric weights sum to ${weights}`);
  assert.equal(new Set(artifact.capstone.rubric.map((row) => row.criterion)).size, artifact.capstone.rubric.length);
  for (const row of artifact.capstone.rubric) {
    assert.ok(row.criterion && row.weight > 0 && row.evidence.length > 30, 'rubric row needs a criterion, weight and evidence');
  }
  assert.ok(artifact.capstone.assessment.pass.includes('70'));
  assert.ok(artifact.capstone.assessment.excellent.includes('90'));
});

test('the starter output matches a fresh Python run', (t) => {
  const python = spawnSync('python3', ['-c', 'print("ok")'], { encoding: 'utf8' });
  if (python.status !== 0) {
    t.skip('python3 is not available');
    return;
  }
  const result = spawnSync('python3', ['-c', artifact.capstone.starter.code], { encoding: 'utf8' });
  assert.equal(result.status, 0, `starter failed: ${result.stderr.trim()}`);
  assert.equal(result.stdout.replace(/\r\n?/g, '\n').trim(), artifact.capstone.starter.output);
});

test('ML certificate needs both all section records and the capstone pass mark', () => {
  const rubric = artifact.capstone.rubric;
  const complete = { modulesDone: 27, modulesTotal: 27, pct: 100, sectionsDone: 270, sectionsTotal: 270 };
  const partial = { ...complete, sectionsDone: 269, pct: 99 };

  const empty = engine.mlCertificate(complete, rubric, []);
  assert.equal(empty.score, 0);
  assert.equal(empty.eligible, false);
  assert.equal(empty.grade, 'none');
  assert.match(empty.reason, /below 70/);

  const pass = engine.mlCertificate(complete, rubric, rubric.slice(0, 6).map((row) => row.criterion));
  assert.equal(pass.score, 80);
  assert.equal(pass.grade, 'pass');
  assert.equal(pass.eligible, true);

  const excellent = engine.mlCertificate(complete, rubric, rubric.map((row) => row.criterion));
  assert.equal(excellent.score, 100);
  assert.equal(excellent.grade, 'excellent');

  const unfinished = engine.mlCertificate(partial, rubric, rubric.map((row) => row.criterion));
  assert.equal(unfinished.eligible, false);
  assert.match(unfinished.reason, /1 sections/);

  assert.equal(engine.M_CAPSTONE_KEY, 'mcap');
  assert.notEqual(engine.M_CAPSTONE_KEY, 'ncap');
});
