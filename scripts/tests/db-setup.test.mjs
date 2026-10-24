import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const setup = require(path.join(ROOT, 'scripts', 'db-setup.cjs'));

const SAMPLE_ENV = [
  '# Supabase account service',
  'SUPABASE_URL=https://example.supabase.co',
  'DATABASE_URL=postgresql://postgres.abcdefghijklmnopqrst:percent-encoded-password@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true',
  'DIRECT_URL=postgresql://postgres.abcdefghijklmnopqrst:real-secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres',
  '',
  'WEB_ORIGIN="http://localhost:5173"',
  'API_PORT=8787',
].join('\n');

test('db-setup: the placeholder credential is found by name and line, real values pass', () => {
  const blockers = setup.findCredentialBlockers(SAMPLE_ENV);
  assert.deepEqual(blockers.map((b) => ({ name: b.name, line: b.line, reason: b.reason })), [
    { name: 'DATABASE_URL', line: 3, reason: 'placeholder' },
  ]);

  const empty = setup.findCredentialBlockers('DIRECT_URL=\nDATABASE_URL=');
  assert.deepEqual(empty.map((b) => b.reason), ['missing', 'missing']);

  const shippedTemplate = setup.findCredentialBlockers(
    'DATABASE_URL=postgresql://postgres.ref:percent-encoded-password@host:6543/postgres\nDIRECT_URL=https://your-project-ref.supabase.co',
  );
  assert.equal(shippedTemplate.length, 2);
});

test('db-setup: env parsing keeps quotes, export prefixes, and line numbers', () => {
  const entries = setup.envEntries('# comment\nexport DIRECT_URL=\'postgresql://u:p@h:5432/db\'\nAPI_PORT=8787\nBROKEN LINE');
  assert.deepEqual(entries, [
    { name: 'DIRECT_URL', value: 'postgresql://u:p@h:5432/db', line: 2 },
    { name: 'API_PORT', value: '8787', line: 3 },
  ]);
});

test('db-setup: URLs are redacted and inspected without exposing the password', () => {
  const raw = 'postgresql://postgres.ref:s3cret@db.ref.supabase.co:5432/postgres';
  const shown = setup.redact(raw);
  assert.equal(shown, 'postgresql://postgres.ref:***@db.ref.supabase.co:5432/postgres');
  assert.equal(shown.includes('s3cret'), false);

  const parsed = setup.inspectUrl(raw);
  assert.equal(parsed.host, 'db.ref.supabase.co:5432');
  assert.equal(parsed.hostname, 'db.ref.supabase.co');
  assert.equal(parsed.hasPassword, true);
  assert.equal(parsed.ref, 'ref');
  assert.equal(setup.inspectUrl('not-a-url'), null);
});

test('db-setup: Prisma failures are classified with their code and kind', () => {
  assert.equal(setup.classifyPrismaFailure('Error: P1000: Authentication failed against database server').kind, 'auth');
  const unreachable = setup.classifyPrismaFailure(
    'Error: P1001: Can\'t reach database server at `aws-0-ap-southeast-2.pooler.supabase.com:5432`',
  );
  assert.equal(unreachable.kind, 'unreachable');
  assert.equal(unreachable.code, 'P1001');
  assert.match(unreachable.host, /pooler\.supabase\.com/);
  assert.equal(setup.classifyPrismaFailure('Error: P1002: Timed out').kind, 'timeout');
  assert.equal(setup.classifyPrismaFailure('P3005: The database schema is not empty').kind, 'schema-not-empty');
  assert.equal(setup.classifyPrismaFailure('P3009: migrate found failed migrations').kind, 'failed-migration');
  assert.equal(setup.classifyPrismaFailure('P3018: A migration failed to apply').kind, 'migration-failed');
  assert.equal(setup.classifyPrismaFailure('No pending migrations to apply.').kind, 'up-to-date');
  assert.equal(setup.classifyPrismaFailure('something unexpected').kind, 'unknown');
});

test('db-setup: health responses map to an ok, database-down, or wrong-service verdict', () => {
  assert.equal(setup.classifyHealth({ status: 200, body: { api: 'ok', database: 'ok' } }).kind, 'ok');
  assert.equal(setup.classifyHealth({ status: 500, body: { error: 'The account service could not complete the request.' } }).kind, 'database-down');
  assert.equal(setup.classifyHealth({ status: 404, body: { error: 'Not found.' } }).kind, 'not-api');
  assert.equal(setup.classifyHealth({ error: 'ECONNREFUSED' }).kind, 'unreachable');
  assert.equal(setup.classifyHealth({ error: 'ECONNREFUSED' }).code, 'ECONNREFUSED');
  assert.equal(setup.classifyHealth({ status: 200, body: { api: 'ok', database: 'error' } }).kind, 'unexpected');
});
