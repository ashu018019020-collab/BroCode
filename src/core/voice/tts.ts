/**
 * The browser's side of the server voice.
 *
 * One rule shapes this file: the client never knows the provider, the key or the SSML. It posts text
 * to this deployment's own API, receives audio, and plays it. A failure is a typed `SpeechError`
 * carrying the server's own sentence, so the UI can show what happened instead of a generic shrug —
 * and it never falls back to a robot voice on its own.
 */

export type ServerVoiceState = 'checking' | 'ready' | 'unavailable';

export interface VoiceStatus {
  configured: boolean;
  engine: string;
  langs: string[];
  /** language → voice id, exactly as the server will speak it. */
  voices: Record<string, string>;
}

const STATUS_PATH = '/api/voice/status';
const TTS_PATH = '/api/voice/tts';

export class SpeechError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SpeechError';
    this.code = code;
    this.status = status;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** Read `{ message }` / `{ error }` without trusting the shape: a proxy can answer HTML. */
async function readFailure(response: Response, fallback: string): Promise<SpeechError> {
  let message = fallback;
  let code = `VOICE_${response.status}`;
  try {
    const body = await response.json() as Record<string, unknown> | null;
    const text = body?.message ?? body?.error ?? body?.detail;
    if (typeof text === 'string' && text.trim()) message = text.trim();
    if (typeof body?.code === 'string' && body.code.trim()) code = body.code.trim();
  } catch {
    /* not JSON: the fallback sentence stands */
  }
  return new SpeechError(code, message, response.status);
}

/**
 * What the server will speak with. `null` means the API did not answer at all — a different fact
 * from "it answered and has no key", and the UI says which one it is.
 */
export async function voiceStatus(signal?: AbortSignal): Promise<VoiceStatus | null> {
  try {
    const response = await fetch(STATUS_PATH, {
      headers: { Accept: 'application/json' },
      signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = await response.json() as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return null;
    const voices = (body.voices && typeof body.voices === 'object' ? body.voices : {}) as Record<string, unknown>;
    return {
      configured: body.configured === true,
      engine: typeof body.engine === 'string' ? body.engine : '',
      langs: strings(body.langs),
      voices: Object.fromEntries(
        Object.entries(voices).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
      ),
    };
  } catch {
    return null;
  }
}

/**
 * One chunk of speech. Returns an object URL the hook owns: the caller must revoke it when the
 * answer finishes, which is why this hands back a URL rather than an element — the queue decides
 * when playback starts.
 */
export async function fetchSpeech({
  text,
  lang,
  rate,
  signal,
}: {
  text: string;
  lang: string;
  rate: number;
  signal?: AbortSignal;
}): Promise<string> {
  let response: Response;
  try {
    response = await fetch(TTS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({ text, lang, rate }),
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new SpeechError('VOICE_UNREACHABLE', 'The voice service could not be reached.', 0);
  }
  if (!response.ok) throw await readFailure(response, 'The voice could not be generated.');
  const type = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!type.startsWith('audio')) {
    throw new SpeechError('VOICE_NOT_AUDIO', 'The voice service did not return audio.', response.status);
  }
  const blob = await response.blob();
  if (!blob.size) throw new SpeechError('VOICE_EMPTY', 'The voice service returned silence.', response.status);
  return URL.createObjectURL(blob);
}

/** A voice id in words: `hi-IN-SwaraNeural` → `Swara`. Unknown ids are shown as they are. */
export function voiceDisplayName(voiceId: string | null | undefined): string {
  if (!voiceId) return '';
  const match = /^[a-z]{2}-[A-Z]{2}-([A-Za-z]+?)Neural$/.exec(voiceId);
  return match?.[1] ?? voiceId;
}

/** The one line under the mentor's controls. Honest about where the sound comes from. */
export function serverVoiceNote(state: ServerVoiceState, voiceId: string | null, support: boolean): string {
  if (state === 'checking') return 'Checking the AI voice…';
  if (state === 'ready') {
    const name = voiceDisplayName(voiceId);
    return `Female AI voice${name ? ` · ${name}` : ''} · Hindi/Hinglish + English · generated on the server.`;
  }
  // This deployment has no server key. That is a fact about the INTERVIEW's optional voice only: the
  // AI Mentor speaks with Supertonic 3 in the browser and never asks for a key. The old sentence
  // ("the server voice is not configured") read like a broken product, so it is not shown any more.
  return support
    ? 'This deployment has no server voice key. The interview can read answers with this browser’s own voice.'
    : 'No voice is available here: this deployment has no server key and this browser cannot read text aloud.';
}
