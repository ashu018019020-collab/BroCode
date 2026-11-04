/**
 * Which installed voice speaks which language — and what to say when none does.
 *
 * Pure on purpose: the ranking is the part of a voice system that is easiest to get quietly wrong
 * (a "natural" voice in the wrong language is worse than a plain one in the right language), so it is
 * driven here with plain objects and pinned by the suite. Nothing in this file creates an utterance,
 * reads `window`, or claims a voice is available before the device listed it.
 *
 * The rules, highest first:
 *
 *  1. language first — a perfect English voice never wins a Hindi request;
 *  2. within a language, the chain in `LANGUAGE_CHAINS` prefers the regional accent the learner
 *     expects (`en-IN` before `en-GB` before `en-US`) and Hindi before nothing;
 *  3. a female-sounding voice, when the device actually names one (Windows/Chrome/macOS all ship
 *     several) — this is a preference, never a promise;
 *  4. Chrome's own voices over system ones, then installed voices over remote ones, then the device's
 *     declared default;
 *  5. the name, so the same install always resolves to the same voice.
 */

import type {
  BrowserVoice, VoiceCounts, VoiceLanguagePreference, VoiceLocale,
} from './voice-types';

/** The accents a learner expects, most preferred first. `en`/`hi` catch tags without a region. */
export const LANGUAGE_CHAINS: Record<VoiceLocale, readonly string[]> = {
  en: ['en-in', 'en-gb', 'en-us', 'en-au', 'en-nz', 'en-ca', 'en'],
  hi: ['hi-in', 'hi'],
};

const DEVANAGARI = /[\u0900-\u097F]/u;

/** Roman-script Hindi markers. Deliberately common words, so an English sentence cannot trip them. */
const HINDI_ROMAN =
  /\b(kya|kaise|kyun|kyon|karna|karo|karega|batao|bata|samajh|samjha|nahi|nhi|hai|hain|hoon|mera|tum|aap|kuch|abhi|phir|lekin|matlab|bilkul|theek|thik|acha|accha|yaar|chahiye|hoga|hogi|karte|karta)\b/i;

/**
 * Names that are female on the platforms this app actually runs on.
 *
 * A name list is a preference, not a gender API: browser speech voices expose no gender field, which
 * is why the UI says "female-sounding voices are preferred when your device names one" instead of
 * promising one. `female` in the name (Google's own voices) is the only explicit marker.
 */
const FEMALE_NAMES = [
  'female', 'aditi', 'swara', 'heera', 'kalpana', 'neerja', 'priya', 'raveena', 'veena',
  'samantha', 'karen', 'moira', 'tessa', 'fiona', 'serena', 'allison', 'ava', 'susan', 'zira',
  'hazel', 'linda', 'jenny', 'aria', 'michelle', 'salli', 'joanna', 'kendra', 'kimberly', 'ivy',
  'nora', 'sonia', 'emma', 'olivia', 'sophie', 'chloe', 'amelie', 'leah', 'mia', 'paulina',
  'vicki', 'marlene', 'hanna', 'carla', 'helena', 'lianne', 'xiaoxiao', 'xiaoyi', 'nanami', 'yuna',
];

/** `en_IN` / `EN-in` → `en-in`. Device tags are not consistently cased or separated. */
export function normalizeTag(lang: string): string {
  return String(lang ?? '').replace(/_/g, '-').trim().toLowerCase();
}

/** The language family a tag belongs to, or `null` for a language this app does not speak. */
export function localeOf(lang: string): VoiceLocale | null {
  const code = normalizeTag(lang);
  if (code === 'hi' || code.startsWith('hi-')) return 'hi';
  if (code === 'en' || code.startsWith('en-')) return 'en';
  return null;
}

/** Does this voice belong to the requested language at all? Never crosses languages. */
export function matchesLocale(voice: Pick<BrowserVoice, 'lang'> | { lang: string }, locale: VoiceLocale): boolean {
  return localeOf(voice.lang) === locale;
}

export function isFemaleSounding(name: string): boolean {
  const value = String(name ?? '').toLowerCase();
  return FEMALE_NAMES.some((entry) => value.includes(entry));
}

/** Lower is better. Exported so the tests can pin the ordering rather than the winner alone. */
export function scoreVoice(voice: BrowserVoice, locale: VoiceLocale): number {
  const code = normalizeTag(voice.lang);
  const chain = LANGUAGE_CHAINS[locale];
  const position = chain.indexOf(code);
  const language = position >= 0 ? position : 40;
  // Every tie-breaker below is smaller than one step of the accent chain: the accent the learner
  // expects outranks a preferred name, and the name only decides between voices of the same tag.
  const gender = isFemaleSounding(voice.name) ? -0.75 : 0;
  const google = /^google\b/i.test(voice.name);
  const brand = google ? -0.5 : 0;
  // Neural/"Natural" voices (Edge/Windows, Chrome's cloud voices) are the closest thing to an AI
  // voice the platform offers: same language, better prosody than the legacy formant ones. Google's
  // own voices count as neural — they are cloud-synthesised — so this preference does not downgrade
  // the one family the suite already prefers.
  const quality = google || /\b(natural|neural|premium|enhanced|wavenet|studio)\b/i.test(voice.name)
    ? -0.45
    : 0;
  const local = voice.localService ? 0 : 0.5;
  const declared = voice.default ? -0.25 : 0;
  // The personality block never outranks the accent chain: one chain step is 1, so the whole block is
  // clamped below it. Otherwise a natural US voice would beat an installed Indian English one.
  const taste = Math.max(-0.95, Math.min(0.95, gender + brand + quality + local + declared));
  return language + taste;
}

/** Every voice the device has for this language, best first. Other languages are excluded. */
export function voicesForLocale(voices: readonly BrowserVoice[], locale: VoiceLocale): BrowserVoice[] {
  return voices
    .filter((voice) => matchesLocale(voice, locale))
    .slice()
    .sort((a, b) => scoreVoice(a, locale) - scoreVoice(b, locale) || a.name.localeCompare(b.name));
}

export function bestVoice(voices: readonly BrowserVoice[], locale: VoiceLocale): BrowserVoice | null {
  return voicesForLocale(voices, locale)[0] ?? null;
}

/** A stored `voiceURI` may have been uninstalled; that is a miss, not an error. */
export function findVoiceByURI(voices: readonly BrowserVoice[], uri: string | undefined): BrowserVoice | null {
  if (!uri) return null;
  const wanted = uri.toLowerCase();
  return voices.find((voice) => voice.voiceURI.toLowerCase() === wanted) ?? null;
}

/**
 * The voice to speak with: the learner's pick when it is still installed AND still speaks the right
 * language, otherwise the best match. A stored Hindi voice never answers an English sentence.
 */
export function resolveVoice(
  voices: readonly BrowserVoice[],
  locale: VoiceLocale,
  preferredURI?: string,
): BrowserVoice | null {
  const preferred = findVoiceByURI(voices, preferredURI);
  if (preferred && matchesLocale(preferred, locale)) return preferred;
  return bestVoice(voices, locale);
}

export function voiceCounts(voices: readonly BrowserVoice[]): VoiceCounts {
  return {
    total: voices.length,
    hindi: voices.filter((voice) => matchesLocale(voice, 'hi')).length,
    english: voices.filter((voice) => matchesLocale(voice, 'en')).length,
  };
}

/**
 * `auto` is not an engine language — it is a preference resolved per answer from what the learner
 * wrote or said. Devanagari is unambiguous; Roman Hinglish follows the text's own words.
 */
export function resolveLocale(preference: VoiceLanguagePreference, sample = ''): VoiceLocale {
  if (preference === 'hi' || preference === 'en') return preference;
  const text = String(sample ?? '');
  if (DEVANAGARI.test(text)) return 'hi';
  return HINDI_ROMAN.test(text) ? 'hi' : 'en';
}

/**
 * What the panel says when the device has no voice for a language.
 *
 * An empty string means "there is a voice, say nothing". When there is none the sentence names the
 * consequence instead of quietly choosing an unrelated language.
 */
export function availabilityMessage(voices: readonly BrowserVoice[], locale: VoiceLocale): string {
  if (voicesForLocale(voices, locale).length) return '';
  if (locale === 'hi') {
    return 'No Hindi voice is installed on this device. Hindi and Hinglish answers fall back to the '
      + 'English voice, which may read Devanagari poorly. Install a Hindi voice in your system settings, '
      + 'or read the answer on screen.';
  }
  return 'No English voice is installed on this device. Pick another installed voice, or read the '
    + 'answer on screen.';
}

/** One voice, said plainly: name, tag, and whether the sound is local. */
export function describeVoice(voice: BrowserVoice | null): string {
  if (!voice) return 'No voice selected';
  return `${voice.name} · ${voice.lang}`;
}

/**
 * The line under the controls. It names the device's own voice and never promises more than the
 * platform does: a `localService: false` voice may be synthesised by the operating system or a
 * cloud speech service the device is configured with — that is the platform's choice, not ours.
 */
export function voiceEngineNote(
  voices: readonly BrowserVoice[],
  locale: VoiceLocale,
  selected: BrowserVoice | null,
): string {
  const pool = voicesForLocale(voices, locale);
  if (!pool.length) return availabilityMessage(voices, locale);
  const voice = selected ?? pool[0];
  if (!voice) return availabilityMessage(voices, locale);
  const where = voice.localService
    ? 'installed on this device'
    : 'provided by this device’s speech service (it may be online)';
  const hindi = voicesForLocale(voices, 'hi').length;
  return `Device voice · ${voice.name} (${voice.lang}) · ${where} · ${hindi > 0
    ? 'Hindi + English voices detected'
    : 'no Hindi voice detected'}.`;
}
