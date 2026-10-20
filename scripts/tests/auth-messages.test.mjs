import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { authErrorCopy, isEmail, MIN_PASSWORD, passwordProblem, RESEND_COOLDOWN_SECONDS, resendWaitSeconds, SERVICE_UNAVAILABLE_COPY } =
  await load('src/core/auth/messages.ts');

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
  // The sign-up mail quota and the login throttle are different waits, so they are different
  // sentences: Supabase's built-in sender allows only TWO confirmation emails per project per hour
  // (docs/guides/auth/rate-limits — not customizable without custom SMTP or a send-email hook),
  // so "wait a minute or two" — and even "a few minutes" — sent a learner retrying into the same
  // wall. The sentence names the real window and the way out that costs no email at all.
  const quota = authErrorCopy('Email rate limit exceeded');
  assert.match(quota, /hourly confirmation emails/);
  assert.match(quota, /about an hour/);
  assert.match(quota, /sign in if you already created this account/);
  assert.doesNotMatch(quota, /minute or two/);
  assert.match(authErrorCopy('Too many requests'), /Too many attempts/);
  assert.match(authErrorCopy('Password should be at least 6 characters'), /at least 8 characters/);
  assert.match(authErrorCopy('Unable to validate email address: invalid format'), /look valid/);
  assert.match(authErrorCopy('Signups not allowed for this instance'), /sign-ups are disabled/);
});

test('auth messages: the resend button waits a minute, like the server does', () => {
  assert.equal(RESEND_COOLDOWN_SECONDS, 60);
  const sent = 1_700_000_000_000;
  assert.equal(resendWaitSeconds(sent, sent), 60, 'a fresh message locks the button');
  assert.equal(resendWaitSeconds(sent, sent + 30_500), 30, 'and it counts down in whole seconds');
  assert.equal(resendWaitSeconds(sent, sent + 60_000), 0, 'the button reopens after a minute');
  assert.equal(resendWaitSeconds(sent, sent + 3_600_000), 0, 'and never re-locks itself');
  assert.equal(resendWaitSeconds(0, sent), 0, 'nothing sent yet means nothing to wait for');
  assert.equal(resendWaitSeconds(sent, sent - 5_000), 60, 'a clock that moved backwards is clamped, not endless');
});

test('auth messages: an error nobody has seen yet is passed through, never swallowed', () => {
  assert.equal(authErrorCopy('Database error saving new user'), 'Database error saving new user');
  assert.equal(authErrorCopy('Account service is unavailable.'), 'Account service is unavailable.');
});

/**
 * The one thing that must never reach a learner is how the deployment is wired. A missing variable,
 * a secret key name, an HTTP status, the local API not being up yet: all of it is the operator's
 * business (it goes to the console), and every one of these strings was, at some point, rendered
 * inside the account dialog.
 */
test('auth messages: deployment detail and infrastructure are never shown, whatever the wording', () => {
  for (const leaked of [
    'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in the root .env file.',
    'Set SUPABASE_SECRET_KEY before starting the account API.',
    'process.env.DATABASE_URL is not set.',
    'Account API returned HTTP 503 without JSON; verify the API server is running.',
    'The account service returned an invalid response.',
    'Account request failed (500).',
  ]) {
    assert.equal(authErrorCopy(leaked), SERVICE_UNAVAILABLE_COPY,
      `a learner must never be shown deployment detail: ${leaked}`);
  }
  // …and the sentence itself says what to DO, without naming a subsystem, a key or a host.
  assert.match(SERVICE_UNAVAILABLE_COPY, /try again/i);
  assert.doesNotMatch(SERVICE_UNAVAILABLE_COPY, /VITE_|\.env|supabase|key|http/i);
});
