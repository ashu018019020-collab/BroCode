/**
 * The dual-level teaching layer.
 *
 * Part 2 of the brief asks every topic to carry a simple explanation and a professional one. The
 * authored levels must reach the published artifact intact: both halves present, neither copying the
 * Learn body, and the simple half actually shorter than the professional one (otherwise the switch is
 * cosmetic).
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
  ...fs.readdirSync(SRC).filter((f) => /^levels-.*\.json$/.test(f)).sort()
    .map((f) => readJSON(path.join('content', 'numpy-mastery', f))),
);

const withLevels = artifact.modules.flatMap((m) =>
  m.sections.learn.filter((e) => e.simple || e.pro).map((e) => ({ module: m.id, entry: e })));

test('the authored levels reach the artifact', () => {
  assert.ok(Object.keys(authored).length > 0, 'no levels-*.json authored');
  assert.ok(withLevels.length > 0, 'no learn entry carries simple/pro');
  for (const { entry } of withLevels) {
    assert.ok(entry.simple && entry.simple.trim().length > 40, `${entry.id} is missing a simple explanation`);
    assert.ok(entry.pro && entry.pro.trim().length > 40, `${entry.id} is missing a professional explanation`);
  }
});

test('neither level repeats the Learn body or the other level', () => {
  for (const { entry } of withLevels) {
    assert.notEqual(entry.simple, entry.body, `${entry.id}: simple copies the body`);
    assert.notEqual(entry.pro, entry.body, `${entry.id}: pro copies the body`);
    assert.notEqual(entry.simple, entry.pro, `${entry.id}: the two levels are identical`);
  }
});

test('the simple level is the shorter one', () => {
  for (const { entry } of withLevels) {
    assert.ok(entry.simple.length < entry.pro.length,
      `${entry.id}: simple (${entry.simple.length}) should be shorter than pro (${entry.pro.length})`);
  }
});

test('every newly added topic carries both levels in the artifact', () => {
  const deepening = readJSON('content/numpy-mastery/deepening-10.json');
  let total = 0;
  for (const [moduleId, { topics }] of Object.entries(deepening)) {
    const mod = artifact.modules.find((m) => m.id === moduleId);
    assert.ok(mod, `deepening names an unknown module ${moduleId}`);
    for (const topic of topics) {
      const title = topic.title || topic;
      const entry = mod.sections.learn.find((e) => e.title === title);
      assert.ok(entry, `${moduleId}: new topic "${title}" is missing from the artifact`);
      assert.ok(entry.simple && entry.simple.trim().length > 40, `${moduleId}: "${title}" has no simple level`);
      assert.ok(entry.pro && entry.pro.trim().length > 40, `${moduleId}: "${title}" has no pro level`);
      assert.ok(entry.simple.length < entry.pro.length, `${moduleId}: "${title}" simple is not shorter`);
      total++;
    }
  }
  assert.equal(total, 108, 'the new-topic ledger changed; extend the dual-level coverage with it');
});

test('every authored topic title exists in its module', () => {
  for (const [moduleId, topics] of Object.entries(authored)) {
    const mod = artifact.modules.find((m) => m.id === moduleId);
    assert.ok(mod, `levels name an unknown module ${moduleId}`);
    const titles = new Set(mod.sections.learn.map((e) => e.title));
    for (const title of Object.keys(topics)) {
      assert.ok(titles.has(title), `${moduleId}: authored level for unknown topic "${title}"`);
    }
  }
});
