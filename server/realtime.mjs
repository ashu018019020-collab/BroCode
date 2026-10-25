/**
 * OpenAI Realtime voice — the optional upgrade over the browser's own speech loop.
 *
 * The permanent API key never leaves this process. The browser asks the account API for a SHORT-LIVED
 * client secret, then talks to OpenAI's WebRTC endpoint directly with that secret. If the key is not
 * configured, or OpenAI refuses, the client falls back to the browser voice — this path is an
 * upgrade, never a dependency, and the app still works with zero network.
 *
 * The session instructions are the part that keeps the voice honest: the model is told it cannot see
 * a code run, must not claim a test passed, and must not judge accent. Those are product rules, so
 * they live here rather than in a prompt the browser can rewrite.
 */

export const DEFAULT_REALTIME_MODEL = 'gpt-realtime';
/** A female-sounding voice that reads both Indian English and Hinglish naturally. */
export const DEFAULT_REALTIME_VOICE = 'coral';
export const REALTIME_VOICES = ['coral', 'shimmer', 'sage', 'marin', 'alloy'];
export const REALTIME_LANGS = ['en-IN', 'hi-IN'];

/**
 * The session body, validated in one place.
 *
 * Two rules, both product rules rather than client courtesies:
 *   · `lang` must be one this deployment actually serves, so a crafted body cannot reach OpenAI
 *     with settings the UI never offered;
 *   · `consent` must be an explicit `true` — audio from the microphone is streamed to a third-party
 *     provider for this session, and that must be a decision the learner made on this device, not an
 *     omission the server quietly fills in.
 *
 * Pure and dependency-free, so the validation is testable without a key, a socket or a user.
 */
export function validateRealtimeSessionBody(input, langs = REALTIME_LANGS) {
  const body = input && typeof input === 'object' ? input : {};
  const lang = typeof body.lang === 'string' && langs.includes(body.lang) ? body.lang : null;
  if (!lang) {
    return { ok: false, status: 400, message: `Choose a supported realtime language: ${langs.join(', ')}.` };
  }
  if (body.consent !== true) {
    return {
      ok: false,
      status: 400,
      message: 'Online voice consent is required: microphone audio is streamed to the provider for this session only. Turn on "Online AI Voice" first.',
    };
  }
  return { ok: true, lang };
}
/** A hard ceiling the client enforces; also returned so the UI can show the remaining time. */
export const REALTIME_MAX_SESSION_SECONDS = 300;
/** Short-lived credential lifetime requested from OpenAI. */
export const REALTIME_SECRET_TTL_SECONDS = 600;

/**
 * The teaching contract for the live voice.
 *
 * Deliberately concrete: the model may explain and question, but it has no tool that runs code in
 * this deployment. Saying that plainly is what stops a confident "I tested it" from a model that
 * cannot have tested anything.
 */
export function realtimeInstructions(lang) {
  const language = lang === 'hi-IN'
    ? 'Reply in natural Hinglish: Roman-script Hindi mixed with the English technical vocabulary. Never use Devanagari script. Keep technical terms in English.'
    : 'Reply in clear, friendly Indian English.';
  return [
    'You are BroCode, a patient AI coding mentor and mock interviewer for a Python/AI learning platform.',
    language,
    'When explaining a concept, use this order: (1) the plain idea in one or two short sentences, (2) why it works or why it matters, (3) one concrete example, (4) the next step the learner should try.',
    'Keep spoken turns short: at most 4 sentences before pausing for the learner. If the learner interrupts, stop and listen.',
    'Ask one question at a time. In an interview, wait for the answer, then ask one follow-up based on what was actually said.',
    'You cannot run code and you cannot see the learner’s test results. Never say you ran, tested, compiled or verified code. If code needs checking, ask the learner to run it and tell you the exact error.',
    'Never invent curriculum content, question numbers, scores or routes. If you do not know, say so and point to the lesson.',
    'Do not judge accent, voice, fluency or personality. If asked to score, score technical content and reasoning only, and say the score is an estimate.',
    'No robotic filler, no long preambles. Be warm, direct and useful.',
  ].join(' ');
}

/**
 * The exact session object sent to OpenAI. Pure, so voice/model/instruction wiring is testable with
 * no network and no key. `input_audio_transcription` is requested because the learner must be able
 * to read what was heard; the page never stores raw audio.
 */
export function buildRealtimeSessionConfig({
  model = DEFAULT_REALTIME_MODEL,
  voice = DEFAULT_REALTIME_VOICE,
  lang = 'en-IN',
  instructions = realtimeInstructions(lang),
} = {}) {
  const safeVoice = REALTIME_VOICES.includes(voice) ? voice : DEFAULT_REALTIME_VOICE;
  return {
    session: {
      type: 'realtime',
      model,
      instructions,
      audio: {
        input: {
          transcription: { model: 'gpt-4o-mini-transcribe' },
          turn_detection: { type: 'semantic_vad' },
        },
        output: { voice: safeVoice },
      },
    },
  };
}

/**
 * Ask OpenAI for an ephemeral client secret.
 *
 * Every failure is mapped to an Error with a `.code` the route turns into an honest status. The key
 * is never put in a message, and the returned payload is narrowed to the fields the browser needs —
 * no session instructions or account metadata travel back to the client.
 */
export async function createRealtimeClientSecret({
  apiKey,
  lang = 'en-IN',
  model = DEFAULT_REALTIME_MODEL,
  voice = DEFAULT_REALTIME_VOICE,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  now = Date.now,
} = {}) {
  if (!apiKey) {
    const error = new Error('Realtime voice is not configured on this server.');
    error.code = 'realtime-unconfigured';
    throw error;
  }
  if (!REALTIME_LANGS.includes(lang)) {
    const error = new Error(`Unsupported realtime language: ${lang}.`);
    error.code = 'realtime-bad-lang';
    throw error;
  }
  if (!fetchImpl) {
    const error = new Error('This runtime has no fetch implementation.');
    error.code = 'realtime-unavailable';
    throw error;
  }

  const body = buildRealtimeSessionConfig({ model, voice, lang });
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'realtime=v1',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error('The realtime voice service did not answer in time.');
    error.code = 'realtime-unavailable';
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`The realtime voice service refused the request (HTTP ${response.status}).`);
    error.code = response.status === 429 ? 'realtime-rate-limited' : 'realtime-unavailable';
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('The realtime voice service returned an unreadable answer.');
    error.code = 'realtime-unavailable';
    throw error;
  }
  const value = payload?.value ?? payload?.client_secret?.value;
  if (typeof value !== 'string' || !value) {
    const error = new Error('The realtime voice service returned no client secret.');
    error.code = 'realtime-unavailable';
    throw error;
  }
  const expiresAt = Number.isFinite(Number(payload?.expires_at))
    ? Number(payload.expires_at) * 1000
    : Number.isFinite(Number(payload?.expiresAt))
      ? Number(payload.expiresAt)
      : now() + REALTIME_SECRET_TTL_SECONDS * 1000;

  return {
    value,
    expiresAt,
    model: payload?.session?.model ?? model,
    voice: payload?.session?.audio?.output?.voice ?? (REALTIME_VOICES.includes(voice) ? voice : DEFAULT_REALTIME_VOICE),
    maxSessionSeconds: REALTIME_MAX_SESSION_SECONDS,
  };
}
