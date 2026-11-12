/**
 * Part 11 of the brief: the project layer must end in something assessable.
 *
 * A capstone is only real if every tier states requirements and deliverables, the rubric weights add
 * up, the milestones order the work, and the starter's stored output is what NumPy actually printed.
 * These tests hold the artifact to that, and they fail if the capstone disappears from the build.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/numpy-course/index.json'), 'utf8'));

test('the capstone ships with a brief, a dataset note and a starter that printed something', () => {
  const cap = artifact.capstone;
  assert.ok(cap, 'artifact.capstone is missing');
  assert.ok(cap.title.length > 10 && cap.brief.length > 80, 'capstone needs a real brief');
  assert.ok(cap.dataset.length > 60, 'capstone needs a dataset description');
  assert.ok(cap.starter.code.includes('import numpy as np'), 'starter must be runnable NumPy');
  assert.ok(cap.starter.output.trim().length > 40, 'starter output was not executed');
  assert.match(cap.starter.output, /units shape: \(12, 6\)/);
});

test('three tiers each carry requirements, deliverables and a stretch goal', () => {
  assert.equal(artifact.capstone.tiers.length, 3);
  assert.deepEqual(artifact.capstone.tiers.map((t) => t.name), ['Beginner', 'Intermediate', 'Advanced']);
  for (const tier of artifact.capstone.tiers) {
    assert.ok(tier.goal.length > 30, `${tier.name}: no goal`);
    assert.ok(tier.requirements.length >= 3, `${tier.name}: fewer than three requirements`);
    assert.ok(tier.deliverables.length >= 1, `${tier.name}: no deliverable`);
    assert.ok(tier.stretch.length >= 1, `${tier.name}: no stretch goal`);
    for (const req of tier.requirements) assert.ok(req.length > 25, `${tier.name}: thin requirement`);
  }
});

test('milestones order the work and the rubric totals one hundred', () => {
  assert.ok(artifact.capstone.milestones.length >= 4);
  assert.ok(artifact.capstone.milestones.every((m) => m.title && m.detail.length > 40));
  const weights = artifact.capstone.rubric.reduce((a, r) => a + r.weight, 0);
  assert.equal(weights, 100, `rubric weights sum to ${weights}`);
  for (const row of artifact.capstone.rubric) {
    assert.ok(row.criterion && row.evidence.length > 30, 'rubric row needs a criterion and evidence');
  }
  assert.ok(artifact.capstone.assessment.pass.includes('70'));
  assert.ok(artifact.capstone.assessment.excellent.includes('90'));
});
