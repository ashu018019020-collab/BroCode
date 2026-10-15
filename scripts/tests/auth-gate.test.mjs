/**
 * Authentication GATE rules — the pure decisions behind "can this visitor see this page" and "which
 * half of password recovery is this".
 *
 * These are greppable string checks against the real sources rather than rendered components: the
 * route guard and the reset page both import React and the router, which the test loader cannot link
 * (see the loader-ceiling note in AGENTS.md). What a string check CAN do is hold the contracts that
 * would otherwise drift silently — the storage keys, the redirect shape, the route wrappers, and the
 * recovery-link parsing, which is pure and IS unit-tested directly below.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/**
 * Source with comments removed, for assertions that grep for a literal string.
 *
 * Documentation legitimately DISCUSSES what was removed ("the app was guest-first", "no continue as
 * guest"), and a naive grep reads that explanation as a live affordance. Stripping comments keeps the
 * assertion about the CODE while leaving the reasoning in place. Blank lines are preserved so
 * line-based neighbours still make sense.
 */
const code = (relative) => read(relative)
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

/* ------------------------------ the reset link ------------------------------ */

test('auth gate: a recovery link is recognised in the query (PKCE) and in the fragment (implicit)', async () => {
  const { passwordResetRequested } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'core', 'auth', 'reset.ts')).href
  );

  // PKCE — this app's configured flow. supabase-js exchanges `?code=…`; our marker says why.
  assert.equal(passwordResetRequested({ search: '?reset=1', hash: '' }), true);
  assert.equal(passwordResetRequested({ search: '?code=abc&type=recovery', hash: '' }), true);
  // Implicit fallback some projects still send: the credential is in the FRAGMENT, not the query.
  assert.equal(passwordResetRequested({ search: '', hash: '#access_token=tok&type=recovery' }), true);
  assert.equal(passwordResetRequested({ search: '', hash: '#error=access_denied&error_code=otp_expired' }), true);

  // A HashRouter ROUTE lives in that same fragment and must NOT be mistaken for a recovery link —
  // this is the case that would otherwise send every deep link into the reset screen.
  assert.equal(passwordResetRequested({ search: '', hash: '#/lesson/s01/learn' }), false);
  assert.equal(passwordResetRequested({ search: '', hash: '#/courses' }), false);
  assert.equal(passwordResetRequested({ search: '', hash: '' }), false);
  assert.equal(passwordResetRequested({ search: '?section=s19&type=interview', hash: '#/questions' }), false);
});

test('auth gate: a failed recovery link reports why, and never invents a reason', async () => {
  const { passwordResetError } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'core', 'auth', 'reset.ts')).href
  );
  assert.equal(passwordResetError({ hash: '', search: '' }), null, 'no error means no sentence');
  assert.match(
    passwordResetError({ hash: '#error=access_denied&error_description=Email+link+is+invalid', search: '' }),
    /Email link is invalid/,
    'the provider sentence is shown to the learner, with + unescaped',
  );
  assert.match(
    passwordResetError({ hash: '', search: '?error_code=otp_expired' }),
    /invalid or has expired/,
    'a code with no description still produces an actionable sentence',
  );
});

test('auth gate: the spent recovery credential is stripped from the address bar', async () => {
  const { withoutResetParams } = await import(
    pathToFileURL(path.join(ROOT, 'src', 'core', 'auth', 'reset.ts')).href
  );
  // The credential must not survive in the URL: a refresh would replay a spent link and a screenshot
  // or a shared screen would capture a live one.
  assert.equal(
    withoutResetParams({ pathname: '/', search: '?reset=1', hash: '' }),
    '/',
    'our own marker is removed',
  );
  assert.equal(
    withoutResetParams({ pathname: '/', search: '', hash: '#access_token=tok&type=recovery&expires_in=3600' }),
    '/',
    'the implicit fragment credential is removed entirely',
  );
  assert.equal(
    withoutResetParams({ pathname: '/', search: '?code=abc', hash: '' }),
    '/',
    'the PKCE code is removed',
  );
  // A HashRouter route is NOT a credential and must survive untouched, or the cleanup would navigate
  // the learner somewhere else.
  assert.equal(
    withoutResetParams({ pathname: '/', search: '', hash: '#/lesson/s01/learn' }),
    '/#/lesson/s01/learn',
  );
  assert.equal(withoutResetParams({ pathname: '/courses', search: '', hash: '' }), '/courses');
});

/* ------------------------------- the route gate ------------------------------- */

test('auth gate: the guard preserves the destination and never redirects while restoring', () => {
  const guard = read('src/features/auth/RequireAuth.tsx');
  // A redirect during session restore is the bug that logs a signed-in learner out on every refresh.
  assert.match(guard, /if \(loading\) return <RouteGateSkeleton \/>/);
  assert.match(guard, /if \(!user\) \{[\s\S]{0,200}<Navigate\s+to="\/login"[\s\S]{0,120}state=\{\{ from:/,
    'the unauthenticated branch must redirect to /login with the requested route');
  assert.match(guard, /replace/, 'the redirect must replace history so Back does not loop');
  // The skeleton must announce itself rather than render an empty page.
  assert.match(guard, /aria-busy="true"/);
});

test('auth gate: every protected page is registered behind the guard, and the public list is closed', () => {
  const app = read('src/app/App.tsx');
  const routes = app.slice(app.indexOf('<Routes>'), app.indexOf('</Routes>'));
  const PUBLIC = ['/', '/start', '/login', '/reset-password'];

  const entries = [...routes.matchAll(/<Route path="(\/[^"]*)" element=\{<(\w+)/g)].map(([, p, c]) => ({ path: p, component: c }));
  assert.ok(entries.length >= 40, `expected the whole route table to be literal, found ${entries.length}`);

  for (const { path: routePath, component } of entries) {
    if (PUBLIC.includes(routePath)) {
      assert.notEqual(component, 'Protect', `${routePath} is public and must not be wrapped`);
      continue;
    }
    assert.equal(component, 'Protect', `${routePath} is not behind the guard — it would be public`);
  }

  // The learning surfaces, named so the intent is readable and a removal is obvious.
  const protectedPaths = [
    '/courses', '/course/:slug', '/course/:slug/:step', '/lesson/:sid/:stage', '/lesson/:sid',
    '/practice', '/questions', '/exam', '/labs', '/playground', '/sql', '/notebooks',
    '/projects', '/interviews', '/interview-mode', '/defense', '/mock-interviews',
    '/progress', '/mistakes', '/review', '/career', '/job-prep', '/notes', '/cheat-sheets',
    '/playbook', '/pdf', '/concepts', '/track/:trackSlug', '/final-assessment',
    '/ai-lab', '/rag-lab', '/agentic', '/numpy-pandas', '/settings', '/onboarding', '/admin',
  ];
  for (const routePath of protectedPaths) {
    const entry = entries.find((e) => e.path === routePath);
    assert.ok(entry, `${routePath} disappeared from the route table`);
    assert.equal(entry.component, 'Protect', `${routePath} must require an account`);
  }

  // The wildcard must NOT be a protected page — an unknown URL should not reveal that a page exists
  // behind a login, and it must not send a visitor into a redirect loop.
  assert.match(routes, /<Route path="\*" element=\{<PublicHome \/>\}/);
});

test('auth gate: no guest affordance survives anywhere in the app', () => {
  // The whole point of the change: there is no path into learning without a session. Every entry
  // below is a place a "guest" could previously get in, or a promise of one. Comments are stripped
  // first — the files EXPLAIN what was removed, and an explanation is not an affordance.
  const files = [
    'src/app/App.tsx',
    'src/features/auth/LoginPage.tsx',
    'src/features/auth/AuthForm.tsx',
    'src/features/auth/AuthDialog.tsx',
    'src/features/dashboard/Landing.tsx',
    'src/features/dashboard/Dashboard.tsx',
    'src/features/dashboard/Onboarding.tsx',
    'src/core/auth/oauth.ts',
    'src/core/auth/client.ts',
    'src/core/auth/AuthProvider.tsx',
    'src/app/i18n/locales.ts',
  ];
  for (const file of files) {
    const source = code(file);
    assert.doesNotMatch(source, /Guest learner|Continue as guest|guest-first/i,
      `${file} still offers a guest path`);
    // `'guest'` as an identity, a key, or a storage namespace is likewise gone.
    assert.doesNotMatch(source, /['"]guest['"]/, `${file} still keys something on a guest identity`);
  }
  // Anonymous sign-in would silently reinstate the same thing, so it is asserted absent.
  for (const file of ['src/core/auth/client.ts', 'src/core/auth/AuthProvider.tsx']) {
    assert.doesNotMatch(code(file), /signInAnonymously|anonymous/i, `${file} must not sign anyone in anonymously`);
  }
  // And the locale pack no longer carries the key at all — a live key is what renders "Guest learner".
  const locales = code('src/app/i18n/locales.ts');
  assert.doesNotMatch(locales, /acct\.guest/, 'the guest label must be gone from both packs');
  // The replacement keys are present in both, so the signed-out state still reads properly.
  for (const key of ['acct.signedOut', 'acct.signInHint', 'acct.signIn', 'acct.signUp']) {
    assert.equal(locales.split(`'${key}':`).length - 1, 2, `${key} must exist in the English AND Hinglish packs`);
  }
});
