/**
 * The one vocabulary the voice surfaces share.
 *
 * Two jobs, both pure so the suite can drive them without a browser:
 *
 *  1. STATE. The engine reports raw facts (a model phase, a download percentage, whether an <audio>
 *     element is really playing). The UI announces exactly one state — "Generating", "Speaking",
 *     "Paused" — and it must never say "Speaking" because a request was sent. `mentorVoiceState`
 *     is that single mapping, and `mentorVoiceLabel` is the single wording.
 *
 *  2. SPEECH TEXT. What Supertonic reads is not what the learner reads: markdown symbols, tables and
 *     arrows are punctuation on screen and gibberish in the ear. `speechText` cleans the reply without
 *     changing its meaning, `speechSegments` cuts it on sentence boundaries so the first sound arrives
 *     quickly and the queue can be interrupted between sentences, and `speechLanguage` decides the
 *     model's own `<hi>`/`<en>` token for the actual characters in front of it.
 *
 * Nothing here invents a sentence: with empty input every function returns empty output.
 */

/** What the browser engine can be doing. `generating` is synthesis, not playback. */
export type MentorVoicePhase =
  | 'idle'
  | 'downloading'
  | 'initializing'
  | 'ready'
  | 'generating'
  | 'speaking'
  | 'paused'
  | 'completed'
  | 'error';

/** One announced state, derived from real signals only. */
export type MentorVoiceState =
  | 'idle'
  | 'loading'
  | 'preparing'
  | 'ready'
  | 'listening'
  | 'generating'
  | 'speaking'
  | 'paused'
  | 'completed'
  | 'error';

export interface MentorVoiceSnapshot {
  phase: MentorVoicePhase;
  /** The microphone is open and the recogniser is running. */
  listening?: boolean;
  /** An <audio> element reported `playing` and has not ended. */
  speaking?: boolean;
  paused?: boolean;
  muted?: boolean;
  /** A request is in flight: the model is producing audio for the next sentence. */
  generating?: boolean;
  error?: string | null;
}

/**
 * The precedence is deliberate: a real failure outranks everything, then the microphone (the learner
 * is talking), then actual playback, then synthesis, then the model's own phase.
 */
export function mentorVoiceState(snapshot: MentorVoiceSnapshot): MentorVoiceState {
  const {
    phase, listening = false, speaking = false, paused = false,
    muted = false, generating = false, error = null,
  } = snapshot;
  if (error || phase === 'error') return 'error';
  if (speaking || phase === 'speaking') return paused ? 'paused' : 'speaking';
  if (paused && phase === 'paused') return 'paused';
  if (listening) return 'listening';
  if (muted && phase === 'ready') return 'ready';
  if (generating || phase === 'generating') return 'generating';
  if (phase === 'downloading') return 'loading';
  if (phase === 'initializing') return 'preparing';
  if (phase === 'completed') return 'completed';
  if (phase === 'ready') return 'ready';
  return 'idle';
}

export type SpeechLocale = 'en' | 'hi';

/** The label under the orb — one line, in the learner's language. */
export function mentorVoiceLabel(state: MentorVoiceState, locale: SpeechLocale = 'en'): string {
  const hi = locale === 'hi';
  switch (state) {
    case 'loading': return hi ? 'Supertonic 3 download ho raha hai…' : 'Downloading Supertonic 3…';
    case 'preparing': return hi ? 'Model taiyar ho raha hai…' : 'Preparing the voice model…';
    case 'ready': return hi ? 'Taiyar hoon' : 'Ready';
    case 'listening': return hi ? 'Sun raha hoon…' : 'Listening…';
    case 'generating': return hi ? 'Awaaz ban rahi hai…' : 'Generating speech…';
    case 'speaking': return hi ? 'Bol raha hoon…' : 'Speaking…';
    case 'paused': return hi ? 'Ruka hua hai' : 'Paused';
    case 'completed': return hi ? 'Jawab poora hua' : 'Finished speaking';
    case 'error': return hi ? 'Voice mein dikkat' : 'Voice unavailable';
    default: return hi ? 'Voice taiyar' : 'Voice on standby';
  }
}

/** The second line: what the state MEANS, never a second status. */
export function mentorVoiceHint(state: MentorVoiceState, locale: SpeechLocale = 'en'): string {
  const hi = locale === 'hi';
  switch (state) {
    case 'loading': return hi
      ? 'Pehli baar model download hota hai, phir cache se turant khulta hai.'
      : 'The model downloads once, then loads from the browser cache.';
    case 'preparing': return hi
      ? 'ONNX sessions ban rahe hain — WebGPU, warna WASM.'
      : 'Opening the ONNX sessions — WebGPU when available, WASM otherwise.';
    case 'ready': return hi ? 'Bolo ya likho — jawab bol kar sunaya jayega.' : 'Speak or type — the answer will be read aloud.';
    case 'listening': return hi ? 'Bolo, main sun raha hoon.' : 'Speak now — the microphone is open.';
    case 'generating': return hi ? 'Pehla vaakya agle hi pal bajega.' : 'The first sentence will start playing shortly.';
    case 'speaking': return hi ? 'Rokna ho to Interrupt dabao.' : 'Press Interrupt to stop the voice.';
    case 'paused': return hi ? 'Resume dabao wahin se sunne ke liye.' : 'Press Resume to continue where it stopped.';
    case 'completed': return hi ? 'Replay se dobara sun sakte ho.' : 'Replay reads it again, no new request.';
    case 'error': return hi ? 'Model load nahi hua — dobara koshish karo.' : 'The model did not start — try again.';
    default: return hi ? 'Awaaz pehli baar bolne par shuru hoti hai.' : 'The engine starts on the first spoken answer.';
  }
}

/* ------------------------------------------------------------------
 * Text → speech
 * ------------------------------------------------------------------ */

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
 * A Devanagari sentence keeps its numerals: the Hindi voice reads `2` as "do", and substituting
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
 * then emphasis, then symbols that are punctuation on screen and words in the ear. Nothing is
 * summarised — the words that remain are the words the learner can see.
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
 * Sentence-sized requests, in order.
 *
 * One request per sentence keeps the first sound quick and gives `Interrupt` a boundary to cut on.
 * A sentence longer than `maxChars` is split at a comma, then at a space — never mid-word — and the
 * concatenation of the result contains every word of `speechText(text)`.
 */
export function speechSegments(text: string, maxChars = 220): string[] {
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

/** What the learner chose in the selector: `auto` resolves from the text of each answer. */
export type SpeechPreference = 'auto' | 'en' | 'hi';

const HINDI_ROMAN =
  /\b(kya|kaise|kyun|kyon|karna|karo|karega|batao|bata|samajh|samjha|nahi|nhi|hai|hain|hoon|mera|tum|aap|kuch|abhi|phir|lekin|matlab|bilkul|theek|thik|acha|accha|yaar|chahiye|hoga|hogi|karte|karta)\b/i;

/**
 * The model's own language token for THIS text.
 *
 * Devanagari is unambiguously Hindi and Latin text is English — except Roman Hinglish, which is Latin
 * text that happens to be Hindi. That case follows the learner's explicit `hi` choice instead of
 * pretending the script decides it; English technical vocabulary inside a Hinglish sentence keeps its
 * Latin spelling, which is exactly how the model's multilingual training treats a code-switch.
 */
export function speechLanguage(text: string, preference: SpeechPreference = 'auto'): SpeechLocale {
  const value = String(text ?? '');
  if (/[\u0900-\u097F]/u.test(value)) return 'hi';
  if (preference === 'hi') return 'hi';
  if (preference === 'en') return 'en';
  return preference === 'auto' && HINDI_ROMAN.test(value) ? 'hi' : 'en';
}

/** The voice line: engine name, language and preset, with no promise the model cannot keep. */
export function speechEngineNote(preset: string, locale: SpeechLocale = 'en'): string {
  return locale === 'hi'
    ? `Supertonic 3 · preset ${preset} · Hindi + English, browser mein generate hota hai.`
    : `Supertonic 3 · preset ${preset} · Hindi + English, generated in this browser.`;
}
