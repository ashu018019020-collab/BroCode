/**
 * The ML per-course persistence contract.
 *
 * The existing `per_course` column is NumPy-only: its validator accepts nmod/nans/ntick and its
 * replace-RPC owns the whole value. These checks keep ML on a separate additive column and RPC, with
 * the same identity and privilege model, without adding a new policy or a table grant.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');
const code = (relative) => read(relative)
  .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (match, lead) => lead + ' '.repeat(match.length - lead.length));

const SQL_PATH = 'prisma/migrations/20261120120000_ml_progress/migration.sql';

test('ML gets an additive column separate from NumPy per_course', () => {
  const sql = read(SQL_PATH);
  assert.match(sql,
    /ALTER TABLE public\.progress_snapshots\s+ADD COLUMN IF NOT EXISTS ml_per_course jsonb NOT NULL DEFAULT '\{\}'::jsonb/,
    'the ML column must be additive and default to an empty object');
  assert.doesNotMatch(code(SQL_PATH), /ADD COLUMN IF NOT EXISTS per_course/,
    'the existing NumPy column must not be altered or reused');
  assert.match(read('prisma/schema.prisma'), /mlPerCourse\s+Json\s+@default\("\{\}"\)\s+@map\("ml_per_course"\)/,
    'Prisma must know the dedicated column');
});

test('the ML RPC is identity-bound and only accepts mmod records', () => {
  const sql = read(SQL_PATH);
  assert.match(sql, /me uuid := auth\.uid\(\)/, 'the caller comes from the signed JWT');
  assert.match(sql, /SECURITY DEFINER/, 'the writer must bypass RLS only for its own upsert');
  assert.match(sql, /SET search_path = ''/, 'the function must not inherit a search path');
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.save_my_ml_progress\(/);
  assert.match(sql, /entry\.key LIKE 'mmod:%'/, 'only ML section keys are accepted');
  assert.doesNotMatch(sql, /entry\.key LIKE 'nmod:%'/, 'the NumPy prefix must not be accepted');
  assert.match(sql, /octet_length\(payload::text\) > 65536/, 'the whole payload is bounded');
  assert.match(sql, /jsonb_object_keys\(payload\)\) > 600/, 'the record count is bounded');
  assert.match(sql, /char_length\(entry\.value ->> 'answer'\) > 20000/, 'a draft value is bounded');
  assert.match(sql, /INSERT INTO public\.progress_snapshots \(user_id, ml_per_course, updated_at\)/,
    'the course-only writer touches the ML column, not the counters');
  assert.match(sql, /ml_per_course = EXCLUDED\.ml_per_course/, 'the write replaces only the ML payload');
  assert.doesNotMatch(sql, /save_my_ml_progress[\s\S]{0,900}xp\s*=/, 'the ML path must not write XP');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.save_my_ml_progress\(jsonb\) FROM PUBLIC, anon/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.save_my_ml_progress\(jsonb\) TO authenticated/);
});

test('the NumPy writer remains separate from the ML column', () => {
  const numpySql = read('prisma/migrations/20261112130000_progress_per_course/migration.sql');
  assert.doesNotMatch(numpySql, /ml_per_course/, 'the existing NumPy RPC must not learn about ML storage');
  const store = code('server/store.mjs');
  assert.doesNotMatch(store, /saveProgress\([\s\S]{0,700}mlPerCourse/,
    'the generic snapshot writer must not overwrite the ML column');
});

test('the ML migration does not weaken RLS or table privileges', () => {
  const sql = code(SQL_PATH);
  assert.doesNotMatch(sql, /CREATE POLICY|ALTER POLICY|DROP POLICY|ENABLE ROW LEVEL SECURITY|DISABLE ROW LEVEL SECURITY/i,
    'the existing own-row SELECT policy must remain the only read policy');
  assert.doesNotMatch(sql, /GRANT\s+(?:ALL|INSERT|UPDATE|DELETE|TRUNCATE)[\s\S]{0,80}ON\s+(?:TABLE\s+)?public\.progress_snapshots/i,
    'ML must not add a direct table write grant');
  assert.doesNotMatch(sql, /^\s*(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)/im,
    'the migration must stay additive');
});

test('the static ML client reads and writes its own column through the narrow RPC', () => {
  const client = code('src/core/auth/client.ts');
  assert.match(client, /from\('progress_snapshots'\)\s*\.select\('ml_per_course'\)/,
    'the read path selects the ML column, not NumPy per_course');
  assert.match(client, /rpc\('save_my_ml_progress', \{ per_course: payload \}\)/,
    'the direct write uses the dedicated ML function');
  assert.doesNotMatch(client, /save_my_ml_progress', \{ per_course: (?!\s*payload\s*\})/,
    'the ML RPC must receive the validated ML payload');

  const transport = code('src/core/data/ml-progress.ts');
  assert.match(transport, /\/api\/ml\/progress/, 'the account API path is dedicated to ML');
  assert.match(transport, /loadOwnMlProgress\(\)/, 'load falls back to the ML column');
  assert.match(transport, /saveOwnMlProgress\(payload\)/, 'save falls back to the ML RPC');
  assert.match(transport, /result\.status === 401\) return \{ ok: false, reason: 'signed-out' \}/,
    'a signed-out response is not turned into a local write');
});

test('the API validates ML independently from NumPy', () => {
  const server = code('server/app.mjs');
  assert.match(server, /url\.pathname === '\/api\/ml\/progress'/);
  assert.match(server, /function validateMlPayload/);
  assert.match(server, /key\.startsWith\(ML_SYNC_PREFIX\)/);
  assert.doesNotMatch(server, /function validateMlPayload[\s\S]{0,900}NUMPY_SYNC_PREFIXES/,
    'the ML validator must not accept the NumPy allowlist');
});
