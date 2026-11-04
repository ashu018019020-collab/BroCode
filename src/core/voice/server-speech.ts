/**
 * Turning one mentor answer into the sentences the DEPLOYMENT's AI voice will read.
 *
 * The server route (`POST /api/voice/tts`) is Azure AI Speech: `hi-IN-SwaraNeural` for Hindi and
 * Hinglish, `en-IN-NeerjaNeural` for English. It caps a request at 600 characters, so an answer has
 * to be split here — before any network call — and each piece has to carry the language whose voice
 * should read it. That is the whole job of this module, and it is pure so the suite can drive it.
 *
 * Two rules that are easy to get wrong:
 *
 *  · The Hindi/English split is PER SENTENCE, not per answer. A Hinglish reply mixes both, and
 *    handing Devanagari to an English voice is the failure learners report as "the AI voice is bad".
 *  · Nothing is dropped or reordered. Concatenating the plan gives back the cleaned answer, so the
 *    audio reads the same words that are on screen.
 */

import { speechSegments } from './speech-processor';
import { planSpeech } from './voice-profile';
import type { VoiceLanguagePreference } from './voice-types';

/** The route's documented ceiling is 600; the margin is for the space this module joins with. */
export const SERVER_CHUNK_CHARS = 480;

export interface ServerSpeechChunk {
  text: string;
  /** Exactly the `lang` value the TTS route accepts. */
  lang: 'hi-IN' | 'en-IN';
}

/**
 * The plan for one answer. Empty input is an empty plan — never a placeholder sentence.
 * Adjacent sentences in the same language are merged up to the limit, so a five-sentence English
 * answer is one request instead of five, while a Hindi sentence still gets the Hindi voice.
 */
export function planServerSpeech(
  text: string,
  preference: VoiceLanguagePreference = 'auto',
): ServerSpeechChunk[] {
  const plan = planSpeech(text, preference);
  const chunks: ServerSpeechChunk[] = [];

  for (const segment of plan.segments) {
    const lang: ServerSpeechChunk['lang'] = segment.lang === 'hi' ? 'hi-IN' : 'en-IN';
    // `planSpeech` already cleaned the text once; splitting again only shortens the pieces.
    for (const piece of speechSegments(segment.text, SERVER_CHUNK_CHARS)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      const last = chunks[chunks.length - 1];
      if (last && last.lang === lang && last.text.length + trimmed.length + 1 <= SERVER_CHUNK_CHARS) {
        last.text = `${last.text} ${trimmed}`;
      } else {
        chunks.push({ text: trimmed, lang });
      }
    }
  }

  return chunks;
}

/** What the panel says about the voice that actually spoke, or '' when it is not known. */
export function serverVoiceLine(configured: boolean, voiceId: string | null): string {
  if (!configured) return '';
  if (!voiceId) return 'AI voice · generated on the server.';
  const name = /^[a-z]{2}-[A-Z]{2}-([A-Za-z]+?)Neural$/.exec(voiceId)?.[1] ?? voiceId;
  return `AI voice · ${name} · generated on the server, not the device.`;
}
