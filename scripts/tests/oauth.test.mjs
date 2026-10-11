import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { enabledProviders, oauthErrorMessage, readOAuthCallback, withoutOAuthParams } = await load('src/core/auth/oauth.ts');

test('oauth: the sign-in form offers only the providers the project has enabled', () => {
  // This project is email-only, so both provider buttons must go — a button that can only fail is
  // worse than no button.
  assert.deepEqual(enabledProviders({ external: { email: true, github: false, google: false } }),
    { github: false, google: false });
  assert.deepEqual(enabledProviders({ external: { email: true, github: true, google: false } }),
    { github: true, google: false });
  assert.deepEqual(enabledProviders({ external: { email: true } }), { github: false, google: false });
  // "Could not find out" is NOT "none": an unreadable payload must not hide a working provider.
  assert.equal(enabledProviders(null), null);
  assert.equal(enabledProviders('nope'), null);
  assert.equal(enabledProviders({}), null);
  assert.equal(enabledProviders({ external: 'yes' }), null);
});

test('oauth: a provider return is read from the redirect query, and nothing else is', () => {
  assert.deepEqual(readOAuthCallback(''), { code: null, error: null, errorDescription: null });
  assert.deepEqual(readOAuthCallback('?code=abc123&state=xyz'), {
    code: 'abc123',
    error: null,
    errorDescription: null,
  });
  assert.deepEqual(
    readOAuthCallback('?error=access_denied&error_description=User+denied+the+request'),
    { code: null, error: 'access_denied', errorDescription: 'User denied the request' },
  );
  assert.deepEqual(readOAuthCallback('?code=%20%20'), { code: null, error: null, errorDescription: null });
});

test('oauth: the one-shot redirect parameters are stripped, unrelated state survives', () => {
  assert.equal(withoutOAuthParams(''), '');
  assert.equal(withoutOAuthParams('?code=abc&state=xyz'), '');
  assert.equal(withoutOAuthParams('?error=access_denied&error_code=otp_expired&error_description=Email+link'), '');
  assert.equal(withoutOAuthParams('?code=abc&next=%2Fpractice'), '?next=%2Fpractice');
  assert.equal(withoutOAuthParams('?next=%2Fpractice'), '?next=%2Fpractice');
});

test('oauth: a cancelled return reads as a cancellation, other errors keep their reason', () => {
  assert.match(
    oauthErrorMessage({ code: null, error: 'access_denied', errorDescription: null }),
    /cancelled/i,
  );
  assert.match(
    oauthErrorMessage({ code: null, error: 'server_error', errorDescription: 'Email could not be sent' }),
    /Email could not be sent/,
  );
  assert.match(
    oauthErrorMessage({ code: null, error: 'server_error', errorDescription: null }),
    /could not complete/i,
  );
});
