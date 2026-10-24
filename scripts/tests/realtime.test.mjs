import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { LIVE_CHANNEL, SIGN_IN_EVENT, onlineOf, presenceIds } = await load('src/core/auth/realtime.ts');

test('realtime: a presence state reads as the set of connected account ids', () => {
  // Two connections of one account (two devices) collapse to one id; a presence_ref alone is not
  // an account; malformed entries are skipped, never thrown on — this state crosses a network.
  const state = {
    'key-a': [{ id: 'user-1', presence_ref: 'r1' }, { id: 'user-2', presence_ref: 'r2' }],
    'key-b': [{ id: 'user-1', presence_ref: 'r3' }],
    'key-c': [{ presence_ref: 'r4' }, 'not-an-object'],
    'key-d': 'not-an-array',
  };
  assert.deepEqual([...presenceIds(state)].sort(), ['user-1', 'user-2']);
  assert.deepEqual([...presenceIds(null)], []);
  assert.deepEqual([...presenceIds('bogus')], []);
  assert.deepEqual([...presenceIds({})], []);
});

test('realtime: live presence is authoritative, the snapshot only stands in when nothing is live', () => {
  const live = new Set(['user-1']);
  // Connected channel: the live set decides both directions — join AND leave are instant.
  assert.equal(onlineOf('user-1', false, live), true);
  assert.equal(onlineOf('user-2', true, live), false);
  // No live channel (first paint, dropped socket, no realtime): the server snapshot decides.
  assert.equal(onlineOf('user-1', true, null), true);
  assert.equal(onlineOf('user-2', false, null), false);
  // An empty live set is a real answer — everybody is offline — not "unknown".
  assert.equal(onlineOf('user-2', true, new Set()), false);
});

test('realtime: the channel and event names are stable — they are a wire contract between tabs', () => {
  assert.equal(LIVE_CHANNEL, 'brocode-live');
  assert.equal(SIGN_IN_EVENT, 'sign-in');
});
