/**
 * Part 5 of the brief: every module must carry all ten working sections, and each section's records
 * must actually contain what that section is for. This is a contract, not a count: an Interview record
 * without an answer, a Debug record without an error, or a Checkpoint without options fails here
 * instead of shipping as an empty card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/numpy-course/index.json'), 'utf8'));

const SECTIONS = ['learn', 'interview', 'coding', 'logic', 'debug', 'practice', 'miniProject', 'projectLab', 'defense', 'checkpoint'];

test('all ten sections exist and are non-empty in every module', () => {
  for (const m of artifact.modules) {
    for (const key of SECTIONS) {
      assert.ok(Array.isArray(m.sections[key]), `${m.id}: missing section ${key}`);
      assert.ok(m.sections[key].length > 0, `${m.id}: ${key} is empty`);
    }
  }
});

test('each section carries the fields its activity needs', () => {
  for (const m of artifact.modules) {
    for (const e of m.sections.learn) {
      assert.ok(e.title && e.body && e.code && e.output, `${e.id}: Learn needs title/body/code/output`);
    }
    for (const e of m.sections.interview) {
      assert.ok(e.q && e.answer, `${e.id}: Interview needs a question and an answer`);
    }
    for (const e of m.sections.coding) {
      assert.ok(e.starter && e.check && e.expected, `${e.id}: Coding needs starter/check/expected`);
      assert.ok(e.statement, `${e.id}: Coding needs a statement`);
    }
    for (const e of m.sections.logic) {
      assert.ok(e.code && e.answer, `${e.id}: Logic needs code and a verified answer`);
    }
    for (const e of m.sections.debug) {
      assert.ok(e.code && e.error && e.fix, `${e.id}: Debug needs broken code, the error and the fix`);
    }
    for (const e of m.sections.practice) {
      assert.ok(e.task && e.solution && e.expected, `${e.id}: Practice needs task/solution/expected`);
    }
    for (const key of ['miniProject', 'projectLab']) {
      for (const e of m.sections[key]) {
        assert.ok(e.body && e.steps?.length, `${e.id}: project needs a brief and steps`);
      }
    }
    for (const e of m.sections.defense) {
      assert.ok(e.q && e.answer, `${e.id}: Defense needs a prompt and an authored answer`);
    }
    const quiz = m.sections.checkpoint.filter((e) => e.options && e.format !== 'truefalse');
    const trueFalse = m.sections.checkpoint.filter((e) => e.format === 'truefalse');
    const blanks = m.sections.checkpoint.filter((e) => e.format === 'blank');
    const written = m.sections.checkpoint.filter((e) => e.rubric);
    assert.ok(quiz.length > 0, `${m.id}: no quiz checkpoints`);
    assert.ok(written.length > 0, `${m.id}: no written checkpoints`);
    assert.ok(trueFalse.length > 0, `${m.id}: no true/false checkpoints`);
    assert.ok(blanks.length > 0, `${m.id}: no fill-in-the-blank checkpoints`);
    for (const e of trueFalse) {
      assert.deepEqual(e.options, ['True', 'False'], `${e.id}: true/false needs exactly two options`);
      assert.ok(e.options.includes(e.answer), `${e.id}: the answer is not True or False`);
    }
    for (const e of blanks) {
      assert.ok(e.code.includes('___') && e.solution && e.answer, `${e.id}: blank needs a ___, a solution and an answer`);
    }
    for (const e of quiz) {
      assert.ok(e.options.length >= 3, `${e.id}: quiz needs three real options`);
      assert.ok(e.options.includes(e.answer), `${e.id}: the answer is not among the options`);
    }
    for (const e of written) {
      assert.ok(e.rubric.length >= 3, `${e.id}: written checkpoint needs three criteria`);
    }
  }
});

test('coding hints are authored for at least one module and are genuinely helpful text', () => {
  const hints = artifact.modules.flatMap((m) => m.sections.coding.filter((e) => e.hint));
  assert.ok(hints.length >= 25, `only ${hints.length} coding hints authored`);
  for (const e of hints) {
    assert.ok(e.hint.trim().length > 20, `${e.id}: hint is too short to help`);
  }
});
