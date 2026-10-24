/**
 * The spoken layer of the assistant.
 *
 * Everything here is pure: it turns text the app ALREADY has (an answer, a lesson, the current-page
 * context) into something a speech synthesiser can read without sounding like a stack trace. It never
 * writes copy of its own — the briefing can only name a course, a lesson, a progress figure or an
 * error that the caller actually passed in, which is the same honesty rule the rest of `core/ai`
 * follows. With no context it says so instead of guessing.
 *
 * Two practical constraints shape the chunking:
 *
 *  - Chrome cuts a single `speak()` utterance off after roughly 15 seconds, so a 900-character answer
 *    is spoken as several short utterances in order. That is also what makes "Stop" feel immediate.
 *  - Code is not English. A fenced block is announced as "code example" rather than read character by
 *    character (`[` ... "bracket"), and inline code keeps its identifier because `len(seq)` is how a
 *    learner says it aloud.
 */
import type { Section } from '../../types';
import type { AssistantContext } from './assistant';

export type VoiceLangId = 'en-IN' | 'hi-IN';

export interface VoiceLang {
  id: VoiceLangId;
  /** The label the learner sees — never translated (see the language selector's own note). */
  label: string;
  hint: string;
}

export const VOICE_LANGS: VoiceLang[] = [
  { id: 'en-IN', label: 'English', hint: 'English voice and English explanations' },
  { id: 'hi-IN', label: 'Hinglish', hint: 'Hindi voice, Hinglish explanations' },
];

export const DEFAULT_VOICE_LANG: VoiceLangId = 'en-IN';
export const DEFAULT_RATE = 1;
export const MIN_RATE = 0.7;
export const MAX_RATE = 1.4;

export type VoiceStatus = 'off' | 'listening' | 'thinking' | 'speaking';

export function normalizeVoiceLang(value: unknown): VoiceLangId {
  return VOICE_LANGS.some((lang) => lang.id === value) ? (value as VoiceLangId) : DEFAULT_VOICE_LANG;
}

/** Narration speed is clamped, not validated: a slider can never produce a 0.05x voice. */
export function clampRate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_RATE;
  return Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, n)) * 10) / 10;
}

/**
 * Markdown → readable text.
 *
 * Order matters: fenced blocks go first (before the inline-backtick rule can eat their braces), then
 * links, then emphasis, then the symbols that are punctuation on screen and words in the ear
 * (`→` is "to"; `·` is a comma; a table pipe is a comma).
 */
const REWRITES: [RegExp, string][] = [
  [/```[a-z]*\n?[\s\S]*?```/gi, ' code example '],
  [/`([^`]+)`/g, '$1'],
  [/!\[[^\]]*\]\([^)]*\)/g, ''],
  [/\[([^\]]+)\]\([^)]*\)/g, '$1'],
  [/https?:\/\/\S+/g, ' a link '],
  [/\*\*([^*]+)\*\*/g, '$1'],
  [/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2'],
  [/^\s{0,3}#{1,6}\s*/gm, ''],
  [/^\s*[-*•]\s+/gm, ''],
  [/^\s*>\s?/gm, ''],
  [/\s*→\s*/g, ' to '],
  [/\s*·\s*/g, ', '],
  [/\s*\|\s*/g, ', '],
  [/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, ''],
];

export function speakable(text: string): string {
  let out = String(text ?? '');
  for (const [pattern, replacement] of REWRITES) out = out.replace(pattern, replacement);
  return out
    .replace(/\s+([,.;:!?])/g, '$1')
    // A space after punctuation, but never inside a number: "1.5" is a speed, not a sentence end.
    .replace(/([,.;:!?])(?=[^\s\d])/g, '$1 ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split one over-long sentence. Comma/semicolon/colon boundaries first (they are where a teacher
 * pauses), a plain space only when there is no punctuation to use, and the hard cap as the last
 * resort so a 300-character token cannot spin forever.
 */
function splitLong(sentence: string, maxLen: number): string[] {
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > maxLen) {
    const head = rest.slice(0, maxLen + 1);
    let cut = -1;
    for (const sep of [', ', '; ', ': ']) cut = Math.max(cut, head.lastIndexOf(sep));
    if (cut >= Math.floor(maxLen * 0.4)) cut += 1;
    else cut = head.lastIndexOf(' ');
    if (cut <= 0) cut = maxLen;
    const piece = rest.slice(0, cut).trim();
    if (piece) pieces.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * The utterances to queue, in order. Every one is at most `maxLen` characters, and joining them back
 * with spaces reproduces `speakable(text)` exactly — nothing is dropped silently.
 */
export function speechChunks(text: string, maxLen = 180): string[] {
  const limit = Math.max(60, Math.round(maxLen));
  const clean = speakable(text);
  if (!clean) return [];
  const chunks: string[] = [];
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    chunks.push(...splitLong(trimmed, limit));
  }
  return chunks;
}

/**
 * What to say for a full answer: the opening sentences (bounded), plus where the rest lives.
 *
 * The whole answer is on screen and long answers stay there; reading 1,200 characters aloud is not
 * teaching, it is a wait. The truncation is announced rather than hidden — a learner should never
 * think the answer ended where the voice stopped.
 */
export function spokenReply(
  text: string,
  sources: { title: string }[] = [],
  maxChars = 620,
): string {
  const clean = speakable(text);
  if (!clean) return '';
  let spoken = '';
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    const candidate = spoken ? `${spoken} ${sentence}` : sentence;
    if (spoken && candidate.length > maxChars) break;
    spoken = candidate;
  }
  const truncated = spoken.length < clean.length;
  if (truncated) spoken = `${spoken} ${spoken.endsWith('.') ? '' : '. '}The rest is written on screen.`.trim();
  const source = sources[0]?.title?.trim();
  if (source) spoken = `${spoken} Source: ${source}.`;
  return spoken.replace(/\s{2,}/g, ' ').trim();
}

/* ------------------------------ the speech engine ------------------------------ */

/** The fields of `SpeechSynthesisVoice` this layer actually reads — plain data, so ranking is pure. */
export interface VoiceLike {
  name: string;
  lang: string;
  localService?: boolean;
}

const GOOGLE_BRAND = /^google\b/i;

/**
 * The browser voice to speak this language with.
 *
 * Ranking, highest first — and never across a language boundary, so a beautiful voice in the wrong
 * language always loses to a plain one in the right language:
 *
 *  1. exact language match + Google's own voice (Chrome ships "Google हिन्दी" and the Google
 *     English voices — the most natural speech a browser offers without a server),
 *  2. exact match + any local voice,
 *  3. exact match + any other voice (Chrome's Google voices are network voices, not localService —
 *     preferring `localService` first, as this app used to, is exactly what pushed learners onto
 *     Microsoft's robotic Windows voices),
 *  4. same language family, same order.
 */
export function pickVoiceFrom(voices: VoiceLike[], lang: VoiceLangId): VoiceLike | null {
  const wanted = lang.toLowerCase();
  const twoLetter = wanted.slice(0, 2);
  const matches = voices.filter((voice) => {
    const code = voice.lang.replace('_', '-').toLowerCase();
    return code === wanted || code.startsWith(`${twoLetter}-`) || code === twoLetter;
  });
  if (!matches.length) return null;
  const score = (voice: VoiceLike): number => {
    const code = voice.lang.replace('_', '-').toLowerCase();
    const language = code === wanted ? 0 : 10;
    const brand = GOOGLE_BRAND.test(voice.name) ? 0 : 5;
    const local = voice.localService ? 0 : 1;
    return language + brand + local;
  };
  return [...matches].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name))[0] ?? null;
}

/**
 * What engine is actually speaking — the settings line, and the one place the plumbing is named.
 *
 * `cloudConfigured` is what the SERVER reported (null while unknown): the label must never promise
 * Google audio the deployment does not have, and a mid-session failure is shown as the fallback it
 * is rather than hidden.
 */
export function ttsEngineNote(
  engine: 'cloud' | 'browser' | null,
  cloudConfigured: boolean | null,
): string {
  if (engine === 'cloud') return 'Speaking with the Google Neural2 voice (online).';
  if (engine === 'browser' && cloudConfigured === true) {
    return 'Google voice is busy — using the built-in browser voice for this answer.';
  }
  if (cloudConfigured === true) return 'Google Neural2 voice ready · browser voice as the offline fallback.';
  if (cloudConfigured === false) return 'Browser voice (this server has no Google voice configured).';
  return 'Checking the voice engine…';
}

/** The line under the mic button. One state, one short label. */
export function voiceStatusLabel(status: VoiceStatus, lang: VoiceLangId): string {
  const hi = lang === 'hi-IN';
  switch (status) {
    case 'listening': return hi ? 'Sun raha hoon…' : 'Listening…';
    case 'thinking': return hi ? 'Soch raha hoon…' : 'Thinking…';
    case 'speaking': return hi ? 'Bol raha hoon…' : 'Speaking…';
    default: return hi ? 'Voice off' : 'Voice off';
  }
}

/**
 * What the browser can actually do.
 *
 * Speech recognition is Chromium-only and, on Chrome, its transcription runs through Google's
 * servers — so this app treats it as progressive enhancement. Saying that plainly is better than a
 * mic button that does nothing on Firefox.
 */
export function voiceSupportNote(support: { synthesis: boolean; recognition: boolean }): string {
  if (support.synthesis && support.recognition) return '';
  if (support.synthesis) {
    return 'This browser has no speech recognition, so voice input is unavailable here. Spoken answers and "Read lesson" still work.';
  }
  if (support.recognition) {
    return 'This browser has no speech synthesis, so answers cannot be read aloud. Voice input still works.';
  }
  return 'This browser supports neither speech input nor speech output. The assistant still works by typing.';
}

/**
 * "Explain this screen" — built ONLY from what the caller passed in.
 *
 * Every clause maps to a field: `where`/`pageTitle` say where the learner is, `progressSummary` is
 * the measured figure `context.ts` computed, `error`/`question` are the real things on the page. When
 * `where` is empty there is nothing to explain, so it asks instead of narrating a guess.
 */
export function screenBriefing(
  context: AssistantContext | undefined,
  lang: VoiceLangId,
  next?: { label?: string; reason?: string },
): string {
  const hi = lang === 'hi-IN';
  const place = (context?.where || [context?.courseTitle, context?.pageTitle].filter(Boolean).join(' · ') || context?.pageTitle || '').trim();
  if (!place) {
    return hi
      ? 'Is screen ka context nahi mila, isliye main guess nahi karunga. Batao kis lesson ya topic mein madad chahiye.'
      : 'I could not read this page’s context, so I will not guess. Tell me which lesson or topic you need help with.';
  }

  const parts: string[] = [];
  parts.push(hi ? `Abhi tum ${place} par ho.` : `You are on ${place}.`);

  if (context?.progressSummary) {
    parts.push(hi ? `Progress: ${context.progressSummary}.` : `Progress: ${context.progressSummary}.`);
  }
  if (context?.question?.text) {
    const brief = context.question.text.replace(/\s+/g, ' ').trim().slice(0, 120);
    parts.push(hi ? `Screen par yeh sawal hai: ${brief}` : `The question on screen is: ${brief}`);
  }
  if (context?.error) {
    parts.push(hi
      ? 'Ek cell fail hua hai — error screen par hai. "Fix this mistake" dabao, main line bata dunga.'
      : 'A cell failed — the error is on the screen. Press "Fix this mistake" and I will point at the line.');
  }
  if (next?.label) {
    parts.push(hi ? `Agla step: ${next.label}.` : `Next step: ${next.label}.`);
    if (next.reason) parts.push(next.reason.endsWith('.') ? next.reason : `${next.reason}.`);
  }
  parts.push(hi ? 'Bolo, kya samjhana hai?' : 'Ask me what to explain.');
  return parts.join(' ');
}

/**
 * "Read this lesson" — the authored lesson, in order: concepts, their tips, the recap.
 *
 * This is the page reading feature done honestly: it is the section's real content (the same objects
 * the Learn stage renders), not a summary generated somewhere else. No section means no lesson.
 */
/**
 * Curriculum prose is authored line by line, not sentence by sentence — a recap is several lines with
 * no closing punctuation, which a synthesiser reads as one endless sentence ("== compare karta hai
 * Main types: ..."). This closes each line that needs it so the voice pauses between ideas.
 */
function endPunct(line: string): string {
  return /[.!?:]$/.test(line) ? line : `${line}.`;
}

function joinedLines(text: string | undefined): string {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(endPunct)
    .join(' ');
}

export function lessonScript(section: Section | null | undefined, lang: VoiceLangId): string {
  const hi = lang === 'hi-IN';
  if (!section) {
    return hi
      ? 'Abhi koi lesson open nahi hai. Pehle Courses se koi lesson kholo, phir main use padhkar sunaunga.'
      : 'No lesson is open right now. Open one from Courses and I will read it aloud.';
  }

  const concepts = (section.learn?.concepts ?? []).filter((concept) => concept?.body?.trim() || concept?.title?.trim());
  const titles = concepts.map((concept) => concept.title?.trim()).filter((title): title is string => !!title);
  const parts: string[] = [];

  parts.push(hi
    ? `Lesson: ${section.title}.`
    : `Lesson: ${section.title}.`);
  if (titles.length) {
    parts.push(hi
      ? `Is lesson mein hum ${titles.join(', ')} cover karte hain.`
      : `This lesson covers ${titles.join(', ')}.`);
  }
  const first = concepts.find((concept) => (concept.body ?? '').trim());
  if (first) {
    const body = (first.body ?? '').replace(/\s+/g, ' ').trim();
    parts.push(`${first.title ? `${first.title}. ` : ''}${body.slice(0, 520)}`);
    if (first.tip?.trim()) parts.push(`Tip: ${first.tip.trim()}`);
  }
  const remember = (section.learn?.remember ?? []).map((line) => line.trim()).filter(Boolean).slice(0, 2).map(endPunct);
  if (remember.length) parts.push(`${hi ? 'Yaad rakho' : 'Remember'}: ${remember.join(' ')}`);
  const recap = joinedLines(section.learn?.recap);
  if (recap) parts.push(`Recap: ${recap}`);
  parts.push(hi ? 'Ab bolo kaunsa part dobara samjhana hai.' : 'Ask me to explain any part again.');
  return parts.join(' ').replace(/\s{2,}/g, ' ').trim();
}
