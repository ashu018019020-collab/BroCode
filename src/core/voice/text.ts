/**
 * The model's front door: text in, integer ids and a mask out.
 *
 * This is a direct port of `UnicodeProcessor` from the official SDK
 * (`supertonic/core.py`, package 1.3.1) — the same normalisation order, the same symbol table,
 * the same `<lang>…</lang>` wrapper and the same `unicode_indexer.json` lookup. It has to be a
 * faithful port rather than "something reasonable": the character classes are what the text
 * encoder was trained on, so a missing replacement step reads as noise, and an extra one silently
 * changes pronunciation. `scripts/tests/supertonic-voice.test.mjs` pins the behaviour against the
 * Python implementation's own examples.
 *
 * Pure by contract: no DOM, no network, no model. That is what lets the suite drive it directly.
 */

/** The two languages BroCode speaks. The model's own codes, not the UI's `hi-IN`/`en-IN`. */
export type SpeechLang = 'hi' | 'en';

/** One entry per Unicode code point; `-1` means the model has no class for it. */
export type UnicodeIndexer = ReadonlyArray<number>;

const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}]+/gu;

/** The SDK's `_SYMBOL_REPLACEMENTS`, verbatim — dashes, curly quotes, and the ASCII that reads badly. */
const SYMBOL_REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ['\u2013', '-'], ['\u2011', '-'], ['\u2014', '-'], ['\u00af', ' '], ['_', ' '],
  ['\u201c', '"'], ['\u201d', '"'], ['\u2018', "'"], ['\u2019', "'"], ['\u00b4', "'"],
  ['`', "'"], ['[', ' '], [']', ' '], ['|', ' '], ['/', ' '], ['#', ' '], ['\u2192', ' '], ['\u2190', ' '],
];

const SPECIAL_SYMBOLS = /[♥☆♡©\\]/gu;

const PUNCTUATION_SPACING: ReadonlyArray<readonly [RegExp, string]> = [
  [/ ,/gu, ','], [/ \./gu, '.'], [/ !/gu, '!'], [/ \?/gu, '?'],
  [/ ;/gu, ';'], [/ :/gu, ':'], [/ '/gu, "'"],
];

const DUPLICATE_QUOTES = /(["'`])\1+/gu;
const WHITESPACE = /\s+/gu;
/** If the text already ends in punctuation (or a closing bracket/quote) the SDK adds no full stop. */
const ENDING_PUNCTUATION = /[.!?;:,'")\]}…。」』】〉》›»]$/u;

/**
 * One pass of the SDK's `_preprocess_text`, minus the language wrapper.
 *
 * NFKD first, exactly as the SDK does: it decomposes `é` into `e` + combining accent, and the
 * indexer has a class for the combining mark. Skipping it (NFC) would send a code point the model
 * never saw in training.
 */
export function normalizeForModel(text: string): string {
  let value: string;
  try {
    // Some engines throw on lone surrogates; the SDK continues without normalisation there too.
    value = text.normalize('NFKD');
  } catch {
    value = text;
  }
  value = value.replace(EMOJI, '');
  for (const [from, to] of SYMBOL_REPLACEMENTS) value = value.split(from).join(to);
  value = value.replace(SPECIAL_SYMBOLS, '');
  value = value.split('@').join(' at ').split('e.g.,').join('for example, ').split('i.e.,').join('that is, ');
  for (const [pattern, replacement] of PUNCTUATION_SPACING) value = value.replace(pattern, replacement);
  value = value.replace(DUPLICATE_QUOTES, '$1');
  value = value.replace(WHITESPACE, ' ').trim();
  if (!ENDING_PUNCTUATION.test(value)) value += '.';
  return value;
}

/** `hello` → `<en>hello.</en>`. The wrapper is how the multilingual model is told what it is reading. */
export function withLanguageToken(text: string, lang: SpeechLang): string {
  return `<${lang}>${text}</${lang}>`;
}

/** The exact string the model is fed, exposed so a failing request can be reproduced byte-for-byte. */
export function modelText(text: string, lang: SpeechLang): string {
  return withLanguageToken(normalizeForModel(text), lang);
}

/** The indexer's class for a code point, or `-1` when the model has never seen it. */
export function classFor(indexer: UnicodeIndexer, codePoint: number): number {
  const value = indexer[codePoint];
  return typeof value === 'number' ? value : -1;
}

export interface EncodedText {
  /** `text_ids`, row-major `[1, length]`, as the int64 tensor wants it. */
  ids: BigInt64Array;
  /** `text_mask`, `[1, 1, length]`. */
  mask: Float32Array;
  length: number;
  /** Characters the model has no class for — reported, never silently replaced. */
  unsupported: string[];
}

/**
 * Text → the two tensors every graph in the pipeline needs.
 *
 * Unsupported characters map to class `-1`, exactly as the SDK's indexer does (its list carries
 * `-1` entries), rather than being dropped: dropping them would shift every later id and change the
 * sentence's rhythm, while `-1` is the class the model was trained to see for "unknown".
 */
export function encodeText(text: string, lang: SpeechLang, indexer: UnicodeIndexer): EncodedText {
  const prepared = modelText(text, lang);
  const ids = new BigInt64Array(prepared.length);
  const unsupported: string[] = [];
  for (let i = 0; i < prepared.length; i += 1) {
    const codePoint = prepared.codePointAt(i) as number;
    const cls = classFor(indexer, codePoint);
    if (cls < 0) unsupported.push(String.fromCodePoint(codePoint));
    ids[i] = BigInt(cls);
  }
  const mask = new Float32Array(prepared.length);
  mask.fill(1);
  return { ids, mask, length: prepared.length, unsupported: [...new Set(unsupported)] };
}

/**
 * Split a long answer into speakable requests, on sentence boundaries.
 *
 * One request per sentence keeps latency low (the first sentence is heard while the rest is still
 * being generated) and keeps a long answer inside the model's comfortable length. A sentence longer
 * than `maxChars` is cut at a word boundary, never mid-word, and the pieces are joined by the caller
 * in order — so no text is dropped, which is what "no missing words" means here.
 */
export function speechRequests(text: string, maxChars = 320): string[] {
  const clean = text.replace(/\s+/gu, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?।]+[.!?।]*/gu) ?? [clean];
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    if (sentence.length <= maxChars) {
      out.push(sentence);
      continue;
    }
    let line = '';
    for (const word of sentence.split(' ')) {
      if (!word) continue;
      if (line && line.length + word.length + 1 > maxChars) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/**
 * Which language the model should read a chunk in.
 *
 * Devanagari is unambiguously Hindi, Latin is English — that much is reliable. Romanised Hinglish is
 * NOT (it is Latin text that happens to be Hindi), so it is left to the learner's explicit choice:
 * this returns the chosen language when the script does not decide it, instead of pretending.
 */
export function languageForChunk(chunk: string, chosen: SpeechLang): { lang: SpeechLang; decided: boolean } {
  if (/[\u0900-\u097F]/u.test(chunk)) return { lang: 'hi', decided: true };
  if (/[A-Za-z]/.test(chunk)) return { lang: 'en', decided: true };
  return { lang: chosen, decided: false };
}
