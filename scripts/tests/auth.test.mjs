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
  async getProfile(id) {
    return profiles.get(id) ?? null;
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
