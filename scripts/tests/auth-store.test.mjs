import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const { createAuthStore, profileFromAuthUser } = await load('server/auth-store.mjs');
const { databaseConfigured } = await load('server/db-config.mjs');

const NOW = Date.parse('2026-10-07T12:00:00.000Z');
const ids = {
  owner: '11111111-1111-4111-8111-111111111111',
  learner: '22222222-2222-4222-8222-222222222222',
  fresh: '33333333-3333-4333-8333-333333333333',
};

const authUsers = () => [
  {
    id: ids.owner, email: 'owner@example.test', created_at: '2026-01-01T00:00:00.000Z',
    email_confirmed_at: '2026-01-01T00:05:00.000Z', last_sign_in_at: '2026-10-01T00:00:00.000Z',
    app_metadata: { provider: 'email', brocode_role: 'admin' },
    user_metadata: { display_name: 'Owner' },
    banned_until: null,
  },
  {
    id: ids.learner, email: 'moin.learner@example.test', created_at: '2026-09-01T00:00:00.000Z',
    email_confirmed_at: '2026-09-01T00:05:00.000Z', last_sign_in_at: '2026-10-06T09:30:00.000Z',
    app_metadata: { provider: 'github' },
    user_metadata: {},
    banned_until: null,
  },
  {
    id: ids.fresh, email: 'fresh@example.test', created_at: '2026-10-06T00:00:00.000Z',
    email_confirmed_at: null, last_sign_in_at: null,
    app_metadata: { provider: 'email' },
    user_metadata: { display_name: '' },
    banned_until: null,
  },
];

function fakeAdmin(users) {
  return {
    auth: {
      admin: {
        async getUserById(id) {
          const user = users.find((candidate) => candidate.id === id);
          return user
            ? { data: { user }, error: null }
            : { data: { user: null }, error: { status: 404, message: 'not found' } };
        },
        async updateUserById(id, patch) {
          const user = users.find((candidate) => candidate.id === id);
          if (!user) return { data: { user: null }, error: { status: 404 } };
          if (patch.user_metadata) user.user_metadata = patch.user_metadata;
          if (patch.app_metadata) user.app_metadata = patch.app_metadata;
          if (patch.ban_duration !== undefined) {
            user.banned_until = patch.ban_duration === 'none'
              ? null
              : new Date(NOW + 3600_000).toISOString();
          }
          return { data: { user }, error: null };
        },
        async listUsers({ page }) {
          return { data: { users: page === 1 ? users : [] }, error: null };
        },
      },
    },
  };
}

const storeFor = () => createAuthStore(fakeAdmin(authUsers()), { now: () => NOW });

test('auth store: a profile is derived from the account itself — name, role, ban state', async () => {
  const store = storeFor();
  const owner = await store.getProfile(ids.owner);
  assert.equal(owner.name, 'Owner');
  assert.equal(owner.role, 'admin');
  assert.equal(owner.status, 'active');

  // No display_name → the local part of the address, never an empty chip.
  const learner = await store.getProfile(ids.learner);
  assert.equal(learner.name, 'moin.learner');
  assert.equal(learner.role, 'user');
  // A blank display_name is not a name.
  const fresh = await store.getProfile(ids.fresh);
  assert.equal(fresh.name, 'fresh');

  assert.equal(await store.getProfile('44444444-4444-4444-8444-444444444444'), null);
});

test('auth store: disabling an account is a ban, and unbanning restores it', async () => {
  const users = authUsers();
  const store = createAuthStore(fakeAdmin(users), { now: () => NOW });
  await store.touchProfile(ids.learner, new Date(NOW));
  assert.equal((await store.getProfile(ids.learner)).status, 'active');

  await store.updateStatus(ids.learner, 'disabled');
  assert.equal(users[1].banned_until, new Date(NOW + 3600_000).toISOString());
  assert.equal((await store.getProfile(ids.learner)).status, 'disabled');
  // Presence is dropped with the account: a disabled learner must not read as online.
  assert.equal((await store.getProfile(ids.learner)).lastSeenAt, null);

  await store.updateStatus(ids.learner, 'active');
  assert.equal(users[1].banned_until, null);
  assert.equal((await store.getProfile(ids.learner)).status, 'active');
});

test('auth store: presence is recorded per account and read back as last-seen', async () => {
  const store = storeFor();
  assert.equal((await store.getProfile(ids.owner)).lastSeenAt, null);
  await store.touchProfile(ids.owner, new Date(NOW - 30_000));
  const online = await store.getProfile(ids.owner);
  assert.equal(online.lastSeenAt.getTime(), NOW - 30_000);
  const listed = await store.listAdminUsers();
  assert.equal(listed.find((profile) => profile.id === ids.owner).lastSeenAt.getTime(), NOW - 30_000);
  assert.equal(listed.length, 3);
});

test('auth store: the progress snapshot round-trips through the account record', async () => {
  const users = authUsers();
  const store = createAuthStore(fakeAdmin(users), { now: () => NOW });
  const summary = {
    xp: 1240, streakCurrent: 4, practicedCount: 318, doneRecords: 402,
    studyMinutes: 296, studyDays: 9, openMistakes: 11,
  };
  assert.equal((await store.getProfile(ids.owner)).progress, null);
  await store.saveProgress(ids.owner, summary, new Date(NOW));
  const saved = (await store.getProfile(ids.owner)).progress;
  assert.deepEqual(
    { ...saved, updatedAt: saved.updatedAt.toISOString() },
    { ...summary, updatedAt: new Date(NOW).toISOString() },
  );
  // Saving progress must not disturb the identity fields it shares a record with.
  assert.equal(users[0].user_metadata.display_name, 'Owner');
  assert.equal(users[0].app_metadata.brocode_role, 'admin');
});

test('auth store: a malformed stored snapshot reads as "no synced progress", never as numbers', async () => {
  const users = authUsers();
  users[0].user_metadata.brocode_progress = { xp: 5, streakCurrent: -2 };
  const store = createAuthStore(fakeAdmin(users), { now: () => NOW });
  assert.equal((await store.getProfile(ids.owner)).progress, null);
});

test('auth store: recent sign-ins are the real last sign-in per account, newest first', async () => {
  const store = storeFor();
  const recent = await store.listRecentSignIns(50);
  assert.deepEqual(recent.map((entry) => entry.userId), [ids.learner, ids.owner]);
  assert.equal(recent[0].name, 'moin.learner');
  assert.equal(recent[0].provider, 'github');
  assert.equal(recent[1].provider, 'email');
  assert.ok(recent[0].signedInAt instanceof Date);
  // An account that has never signed in has no sign-in to show.
  assert.equal(recent.some((entry) => entry.userId === ids.fresh), false);
});

test('auth store: it depends on Auth alone, and health means Auth answered', async () => {
  const store = storeFor();
  await store.health();
  // The two capabilities only Postgres has are simply not part of this store's contract.
  assert.equal(store.name, 'supabase-auth');
  assert.equal(typeof store.close, 'function');
});

test('auth store: the profile shape is the one the API serialises', () => {
  const profile = profileFromAuthUser(authUsers()[0], new Date(NOW), NOW);
  assert.deepEqual(Object.keys(profile).sort(),
    ['createdAt', 'email', 'id', 'lastSeenAt', 'name', 'progress', 'role', 'status']);
  assert.ok(profile.createdAt instanceof Date);
});

test('db config: only a real connection string selects the Postgres store', () => {
  assert.equal(databaseConfigured({ DATABASE_URL: 'postgresql://postgres.ref:s3cret@aws-0-x.pooler.supabase.com:6543/postgres' }), true);
  assert.equal(databaseConfigured({ DATABASE_URL: 'postgresql://postgres.ref:[percent-encoded-password]@aws-0-x.pooler.supabase.com:6543/postgres' }), false);
  assert.equal(databaseConfigured({ DATABASE_URL: 'postgresql://postgres.ref:your-password@db.ref.supabase.co:5432/postgres' }), false);
  assert.equal(databaseConfigured({ DATABASE_URL: 'postgresql://postgres.ref:<password>@db.ref.supabase.co:5432/postgres' }), false);
  assert.equal(databaseConfigured({ DATABASE_URL: 'postgresql://postgres.ref@db.ref.supabase.co:5432/postgres' }), false);
  assert.equal(databaseConfigured({ DATABASE_URL: 'mysql://user:pw@host:3306/db' }), false);
  assert.equal(databaseConfigured({}), false);
});
