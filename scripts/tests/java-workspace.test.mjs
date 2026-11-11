/**
 * The Java learning workspace and playground contract.
 *
 * These are source-level pins because the test loader cannot import `.tsx` (see AGENTS.md). They
 * hold the parts a redesign can silently drop: the ten real stages, the shared workspace chrome,
 * the multi-cell controls, and the single-file normalization on both execution paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const lesson = read('src/features/java-programming/JLessonPage.tsx');
const notebook = read('src/features/java-programming/JNotebook.tsx');
const hub = read('src/features/java-programming/JCoursePage.tsx');
const runner = read('server/j-runner.mjs');
const data = read('src/core/data/jcourse.ts');
const engine = read('src/core/learning/jcourse.ts');
const css = read('src/styles/08-labs-and-mobile.css');

test('java workspace: uses the shared hero, ten-stage grid, utility strip and coach', () => {
  assert.match(lesson, /SectionHero/);
  assert.match(lesson, /StageGrid/);
  assert.match(lesson, /UtilityStrip/);
  assert.match(lesson, /LessonCoach/);
  assert.match(lesson, /STAGES/);
  for (const stage of ['learn', 'interview', 'coding', 'logic', 'debug', 'solved', 'mini', 'project', 'defense', 'checkpoint']) {
    assert.match(lesson, new RegExp(`stage === '${stage}'`), `the ${stage} stage must render real content`);
  }
});

test('java workspace: the ten cards show real counts and real completion gates', () => {
  assert.match(lesson, /counts: Record<Stage, number>/);
  assert.match(lesson, /done: Record<Stage, boolean>/);
  assert.match(lesson, /codingTally\(store\.attempts, codingMine\)/);
  assert.match(lesson, /debugTally\(store\.attempts, debugMine\)/);
  assert.match(lesson, /jQuizTally\(store\.attempts, module\.id, module\.mcqs\.length\)/);
  assert.match(lesson, /jStageKey\(module\.id, s\)/);
  assert.match(engine, /export function jStageKey/);
  assert.match(engine, /export function jQuizKey/);
});

test('java workspace: notes and resources are real controls, not decorative cards', () => {
  assert.match(lesson, /upsertNote/);
  assert.match(lesson, /newNote/);
  assert.match(lesson, /dev\.java/);
  assert.match(lesson, /docs\.oracle\.com/);
  assert.match(lesson, /Save note/);
});

test('java playground: every required control exists and is wired', () => {
  for (const label of ['Run all', 'Stop', 'Restart', 'Reset cells', 'Cell', 'ipynb', 'PROGRAM INPUT', 'Previous cell', 'Next cell']) {
    assert.ok(notebook.includes(label), `missing playground control: ${label}`);
  }
  assert.match(notebook, /runJava\(/);
  assert.match(notebook, /AbortController/);
  assert.match(notebook, /recordAttempt\(family/);
  assert.match(notebook, /localStorage\.setItem/);
  assert.match(notebook, /nbformat: 4/);
  assert.doesNotMatch(notebook, /Python 3\.12/);
});

test('java execution: both the API and the browser fallback normalize the single file', () => {
  assert.match(runner, /prepareJavaSource/);
  assert.match(data, /prepareJavaSource/);
  assert.match(data, /signal\?: AbortSignal/);
  assert.match(runner, /source_code: source/);
});

test('java hub: the module test opens the checkpoint stage', () => {
  assert.match(hub, /\?stage=checkpoint/);
  assert.doesNotMatch(hub, /\?tab=test/);
});

test('java workspace: only the completion record marks the checkpoint stage done', () => {
  assert.match(lesson, /checkpoint: complete,/);
  assert.doesNotMatch(lesson, /checkpoint: complete \|\| testPct >= 60/);
});

test('java workspace: code boxes use theme tokens, not a hardcoded dark background', () => {
  assert.match(css, /\.j-code pre \{[^}]*background: var\(--panel2\)/s);
  assert.match(css, /\.j-code pre \{[^}]*color: var\(--text\)/s);
  // The output box shares its rule with C's (`.j-output-pre, .c-output-pre`), so the assertion
  // accepts the grouped selector instead of pinning a shape the stylesheet no longer uses.
  assert.match(css, /\.j-output-pre,\s*\.c-output-pre \{[^}]*background: var\(--panel2\)/s);
  assert.doesNotMatch(css, /\{\s*background: #0b0b0b;\s*border-radius: 10px;\s*padding: 12px/);
});

test('java workspace: responsive rules keep the editor and cards inside the viewport', () => {
  assert.match(css, /\.j-topic-grid/);
  assert.match(css, /\.j-stage-grid/);
  assert.match(css, /\.j-play-bar/);
  assert.match(css, /\.j-cell textarea/);
  assert.match(css, /@media \(max-width: 1024px\)/);
  assert.match(css, /\.j-notebook, \.j-code, \.j-tabs \{ min-width: 0; max-width: 100%; \}/);
});
