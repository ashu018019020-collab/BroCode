/**
 * The tutor's premium voice — Google Cloud Text-to-Speech, spoken SERVER-side.
 *
 * The API key never reaches the browser: the client sends text, this module posts it to Google with
 * the key from the server environment and returns audio bytes. When no key is configured the server
 * says so (`configured: false`) and the client keeps using the browser's own synthesiser — the app
 * still works with zero network, and a missing key degrades the voice instead of breaking it.
 *
 * Neural2 is the current best-quality Indian voice Google sells: `hi-IN-Neural2-A` speaks natural
 * Hindi (and Hinglish text reads Hindi words with English identifiers intact), `en-IN-Neural2-A` is
 * Indian English. Both are overridable per deployment — not every Google Cloud project has Neural2
 * enabled, and Wavenet is the honest fallback there.
 */

/** Google refuses a request over 5,000 UTF-8 bytes; Hindi is 3 bytes a character. 480 chars is safe. */
export const TTS_MAX_CHARS = 480;

export const TTS_LANGS = ['en-IN', 'hi-IN'];

export const DEFAULT_TTS_VOICES = {
  'hi-IN': 'hi-IN-Neural2-A',
  'en-IN': 'en-IN-Neural2-A',
};

/**
 * The exact body sent to `text:synthesize`. Pure, so what Google receives is testable without a
 * network or a key: text is trimmed and bounded (never rejected — the client's chunks are already
 * short, and a clipped sentence beats a dropped answer), the voice falls back per language, and the
 * speaking rate is clamped to Google's accepted 0.5–2.0 band.
 */
export function buildGoogleTtsRequest({ text, lang, rate, voiceName }) {
  const clean = String(text ?? '').trim().slice(0, TTS_MAX_CHARS);
  const speakingRate = Number.isFinite(Number(rate)) ? Number(rate) : 1;
  return {
    input: { text: clean },
    voice: {
      languageCode: lang,
      name: (voiceName ?? '').trim() || DEFAULT_TTS_VOICES[lang],
    },
    audioConfig: {
      audioEncoding: 'MP3',
      speakingRate: Math.min(2, Math.max(0.5, speakingRate)),
    },
  };
}

/**
 * One synthesize call, bounded in time and in what it can throw.
 *
 * Returns the MP3 bytes. Every failure mode — no key, Google saying no, a timeout, an empty
 * answer — throws an Error whose `.code` the caller maps to an honest HTTP status. The key is
 * passed in the query string because that is Google's documented API-key transport; it is never
 * logged and never echoed back.
 */
export async function synthesizeGoogleTts({
  apiKey,
  text,
  lang,
  rate,
  voiceName,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
}) {
  if (!apiKey) {
    const error = new Error('No Google TTS key is configured.');
    error.code = 'voice-unconfigured';
    throw error;
  }
  if (!TTS_LANGS.includes(lang)) {
    const error = new Error(`Unsupported voice language: ${lang}.`);
    error.code = 'voice-bad-lang';
    throw error;
  }
  const body = buildGoogleTtsRequest({ text, lang, rate, voiceName });

  let response;
  try {
    response = await fetchImpl(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      },
    );
  } catch (cause) {
    const error = new Error('The Google voice service did not answer in time.');
    error.code = 'voice-unavailable';
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    // Google's body can quote the key back in some error shapes; only the status travels onward.
    const error = new Error(`The Google voice service refused the request (HTTP ${response.status}).`);
    error.code = response.status === 429 ? 'voice-rate-limited' : 'voice-unavailable';
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('The Google voice service returned an unreadable answer.');
    error.code = 'voice-unavailable';
    throw error;
  }
  if (typeof payload?.audioContent !== 'string' || !payload.audioContent) {
    const error = new Error('The Google voice service returned no audio.');
    error.code = 'voice-unavailable';
    throw error;
  }
  return Buffer.from(payload.audioContent, 'base64');
}
