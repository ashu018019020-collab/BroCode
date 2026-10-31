/**
 * Which language a chunk is written in.
 *
 * The model takes one language tag per request, so a mixed answer is split by SCRIPT rather than
 * guessed at. Devanagari is unambiguously Hindi and Latin is English — that much is reliable.
 * Romanised Hinglish is NOT (it is Latin text that happens to be Hindi), so it is left to the
 * learner's explicit choice instead of being silently re-tagged.
 *
 * Pure by contract: no DOM, no network. The server does the rest (normalisation, tokenisation and
 * the graphs), which is why none of that lives in the browser any more.
 */

/** The model's own codes, not the UI's `hi-IN`/`en-IN`. */
export type SpeechLang = 'hi' | 'en';

export function languageForChunk(chunk: string, chosen: SpeechLang): { lang: SpeechLang; decided: boolean } {
  if (/[\u0900-\u097F]/u.test(chunk)) return { lang: 'hi', decided: true };
  if (/[A-Za-z]/.test(chunk)) return { lang: 'en', decided: true };
  return { lang: chosen, decided: false };
}
