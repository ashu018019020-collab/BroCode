/**
 * The ONE voice the mentor offers, and the plan for reading one answer.
 *
 * The learner never picks a device voice: `BroCode Natural Voice` is a profile, not a preset. Under it
 * two real voices may work — a Hindi one and an English one — because a device usually has no single
 * voice that reads both scripts well. Nothing here pretends those are the same speaker: `shared` is
 * true only when the platform itself reported the same `voiceURI` for both languages, and the panel
 * says "one voice" only in that case.
 *
 * `planSpeech` is the other half: it decides, per sentence, which of the two installed voices reads
 * it. Hindi text is never handed to an English voice deliberately — the only fallback is the
 * platform's own when no Hindi voice exists at all, and `profileMessage` says so before it happens.
 *
 * Pure: no `window`, no utterance, no storage. The suite drives it with plain objects.
 */

import { availabilityMessage, resolveLocale, voicesForLocale } from './voice-discovery';
import { speechLanguage, speechSegments, speechText } from './speech-processor';
import type { BrowserVoice, VoiceLanguagePreference, VoiceLocale } from './voice-types';

/** What the learner sees. One name, two languages, no technical voice names. */
export const NATURAL_VOICE = Object.freeze({
  id: 'brocode-natural',
  name: 'BroCode Natural Voice',
  subtitle: 'Hindi + English',
  detail: 'Automatic language selection',
});


export interface NaturalVoices {
  hi: BrowserVoice | null;
  en: BrowserVoice | null;
  /** True only when the device reported ONE voice for both languages. */
  shared: boolean;
}

/** The internal mapping behind the single profile: best Hindi voice, best English voice. */
export function naturalVoices(voices: readonly BrowserVoice[]): NaturalVoices {
  const hi = voicesForLocale(voices, 'hi')[0] ?? null;
  const en = voicesForLocale(voices, 'en')[0] ?? null;
  return { hi, en, shared: Boolean(hi && en && hi.voiceURI === en.voiceURI) };
}

export type NaturalVoiceStatus = 'ready' | 'partial' | 'unavailable';

/** Availability for the CURRENT language choice — honest about a half-installed device. */
export function profileStatus(
  voices: readonly BrowserVoice[],
  preference: VoiceLanguagePreference = 'auto',
): NaturalVoiceStatus {
  const { hi, en } = naturalVoices(voices);
  if (preference === 'hi') return hi ? 'ready' : en ? 'partial' : 'unavailable';
  if (preference === 'en') return en ? 'ready' : hi ? 'partial' : 'unavailable';
  if (hi && en) return 'ready';
  return hi || en ? 'partial' : 'unavailable';
}

/**
 * One sentence about what will actually happen, or `''` when both languages have a voice.
 *
 * The Hindi case is the one that matters on a fresh Windows install: an English voice reading
 * Devanagari is the failure mode learners report as "the voice is broken", so it is named BEFORE the
 * answer is spoken rather than silently producing gibberish.
 */
export function profileMessage(
  voices: readonly BrowserVoice[],
  preference: VoiceLanguagePreference = 'auto',
): string {
  const { hi, en } = naturalVoices(voices);
  if (!hi && !en) {
    return 'No speech voice is installed on this device. Install one in your system settings, or read '
      + 'answers on screen.';
  }
  if (preference === 'hi') {
    return hi ? '' : 'No Hindi voice is installed on this device, so Hindi will be read by the English '
      + 'voice and may sound wrong. Install a Hindi voice in your system settings.';
  }
  if (preference === 'en') {
    return en ? '' : availabilityMessage(voices, 'en');
  }
  if (!hi) {
    return 'No Hindi voice is installed on this device, so Hindi and Hinglish answers are read by the '
      + 'English voice and may sound wrong. Install a Hindi voice in your system settings.';
  }
  if (!en) {
    return 'No English voice is installed on this device, so English answers are read by the Hindi '
      + 'voice — the words may sound unclear. Install an English voice in your system settings.';
  }
  return '';
}

/**
 * The language the microphone should start with for the NEXT question.
 *
 * Recognition and synthesis are different services: Chrome's recogniser will not turn Hindi speech
 * into text with an English-only language tag, and a Hindi-speaking learner typing nothing at all
 * reads that as "the mic does not work". `auto` therefore follows the last answer — a Hindi answer
 * invites a Hindi reply — and an explicit choice is used as-is.
 */
export function recognitionLocale(
  preference: VoiceLanguagePreference = 'auto',
  sample = '',
): 'hi-IN' | 'en-IN' {
  const lang = preference === 'auto' ? resolveLocale('auto', sample) : preference;
  return lang === 'hi' ? 'hi-IN' : 'en-IN';
}

export interface SpeechPlanSegment {
  text: string;
  lang: VoiceLocale;
}

export interface SpeechPlan {
  /** The dominant language of the answer. */
  lang: VoiceLocale;
  /** Sentences in order. Each carries the language whose installed voice should read it. */
  segments: SpeechPlanSegment[];
}

/**
 * Clean an answer and decide who reads each sentence.
 *
 * `auto` decides PER SENTENCE from that sentence's own text: Devanagari is Hindi, Roman Hinglish is
 * Hindi (its `hain`/`kya`/`matlab` words), everything else is English. That is what makes a mixed
 * answer natural — the English lines keep the English voice and the Hindi line gets the Hindi one,
 * instead of one bad accent reading both. An explicit Hindi/English choice wins for every sentence:
 * that is what "English only" means, even when the text says otherwise.
 */
export function planSpeech(text: string, preference: VoiceLanguagePreference = 'auto'): SpeechPlan {
  const clean = speechText(text);
  const segments = speechSegments(clean).map((part) => ({
    text: part,
    lang: preference === 'auto' ? speechLanguage(part, 'auto') : preference,
  }));
  // The dominant language is the one carrying the most characters — used for the panel's own labels.
  let dominant: SpeechPlanSegment['lang'] = preference === 'auto' ? 'en' : preference;
  if (preference === 'auto') {
    let longest = -1;
    for (const segment of segments) {
      if (segment.text.length > longest) {
        longest = segment.text.length;
        dominant = segment.lang;
      }
    }
  }
  return { lang: dominant, segments };
}
