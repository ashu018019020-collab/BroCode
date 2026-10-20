/**
 * The sign-up contract and direct-to-Supabase progress sync.
 *
 * Two things held together here because they ship as one flow: an account is created with NAME,
 * EMAIL, PASSWORD and CONFIRM PASSWORD (email is the only method — no social buttons), and learner
 * progress is collected in Supabase on EVERY deployment — through the account API when a deployment
 * runs one, and through the identity-bound `save_my_progress` function when it does not (a static
 * host serves no `/api`). The greppable source checks follow this repo's convention for React
 * modules the test loader cannot link; `messages.ts` is pure and is DRIVEN instead of grepped, and
 * the SQL is asserted directly because a migration is plain text and its safety rules are exactly
 * the kind of thing that drifts silently.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

register('./_ts-resolve.mjs', import.meta.url);
const { authErrorCopy } = await import(
  pathToFileURL(path.join(ROOT, 'src/core/auth/messages.ts')).href
);

/** Comments explain what was removed; a naive grep reads the explanation as a live affordance. */
const code = (relative) => read(relative)
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + ' '.repeat(m.length - lead.length));

/* ------------------------------ the sign-up form ------------------------------ */

test('sign-up collects name, email, password and confirm password — and no provider buttons', () => {
  const form = code('src/features/auth/AuthForm.tsx');
  // The provider surface is gone: no probe, no buttons, no divider, no OAuth imports.
  assert.doesNotMatch(form, /loadProviderAvailability|signInWithProvider|PROVIDERS|auth-providers|auth-divider/,
    'the form must not offer social sign-in — email is the only method');
  assert.doesNotMatch(form, /GitHubMark|GoogleMark|Continue with/, 'no provider buttons survive');
  // Four fields, in the order a learner meets them.
  assert.equal((form.match(/<input/g) ?? []).length, 4,
    'name, email, password and confirm password are the whole form');
  assert.match(form, /autoComplete="name"/, 'the name field is back — it is the display name');
  assert.match(form, /<span>Confirm password<\/span>/, 'and so is the confirm-password field');
  // The two fields that only exist on the sign-up tab must stay behind the mode check.
  assert.equal((form.match(/mode === 'register'/g) ?? []).length >= 4, true,
    'name and confirm are sign-up-only, so the sign-in tab stays two fields');
  assert.match(form, /register\(name\.trim\(\), email\.trim\(\), password\)/,
    'register carries the typed name, the address and the password');
  assert.match(form, /confirm === password/, 'the two password fields must actually be compared');
  // The confirmation round-trip (the project has Confirm email ON) must keep its state + resend.
  assert.match(form, /awaitingConfirmation/, 'the inbox state is what a waiting learner sees');
  assert.match(form, /authApi\.resendConfirmation/, 'and must be able to ask for the email again');
});

test('the typed name is the display name, with the address as the documented fallback', () => {
  const client = code('src/core/auth/client.ts');
  assert.match(client, /async register\(name: string, email: string, password: string\)/,
    'register takes the name first');
  assert.match(client, /const displayName = name\.trim\(\) \|\| trimmed\.split\('@'\)\[0\]/,
    'a blank name falls back to the local part of the address, like private.create_profile_for_auth_user');
  assert.match(client, /data: \{ display_name: displayName \}/,
    'and travels to Supabase as display_name metadata, which is what the profile reads');
  assert.doesNotMatch(client, /signInWithProvider|takePendingOAuthProvider|loadProviderAvailability/,
    'no OAuth plumbing may remain in the client');
  const provider = code('src/core/auth/AuthProvider.tsx');
  assert.doesNotMatch(provider, /loginWithProvider|takePendingOAuthProvider/,
    'and none in the provider either');
  assert.match(provider, /register: \(name: string, email: string, password: string\)/,
    'the context type must not lose the name on the way to the form');
});

test('an exhausted sign-up mail quota is not reported as a one-minute throttle', () => {
  const emailLimit = authErrorCopy('email rate limit exceeded');
  assert.match(emailLimit, /Too many confirmation emails/,
    'the sign-up mail limit is its own sentence, because its window is not "a minute or two"');
  assert.doesNotMatch(emailLimit, /minute or two/);
  assert.match(authErrorCopy('over_email_send_rate_limit'), /Too many confirmation emails/,
    'the structured error code maps the same way');
  // The login throttle keeps the shorter wording — it really does clear in a minute.
  assert.match(authErrorCopy('Too many requests'), /Too many attempts\. Wait a minute or two/);
  // An unknown message is never swallowed.
  assert.equal(authErrorCopy('Something the project invented'), 'Something the project invented');
});

/* --------------------------- progress reaches Supabase --------------------------- */

test('progress sync falls back to Supabase directly when the account API is absent', () => {
  const client = code('src/core/auth/client.ts');
  // The API stays the first choice (server validation + admin dashboard), but a static deployment
  // must still COLLECT data in Supabase rather than silently dropping the snapshot.
  assert.match(client, /async saveProgress\(/, 'saveProgress is the one write path');
  assert.match(client, /\/api\/progress\/snapshot[\s\S]{0,220}saveProgressDirectly\(progress\)/,
    'the account API is tried first and Supabase direct is the fallback');
  assert.match(client, /rpc\('save_my_progress'/, 'the fallback writes through the database function');
  assert.match(client, /from\('progress_snapshots'\)\s*\.select\('last_section_id, last_stage'\)/,
    'a new device reads its OWN saved lesson position for resume');
});

test('the direct-sync migration is identity-bound, validated, and additive', () => {
  const sql = read('prisma/migrations/20261020120000_progress_direct_sync/migration.sql');

  // Identity comes from the signed JWT, never from an argument — this is the whole security model.
  assert.match(sql, /me uuid := auth\.uid\(\)/, 'the caller is read from the token');
  assert.match(sql, /INSERT INTO public\.progress_snapshots[\s\S]*?VALUES\s*\(\s*me,/,
    'the row is always written for the caller');
  assert.match(sql, /SECURITY DEFINER/, 'the function must bypass RLS for its own upsert only');
  assert.match(sql, /SET search_path = ''/, 'and must not inherit a search path');

  // Validation mirrors server/app.mjs, so a crafted body cannot store junk even without the API.
  assert.match(sql, /Progress counters must be non-negative integers/);
  assert.match(sql, /last_section_id !~ '\^\[A-Za-z0-9_-\]\{1,32\}\$'/);
  assert.match(sql, /last_stage must be a real lesson stage/);

  // The write path is granted to signed-in learners only; table writes stay revoked.
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.save_my_progress\([\s\S]*?\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_my_progress\([\s\S]*?\) TO authenticated/);
  assert.match(sql, /GRANT SELECT ON TABLE public\.progress_snapshots TO authenticated/);
  // Read access is the caller's OWN row and nothing else.
  assert.match(sql, /USING \(user_id = \(SELECT auth\.uid\(\)\)\)/,
    'the read policy exposes only the signed-in learner\'s row');
  // A missing profile must not block the snapshot, and the path may never mint an admin.
  assert.match(sql, /INSERT INTO public\.profiles \(id\) VALUES \(me\) ON CONFLICT \(id\) DO NOTHING/);
  assert.doesNotMatch(sql, /profiles[\s\S]{0,400}role\s*=\s*|INSERT INTO public\.profiles \((?!id\))/,
    'the profile bootstrap writes no role or status');
});

test('the direct-sync migration drops nothing and rewrites no learner data', () => {
  const sql = read('prisma/migrations/20261020120000_progress_direct_sync/migration.sql');
  const statements = sql
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean);
  for (const statement of statements) {
    assert.doesNotMatch(statement, /^\s*(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE public\.progress_snapshots\b(?!.*ON CONFLICT))/i,
      `destructive statement found: ${statement.slice(0, 80)}`);
  }
});
