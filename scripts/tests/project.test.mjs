/**
 * Project-knowledge tests — the answers the footer AI gives about THIS app.
 *
 * The layer exists because one entry point now serves two corpora: `askLocal` retrieves lesson text
 * for Python questions, and `engine/project.ts` answers questions about the repository itself
 * ("naya question kaha add karun", "test kaise chalaun"). The whole risk lives in that split, so
 * these tests pin the two directions:
 *
 *   1. a project question is answered from the project facts, with a route to the page it names;
 *   2. a Python / curriculum question is NOT — `askProject` returns null and retrieval is untouched.
 *
 * The second half is the one that matters. A matcher that fires on `kya` + `hai` looks perfect on
 * its own examples and silently breaks every lesson question in the app.
 *
 * Everything runs against the real engine and the real 29-section curriculum. Zero dependencies:
 * built-in node:test plus the project's TS resolver hook (see `_ts-resolve.mjs`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { askProject, rankProjectFacts, PROJECT_FACTS } = await load('src/core/ai/project.ts');
const { askLocal } = await load('src/core/ai/assistant.ts');

const raw = JSON.parse(read('public/generated/curriculum/sections.json'));
const all = Array.isArray(raw) ? raw : raw.sections;

/** A fresh learner: nothing attempted, nothing broken. */
const blank = () => ({
  version: 1,
  profile: { name: 'T', goal: 'g', level: 'Beginner', dailyMinutes: 60, onboarded: false },
  xp: 0,
  streak: { current: 0, last: '' },
  attempts: {},
  bookmarks: [],
  mistakes: [],
  review: {},
  interviewAnswers: {},
  defenseAnswers: {},
  savedCode: {},
  settings: { reduceMotion: false },
  activity: {},
  notes: [],
  jobPrep: {},
  readNotifs: [],
});

/* ------------------------------ it answers the ask ----------------------------- */

test('project: every fact is reachable from a phrase a user would actually type', () => {
  // Each fact is probed with its own first phrase (or its first two keys) — if a fact cannot be
  // reached through its own trigger words, the trigger list is wrong.
  const misses = [];
  for (const f of PROJECT_FACTS) {
    const probe = f.phrases?.[0] ?? f.keys.slice(0, 2).join(' ');
    const hit = askProject(probe);
    if (!hit || !hit.text.includes(f.body.slice(0, 24))) misses.push(`${f.id} ← "${probe}"`);
  }
  assert.deepEqual(misses, [], `these facts are unreachable from their own keys: ${misses.join(', ')}`);
});

test('project: a project question is answered with its own route, not a lesson', () => {
  const cases = [
    ['naya question kaha add karun', 'content-add-question'],
    ['test kaise chalaun', 'dev-check'],
    ['code kaun si file me hai', 'code-map'],
    ['deploy kaise karein', 'publish'],
    ['progress kaha save hota hai', 'storage'],
  ];
  for (const [q, id] of cases) {
    const top = rankProjectFacts(q)[0];
    assert.ok(top, `"${q}" matched no project fact`);
    assert.equal(top.fact.id, id, `"${q}" was answered by ${top.fact.id}, expected ${id}`);
    const a = askProject(q);
    assert.equal(a.kind, 'project');
    assert.ok(a.sources[0].route.startsWith('/'), 'the answer must carry a real route');
    assert.ok(a.text.length > 80, 'the answer must be an answer, not a label');
  }
});

test('project: answers name the real commands, so a learner can act on them', () => {
  // The value of these answers is the exact command / path. If a pipeline is renamed, this fails
  // rather than shipping an answer that tells the user to run something that no longer exists.
  const dev = askProject('test kaise chalaun').text;
  for (const cmd of ['npm run typecheck', 'npm test', 'npm run build']) {
    assert.ok(dev.includes(cmd), `the dev answer no longer mentions ${cmd}`);
  }
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['questions:expand-track'], 'package.json lost the questions:expand-track script');
  assert.ok(pkg.scripts['notebooks:write'], 'package.json lost the notebooks:write script');
  const q = askProject('naya question kaha add karun').text;
  assert.ok(q.includes('questions:expand-track'), 'the authoring answer lost its command');
});

test('project: it stays out of the way of curriculum questions', () => {
  // The failure mode: a filler word ("kya", "hai", "kaise") counted as a key hit. These are the
  // exact asks the assistant must keep answering from the bundled lessons.
  for (const q of [
    'lambda kya hai',
    'python function kya hai',
    'list aur tuple me difference',
    'variables aur data types',
    'try except kaise use karein',
    'Accessing Values',
  ]) {
    assert.equal(askProject(q), null, `"${q}" is a curriculum question and must not be answered by the project layer`);
  }
});

test('project: no concept title in the real curriculum is hijacked', () => {
  // Every concept title is a plausible question ("Python Lists", "File Handling"). None of them is
  // about the repository, so a hit here is a false positive that would replace a real lesson answer.
  const hijacked = [];
  for (const s of all) {
    for (const c of s.learn?.concepts ?? []) {
      if (c.title && askProject(c.title)) hijacked.push(`${s.id}: ${c.title}`);
    }
  }
  assert.deepEqual(hijacked, [], `concept titles answered by the project layer: ${hijacked.slice(0, 5).join(', ')}`);
});

test('project: askLocal still retrieves the curriculum, and adds project answers', () => {
  // Both branches through the ONE entry point the UI uses.
  const lesson = askLocal('Accessing Values', all, blank(), { sectionId: 's12' });
  assert.equal(lesson.kind, 'curriculum');
  assert.ok(lesson.sources[0].route.startsWith('/lesson/s12/'));

  const about = askLocal('test kaise chalaun', all, blank());
  assert.equal(about.kind, 'project');
  assert.equal(about.sources[0].route, '/settings');
});

test('project: the same question always gets the same answer', () => {
  // Stable ordering, because the card keeps a persisted log: an unstable rank would make the same
  // question return different facts across a reload.
  for (const q of ['naya question kaha add karun', 'deploy kaise', 'code kaha hai', 'kitne pages hain']) {
    const a = askProject(q);
    const b = askProject(q);
    assert.deepEqual(a, b, `"${q}" is not deterministic`);
  }
});

test('project: every fact carries a real route and honest prose', () => {
  assert.ok(PROJECT_FACTS.length >= 8, 'the project layer shrank — is a fact missing?');
  const ids = new Set();
  for (const f of PROJECT_FACTS) {
    assert.ok(!ids.has(f.id), `duplicate fact id ${f.id}`);
    ids.add(f.id);
    assert.ok(f.route.startsWith('/'), `${f.id} has no route`);
    assert.ok(f.keys.length >= 3, `${f.id} has no trigger words`);
    assert.ok(f.body.length > 80, `${f.id} is a label, not an answer`);
    // The UI shows the word as-is, so it must be the app's own name for the screen.
    assert.ok(!/^\w+$/.test(f.where) || f.where.length > 2, `${f.id} has a one-word vague source`);
  }
});
