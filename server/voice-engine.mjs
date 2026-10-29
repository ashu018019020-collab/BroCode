/**
 * Which voice speaks, and what happens when it cannot.
 *
 * When the deployment has a server voice, audio comes from one of two engines, chosen by
 * configuration and reported honestly. `engine: 'none'` means the client uses its built-in voice;
 * the checkpoint is never downloaded to the visitor.
 *
 *   1. `supertonic` — a separate inference service (`services/supertonic-tts/`) running the real Supertonic 3
 *      ONNX graphs on CPU. `TTS_SERVICE_URL` points at it; `TTS_SERVICE_SECRET` authenticates this
 *      process to it. Preferred because it needs no per-character billing and speaks Hindi/English.
 *   2. `google`     — Google Cloud Text-to-Speech (`GOOGLE_TTS_API_KEY`), the previous server voice.
 *      Kept as the zero-infrastructure option: one key, no container. It is a FALLBACK, never a
 *      silent substitution for a configured service.
 *   3. `none`       — nothing server-side is ready. The client says so and uses its explicitly
 *      labelled browser voice; the app keeps working.
 *
 * The status route may only claim "server-powered" after the inference service has actually answered
 * a health check, so `status()` probes it (cached briefly) instead of trusting the presence of a URL.
 */
import { synthesizeGoogleTts, TTS_LANGS, TTS_MAX_CHARS } from './voice.mjs';

export const VOICE_MAX_CHARS = TTS_MAX_CHARS;
export const VOICE_LANGS = TTS_LANGS;

/** Human-readable engine names. The UI composes its own line from `engine`, not from this. */
export const VOICE_ENGINE_LABEL = {
  supertonic: 'Supertonic 3 (server)',
  google: 'Google Neural2 (server)',
  none: 'no server voice',
};

/** How long a healthy answer is trusted before the service is asked again. */
const PROBE_TTL_MS = 30_000;
/** A failure is re-checked sooner: the learner's Retry must not be answered from a stale negative. */
const PROBE_FAILURE_TTL_MS = 5_000;

function trimUrl(value) {
  return String(value ?? '').trim().replace(/\/+$/, '');
}

export function createVoiceEngine({
  serviceUrl = '',
  serviceSecret = '',
  googleKey = '',
  googleVoices = {},
  synthesizeGoogle = synthesizeGoogleTts,
  fetchImpl = globalThis.fetch,
  logger = console,
  now = () => Date.now(),
  serviceTimeoutMs = 20_000,
  probeTimeoutMs = 1_500,
} = {}) {
  const base = trimUrl(serviceUrl);
  let probe = { at: 0, ready: false, detail: null };

  /**
   * Ask the inference service whether it is up. Never throws: an unreachable service is a state, and
   * the route still has to answer.
   */
  async function serviceHealth({ force = false } = {}) {
    if (!base) return { ready: false, detail: 'TTS_SERVICE_URL is not set.' };
    const ttl = probe.ready ? PROBE_TTL_MS : PROBE_FAILURE_TTL_MS;
    if (!force && probe.at && now() - probe.at < ttl) {
      return { ready: probe.ready, detail: probe.detail };
    }
    try {
      const response = await fetchImpl(`${base}/healthz`, {
        headers: serviceSecret ? { Authorization: `Bearer ${serviceSecret}` } : {},
        signal: AbortSignal.timeout(probeTimeoutMs),
      });
      if (!response.ok) {
        probe = { at: now(), ready: false, detail: `health check answered HTTP ${response.status}` };
        return probe;
      }
      const body = await response.json().catch(() => ({}));
      const ready = body?.ready === true;
      probe = {
        at: now(),
        ready,
        detail: ready ? null : String(body?.error ?? 'the model is still loading'),
      };
      return probe;
    } catch (cause) {
      probe = {
        at: now(),
        ready: false,
        detail: cause?.name === 'TimeoutError' ? 'health check timed out' : 'service unreachable',
      };
      return probe;
    }
  }

  /** The public half: booleans and engine names, never a URL with a token in it. */
  async function status() {
    let engine = 'none';
    let ready = false;
    let reason = null;
    if (base) {
      const health = await serviceHealth();
      ready = health.ready;
      // A configured but unreachable service still names itself: the UI can then say "the AI voice is
      // temporarily unavailable" instead of pretending this deployment never had one.
      engine = 'supertonic';
      reason = health.detail;
    } else if (googleKey) {
      engine = 'google';
      ready = true;
    } else {
      reason = 'No server voice is configured on this deployment.';
    }
    return {
      configured: ready,
      engine,
      engineLabel: VOICE_ENGINE_LABEL[engine],
      ready,
      langs: VOICE_LANGS,
      reason,
    };
  }

  async function speakSupertonic({ text, lang, rate }) {
    const response = await fetchImpl(`${base}/v1/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(serviceSecret ? { Authorization: `Bearer ${serviceSecret}` } : {}),
      },
      body: JSON.stringify({ text, lang, rate }),
      signal: AbortSignal.timeout(serviceTimeoutMs),
    });
    if (!response.ok) {
      const error = new Error(`The AI voice service refused the request (HTTP ${response.status}).`);
      // 401/403 is a configuration fault (rotated or mismatched shared secret), not a busy service:
      // the route must not tell the learner to retry something that cannot start working by itself.
      error.code = response.status === 429
        ? 'voice-rate-limited'
        : response.status === 401 || response.status === 403
          ? 'voice-auth-failed'
          : 'voice-unavailable';
      error.status = response.status;
      throw error;
    }
    const type = response.headers.get('content-type') ?? '';
    if (!type.startsWith('audio/')) {
      const error = new Error('The AI voice service returned something that was not audio.');
      error.code = 'voice-invalid-audio';
      throw error;
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) {
      const error = new Error('The AI voice service returned no audio.');
      error.code = 'voice-invalid-audio';
      throw error;
    }
    // The service's own sample rate is in a header so the client never guesses one; the WAV also
    // declares it, so this is informational rather than load-bearing.
    const sampleRate = Number(response.headers.get('x-sample-rate') ?? 0);
    return {
      audio,
      contentType: type.split(';')[0],
      engine: 'supertonic',
      sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : null,
    };
  }

  async function speakGoogle({ text, lang, rate }) {
    if (!googleKey) {
      const error = new Error('The Google voice is not configured on this server.');
      error.code = 'voice-unconfigured';
      throw error;
    }
    const audio = await synthesizeGoogle({
      apiKey: googleKey,
      text,
      lang,
      rate,
      voiceName: googleVoices?.[lang],
    });
    return { audio, contentType: 'audio/mpeg', engine: 'google', sampleRate: null };
  }

  /**
   * Speak one validated request. The engine that produced the audio is returned with it, so the route
   * can label the response and the UI never claims a voice that did not speak.
   */
  async function speak({ text, lang, rate = 1 }) {
    const clean = String(text ?? '').trim();
    if (!clean) {
      const error = new Error('Text is required.');
      error.code = 'voice-bad-text';
      throw error;
    }
    if (!VOICE_LANGS.includes(lang)) {
      const error = new Error(`Choose a supported voice language: ${VOICE_LANGS.join(', ')}.`);
      error.code = 'voice-bad-lang';
      throw error;
    }
    if (clean.length > VOICE_MAX_CHARS) {
      const error = new Error(`Text must be at most ${VOICE_MAX_CHARS} characters.`);
      error.code = 'voice-bad-text';
      throw error;
    }

    if (base) {
      try {
        return await speakSupertonic({ text: clean, lang, rate });
      } catch (cause) {
        logger.warn?.('Supertonic voice service failed.', cause?.code ?? cause?.name ?? 'unknown');
        // A timeout is worth reporting as itself: the route maps it to 504 so the client retries once
        // instead of looping, and `/api/voice/health` can name it.
        if (cause?.name === 'TimeoutError' && !cause.code) cause.code = 'voice-timeout';
        if (!googleKey) throw cause;
        // An explicit, logged downgrade — the response still says `engine: 'google'`, so nothing hides.
      }
    }
    return speakGoogle({ text: clean, lang, rate });
  }

  return { status, speak, serviceHealth };
}
