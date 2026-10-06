import { createServer } from 'node:http';
import { listAllAuthUsers } from './supabase.mjs';

const MAX_BODY_BYTES = 16 * 1024;
const HSTS_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
const PROGRESS_FIELDS = [
  'xp',
  'streakCurrent',
  'practicedCount',
  'doneRecords',
  'studyMinutes',
  'studyDays',
  'openMistakes',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) {
    throw new HttpError(415, 'Send JSON using Content-Type: application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

function responseOrigin(request, allowedOrigin) {
  const origin = request.headers.origin;
  if (origin && origin !== allowedOrigin) throw new HttpError(403, 'Request origin is not allowed.');
  return origin ? {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    Vary: 'Origin',
  } : {};
}

function ensureSameOrigin(request, allowedOrigin) {
  if (request.headers.origin !== allowedOrigin) {
    throw new HttpError(403, 'Request origin is not allowed.');
  }
}

function requestProtocol(request) {
  const forwarded = request.headers['x-forwarded-proto'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded ?? '')
    .split(',')[0].trim().toLowerCase();
  if (first === 'https' || first === 'http') return first;
  return request.socket?.encrypted ? 'https' : 'http';
}

function httpsLocation(request) {
  const host = request.headers.host;
  if (typeof host !== 'string' || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i.test(host)) return null;
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    return `https://${host}${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function bearerToken(request) {
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string' ? authorization.match(/^Bearer ([^\s]+)$/i) : null;
  return match?.[1] ?? null;
}

function toPublicUser(profile, email) {
  return {
    id: profile.id,
    email,
    name: profile.name,
    role: profile.role,
    status: profile.status,
  };
}

function validateProgress(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Progress data must be an object.');
  }
  const progress = {};
  for (const field of PROGRESS_FIELDS) {
    const value = input[field];
    if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
      throw new HttpError(400, `Progress field ${field} must be a non-negative integer.`);
    }
    progress[field] = value;
  }
  return progress;
}

export function createAuthServer({
  store,
  supabaseAuth,
  supabaseAdmin,
  allowedOrigin,
  now = () => Date.now(),
  logger = console,
  enforceHttps = false,
}) {
  if (!store) throw new TypeError('A Supabase account store is required.');
  if (!supabaseAuth) throw new TypeError('A Supabase Auth client is required.');
  if (!supabaseAdmin) throw new TypeError('A Supabase admin client is required.');
  if (!allowedOrigin) throw new TypeError('An allowed web origin is required.');
  if (typeof enforceHttps !== 'boolean') throw new TypeError('enforceHttps must be a boolean.');

  async function getUser(request) {
    const token = bearerToken(request);
    if (!token) return null;
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error) {
      if (error.status === 401 || error.status === 403) return null;
      throw error;
    }
    if (!data.user) return null;
    const profile = await store.getProfile(data.user.id);
    if (!profile || profile.status !== 'active') return null;
    return { authUser: data.user, profile };
  }

  async function requireUser(request) {
    const user = await getUser(request);
    if (!user) throw new HttpError(401, 'Sign in to continue.');
    return user;
  }

  async function requireAdmin(request) {
    const user = await requireUser(request);
    if (user.profile.role !== 'admin') {
      throw new HttpError(403, 'Administrator access is required.');
    }
    return user;
  }

  const server = createServer(async (request, response) => {
    let headers = {};
    try {
      headers = responseOrigin(request, allowedOrigin);
      if (enforceHttps) {
        if (requestProtocol(request) === 'https') {
          headers['Strict-Transport-Security'] = `max-age=${HSTS_MAX_AGE_SECONDS}`;
        } else {
          const location = httpsLocation(request);
          if (!location) throw new HttpError(403, 'HTTPS is required.');
          response.writeHead(308, { ...headers, Location: location, 'Cache-Control': 'no-store' });
          response.end();
          return;
        }
      }
      if (request.method === 'OPTIONS') {
        if (!request.headers.origin) throw new HttpError(403, 'Request origin is required.');
        response.writeHead(204, { ...headers, 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store' });
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await store.health();
        json(response, 200, { api: 'ok', database: 'ok' }, headers);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/session') {
        const user = await getUser(request);
        json(response, 200, { user: user ? toPublicUser(user.profile, user.authUser.email ?? '') : null }, headers);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/auth/presence') {
        ensureSameOrigin(request, allowedOrigin);
        const user = await requireUser(request);
        await store.touchProfile(user.profile.id, new Date(now()));
        const profile = await store.getProfile(user.profile.id);
        json(response, 200, { user: toPublicUser(profile, user.authUser.email ?? '') }, headers);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/progress/snapshot') {
        ensureSameOrigin(request, allowedOrigin);
        const user = await requireUser(request);
        const progress = validateProgress(await readJson(request));
        await store.saveProgress(user.profile.id, progress, new Date(now()));
        json(response, 200, { ok: true }, headers);
        return;
      }

      if (request.method === 'GET' && url.pathname === '/api/admin/users') {
        await requireAdmin(request);
        const [authUsers, profiles] = await Promise.all([
          listAllAuthUsers(supabaseAdmin),
          store.listAdminUsers(),
        ]);
        const authById = new Map(authUsers.map((user) => [user.id, user]));
        const users = profiles.map((profile) => {
          const authUser = authById.get(profile.id);
          if (!authUser) throw new Error(`Auth user is missing for profile ${profile.id}.`);
          const lastSeenAt = profile.lastSeenAt?.getTime?.() ?? 0;
          return {
            id: profile.id,
            email: authUser.email ?? '',
            name: profile.name,
            role: profile.role,
            status: profile.status,
            createdAt: profile.createdAt.toISOString(),
            lastSignInAt: authUser.last_sign_in_at ?? null,
            lastSeenAt: profile.lastSeenAt?.toISOString?.() ?? null,
            online: lastSeenAt > 0 && now() - lastSeenAt <= ONLINE_WINDOW_MS,
            progress: profile.progress ? {
              xp: profile.progress.xp,
              streakCurrent: profile.progress.streakCurrent,
              practicedCount: profile.progress.practicedCount,
              doneRecords: profile.progress.doneRecords,
              studyMinutes: profile.progress.studyMinutes,
              studyDays: profile.progress.studyDays,
              openMistakes: profile.progress.openMistakes,
              updatedAt: profile.progress.updatedAt.toISOString(),
            } : null,
          };
        });
        const cutoff = now() - 30 * 24 * 60 * 60 * 1000;
        json(response, 200, {
          users,
          summary: {
            total: users.length,
            online: users.filter((user) => user.online).length,
            active30Days: users.filter((user) => user.lastSignInAt
              && new Date(user.lastSignInAt).getTime() >= cutoff).length,
          },
        }, headers);
        return;
      }

      const statusMatch = request.method === 'PATCH'
        ? url.pathname.match(/^\/api\/admin\/users\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/status$/i)
        : null;
      if (statusMatch) {
        ensureSameOrigin(request, allowedOrigin);
        await requireAdmin(request);
        const input = await readJson(request);
        if (!['active', 'disabled'].includes(input?.status)) {
          throw new HttpError(400, 'Choose a valid account status.');
        }
        const target = await store.getProfile(statusMatch[1]);
        if (!target) throw new HttpError(404, 'User not found.');
        if (target.role === 'admin') throw new HttpError(400, 'Administrator accounts cannot be disabled here.');
        await store.updateStatus(target.id, input.status);
        json(response, 200, { ok: true }, headers);
        return;
      }

      json(response, 404, { error: 'Not found.' }, headers);
    } catch (error) {
      if (response.headersSent) {
        response.destroy();
        logger.error?.('Supabase API response failed after headers were sent.', error?.code ?? error?.name);
        return;
      }
      if (error instanceof HttpError) {
        json(response, error.status, { error: error.message }, headers);
        return;
      }
      logger.error?.('Supabase API request failed.', error?.code ?? error?.name ?? 'unknown');
      json(response, 500, { error: 'The account service could not complete the request.' }, headers);
    }
  });

  return server;
}
