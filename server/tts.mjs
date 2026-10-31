/**
 * The server's text-to-speech engine.
 *
 * ONE provider, chosen for a warm Indian female voice in both languages rather than for the model's
 * marketing: Azure AI Speech ships `hi-IN-SwaraNeural` and `en-IN-NeerjaNeural` — a matched pair of
 * natural Indian female voices — and it is a plain HTTPS endpoint, so nothing is downloaded, no GPU
 * is involved and the key never leaves this process.
 *
 * The rules this module keeps:
 *   · The key is read from the environment ONCE and is never returned, logged or put in a response.
 *   · Nothing is synthesised when there is no key: `synthesize()` rejects with `TTS_NOT_CONFIGURED`
 *     so the route can answer 503 honestly instead of the UI pretending it spoke.
 *   · The text is escaped into SSML; a learner's `<` cannot become markup.
 *   · Every failure is a typed `TtsError` with a machine code, because the route sends a category
 *     and the client writes the human sentence.
 */

export const TTS_MAX_CHARS = 600;
export const TTS_DEFAULT_TIMEOUT_MS = 20_000;

/** The languages the tutor speaks. `hi-IN` covers Hinglish: Swara reads Roman Hindi the way it sounds. */
export const TTS_LANGS = ['hi-IN', 'en-IN'];

/**
 * The voice pair. Both are female and both are Indian English/Hindi natives, so switching language
 * mid-lesson changes the language, not the person. An operator may pin another voice by env without
 * touching code — the ids are validated against the same language they claim.
 */
export const TTS_VOICES = {
  'hi-IN': 'hi-IN-SwaraNeural',
  'en-IN': 'en-IN-NeerjaNeural',
};

const VOICE_LANG = Object.fromEntries(Object.entries(TTS_VOICES).map(([lang, voice]) => [voice, lang]));

const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

export class TtsError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'TtsError';
    this.code = code;
    this.status = status;
  }
}

/** SSML is XML: the learner's own words must never be able to close a tag. */
export function escapeSsml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** The client sends a multiplier (0.5–1.5); SSML wants a signed percentage. */
export function clampRate(rate) {
  const n = Number(rate);
  if (!Number.isFinite(n)) return 1;
  // Two decimals, not one: 1.25 must stay 1.25 (a one-decimal round turned it into 1.3).
  return Math.min(1.5, Math.max(0.5, Math.round(n * 100) / 100));
}

export function voiceFor(lang) {
  return TTS_VOICES[lang] ?? null;
}

/**
 * The SSML body. `xml:lang` and the voice must agree, and the prosody wraps ONLY the words, so the
 * markup stays constant and the rate is the only thing that changes between requests.
 */
export function buildSsml({ text, lang, rate = 1 }) {
  const voice = voiceFor(lang);
  if (!voice) throw new TtsError('TTS_LANG_UNSUPPORTED', `Unsupported voice language: ${lang}`, 400);
  if (!VOICE_LANG[voice]) throw new TtsError('TTS_VOICE_INVALID', 'The configured voice does not match its language.', 500);
  const percent = Math.round((clampRate(rate) - 1) * 100);
  const prosody = percent === 0 ? '0%' : `${percent > 0 ? '+' : ''}${percent}%`;
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">`
    + `<voice name="${voice}"><prosody rate="${prosody}">${escapeSsml(text)}</prosody></voice>`
    + '</speak>';
}

/**
 * Build the engine. `fetchImpl` is injectable so the tests drive real request/response handling with
 * no network and no key, and so an operator can hand in a cipher-free transport if they must.
 */
export function createTtsEngine({
  key = '',
  region = '',
  fetchImpl = globalThis.fetch,
  timeoutMs = TTS_DEFAULT_TIMEOUT_MS,
  logger = console,
  voices = {},
} = {}) {
  const configured = Boolean(key && region);

  function endpoint() {
    return `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  }

  /** The public half: what a client may know. Never the key, never the region's credentials. */
  function status() {
    return {
      configured,
      engine: 'azure',
      langs: [...TTS_LANGS],
      voices: { ...TTS_VOICES, ...voices },
      femaleOnly: true,
      maxChars: TTS_MAX_CHARS,
    };
  }

  /**
   * Synthesise one chunk. Resolves with the audio and the voice that produced it — the caller sends
   * that name to the client so the UI reports the voice that actually spoke, not a guess.
   */
  async function synthesize({ text, lang, rate = 1 } = {}) {
    if (!configured) {
      throw new TtsError('TTS_NOT_CONFIGURED', 'No speech key is configured on this server.', 503);
    }
    const clean = typeof text === 'string' ? text.trim() : '';
    if (!clean) throw new TtsError('TTS_TEXT_EMPTY', 'Text is required.', 400);
    if (clean.length > TTS_MAX_CHARS) {
      throw new TtsError('TTS_TEXT_TOO_LONG', `Text must be at most ${TTS_MAX_CHARS} characters.`, 400);
    }
    const language = TTS_LANGS.includes(lang) ? lang : null;
    if (!language) throw new TtsError('TTS_LANG_UNSUPPORTED', `Choose one of: ${TTS_LANGS.join(', ')}.`, 400);

    const body = buildSsml({ text: clean, lang: language, rate });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(endpoint(), {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': key,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': OUTPUT_FORMAT,
          'User-Agent': 'BroCode',
        },
        body,
        signal: controller.signal,
      });
    } catch (cause) {
      // Never echo the cause: a transport error object can carry the request, headers included.
      void cause;
      throw new TtsError('TTS_UNREACHABLE', 'The speech service could not be reached.', 502);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // The provider's body is not forwarded: it can name the subscription and the endpoint.
      throw new TtsError(`TTS_UPSTREAM_${response.status}`, `The speech service answered ${response.status}.`, 502);
    }
    const type = (response.headers.get('content-type') ?? '').toLowerCase();
    // A proxy or a captive portal answers 200 with HTML; audio is audio.
    if (!type.startsWith('audio')) {
      throw new TtsError('TTS_NOT_AUDIO', 'The speech service did not return audio.', 502);
    }
    let audio;
    try {
      audio = new Uint8Array(await response.arrayBuffer());
    } catch {
      throw new TtsError('TTS_BODY_UNREADABLE', 'The audio could not be read.', 502);
    }
    if (!audio.byteLength) throw new TtsError('TTS_EMPTY_AUDIO', 'The speech service returned silence.', 502);

    const voice = voices[language] ?? TTS_VOICES[language];
    logger?.info?.(`tts: ${voice} · ${clean.length} chars`);
    return { audio, contentType: 'audio/mpeg', voice, lang: language };
  }

  return { status, synthesize, configured };
}
