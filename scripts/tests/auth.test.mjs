import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { createAuthServer } from '../../server/app.mjs';

const ORIGIN = 'http://localhost:5173';
const now = Date.parse('2026-10-02T00:00:00.000Z');
const ids = {
  admin: '11111111-1111-4111-8111-111111111111',
  learner: '22222222-2222-4222-8222-222222222222',
};
const authUsers = [
  { id: ids.admin, email: 'admin@example.test', last_sign_in_at: '2026-10-01T00:00:00.000Z', app_metadata: { provider: 'email' } },
  { id: ids.learner, email: 'learner@example.test', last_sign_in_at: '2026-09-20T00:00:00.000Z', app_metadata: { provider: 'google' } },
];
const profiles = new Map([
  [ids.admin, {
    id: ids.admin,
    name: 'Owner',
    role: 'admin',
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: new Date(now - 30_000),
    progress: null,
  }],
  [ids.learner, {
    id: ids.learner,
    name: 'Learner',
    role: 'user',
    status: 'active',
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    lastSeenAt: new Date(now - 3 * 60 * 1000),
    progress: null,
  }],
]);
const tokens = new Map([
  ['owner-token', { id: ids.admin, email: 'admin@example.test' }],
  ['learner-token', {
    id: ids.learner,
    email: 'learner@example.test',
    app_metadata: { provider: 'email' },
    identities: [{ provider: 'email' }, { provider: 'google' }],
  }],
]);
let lastProgress;
const signInEvents = [];
let server;
let baseUrl;
let secureServer;
let securePort;

const store = {
  // The API reports WHICH store answered (/api/health.store), so the fake store names itself like
  // the real ones do: 'prisma' or 'supabase-auth'.
  name: 'test-store',
  async health() {},
  async getProfile(id, authUser) {
    const existing = profiles.get(id);
    if (existing) return existing;
    // Mirrors `server/store.mjs`: a missing row is provisioned for the VERIFIED identity, and the
    // role/status come from the database defaults — this path may never grant a role or re-enable a
    // banned account. A fake that returned `null` here could not exercise that behaviour at all.
    const named = authUser?.user_metadata?.display_name;
    const provisioned = {
      id,
      name: typeof named === 'string' && named.trim()
        ? named.trim()
        : (authUser?.email ?? '').split('@')[0] ?? '',
      email: authUser?.email ?? '',
      role: 'user',
      status: 'active',
      createdAt: new Date(now),
      lastSeenAt: null,
      progress: null,
    };
    profiles.set(id, provisioned);
    return provisioned;
  },
  async touchProfile(id, at) {
    profiles.get(id).lastSeenAt = at;
  },
  async recordSignInEvent(userId, provider, signedInAt) {
    signInEvents.push({ id: signInEvents.length + 1, userId, provider, signedInAt });
  },
  async listRecentSignIns(limit) {
    return signInEvents.slice(-limit).reverse().map((event) => ({
      ...event,
      name: profiles.get(event.userId).name,
    }));
  },
  async saveProgress(id, progress) {
    lastProgress = { id, ...progress };
  },
  async listAdminUsers() {
    return [...profiles.values()];
  },
  async updateStatus(id, status) {
    profiles.get(id).status = status;
  },
};

const supabaseAuth = {
  auth: {
    async getUser(token) {
      const user = tokens.get(token);
      return user
        ? { data: { user }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    },
  },
};

const supabaseAdmin = {
  auth: {
    admin: {
      async listUsers({ page }) {
        return { data: { users: page === 1 ? authUsers : [] }, error: null };
      },
    },
  },
};

before(async () => {
  server = createAuthServer({
    store,
    supabaseAuth,
    supabaseAdmin,
    allowedOrigin: ORIGIN,
    now: () => now,
    logger: { error() {} },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  secureServer = createAuthServer({
    store,
    supabaseAuth,
    supabaseAdmin,
    allowedOrigin: ORIGIN,
    now: () => now,
    logger: { error() {} },
    enforceHttps: true,
  });
  await new Promise((resolve) => secureServer.listen(0, '127.0.0.1', resolve));
  securePort = secureServer.address().port;
});

test('sign-in events require same-origin authentication and a provider linked to the verified user', async () => {
  assert.equal((await call('/api/auth/sign-in-event', { method: 'POST' })).status, 401);
  assert.equal((await call('/api/auth/sign-in-event', {
    method: 'POST',
    token: 'learner-token',
    origin: 'https://attacker.example',
  })).status, 403);
  assert.equal((await call('/api/auth/sign-in-event', {
    method: 'POST',
    token: 'learner-token',
    body: { provider: 'github' },
  })).status, 400);

  const response = await call('/api/auth/sign-in-event', {
    method: 'POST',
    token: 'learner-token',
    body: { provider: 'google' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(signInEvents.at(-1), {
    id: 1,
    userId: ids.learner,
    provider: 'google',
    signedInAt: new Date(now),
  });
});

test('admin dashboard lists recent sign-in identities and authentication methods', async () => {
  const response = await call('/api/admin/users', { token: 'owner-token' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.recentSignIns[0], {
    id: 1,
    email: 'learner@example.test',
    name: 'Learner',
    provider: 'google',
    signedInAt: new Date(now).toISOString(),
  });
});

after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await new Promise((resolve, reject) => secureServer.close((error) => error ? reject(error) : resolve()));
});

function call(path, { method = 'GET', body, token, origin = ORIGIN } = {}) {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('health endpoint confirms API and database health', async () => {
  const response = await call('/api/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { api: 'ok', database: 'ok', store: 'test-store' });
});

test('session requires a valid Supabase access token and returns database-backed access state', async () => {
  const guest = await call('/api/auth/session');
  assert.deepEqual(await guest.json(), { user: null });

  const response = await call('/api/auth/session', { token: 'learner-token' });
  assert.equal(response.status, 200);
  const { user } = await response.json();
  assert.equal(user.id, ids.learner);
  assert.equal(user.role, 'user');
  assert.equal(user.email, 'learner@example.test');
});

test('admin data is inaccessible to guests and regular users', async () => {
  assert.equal((await call('/api/admin/users')).status, 401);
  assert.equal((await call('/api/admin/users', { token: 'learner-token' })).status, 403);
});

test('admin dashboard includes identities, activity, and progress but only for an admin', async () => {
  const response = await call('/api/admin/users', { token: 'owner-token' });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.summary, { total: 2, online: 1, active30Days: 2 });
  const learner = result.users.find((user) => user.id === ids.learner);
  assert.equal(learner.email, 'learner@example.test');
  assert.equal(learner.online, false);
  assert.equal(learner.progress, null);
});

test('presence refresh records online activity for the signed-in user', async () => {
  const response = await call('/api/auth/presence', { method: 'POST', token: 'learner-token' });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).user.id, ids.learner);
  assert.equal(profiles.get(ids.learner).lastSeenAt.toISOString(), new Date(now).toISOString());
});

test('progress endpoint accepts aggregate counters without accepting private records', async () => {
  const progress = {
    xp: 450,
    streakCurrent: 4,
    practicedCount: 20,
    doneRecords: 12,
    studyMinutes: 90,
    studyDays: 5,
    openMistakes: 2,
    notes: ['must not be stored'],
    answers: ['must not be stored'],
  };
  const response = await call('/api/progress/snapshot', {
    method: 'POST',
    token: 'learner-token',
    body: progress,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(lastProgress, {
    id: ids.learner,
    xp: 450,
    streakCurrent: 4,
    practicedCount: 20,
    doneRecords: 12,
    studyMinutes: 90,
    studyDays: 5,
    openMistakes: 2,
  });

  const invalid = await call('/api/progress/snapshot', {
    method: 'POST',
    token: 'learner-token',
    body: { ...progress, xp: -1 },
  });
  assert.equal(invalid.status, 400);
});

test('the resume position is validated, stored with the snapshot, and returned by the session', async () => {
  const counters = {
    xp: 10,
    streakCurrent: 1,
    practicedCount: 2,
    doneRecords: 1,
    studyMinutes: 5,
    studyDays: 1,
    openMistakes: 0,
  };
  const saved = await call('/api/progress/snapshot', {
    method: 'POST',
    token: 'learner-token',
    body: { ...counters, lastSectionId: 's07', lastStage: 'coding' },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(lastProgress, { id: ids.learner, ...counters, lastSectionId: 's07', lastStage: 'coding' },
    'the position travels with the counters, not as free text');

  // The real stores persist the snapshot on the profile; mirror that here so the session endpoint
  // is exercised against the same shape it will read in production.
  const learner = profiles.get(ids.learner);
  const previous = learner.progress;
  learner.progress = { ...lastProgress, updatedAt: new Date(now) };
  try {
    assert.deepEqual(
      await (await call('/api/auth/session', { token: 'learner-token' })).json(),
      {
        user: {
          id: ids.learner,
          email: 'learner@example.test',
          name: 'Learner',
          role: 'user',
          status: 'active',
        },
        resume: { sectionId: 's07', stage: 'coding' },
      },
    );
  } finally {
    learner.progress = previous;
  }

  // A crafted stage or section id is refused rather than stored and later turned into a route.
  for (const body of [
    { ...counters, lastSectionId: 's07', lastStage: 'javascript:' },
    { ...counters, lastSectionId: '../../etc/passwd', lastStage: 'learn' },
    { ...counters, lastSectionId: 's07' },
  ]) {
    assert.equal((await call('/api/progress/snapshot', { method: 'POST', token: 'learner-token', body })).status, 400);
  }
});

test('an authenticated account whose profile row is missing is provisioned, not locked out', async () => {
  // The profile is created by a database trigger. When that trigger did not run — a migration applied
  // without it, or a signup that raced it — the API used to answer "profile unavailable" and, now
  // that an account is required for every learning surface, that locked a legitimately authenticated
  // learner out of the entire product over something they cannot see or fix.
  profiles.delete(ids.learner);
  try {
    const response = await call('/api/auth/session', { token: 'learner-token' });
    assert.equal(response.status, 200);
    const { user } = await response.json();
    assert.equal(user.id, ids.learner, 'the verify-token identity is the one provisioned');
    // The same fallback the database trigger uses: the display name from signup metadata when it
    // exists, otherwise the email's local part. This fixture's auth user carries no `display_name`,
    // so the derived name is asserted — which also proves the email actually reached the store.
    assert.equal(user.name, 'learner', 'the name falls back to the email local part');
    assert.equal(user.email, 'learner@example.test', 'the auth address is mirrored onto the profile');
    // A provisioned profile is an ORDINARY account. Nothing on this path may mint an administrator or
    // re-enable a banned account — `role`/`status` come from the database defaults and are asserted.
    assert.equal(user.role, 'user', 'the on-demand path must never grant a role');
    assert.equal(user.status, 'active');
    // It must also have been created FOR the token holder and nobody else.
    assert.equal(profiles.get(ids.learner).email, 'learner@example.test');
  } finally {
    profiles.set(ids.learner, {
      id: ids.learner,
      name: 'Learner',
      email: 'learner@example.test',
      role: 'user',
      status: 'active',
      createdAt: new Date(now),
      lastSeenAt: null,
      progress: null,
    });
  }
});

test('the caller\'s identity comes from the token, never from the request body', async () => {
  // The impersonation attempt: a valid learner token that tries to speak for someone else. Every
  // protected mutation derives the subject from the VERIFIED token, so the body's `userId` is inert.
  const response = await call('/api/progress/snapshot', {
    method: 'POST',
    token: 'learner-token',
    body: {
      userId: ids.owner,
      id: ids.owner,
      xp: 1,
      streakCurrent: 1,
      practicedCount: 1,
      doneRecords: 1,
      studyMinutes: 1,
      studyDays: 1,
      openMistakes: 0,
    },
  });
  assert.equal(response.status, 200);
  assert.equal(lastProgress.id, ids.learner, 'the record must belong to the token holder');

  // And an admin action cannot be reached by claiming a role in the body either.
  const escalate = await call('/api/admin/users', {
    method: 'GET',
    token: 'learner-token',
    headers: { 'x-brocode-role': 'admin' },
  });
  assert.equal(escalate.status, 403, 'a header cannot promote a caller');
});

test('a disabled account is refused on every authenticated endpoint', async () => {
  const learner = profiles.get(ids.learner);
  const previous = learner.status;
  learner.status = 'disabled';
  try {
    assert.equal((await call('/api/auth/session', { token: 'learner-token' })).status, 200);
    assert.deepEqual(await (await call('/api/auth/session', { token: 'learner-token' })).json(), { user: null },
      'a disabled account must resolve to no session at all');
    assert.equal((await call('/api/auth/presence', { method: 'POST', token: 'learner-token' })).status, 401);
    assert.equal((await call('/api/admin/users', { token: 'learner-token' })).status, 401);
  } finally {
    learner.status = previous;
  }
});

function send(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
    });
    call.on('error', reject);
    if (body !== undefined) call.write(body);
    call.end();
  });
}

test('production enforcement answers plain HTTP with a redirect to the same URL over HTTPS', async () => {
  const health = await send(securePort, '/api/health?probe=1', { headers: { Origin: ORIGIN } });
  assert.equal(health.status, 308);
  assert.equal(health.headers.location, `https://127.0.0.1:${securePort}/api/health?probe=1`);
  assert.equal(health.headers['access-control-allow-origin'], ORIGIN);
  assert.equal(health.headers['strict-transport-security'], undefined);

  const forwardedHttp = await send(securePort, '/api/auth/session', {
    headers: { Origin: ORIGIN, 'X-Forwarded-Proto': 'http' },
  });
  assert.equal(forwardedHttp.status, 308);
  assert.equal(forwardedHttp.headers.location, `https://127.0.0.1:${securePort}/api/auth/session`);

  const post = await send(securePort, '/api/progress/snapshot', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
  });
  assert.equal(post.status, 308);
  assert.equal(post.headers.location, `https://127.0.0.1:${securePort}/api/progress/snapshot`);
});

test('a TLS-terminated request is served and carries strict transport security', async () => {
  const response = await send(securePort, '/api/health', {
    headers: { Origin: ORIGIN, 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.text), { api: 'ok', database: 'ok', store: 'test-store' });
  assert.equal(response.headers['strict-transport-security'], 'max-age=15552000');
});

test('a malformed Host cannot turn the upgrade into an open redirect', async () => {
  for (const host of ['.example', 'evil.example/path', 'evil.example:notaport']) {
    const response = await send(securePort, '/api/health', { headers: { Host: host, Origin: ORIGIN } });
    assert.equal(response.status, 403);
    assert.equal(response.headers.location, undefined);
  }
});

test('enforcement stays off unless production turns it on, so plain HTTP still serves locally', async () => {
  const response = await send(server.address().port, '/api/health', {
    headers: { Origin: ORIGIN, 'X-Forwarded-Proto': 'https' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers['strict-transport-security'], undefined);
});

test('admin mutation routes enforce same-origin and role boundaries', async () => {
  const crossOrigin = await call(`/api/admin/users/${ids.learner}/status`, {
    method: 'PATCH',
    origin: 'https://attacker.example',
    token: 'owner-token',
    body: { status: 'disabled' },
  });
  assert.equal(crossOrigin.status, 403);
  assert.equal(profiles.get(ids.learner).status, 'active');

  const invalidStatus = await call(`/api/admin/users/${ids.learner}/status`, {
    method: 'PATCH',
    token: 'owner-token',
    body: { status: 'expired' },
  });
  assert.equal(invalidStatus.status, 400);

  const roleMutation = await call(`/api/admin/users/${ids.learner}/role`, {
    method: 'PATCH',
    token: 'owner-token',
    body: { role: 'admin' },
  });
  assert.equal(roleMutation.status, 404);
  assert.equal(profiles.get(ids.learner).role, 'user');
});
