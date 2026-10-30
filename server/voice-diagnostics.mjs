/**
 * What the DEPLOYED voice route can and cannot do, in machine-readable form.
 *
 * The operator question after a deploy is always the same — "is this deployment configured, and if
 * not which variable is missing?" — and `/api/voice/status` deliberately answers only the browser's
 * question (which engine speaks, is it ready). This module answers the operator's, and it is read by
 * `GET /api/voice/health`.
 *
 * Two rules the whole file exists to keep:
 *
 *  1. **Names, never values.** A report can say `TTS_SERVICE_SECRET: "set"`. It can never say what it
 *     is set to, how long it is, or whether it matches the service. `env` is read for presence only.
 *  2. **A key is not a working voice.** `GOOGLE_TTS_API_KEY` being present makes the engine usable but
 *     is not proof: the report marks that `verified: false` and says so. Only the Supertonic service
 *     is actually probed, because its `/healthz` is free and it is the engine that can silently be
 *     down while the URL is correctly set.
 */

export const VOICE_CODES = Object.freeze({
  ready: 'VOICE_READY',
  notConfigured: 'VOICE_NOT_CONFIGURED',
  providerUnavailable: 'VOICE_PROVIDER_UNAVAILABLE',
  authFailed: 'VOICE_AUTH_FAILED',
  timeout: 'VOICE_TIMEOUT',
  rateLimited: 'VOICE_RATE_LIMITED',
  invalidAudio: 'VOICE_INVALID_AUDIO',
  invalidRequest: 'VOICE_INVALID_REQUEST',
  forbidden: 'VOICE_FORBIDDEN',
});

/**
 * The variable names this deployment reads. Presence only — a value is never returned.
 * `SUPERTONIC_TTS_BASE_URL` / `SUPERTONIC_TTS_API_KEY` are accepted aliases of the service pair, so
 * they are reported too: a deployment that set the other spelling should not read `missing` for its
 * own variable, and one that set BOTH wrong should see which is actually in use.
 */
export const VOICE_ENV_NAMES = Object.freeze([
  'TTS_SERVICE_URL',
  'TTS_SERVICE_SECRET',
  'SUPERTONIC_TTS_BASE_URL',
  'SUPERTONIC_TTS_API_KEY',
  'GOOGLE_TTS_API_KEY',
]);

function presence(env, name) {
  return String(env?.[name] ?? '').trim() ? 'set' : 'missing';
}

/**
 * The configuration half of the report: no network, no secrets, safe to call on every request.
 */
export function voiceEnvReport(env = process.env) {
  const vars = Object.fromEntries(VOICE_ENV_NAMES.map((name) => [name, presence(env, name)]));
  // Either spelling configures the service; `TTS_SERVICE_*` wins when both are present, exactly as
  // `engineFromEnv` resolves them, so the report can never describe a different engine than runs.
  const url = vars.TTS_SERVICE_URL === 'set' || vars.SUPERTONIC_TTS_BASE_URL === 'set';
  const secret = vars.TTS_SERVICE_SECRET === 'set' || vars.SUPERTONIC_TTS_API_KEY === 'set';
  const google = vars.GOOGLE_TTS_API_KEY === 'set';
  const base = String(env?.TTS_SERVICE_URL || env?.SUPERTONIC_TTS_BASE_URL || '').trim();

  const hints = [];
  if (url && !secret) {
    hints.push('The service URL is set but no shared secret is (TTS_SERVICE_SECRET or SUPERTONIC_TTS_API_KEY): the service refuses every synthesis without it.');
  }
  if (!url && secret) {
    hints.push('A shared secret is set but no service URL is (TTS_SERVICE_URL or SUPERTONIC_TTS_BASE_URL), so nothing is called. Set the base URL too.');
  }
  if (!url && !google) {
    hints.push('Set GOOGLE_TTS_API_KEY (one key, no extra host) or TTS_SERVICE_URL + TTS_SERVICE_SECRET (the Render blueprint in render.yaml).');
    hints.push('Vercel only exposes a new variable to a NEW deployment: after saving it, redeploy (an empty commit or the dashboard Redeploy button).');
  }
  if (url && !/^https:\/\//i.test(base)) {
    hints.push('The service URL should be an https:// URL; a plain-http service is unreachable from a Vercel function.');
  }

  return {
    vars,
    configured: (url && secret) || google,
    engine: url ? 'supertonic' : google ? 'google' : 'none',
    hints,
  };
}

/**
 * The full report: configuration plus one real readiness probe of the configured engine.
 *
 * `ok` is true only when the engine that would speak has answered. That makes this endpoint usable
 * as an uptime check as well as a diagnostics page.
 */
export async function voiceDiagnostics({ env = process.env, engine } = {}) {
  const report = voiceEnvReport(env);
  const base = { env: report.vars, hints: report.hints, engine: report.engine };

  if (!report.configured) {
    return {
      ...base,
      ok: false,
      ready: false,
      verified: false,
      code: VOICE_CODES.notConfigured,
      detail: 'No server voice is configured on this deployment, so nothing is spoken — the answer stays on screen.',
    };
  }

  if (report.engine === 'google') {
    // Present is not the same as working: a key can be revoked, unfunded or have the API disabled,
    // and only a synthesis would prove it. Say exactly that instead of claiming a healthy voice.
    return {
      ...base,
      ok: true,
      ready: true,
      verified: false,
      code: VOICE_CODES.ready,
      detail: 'Google Cloud Text-to-Speech is configured with a key. The key itself is not spent on this check — the first spoken answer proves it.',
    };
  }

  const health = await engine?.serviceHealth?.({ force: true });
  const ready = health?.ready === true;
  const detail = String(health?.detail ?? '').trim();
  if (ready) {
    return {
      ...base,
      ok: true,
      ready: true,
      verified: true,
      code: VOICE_CODES.ready,
      detail: 'The Supertonic 3 service answered its readiness check and is running on CPU.',
    };
  }
  const timeout = /timed out|timeout/i.test(detail);
  return {
    ...base,
    ok: false,
    ready: false,
    verified: false,
    code: timeout ? VOICE_CODES.timeout : VOICE_CODES.providerUnavailable,
    // The engine's own detail is already sanitized (no URL, no token) — it says "unreachable",
    // "HTTP 401" or "the model is still loading".
    detail: detail || 'The configured voice service did not answer.',
  };
}
