/**
 * The 12-part lesson structure (Part 4 of the brief).
 *
 * A Learn entry must be teachable on its own: what it is, why it matters, the syntax, the steps, what
 * it looks like, where it is used, what goes wrong, and how to revise it. These tests hold the authored
 * structure to that contract wherever it exists — they do not invent content for topics that have none.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const artifact = readJSON('public/generated/numpy-course/index.json');
const SRC = path.join(ROOT, 'content', 'numpy-mastery');
const authored = Object.assign(
  {},
  ...fs.readdirSync(SRC).filter((f) => /^structure-.*\.json$/.test(f)).sort()
    .map((f) => readJSON(path.join('content', 'numpy-mastery', f))),
);

const taught = artifact.modules.flatMap((m) => m.sections.learn);
const structured = taught.filter((e) => e.syntax || e.steps?.length || e.visual || e.realWorld || e.mistakes?.length || e.revision?.length);

test('the authored lesson structure reaches the artifact', () => {
  assert.ok(Object.keys(authored).length > 0, 'no structure-*.json authored');
  assert.ok(structured.length >= 14, `only ${structured.length} entries carry the lesson structure`);
});

test('every structured entry covers the authored parts with real text', () => {
  for (const entry of structured) {
    assert.ok(entry.syntax && entry.syntax.trim().length > 3, `${entry.id}: no syntax`);
    assert.ok(Array.isArray(entry.steps) && entry.steps.length >= 3, `${entry.id}: fewer than 3 steps`);
    for (const step of entry.steps) assert.ok(step.trim().length > 10, `${entry.id}: empty step`);
    assert.ok(entry.visual && entry.visual.trim().length > 10, `${entry.id}: no visual`);
    assert.ok(entry.realWorld && entry.realWorld.trim().length > 20, `${entry.id}: no real-world use`);
    assert.ok(Array.isArray(entry.mistakes) && entry.mistakes.length >= 1, `${entry.id}: no common mistakes`);
    assert.ok(Array.isArray(entry.revision) && entry.revision.length >= 2, `${entry.id}: no revision points`);
  }
});

test('every newly added topic carries the full lesson shape', () => {
  const deepening = readJSON('content/numpy-mastery/deepening-10.json');
  let total = 0;
  for (const [moduleId, { topics }] of Object.entries(deepening)) {
    const mod = artifact.modules.find((m) => m.id === moduleId);
    assert.ok(mod, `deepening names an unknown module ${moduleId}`);
    for (const topic of topics) {
      const title = topic.title || topic;
      const entry = mod.sections.learn.find((e) => e.title === title);
      assert.ok(entry, `${moduleId}: new topic "${title}" is missing from the artifact`);
      assert.ok(entry.syntax && entry.syntax.trim().length > 3, `${moduleId}: "${title}" has no syntax line`);
      assert.ok(Array.isArray(entry.steps) && entry.steps.length >= 3, `${moduleId}: "${title}" has fewer than three steps`);
      for (const step of entry.steps) assert.ok(step.trim().length > 10, `${moduleId}: "${title}" has an empty step`);
      assert.ok(entry.visual && entry.visual.trim().length > 10, `${moduleId}: "${title}" has no visual`);
      assert.ok(entry.realWorld && entry.realWorld.trim().length > 20, `${moduleId}: "${title}" has no real-world use`);
      assert.ok(Array.isArray(entry.mistakes) && entry.mistakes.length >= 1, `${moduleId}: "${title}" has no common mistakes`);
      assert.ok(Array.isArray(entry.revision) && entry.revision.length >= 2, `${moduleId}: "${title}" has no revision points`);
      total++;
    }
  }
  assert.equal(total, 108, 'the new-topic ledger changed; extend the lesson shape with it');
});

test('the two gatekeeping parts (practice and mastery) really exist as sections', () => {
  for (const m of artifact.modules) {
    assert.ok(m.sections.practice.length > 0, `${m.id}: no Practice section`);
    assert.ok(m.sections.checkpoint.length > 0, `${m.id}: no Checkpoint section`);
  }
});

test('every authored structure title exists in its module', () => {
  for (const [moduleId, topics] of Object.entries(authored)) {
    const mod = artifact.modules.find((m) => m.id === moduleId);
    assert.ok(mod, `structure names an unknown module ${moduleId}`);
    const titles = new Set(mod.sections.learn.map((e) => e.title));
    for (const title of Object.keys(topics)) {
      assert.ok(titles.has(title), `${moduleId}: structure for unknown topic "${title}"`);
    }
  }
});
