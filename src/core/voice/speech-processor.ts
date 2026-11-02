/**
 * Text → the sentence a person would say.
 *
 * What the learner reads is not what a speech engine should read: markdown symbols, tables and arrows
 * are punctuation on screen and gibberish in the ear. `speechText` cleans the reply without changing
 * its meaning, `speechSegments` cuts it on sentence boundaries so the first sound arrives quickly and
 * `Stop` has a boundary to cut on, and `speechLanguage` decides which installed voice reads the
 * characters actually in front of it.
 *
 * Pure, so the suite drives it without a browser. Nothing here invents a sentence: empty input
 * returns empty output.
 */

import { resolveLocale } from './voice-discovery';
import type { VoiceLanguagePreference, VoiceLocale } from './voice-types';

/** Kept as its own name because the studio and the tests speak about the learner's preference. */
export type SpeechPreference = VoiceLanguagePreference;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu;

const ABBREVIATIONS: readonly (readonly [RegExp, string])[] = [
  [/\be\.g\.,?\s*/gi, 'for example, '],
  [/\bi\.e\.,?\s*/gi, 'that is, '],
  [/\betc\.?/gi, 'etcetera'],
  [/\bvs\.?\s*/gi, 'versus '],
  [/\bapprox\.?\s*/gi, 'approximately '],
  [/\bw\.r\.t\.?\s*/gi, 'with respect to '],
  [/\bext\.?\s*/gi, 'extension '],
  [/\bconfig\.?\s*/gi, 'config '],
  [/\bdept\.?\s*/gi, 'department '],
  [/\bfig\.?\s*/gi, 'figure '],
  [/\bno\.\s*(?=\d)/gi, 'number '],
];

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0…999 in words — the range a lesson actually uses (epochs, layers, ports, scores). */
export function numberWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  const n = Math.trunc(Math.abs(value));
  if (n < 20) return ONES[n] ?? '';
  if (n < 100) {
    const tens = TENS[Math.floor(n / 10)] ?? '';
    const rest = n % 10;
    return rest ? `${tens}-${ONES[rest]}` : tens;
  }
  if (n < 1000) {
    const hundreds = `${ONES[Math.floor(n / 100)]} hundred`;
    const rest = n % 100;
    return rest ? `${hundreds} ${numberWords(rest)}` : hundreds;
  }
  if (n < 1_000_000) {
    const thousands = `${numberWords(Math.floor(n / 1000))} thousand`;
    const rest = n % 1000;
    return rest ? `${thousands} ${numberWords(rest)}` : thousands;
  }
  return String(n);
}

/**
 * Digits → words, for ENGLISH only.
 *
 * A Devanagari sentence keeps its numerals: installed Hindi voices read `2` as "do", and substituting
 * English words into it would be worse than the numeral. Decimals are read as "one point five",
 * which is how a speed or a loss is said aloud.
 */
export function verbalizeNumbers(text: string): string {
  const value = String(text ?? '');
  if (!value || /[\u0900-\u097F]/u.test(value)) return value;
  return value
    .replace(/\b(\d+)\.(\d+)\b/g, (_match, whole: string, fraction: string) =>
      `${numberWords(Number(whole))} point ${fraction.split('').map((digit) => numberWords(Number(digit))).join(' ')}`)
    .replace(/\b(\d{1,6})\b/g, (match, digits: string) => numberWords(Number(digits)) || match);
}

/**
 * Markdown → the sentence a person would say.
 *
 * Order matters: fenced blocks go first (before inline backticks can eat their braces), then links,
 * then emphasis, then the symbols that are punctuation on screen and words in the ear.
 */
export function speechText(markdown: string): string {
  let out = String(markdown ?? '');
  if (!out.trim()) return '';
  out = out
    .replace(/```[a-zA-Z0-9+#-]*\n?[\s\S]*?```/g, ' code example ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' a link ')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2')
    .replace(/\s*→\s*/g, ' to ')
    .replace(/\s*←\s*/g, ' from ')
    .replace(/\s*·\s*/g, ', ')
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s*[–—]\s*/g, ' to ')
    .replace(/&/g, ' and ')
    .replace(/%/g, ' percent')
    .replace(/\s*≈\s*/g, ' approximately ')
    .replace(EMOJI, '');
  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);
  out = verbalizeNumbers(out);
  return out
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,.;:!?])(?=[^\s\d])/g, '$1 ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

/**
 * Sentence-sized utterances, in order.
 *
 * One utterance per sentence keeps the first sound quick and gives `Stop` a boundary to cut on. A
 * sentence longer than `maxChars` is split at a comma, then at a space — never mid-word — and the
 * concatenation of the result contains every word of the input.
 */
export function speechSegments(text: string, maxChars = 180): string[] {
  const limit = Math.max(60, Math.round(maxChars));
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.split(/(?<=[.!?।])\s+/).map((part) => part.trim()).filter(Boolean);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (sentence.length <= limit) {
      out.push(sentence);
      continue;
    }
    let rest = sentence;
    while (rest.length > limit) {
      const window = rest.slice(0, limit + 1);
      let cut = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '), window.lastIndexOf(': '));
      if (cut >= Math.floor(limit * 0.45)) cut += 1;
      else cut = window.lastIndexOf(' ');
      if (cut <= 0) cut = limit;
      const piece = rest.slice(0, cut).trim();
      if (piece) out.push(piece);
      rest = rest.slice(cut).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * The language of THIS text.
 *
 * Devanagari is unambiguously Hindi and Latin text is English — except Roman Hinglish, which is Latin
 * text that happens to be Hindi. That case follows the learner's explicit `hi` choice instead of
 * pretending the script decides it; English technical vocabulary inside a Hinglish sentence keeps its
 * Latin spelling, which is what a multilingual voice handles best.
 */
export function speechLanguage(text: string, preference: SpeechPreference = 'auto'): VoiceLocale {
  return resolveLocale(preference, text);
}
