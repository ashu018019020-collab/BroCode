/**
 * The one vocabulary the voice surfaces share.
 *
 * Two jobs, both pure so the suite can drive them without a browser:
 *
 *  1. STATE. The engine reports raw facts — the platform's playback state, whether the recogniser is
 *     open, whether an answer is being retrieved. The UI announces exactly one state and must never
 *     say "Speaking" because a request was sent. `mentorVoiceState` is that mapping;
 *     `mentorVoiceLabel`/`mentorVoiceHint` are the single wording.
 *
 *  2. SPEECH TEXT. Re-exported from `speech-processor` so every surface that already imports this
 *     module keeps one import for the voice vocabulary.
 *
 * There is no download, model or worker state any more: a device voice is either installed or it is
 * not, and an absent voice is `unsupported` — a fact, not a failure to retry.
 */

export {
  numberWords,
  speechText,
  speechSegments,
  speechLanguage,
  verbalizeNumbers,
} from './speech-processor';
export type { SpeechPreference } from './speech-processor';

import type { VoiceLocale, VoicePlaybackState } from './voice-types';

/** What the mentor announces. `thinking` is a retrieval in flight, never a timer. */
export type MentorVoiceState =
  | 'idle'
  | 'ready'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'paused'
  | 'completed'
  | 'error'
  | 'unsupported'
  | 'permission-required';

export type SpeechLocale = VoiceLocale;

export interface MentorVoiceSnapshot {
  /** The platform's own playback state, from utterance events. */
  playing?: VoicePlaybackState;
  /** The microphone is open and the recogniser is running. */
  listening?: boolean;
  /** A grounded answer is being retrieved. */
  thinking?: boolean;
  error?: string | null;
  /** The device has no speech synthesis at all. */
  unsupported?: boolean;
  /** The microphone permission was refused; the fix is a permission, not a retry. */
  permissionRequired?: boolean;
}

/**
 * The precedence is deliberate: a missing engine is a fact that outranks every other state, then a
 * real failure, then actual sound (the learner hears it or does not), then the microphone, then the
 * wait for an answer, then the last completed run.
 */
export function mentorVoiceState(snapshot: MentorVoiceSnapshot): MentorVoiceState {
  const {
    playing = 'idle', listening = false, thinking = false,
    error = null, unsupported = false, permissionRequired = false,
  } = snapshot;
  if (unsupported) return 'unsupported';
  if (error || playing === 'error') return 'error';
  if (playing === 'speaking') return 'speaking';
  if (playing === 'paused') return 'paused';
  if (listening) return 'listening';
  if (permissionRequired) return 'permission-required';
  if (playing === 'completed') return 'completed';
  if (thinking) return 'thinking';
  if (playing === 'idle') return 'ready';
  return 'idle';
}

/** The label under the orb — one line, in the learner's language. */
export function mentorVoiceLabel(state: MentorVoiceState, locale: SpeechLocale = 'en'): string {
  const hi = locale === 'hi';
  switch (state) {
    case 'ready': return hi ? 'Taiyar hoon' : 'Ready';
    case 'listening': return hi ? 'Sun raha hoon…' : 'Listening…';
    case 'thinking': return hi ? 'Jawab dhoond raha hoon…' : 'Finding the answer…';
    case 'speaking': return hi ? 'Bol raha hoon…' : 'Speaking…';
    case 'paused': return hi ? 'Ruka hua hai' : 'Paused';
    case 'completed': return hi ? 'Jawab poora hua' : 'Finished speaking';
    case 'error': return hi ? 'Voice mein dikkat' : 'Voice unavailable';
    case 'unsupported': return hi ? 'Is browser mein voice nahi' : 'Voice not available here';
    case 'permission-required': return hi ? 'Microphone ki permission chahiye' : 'Microphone permission needed';
    default: return hi ? 'Voice taiyar' : 'Voice on standby';
  }
}

/** The second line: what the state MEANS, never a second status. */
export function mentorVoiceHint(state: MentorVoiceState, locale: SpeechLocale = 'en'): string {
  const hi = locale === 'hi';
  switch (state) {
    case 'ready': return hi
      ? 'Bolo ya likho — jawab is device ki voice se padha jayega.'
      : 'Speak or type — the answer is read with a voice installed on this device.';
    case 'listening': return hi ? 'Bolo, main sun raha hoon.' : 'Speak now — the microphone is open.';
    case 'thinking': return hi ? 'Jawab tumhare lessons se aa raha hai.' : 'The answer is being retrieved from your lessons.';
    case 'speaking': return hi ? 'Rokna ho to Stop dabao.' : 'Press Stop to end the voice.';
    case 'paused': return hi ? 'Resume dabao wahin se sunne ke liye.' : 'Press Resume to continue.';
    case 'completed': return hi ? 'Replay se dobara sun sakte ho.' : 'Replay reads the same answer again.';
    case 'error': return hi ? 'Dobara Speak dabao, ya jawab screen par padho.' : 'Press Speak again, or read the answer on screen.';
    case 'unsupported': return hi
      ? 'Yeh browser bol nahi sakta. Text jawab phir bhi poora kaam karta hai.'
      : 'This browser cannot read text aloud. Typed answers still work exactly the same.';
    case 'permission-required': return hi
      ? 'Address bar mein microphone allow karo, phir mic dobara dabao.'
      : 'Allow the microphone in the address bar, then press the mic again.';
    default: return hi
      ? 'Awaaz pehli baar bolne par shuru hoti hai.'
      : 'The voice starts on the first spoken answer.';
  }
}
