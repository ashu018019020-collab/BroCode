import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { summarizeProgress } = await load('src/core/auth/progress.ts');
const { accountStorageKey, setStorageAccount, subscribeStorageAccount } = await load('src/core/storage/account.ts');

const state = {
  version: 1,
  profile: { name: 'Learner', goal: 'AI', level: 'Beginner', dailyMinutes: 60, onboarded: true },
  xp: 120,
  streak: { current: 3, last: '2026-10-02' },
  attempts: {
    'qb:s01:q1': { done: false },
    'qb:s01:q2': { answer: 'private answer' },
    'qb:s01:q3': { tries: 2 },
    'nb:main.ipynb:c1': { done: true, score: 0 },
  },
  bookmarks: [{ id: 'private', label: 'Private bookmark', page: 1 }],
  mistakes: [
    { id: 'open', fixed: false },
    { id: 'fixed', fixed: true },
  ],
  review: {},
  interviewAnswers: { answer: 'private interview text' },
  defenseAnswers: {},
  savedCode: { file: 'private code' },
  settings: { reduceMotion: false },
  activity: {},
  study: { '2026-10-01': 125, '2026-10-02': 2455 },
  notes: [{ id: 'note', title: 'Private', body: 'not synced', tags: [], fav: false, created: 0, updated: 0 }],
  jobPrep: {},
  readNotifs: [],
};

test('progress sync contains aggregate counts, never answer text, notes, or code', () => {
  const summary = summarizeProgress(state);
  assert.deepEqual(summary, {
    xp: 120,
    streakCurrent: 3,
    practicedCount: 3,
    doneRecords: 1,
    studyMinutes: 43,
    studyDays: 2,
    openMistakes: 1,
  });
  assert.equal(Object.keys(summary).some((key) => ['notes', 'answers', 'savedCode', 'bookmarks'].includes(key)), false);
  assert.equal(JSON.stringify(summary).includes('private'), false);
});

test('private browser storage switches account namespaces while preserving guest data', () => {
  const changes = [];
  const unsubscribe = subscribeStorageAccount(() => changes.push(accountStorageKey('aiml:state:v1')));

  try {
    assert.equal(accountStorageKey('aiml:state:v1'), 'aiml:state:v1');
    setStorageAccount('user/one');
    assert.equal(accountStorageKey('aiml:state:v1'), 'aiml:state:v1:account:user%2Fone');
    setStorageAccount('user/two');
    assert.equal(accountStorageKey('aiml:state:v1'), 'aiml:state:v1:account:user%2Ftwo');
    setStorageAccount(null);
    assert.equal(accountStorageKey('aiml:state:v1'), 'aiml:state:v1');
    assert.deepEqual(changes, [
      'aiml:state:v1:account:user%2Fone',
      'aiml:state:v1:account:user%2Ftwo',
      'aiml:state:v1',
    ]);
  } finally {
    unsubscribe();
    setStorageAccount(null);
  }
});
