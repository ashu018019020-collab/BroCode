/**
 * The plain data every voice surface shares.
 *
 * Kept separate from the engine so the ranking rules, the storage shape and the diagnostics panel can
 * all name the same things without importing a browser module. Nothing here touches `window`: the test
 * suite loads this file directly.
 */

/** A language the app speaks. `hi` also covers Roman-script Hinglish. */
export type VoiceLocale = 'en' | 'hi';

/** What the learner picks: `auto` resolves per answer from the text itself. */
export type VoiceLanguagePreference = 'auto' | VoiceLocale;

/** The real playback state, reported by the engine's own events. */
export type VoicePlaybackState = 'idle' | 'speaking' | 'paused' | 'completed' | 'error';

/** A voice the device actually reported — never a preset we invented. */
export interface BrowserVoice {
  name: string;
  /** BCP-47 tag exactly as the device reported it, e.g. `hi-IN`. */
  lang: string;
  voiceURI: string;
  /** True when the voice is installed locally; remote system voices may be served by the OS. */
  localService: boolean;
  default: boolean;
}

/** Microphone permission, as the Permissions API reports it (or as an error told us). */
export type MicPermission = 'unknown' | 'granted' | 'denied' | 'unsupported';

export interface VoiceCounts {
  total: number;
  hindi: number;
  english: number;
}
