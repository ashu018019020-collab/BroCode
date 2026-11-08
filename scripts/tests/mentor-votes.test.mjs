/**
 * The mentor's FEEDBACK IDENTITY — `turnVoteKey` in `src/core/ai/mentor.ts`.
 *
 * A thumbs up/down is stored on the device, keyed by this string. The conversation it belongs to is
 * an ARRAY that gets filtered by the search box and trimmed by `slice(-MAX_TURNS)`, so an index is
 * not an identity: a vote saved against "turn 4" lands on a different answer the moment one earlier
 * turn is dropped. These tests hold the four properties the panel depends on:
 *
 *   1. The same turn always produces the same key (so a reload finds the vote again).
 *   2. A different ROLE or a different ANSWER is a different turn (no vote bleeding across turns).
 *   3. Trimming/filtering the list does not change the key of a turn that survives.
 *   4. The key stays BOUNDED and JSON-safe, because it becomes part of a localStorage key next to
 *      `aiml:mentor:log` — a 5,000-character answer must not become a 5,000-character key.
 *
 * The first-40-character cut is a deliberate, documented tradeoff (a bounded key over a hash
 * dependency); the last test pins it so a change there is a decision, not an accident.
 *
 * Zero dependencies: node:test plus the project's TS resolver hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { turnVoteKey } = await load('src/core/ai/mentor.ts');

const key = (role, text) => turnVoteKey({ role, text });

test('the same turn always maps to the same key', () => {
  const answer = '**Decorators** change a function without editing its body.';
  assert.equal(key('mentor', answer), key('mentor', answer));
  // …and recomputing it from a fresh object with the same fields does too (a reload builds new ones).
  assert.equal(turnVoteKey({ role: 'mentor', text: answer }), turnVoteKey({ role: 'mentor', text: answer }));
});

test('role is part of the identity, so a learner turn cannot inherit a mentor vote', () => {
  const text = 'Explain list comprehensions';
  assert.notEqual(key('learner', text), key('mentor', text));
});

test('a different answer is a different turn', () => {
  assert.notEqual(key('mentor', 'A list is ordered.'), key('mentor', 'A tuple is immutable.'));
});

test('two answers that differ inside the first 40 characters never share a key', () => {
  const a = 'A dict maps keys to values and keeps insertion order.';
  const b = 'A dict MAPS keys to values and keeps insertion order.';
  assert.equal(a.length, b.length);
  assert.notEqual(key('mentor', a), key('mentor', b));
});

test('a shorter answer is a different turn even with the same prefix', () => {
  const stem = 'A set removes duplicates because it hashes each element';
  assert.notEqual(key('mentor', stem), key('mentor', `${stem} before storing it.`));
});

test('an empty turn is still a key, not a crash', () => {
  assert.equal(key('mentor', ''), 'mentor:0:');
  assert.equal(key('learner', ''), 'learner:0:');
});

test('the key stays bounded for a very long answer', () => {
  const long = 'x'.repeat(5000);
  const k = key('mentor', long);
  // role + ':' + decimal length + ':' + at most 40 characters of text.
  assert.ok(k.length <= 'mentor'.length + 1 + String(long.length).length + 1 + 40, k.length);
  assert.ok(k.startsWith('mentor:5000:'));
});

test('two long answers that agree for 40 characters and in length share a key (the documented cut)', () => {
  // Both are 100 characters and identical up to the 41st: the key cannot tell them apart, which is
  // the price of a bounded, dependency-free identity. If this ever fails, the cut changed on purpose.
  const a = `${'y'.repeat(40)}${'a'.repeat(60)}`;
  const b = `${'y'.repeat(40)}${'b'.repeat(60)}`;
  assert.equal(a.length, b.length);
  assert.equal(key('mentor', a), key('mentor', b));
});

test('trimming and filtering the conversation does not change a surviving turn key', () => {
  const turns = [
    { role: 'learner', text: 'pehla sawaal' },
    { role: 'mentor', text: 'z'.repeat(300) },
    { role: 'learner', text: 'doosra sawaal' },
  ];
  const before = turns.map(turnVoteKey);
  // The panel filters by a search box and keeps only the last N turns; neither may re-key a turn.
  const kept = turns.filter((t) => t.text.includes('sawaal')).map(turnVoteKey);
  const trimmed = turns.slice(-2).map(turnVoteKey);
  assert.deepEqual(kept, [before[0], before[2]]);
  assert.deepEqual(trimmed, before.slice(-2));
});

test('the key round-trips through JSON in every script the app is taught in', () => {
  // Whitespace and Devanagari/emoji pass through `slice(0, 40)` untouched: the key is a plain string
  // (a localStorage key allows both), so the only property the panel needs is that it survives a
  // JSON round-trip unchanged.
  for (const text of ['plain answer', 'नमस्ते दुनिया, यह एक जवाब है', 'emoji 🚀🚀 and a tab\there']) {
    const k = key('mentor', text);
    assert.equal(typeof k, 'string');
    assert.equal(JSON.parse(JSON.stringify(k)), k);
    assert.ok(k.startsWith('mentor:'), k);
  }
});
