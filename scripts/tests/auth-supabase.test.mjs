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
  // The project's sender allows two emails per hour, so the resend cannot be free: it counts down.
  assert.match(form, /resendWaitSeconds\(sentAt, clock\)/, 'the resend is cooled down, not unlimited');
  assert.match(form, /disabled=\{resending \|\| resendWait > 0\}/, 'and the button is actually disabled');
  assert.match(form, /if \(result\.user\) onSuccess\?\.\(result\.user\)/,
    'with Confirm email OFF a session comes back — that branch must sign the learner in');
  // An unconfirmed account or a spent link is a dead end without this: the failure names the
  // problem, and the same screen offers the one action that clears it.
  assert.match(form, /needsNewConfirmationLink\(authFailure\)/, 'the form detects a resend-only failure');
  assert.match(form, /Send me a new confirmation link/, 'and offers the new link right there');
  assert.match(form, /const resendTarget = awaitingConfirmation \?\?/, 'the sign-in tab can resend too');
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
  assert.match(emailLimit, /hourly confirmation emails/,
    'the sign-up mail limit is its own sentence, and says the wait is an hour, not a minute');
  assert.doesNotMatch(emailLimit, /minute or two/);
  assert.match(authErrorCopy('over_email_send_rate_limit'), /hourly confirmation emails/,
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
  assert.match(client, /\/api\/progress\/snapshot[\s\S]{0,220}saveProgressDirectly\(progress(?:, perCourse)?\)/,
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

/* ------------------- per-course column and static NumPy sync ------------------- */

test('the per-course migration adds a bounded column and extends the direct write path', () => {
  const sql = read('prisma/migrations/20261112130000_progress_per_course/migration.sql');

  // The column is additive with a default, so older rows and clients keep working.
  assert.match(sql, /ALTER TABLE public\.progress_snapshots\s+ADD COLUMN IF NOT EXISTS per_course jsonb NOT NULL DEFAULT '\{\}'::jsonb/,
    'the per-course column is additive and defaults to an empty object');

  // The identity, validation and privilege model of the original function is preserved.
  assert.match(sql, /me uuid := auth\.uid\(\)/, 'the caller still comes from the token');
  assert.match(sql, /SECURITY DEFINER/, 'the writer still bypasses RLS for its own row only');
  assert.match(sql, /SET search_path = ''/, 'and keeps an empty search path');
  assert.match(sql, /Progress counters must be non-negative integers/);
  assert.match(sql, /last_section_id !~ '\^\[A-Za-z0-9_-\]\{1,32\}\$'/);
  assert.match(sql, /last_stage must be a real lesson stage/);
  assert.match(sql, /per_course jsonb DEFAULT '\{\}'::jsonb/, 'save_my_progress takes the course payload');
  assert.match(sql, /per_course = EXCLUDED\.per_course/, 'and upserts it with the counters');

  // The NumPy allowlist and limits mirror the client/server, so this is not a free-form JSON column.
  assert.match(sql, /entry\.key LIKE 'nmod:%'/, 'only the course section keys are accepted');
  assert.match(sql, /entry\.key LIKE 'nans:%'/);
  assert.match(sql, /entry\.key LIKE 'ntick:%'/);
  assert.match(sql, /entry\.key IN \('ncap', 'nlast', 'nlevel'\)/);
  assert.match(sql, /character varying|char_length\(entry\.value ->> 'answer'\) > 20000/,
    'a draft is bounded on write');
  assert.match(sql, /octet_length\(payload::text\) > 65536/, 'the whole payload is bounded');
  assert.match(sql, /jsonb_object_keys\(payload\)\) > 600/, 'and the record count is bounded');

  // One signature only: an older 9-argument call must not become ambiguous.
  assert.match(sql, /DROP FUNCTION IF EXISTS public\.save_my_progress\([\s\S]*?character varying, character varying\s*\);/,
    'the old overload is dropped so PostgREST cannot report an ambiguous function');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.save_my_progress\([\s\S]*?jsonb\s*\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_my_progress\([\s\S]*?jsonb\s*\) TO authenticated/);

  // The course-only writer touches one column and never the counters.
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.save_my_numpy_progress\(/);
  assert.match(sql, /INSERT INTO public\.progress_snapshots \(user_id, per_course, updated_at\)/);
  assert.match(sql, /per_course = EXCLUDED\.per_course,[\s\S]*?updated_at = now\(\);/);
  assert.doesNotMatch(sql, /save_my_numpy_progress[\s\S]{0,900}xp\s*=/,
    'the course-only path must not accept or overwrite XP');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_my_numpy_progress\(jsonb\) TO authenticated/);
});

test('the per-course migration drops no data and stays additive', () => {
  const sql = read('prisma/migrations/20261112130000_progress_per_course/migration.sql')
    .replace(/--[^\n]*/g, '');
  const statements = sql.split(';').map((line) => line.trim()).filter(Boolean);
  for (const statement of statements) {
    assert.doesNotMatch(statement, /^\s*(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)/i,
      `destructive statement found: ${statement.slice(0, 80)}`);
    assert.doesNotMatch(statement, /^\s*DROP FUNCTION(?! IF EXISTS public\.save_my_progress)/i,
      `unexpected function drop: ${statement.slice(0, 80)}`);
  }
});

test('a static deployment reads and writes the per-course column directly', () => {
  const client = code('src/core/auth/client.ts');
  assert.match(client, /rpc\('save_my_progress',[\s\S]*?per_course: perCourse \?\? \{\}/,
    'the snapshot write carries the course payload');
  assert.match(client, /from\('progress_snapshots'\)\s*\.select\('per_course'\)/,
    'the read path selects the caller\'s own per-course payload');
  assert.match(client, /rpc\('save_my_numpy_progress', \{ per_course: payload \}\)/,
    'the course-only write uses the narrow function');

  const sync = code('src/core/data/numpy-progress.ts');
  assert.match(sync, /loadOwnNumpyProgress\(\)/, 'load falls back to the column when the API is absent');
  assert.match(sync, /saveOwnNumpyProgress\(payload\)/, 'and save falls back to the narrow RPC');
  // A 401 means "signed out", not "try another path" — it must not be turned into a local write.
  assert.match(sync, /result\.status === 401\) return \{ ok: false, reason: 'signed-out' \}/);
});

test('the background sync sends course records with the snapshot and dedupes on them', () => {
  const provider = code('src/core/auth/AuthProvider.tsx');
  assert.match(provider, /collectNumpyProgress\(stateSnapshot\(\)\.attempts\)/,
    'the snapshot gathers the allowed NumPy keys from the real state');
  assert.match(provider, /JSON\.stringify\(\{ summary, perCourse \}\)/,
    'a new draft must change the dedupe signature, not just a counter');
  assert.match(provider, /authApi\.saveProgress\(summary, perCourse\)/,
    'and the payload travels to the one save call');
});
