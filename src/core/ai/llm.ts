/**
 * The optional AI engine, and the honest boundary around it.
 *
 * The mentor answers from the bundled curriculum (`askLocal` + `mentorTurn`) and keeps working with
 * zero network. This module adds the second engine: it sends the learner's question TOGETHER WITH the
 * retrieved lesson excerpts to the server-side proxy (`/api/chat`), which is the only place a model
 * key exists. Two rules make that safe to bolt on:
 *
 *  · A failure is a `null`, never a thrown error. Not deployed, no key, offline, slow, empty reply —
 *    the caller keeps the local answer. A missing model must never look like a broken chat.
 *  · It is grounded, not fine-tuned. "Train the bot" here means: never ask the model to remember the
 *    course, hand it the course. The excerpts travel in the prompt, so the same model cannot drift
 *    away from what the lessons actually say.
 *
 * Pure besides `fetch` (injectable), so the suite drives every branch with plain objects.
 */

import { retrieveKnowledge, type KnowledgeContext, type KnowledgeIndex } from './knowledge';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmStatus {
  configured: boolean;
  model: string | null;
}

export interface LlmAnswer {
  text: string;
  model: string | null;
}

export interface LlmOptions {
  /** The preference the learner chose; `auto` lets the question's own language decide. */
  lang?: string;
  /** The last few turns, so "iska example do" has something to point at. */
  history?: { role: 'learner' | 'mentor'; text: string }[];
  /** Curriculum excerpts to ground this answer. Empty is allowed — the prompt then says so. */
  passages?: string[];
  signal?: AbortSignal;
}

/** Everything the module touches outside itself, so tests never hit a real network. */
export interface LlmDeps {
  fetch?: typeof fetch;
}

const ENDPOINT = '/api/chat';
const STATUS_TIMEOUT_MS = 2000;
const ANSWER_TIMEOUT_MS = 20000;
const HISTORY_TURNS = 4;
const PASSAGE_LIMIT = 4;
const PASSAGE_CHARS = 900;
const REPLY_CHARS = 2400;

/** The tutor's contract. Deliberately short: a long prompt is where small models start padding. */
const SYSTEM_PROMPT = [
  'You are BroCode AI Mentor, a patient tutor for an Indian learner studying Python, AI engineering, data and web development.',
  'The CURRICULUM EXCERPTS below are the course this learner owns. When they cover the question, answer from them and stay consistent with them.',
  'When they do not cover it, say so in one short line and then answer from general knowledge — never invent a lesson name, page number or link.',
  'Mirror the learner\'s language: a Hinglish question gets simple Hinglish, an English question gets English. Hindi text in Devanagari stays Hindi.',
  'Be concrete, use the learner\'s own words, and stay under 140 words unless the question needs steps.',
].join('\n');

/**
 * The excerpts for this question, as plain text the model can quote.
 * Titles are included because a learner recognises the lesson by its name, and the answer ends up
 * next to source chips built from the SAME retrieval.
 */
export function passagesFor(
  index: KnowledgeIndex | null | undefined,
  question: string,
  context: KnowledgeContext = {},
): string[] {
  if (!index) return [];
  return retrieveKnowledge(index, question, context, PASSAGE_LIMIT)
    .map((hit) => {
      const document = hit.document;
      const body = [document.body, document.answer, document.explanation]
        .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        .join(' ');
      if (!body) return '';
      return `[${document.title}${document.sectionId ? ` · ${document.sectionId}` : ''}]\n${body.slice(0, PASSAGE_CHARS)}`;
    })
    .filter((passage) => passage.length > 0);
}

export function buildMessages(question: string, options: LlmOptions = {}): LlmChatMessage[] {
  const passages = (options.passages ?? []).filter((passage) => passage.trim().length > 0);
  const grounding = passages.length
    ? `CURRICULUM EXCERPTS:\n\n${passages.join('\n\n')}`
    : 'CURRICULUM EXCERPTS: (nothing in the course matched this question)';
  const messages: LlmChatMessage[] = [{ role: 'system', content: `${SYSTEM_PROMPT}\n\n${grounding}` }];
  if (options.lang === 'hi') {
    messages.push({ role: 'system', content: 'The learner is reading Hindi/Hinglish right now; keep the answer in Hinglish.' });
  }
  const history = (options.history ?? []).slice(-HISTORY_TURNS);
  for (const turn of history) {
    if (!turn?.text?.trim()) continue;
    messages.push({ role: turn.role === 'learner' ? 'user' : 'assistant', content: turn.text.slice(0, 700) });
  }
  messages.push({ role: 'user', content: question.slice(0, 1200) });
  return messages;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    // A dev server without the function answers the SPA's index.html with status 200.
    return null;
  }
}

function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

/** Is a model actually configured on this deployment? Cached for the session by the caller. */
export async function llmStatus(deps: LlmDeps = {}): Promise<LlmStatus> {
  const doFetch = deps.fetch ?? (typeof fetch === 'undefined' ? null : fetch);
  if (!doFetch) return { configured: false, model: null };
  const { signal, done } = withTimeout(undefined, STATUS_TIMEOUT_MS);
  try {
    const response = await doFetch(ENDPOINT, { method: 'GET', headers: { Accept: 'application/json' }, signal });
    if (!response.ok) return { configured: false, model: null };
    const data = await readJson(response);
    if (!data || data.configured !== true) return { configured: false, model: null };
    return { configured: true, model: typeof data.model === 'string' ? data.model : 'AI' };
  } catch {
    return { configured: false, model: null };
  } finally {
    done();
  }
}

/**
 * One grounded answer, or `null` when the model is unavailable for ANY reason.
 * The caller decides what to show; this module never invents a fallback answer.
 */
export async function askLlm(
  question: string,
  options: LlmOptions = {},
  deps: LlmDeps = {},
): Promise<LlmAnswer | null> {
  const text = question.trim();
  if (!text) return null;
  const doFetch = deps.fetch ?? (typeof fetch === 'undefined' ? null : fetch);
  if (!doFetch) return null;

  const { signal, done } = withTimeout(options.signal, ANSWER_TIMEOUT_MS);
  try {
    const response = await doFetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ messages: buildMessages(text, options) }),
      signal,
    });
    if (!response.ok) return null;
    const data = await readJson(response);
    const reply = data && typeof data.reply === 'string' ? data.reply.trim() : '';
    if (!reply) return null;
    return {
      text: reply.slice(0, REPLY_CHARS),
      model: typeof data?.model === 'string' ? data.model : null,
    };
  } catch {
    return null;
  } finally {
    done();
  }
}
