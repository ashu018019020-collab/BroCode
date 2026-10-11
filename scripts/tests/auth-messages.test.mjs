import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { authErrorCopy, isEmail, MIN_PASSWORD, passwordProblem } = await load('src/core/auth/messages.ts');

test('auth messages: an address is judged like one, not like a regex exercise', () => {
  for (const good of ['a@b.co', 'moin.khan+study@example.co.in', '  spaced@example.com  ']) {
    assert.equal(isEmail(good), true, `${good} should read as an address`);
  }
  for (const bad of ['', 'nope', 'nope@', '@example.com', 'a@b', 'a b@example.com', 'a@b.c']) {
    assert.equal(isEmail(bad), false, `${bad} should not read as an address`);
  }
});

test('auth messages: the password rule is one number, stated once', () => {
  assert.equal(MIN_PASSWORD, 8);
  assert.equal(passwordProblem('short'), `Use at least ${MIN_PASSWORD} characters.`);
  assert.equal(passwordProblem('1234567'), `Use at least ${MIN_PASSWORD} characters.`);
  assert.equal(passwordProblem('12345678'), '');
  assert.equal(passwordProblem('a much longer passphrase'), '');
});

test('auth messages: a developer error becomes an instruction, in the product voice', () => {
  assert.match(authErrorCopy('Invalid login credentials'), /Email or password is incorrect/);
  assert.match(authErrorCopy('Email not confirmed'), /not confirmed yet/);
  assert.match(authErrorCopy('User already registered'), /already registered/);
  assert.match(authErrorCopy('Email rate limit exceeded'), /Too many attempts/);
  assert.match(authErrorCopy('Password should be at least 6 characters'), /at least 8 characters/);
  assert.match(authErrorCopy('Unable to validate email address: invalid format'), /look valid/);
  assert.match(authErrorCopy('Signups not allowed for this instance'), /sign-ups are disabled/);
});

test('auth messages: an error nobody has seen yet is passed through, never swallowed', () => {
  assert.equal(authErrorCopy('Database error saving new user'), 'Database error saving new user');
  assert.equal(authErrorCopy('Account service is unavailable.'), 'Account service is unavailable.');
});
