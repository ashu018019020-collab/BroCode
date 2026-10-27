import { createServer } from 'node:http';
import { listAllAuthUsers } from './supabase.mjs';
import { projectBrief } from './project-brief.mjs';
import { TTS_LANGS, TTS_MAX_CHARS, synthesizeGoogleTts } from './voice.mjs';
import {
  INTERVIEW_DEFAULT_MODEL,
  evaluateInterviewAnswer,
  validateEvaluationBody,
} from './interview.mjs';
import {
  DEFAULT_REALTIME_MODEL,
  DEFAULT_REALTIME_VOICE,
  REALTIME_LANGS,
  REALTIME_MAX_SESSION_SECONDS,
  createRealtimeClientSecret,
  validateRealtimeSessionBody,
} from './realtime.mjs';

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
const LESSON_STAGES = [
  'learn', 'interview', 'coding', 'logic', 'debug',
  'solved', 'mini', 'project', 'defense', 'checkpoint',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * The API answers one thing only — JSON — and these headers say so to the browser.
 *
 * Nothing here is origin-dependent: a response that can never be framed (`X-Frame-Options` +
 * `frame-ancestors`), never be treated as another type, never leak a referrer, and never load a
 * subresource. `Permissions-Policy` denies the device APIs an account API has no business reading,
 * and `Cross-Origin-Resource-Policy: same-origin` stops another site embedding a token-bearing
 * response. The policy is stated per RESPONSE rather than per origin so a proxy or a host that
 * strips headers cannot leave the API less protected than it looks.
 */
const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...headers,
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

function signInProvider(input, authUser) {
  const provider = input?.provider;
  if (!['email', 'google', 'github'].includes(provider)) {
    throw new HttpError(400, 'Choose a supported sign-in provider.');
  }
  const linkedProviders = new Set([
    authUser.app_metadata?.provider,
    ...(authUser.identities ?? []).map((identity) => identity.provider),
  ]);
  if (!linkedProviders.has(provider)) {
    throw new HttpError(400, 'The sign-in provider is not linked to this account.');
  }
  return provider;
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
  /**
   * The lesson position is OPTIONAL and additive: an older client sends only the counters and keeps
   * working. It is still validated — a section id is a short opaque token and a stage must be one
   * of the real lesson stages — so a crafted body cannot store a route or a script in the profile.
   */
  if (input.lastSectionId !== undefined || input.lastStage !== undefined) {
    if (typeof input.lastSectionId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(input.lastSectionId)) {
      throw new HttpError(400, 'lastSectionId must be a short section identifier.');
    }
    if (typeof input.lastStage !== 'string' || !LESSON_STAGES.includes(input.lastStage)) {
      throw new HttpError(400, 'lastStage must be a real lesson stage.');
    }
    progress.lastSectionId = input.lastSectionId;
    progress.lastStage = input.lastStage;
  }
  return progress;
}

/**
 * The lesson position stored on a profile, or null.
 *
 * Defensive on read as well as on write: rows written by an older release, a manual SQL update or a
 * future stage name must never become a broken `/lesson/...` URL. The client re-validates against
 * the live curriculum, but the server does not hand out anything it cannot name.
 */
function resumePosition(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const { lastSectionId, lastStage } = progress;
  if (typeof lastSectionId !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(lastSectionId)) return null;
  if (typeof lastStage !== 'string' || !LESSON_STAGES.includes(lastStage)) return null;
  return { sectionId: lastSectionId, stage: lastStage };
}

/**
 * The tutor's voice budget: requests per minute per client address. Google Text-to-Speech charges
 * per character, so an unauthenticated text-to-speech endpoint needs a bound of its own — the
 * origin check stops other sites, this stops one tab looping. Sliding window, dropped lazily.
 */
const TTS_WINDOW_MS = 60 * 1000;
const TTS_MAX_REQUESTS = 30;

/**
 * A realtime session is far more expensive than one TTS sentence, so it gets a much tighter budget:
 * six sessions per ten minutes per account+address. The key is BOTH so a shared NAT cannot let one
 * tab spend another account's allowance, and an account cannot escape its own limit by changing
 * address.
 */
const REALTIME_WINDOW_MS = 10 * 60 * 1000;
const REALTIME_MAX_REQUESTS = 6;

/** An env switch that is only off when it says so: unset means the feature works if it is configured. */
function envFlag(value, fallback) {
  if (value === undefined || String(value).trim() === '') return fallback;
  return !/^(0|false|off|no)$/i.test(String(value).trim());
}

/** A ceiling an operator can lower (or raise deliberately); a garbage value keeps the safe default. */
function envPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function createAuthServer({
  store,
  supabaseAuth,
  supabaseAdmin,
  allowedOrigin,
  now = () => Date.now(),
  logger = console,
  enforceHttps = false,
  storeLabel = store?.name ?? 'unknown',
  googleTtsKey = process.env.GOOGLE_TTS_API_KEY ?? '',
  googleTtsVoices = {},
  synthesizeTts = synthesizeGoogleTts,
  openaiRealtimeKey = process.env.OPENAI_API_KEY ?? '',
  openaiRealtimeModel = process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL,
  openaiRealtimeVoice = process.env.OPENAI_REALTIME_VOICE ?? DEFAULT_REALTIME_VOICE,
  createRealtimeSecret = createRealtimeClientSecret,
  // The AI INTERVIEW EVALUATOR is text-only and independent of the realtime voice switch: a
  // deployment can run a written interviewer without minting live audio sessions. It reuses the
  // same server-only key; the browser never sees either value.
  openaiInterviewKey = process.env.OPENAI_API_KEY ?? '',
  interviewModel = process.env.INTERVIEW_MODEL ?? INTERVIEW_DEFAULT_MODEL,
  evaluateInterview = evaluateInterviewAnswer,
  interviewMaxRequests = envPositiveInt(process.env.INTERVIEW_REQUESTS_PER_WINDOW, 20),
  interviewWindowMs = envPositiveInt(process.env.INTERVIEW_WINDOW_MINUTES, 10) * 60 * 1000,
  // The grounded description of THIS deployment's curriculum, handed to the live agent so it names
  // real sections instead of guessing. Empty when the generated file is unreadable — the session
  // then runs with the plain teaching contract, exactly as before.
  curriculumBrief = projectBrief,
  // Online AI voice is opt-in at two levels: this server switch, and the learner's own consent in
  // each session body. Either one being off keeps the browser voice working and returns a message
  // that says so, instead of failing silently.
  onlineVoiceEnabled = envFlag(process.env.ONLINE_VOICE_ENABLED, true),
  realtimeMaxSessions = envPositiveInt(process.env.REALTIME_SESSIONS_PER_WINDOW, REALTIME_MAX_REQUESTS),
  realtimeWindowMs = envPositiveInt(process.env.REALTIME_SESSION_WINDOW_MINUTES, Math.round(REALTIME_WINDOW_MS / 60000)) * 60 * 1000,
}) {
  if (!store) throw new TypeError('A Supabase account store is required.');
  if (!supabaseAuth) throw new TypeError('A Supabase Auth client is required.');
  if (!supabaseAdmin) throw new TypeError('A Supabase admin client is required.');
  if (!allowedOrigin) throw new TypeError('An allowed web origin is required.');
  if (typeof enforceHttps !== 'boolean') throw new TypeError('enforceHttps must be a boolean.');

  async function getUser(request) {
    const token = bearerToken(request);
    if (!token) return null;
    // The token is verified BY SUPABASE, never decoded and trusted here. `data.user` is therefore the
    // only source of the caller's identity: a `user_id` in a body or a query string is data, not
    // proof, and no endpoint below reads one.
    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error) {
      if (error.status === 401 || error.status === 403) return null;
      throw error;
    }
    if (!data.user) return null;
    // The profile resolves the ROLE, which is why it is read from the database on EVERY request
    // rather than carried in the token: a promotion or a ban takes effect immediately instead of
    // whenever the learner's token happens to expire. `data.user` is passed so a missing profile row
    // can be created on the spot (see `store.getProfile`) rather than locking an authenticated
    // learner out of the product over a database trigger they cannot see.
    const profile = await store.getProfile(data.user.id, data.user);
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

  const realtimeHits = new Map();
  function realtimeAllowed(clientKey) {
    const at = now();
    const hits = (realtimeHits.get(clientKey) ?? []).filter((stamp) => at - stamp < realtimeWindowMs);
    if (realtimeHits.size > 5000) {
      for (const [key, stamps] of realtimeHits) {
        if (!stamps.length || at - stamps[stamps.length - 1] >= realtimeWindowMs) realtimeHits.delete(key);
      }
    }
    if (hits.length >= realtimeMaxSessions) {
      realtimeHits.set(clientKey, hits);
      return false;
    }
    hits.push(at);
    realtimeHits.set(clientKey, hits);
    return true;
  }

  const ttsHits = new Map();
  function ttsAllowed(clientKey) {
    const at = now();
    const hits = (ttsHits.get(clientKey) ?? []).filter((stamp) => at - stamp < TTS_WINDOW_MS);
    if (ttsHits.size > 5000) {
      for (const [key, stamps] of ttsHits) {
        if (!stamps.length || at - stamps[stamps.length - 1] >= TTS_WINDOW_MS) ttsHits.delete(key);
      }
    }
    if (hits.length >= TTS_MAX_REQUESTS) {
      ttsHits.set(clientKey, hits);
      return false;
    }
    hits.push(at);
    ttsHits.set(clientKey, hits);
    return true;
  }

  /**
   * One evaluation is one paid model call, so it gets its own budget: twenty per ten minutes per
   * account+address. That is a full round of ten questions with retries; a loop is what it stops.
   */
  const interviewHits = new Map();
  function interviewAllowed(clientKey) {
    const at = now();
    const hits = (interviewHits.get(clientKey) ?? []).filter((stamp) => at - stamp < interviewWindowMs);
    if (interviewHits.size > 5000) {
      for (const [key, stamps] of interviewHits) {
        if (!stamps.length || at - stamps[stamps.length - 1] >= interviewWindowMs) interviewHits.delete(key);
      }
    }
    if (hits.length >= interviewMaxRequests) {
      interviewHits.set(clientKey, hits);
      return false;
    }
    hits.push(at);
    interviewHits.set(clientKey, hits);
    return true;
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
          response.writeHead(308, {
            ...SECURITY_HEADERS, ...headers, Location: location, 'Cache-Control': 'no-store',
          });
          response.end();
          return;
        }
      }
      if (request.method === 'OPTIONS') {
        if (!request.headers.origin) throw new HttpError(403, 'Request origin is required.');
        response.writeHead(204, {
          ...SECURITY_HEADERS, ...headers, 'Access-Control-Max-Age': '600', 'Cache-Control': 'no-store',
        });
        response.end();
        return;
      }

      const url = new URL(request.url ?? '/', 'http://localhost');
      if (request.method === 'GET' && url.pathname === '/api/health') {
        await store.health();
        // `database` is the account backend this process depends on: Postgres when DATABASE_URL is
        // real, Supabase Auth otherwise. `store` names which one answered, so an operator never has
        // to guess which path is live.
        json(response, 200, { api: 'ok', database: 'ok', store: storeLabel }, headers);
        return;
      }

      // The voice engine's PUBLIC state: configured or not. The key itself never leaves this
      // process, and the client needs only this bit to choose its honest label and fallback.
      if (request.method === 'GET' && url.pathname === '/api/voice/status') {
        json(response, 200, { configured: Boolean(googleTtsKey) }, headers);
        return;
      }

      // The realtime path is OPTIONAL. This status route is public but only ever names a boolean;
      // the permanent key stays in the process. The client uses it to choose its honest label and
      // to fall back to the browser loop without a failed network round-trip first.
      if (request.method === 'GET' && url.pathname === '/api/voice/realtime/status') {
        // `configured` is "a key is present"; `enabled` is the deployment switch. The UI needs both
        // to tell "ask your admin to turn it on" apart from "this build never had a key".
        json(response, 200, { configured: Boolean(openaiRealtimeKey), enabled: onlineVoiceEnabled }, headers);
        return;
      }

      if (request.method === 'POST' && url.pathname === '/api/voice/realtime/session') {
        ensureSameOrigin(request, allowedOrigin);
        // The deployment-level switch: off means no paid session is minted, whatever the body says.
        if (!onlineVoiceEnabled) {
          throw new HttpError(503, 'Online AI voice is disabled on this server. The browser voice stays available.');
        }
        // A live audio session is billable and tied to a person, unlike the text-to-speech route.
        // Requiring a signed-in account also gives the rate limit a stable identity.
        const user = await requireUser(request);
        if (!openaiRealtimeKey) {
          throw new HttpError(503, 'Realtime voice is not configured on this server. The browser voice will be used.');
        }
        const clientKey = `${user.profile.id}:${request.socket?.remoteAddress ?? 'unknown'}`;
        const input = await readJson(request);
        const check = validateRealtimeSessionBody(input);
        if (!check.ok) throw new HttpError(check.status, check.message);
        const lang = check.lang;
        // The budget is spent only for a body that would actually have started a session.
        if (!realtimeAllowed(clientKey)) {
          throw new HttpError(429, 'Too many realtime voice sessions. Try again in a few minutes.');
        }
        try {
          const secret = await createRealtimeSecret({
            apiKey: openaiRealtimeKey,
            lang,
            model: openaiRealtimeModel,
            voice: openaiRealtimeVoice,
            brief: typeof curriculumBrief === 'function' ? curriculumBrief() : curriculumBrief,
          });
          json(response, 200, {
            clientSecret: secret.value,
            expiresAt: secret.expiresAt,
            model: secret.model,
            voice: secret.voice,
            maxSessionSeconds: secret.maxSessionSeconds ?? REALTIME_MAX_SESSION_SECONDS,
          }, headers);
          return;
        } catch (error) {
          if (error?.code === 'realtime-rate-limited') {
            throw new HttpError(429, 'The realtime voice service is rate-limited. Try again in a moment.');
          }
          if (error?.code === 'realtime-bad-lang') throw new HttpError(400, 'That realtime language is not supported.');
          if (error?.code === 'realtime-unconfigured') {
            throw new HttpError(503, 'Realtime voice is not configured on this server. The browser voice will be used.');
          }
          logger.warn?.('Realtime voice request failed.', error?.code ?? error?.name ?? 'unknown');
          throw new HttpError(502, 'The realtime voice service is unavailable. The browser voice will be used.');
        }
      }

      if (request.method === 'POST' && url.pathname === '/api/voice/tts') {
        ensureSameOrigin(request, allowedOrigin);
        if (!googleTtsKey) {
          throw new HttpError(503, 'The Google voice is not configured on this server. The browser voice will be used.');
        }
        const clientKey = request.socket?.remoteAddress ?? 'unknown';
        if (!ttsAllowed(clientKey)) {
          throw new HttpError(429, 'Too many voice requests in the last minute. Try again shortly.');
        }
        const input = await readJson(request);
        const lang = typeof input?.lang === 'string' && TTS_LANGS.includes(input.lang) ? input.lang : null;
        if (!lang) throw new HttpError(400, `Choose a supported voice language: ${TTS_LANGS.join(', ')}.`);
        const text = typeof input?.text === 'string' ? input.text.trim() : '';
        if (!text) throw new HttpError(400, 'Text is required.');
        if (text.length > TTS_MAX_CHARS) throw new HttpError(400, `Text must be at most ${TTS_MAX_CHARS} characters.`);
        const rate = Number(input?.rate);
        try {
          const audio = await synthesizeTts({
            apiKey: googleTtsKey,
            text,
            lang,
            rate: Number.isFinite(rate) ? rate : 1,
            voiceName: googleTtsVoices[lang],
          });
          response.writeHead(200, {
            ...SECURITY_HEADERS, ...headers,
            'Content-Type': 'audio/mpeg',
            'Content-Length': String(audio.length),
            // Spoken lines repeat verbatim across a lesson; ten minutes of private caching spares
            // both the learner's network and the Google quota without leaving this account.
            'Cache-Control': 'private, max-age=600',
          });
          response.end(audio);
          return;
        } catch (error) {
          if (error?.code === 'voice-rate-limited') throw new HttpError(429, 'The voice service is rate-limited. Try again in a moment.');
          if (error?.code === 'voice-bad-lang') throw new HttpError(400, 'That voice language is not supported.');
          logger.warn?.('Google TTS request failed.', error?.code ?? error?.name ?? 'unknown');
          throw new HttpError(502, 'The Google voice service is unavailable. The browser voice will be used.');
        }
      }

      // The AI interviewer's evaluator. Text only: one question, one answer, one validated
      // evaluation. The answer text is never logged, and an unconfigured key is a 503 the client
      // understands (it falls back to the deterministic rubric), not a 500.
      if (request.method === 'POST' && url.pathname === '/api/interview/evaluate') {
        ensureSameOrigin(request, allowedOrigin);
        const user = await requireUser(request);
        if (!openaiInterviewKey) {
          json(response, 503, {
            error: 'The AI evaluator is not configured on this server. The offline rubric will be used.',
            code: 'ai-unconfigured',
          }, headers);
          return;
        }
        const clientKey = `${user.profile.id}:${request.socket?.remoteAddress ?? 'unknown'}`;
        if (!interviewAllowed(clientKey)) {
          throw new HttpError(429, 'Too many AI evaluations. Try again in a few minutes — the offline rubric still works.');
        }
        const input = await readJson(request);
        const check = validateEvaluationBody(input);
        if (!check.ok) throw new HttpError(check.status, check.message);
        try {
          const result = await evaluateInterview({
            apiKey: openaiInterviewKey,
            model: interviewModel,
            value: check.value,
          });
          json(response, 200, { evaluation: result.evaluation, model: result.model, source: 'ai' }, headers);
          return;
        } catch (error) {
          if (error?.code === 'ai-rate-limited') {
            json(response, 429, {
              error: 'The AI evaluator is rate-limited. Try again shortly — the offline rubric still works.',
              code: 'ai-rate-limited',
            }, headers);
            return;
          }
          if (error?.code === 'ai-bad-response') {
            logger.warn?.('AI interview evaluation was malformed.', 'ai-bad-response');
            json(response, 502, {
              error: 'The AI evaluator returned an unusable reply. The offline rubric will be used.',
              code: 'ai-bad-response',
            }, headers);
            return;
          }
          logger.warn?.('AI interview evaluation failed.', error?.code ?? error?.name ?? 'unknown');
          json(response, 502, {
            error: 'The AI evaluator is unavailable. The offline rubric will be used.',
            code: 'ai-unavailable',
          }, headers);
          return;
        }
      }

      if (request.method === 'GET' && url.pathname === '/api/auth/session') {
        const user = await getUser(request);
        if (!user) {
          // Exactly the shape the tests and older clients expect: no account, nothing else.
          json(response, 200, { user: null }, headers);
          return;
        }
        const resume = resumePosition(user.profile.progress);
        json(response, 200, {
          user: toPublicUser(user.profile, user.authUser.email ?? ''),
          // Omitted when the account has no saved position, so the response stays additive.
          ...(resume ? { resume } : {}),
        }, headers);
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

      if (request.method === 'POST' && url.pathname === '/api/auth/sign-in-event') {
        ensureSameOrigin(request, allowedOrigin);
        const user = await requireUser(request);
        const input = await readJson(request);
        await store.recordSignInEvent(user.profile.id, signInProvider(input, user.authUser), new Date(now()));
        json(response, 200, { ok: true }, headers);
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
        const [authUsers, profiles, recentSignIns] = await Promise.all([
          listAllAuthUsers(supabaseAdmin),
          store.listAdminUsers(),
          store.listRecentSignIns(50),
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
          recentSignIns: recentSignIns.map((signIn) => ({
            id: signIn.id,
            email: authById.get(signIn.userId)?.email ?? '',
            name: signIn.name,
            provider: signIn.provider,
            signedInAt: signIn.signedInAt.toISOString(),
          })),
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
