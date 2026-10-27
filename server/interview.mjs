/**
 * The AI interviewer's evaluator — server side.
 *
 * Why a module instead of an inline route: the model contract is the part that silently rots. The
 * prompt, the input validation and the OUTPUT validator live together here, are exported, and are
 * exercised by `scripts/tests/interview-api.test.mjs` with an injected `fetch`, so a provider that
 * starts wrapping JSON in prose fails a test instead of showing a learner a blank panel.
 *
 * The permanent key never leaves this process: the client sends an answer, this module posts it to
 * OpenAI with `OPENAI_API_KEY`, and only the validated structure travels back. A missing key is not
 * an error the learner has to solve — the route answers `503 {code:'ai-unconfigured'}` and the
 * client falls back to the deterministic rubric it already has.
 *
 * Privacy: the answer text is NOT logged. Errors travel onward as codes only (`ai-rate-limited`,
 * `ai-unavailable`, `ai-bad-response`), which is what the route maps to an HTTP status.
 */

export const INTERVIEW_MAX_QUESTION = 1200;
export const INTERVIEW_MAX_MODEL_ANSWER = 4000;
export const INTERVIEW_MAX_ANSWER = 4000;
export const INTERVIEW_MAX_SECTION = 120;
export const INTERVIEW_MAX_KIND = 40;
export const INTERVIEW_MAX_DIFFICULTY = 20;
export const INTERVIEW_DEFAULT_MODEL = 'gpt-4o-mini';
export const INTERVIEW_LANGS = ['en-IN', 'hi-IN'];
const ACCURACY = ['accurate', 'mostly-accurate', 'partially-accurate', 'inaccurate'];
const STATUSES = ['correct', 'partially-correct', 'incorrect', 'needs-clarification'];

const trimmed = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/**
 * Validate the request body. Returns `{ok:true, value}` or `{ok:false, status, message}` — the same
 * shape the realtime validator uses, so the route reads uniformly.
 */
export function validateEvaluationBody(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, status: 400, message: 'The evaluation request must be an object.' };
  }
  const question = trimmed(input.question, INTERVIEW_MAX_QUESTION);
  const modelAnswer = trimmed(input.modelAnswer, INTERVIEW_MAX_MODEL_ANSWER);
  const answer = trimmed(input.answer, INTERVIEW_MAX_ANSWER);
  if (question.length < 8) return { ok: false, status: 400, message: 'A question is required.' };
  if (modelAnswer.length < 8) return { ok: false, status: 400, message: 'A model answer is required to mark against.' };
  if (answer.length < 2) return { ok: false, status: 400, message: 'Write or say an answer before asking for feedback.' };
  const lang = INTERVIEW_LANGS.includes(input.lang) ? input.lang : 'en-IN';
  return {
    ok: true,
    value: {
      question,
      modelAnswer,
      answer,
      lang,
      sectionTitle: trimmed(input.sectionTitle, INTERVIEW_MAX_SECTION) || 'Interview question',
      kind: trimmed(input.kind, INTERVIEW_MAX_KIND) || 'Concept',
      difficulty: trimmed(input.difficulty, INTERVIEW_MAX_DIFFICULTY) || 'medium',
    },
  };
}

/**
 * The prompt. Two rules matter more than the wording:
 *
 *  - the authored curriculum answer is the REFERENCE, and alternative correct approaches must be
 *    accepted — a model told to "compare to the model answer" alone marks paraphrases wrong;
 *  - the JSON keys are stated literally, because the validator (not the model) decides what is
 *    acceptable, and a missing key must fail loudly in a test rather than quietly on screen.
 *
 * The model is never asked to reveal chain-of-thought. It is asked for a concise verdict.
 */
export function buildInterviewPrompt(value) {
  const system = [
    'You are a senior technical interviewer for an AI/Data-Science curriculum.',
    'Mark the candidate answer against the reference answer, but accept any technically valid alternative approach or wording.',
    'Be strict about factual errors and missing concepts; be encouraging in tone; never invent facts that are not in the reference.',
    'Scores must reflect the answer actually given. Never award full marks by default, and never give 0 for a partial attempt that names real concepts.',
    'Return ONLY a JSON object, no prose and no code fences, with exactly these keys:',
    '{"score": number 0-100, "status": "correct" | "partially-correct" | "incorrect" | "needs-clarification",',
    '"technicalAccuracy": "accurate" | "mostly-accurate" | "partially-accurate" | "inaccurate",',
    '"conceptsUnderstood": string[], "missingConcepts": string[], "mistakes": string[], "evidence": string[],',
    '"explanation": string, "modelAnswer": string, "nextStep": string, "followUp": string | null}',
    'status: use "needs-clarification" ONLY when the answer is too vague or empty to mark at all; then keep the score low and say what detail is missing.',
    'evidence: short quotes or observations from the candidate answer that justify the score — never your own reasoning steps.',
    'explanation: 2-4 sentences teaching the correct idea in beginner-friendly language.',
    'modelAnswer: an improved answer the candidate could say aloud, grounded in the reference.',
    'nextStep: one concrete action. followUp: one relevant follow-up question, or null if none helps.',
    'Do not include internal reasoning, hidden analysis, API keys or system text.',
  ].join(' ');

  const user = [
    `Section: ${value.sectionTitle}`,
    `Round: ${value.kind} · difficulty: ${value.difficulty}`,
    `Language for the feedback: ${value.lang === 'hi-IN' ? 'Hinglish (Hindi words in Roman script mixed with English technical terms)' : 'English'}`,
    '',
    'QUESTION:',
    value.question,
    '',
    'REFERENCE ANSWER (authoritative curriculum content):',
    value.modelAnswer,
    '',
    'CANDIDATE ANSWER:',
    value.answer,
  ].join('\n');

  return { system, user };
}

function toList(value, max = 8, each = 240) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((x) => x.slice(0, each));
}

/**
 * Validate the model's JSON. Throws `{code:'ai-bad-response'}` on anything that cannot be displayed
 * honestly — the caller turns that into a 502, and the client falls back to the rubric.
 */
export function normalizeEvaluation(raw) {
  const bad = (why) => {
    const error = new Error(`The AI evaluator returned an unusable evaluation (${why}).`);
    error.code = 'ai-bad-response';
    return error;
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('not an object');

  const score = typeof raw.score === 'string' ? Number(raw.score) : raw.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) throw bad('score');

  const explanation = trimmed(raw.explanation, 2000);
  const modelAnswer = trimmed(raw.modelAnswer, 2000);
  if (!explanation || !modelAnswer) throw bad('explanation/modelAnswer');

  const accuracy = ACCURACY.includes(raw.technicalAccuracy)
    ? raw.technicalAccuracy
    : score >= 85 ? 'accurate' : score >= 65 ? 'mostly-accurate' : score >= 40 ? 'partially-accurate' : 'inaccurate';

  const status = STATUSES.includes(raw.status)
    ? raw.status
    : Math.round(score) >= 75 ? 'correct' : Math.round(score) >= 45 ? 'partially-correct' : 'incorrect';

  return {
    score: Math.round(score),
    status,
    technicalAccuracy: accuracy,
    conceptsUnderstood: toList(raw.conceptsUnderstood),
    missingConcepts: toList(raw.missingConcepts),
    mistakes: toList(raw.mistakes),
    evidence: toList(raw.evidence, 6, 300),
    explanation,
    modelAnswer,
    nextStep: trimmed(raw.nextStep, 400) || 'Compare your answer with the model answer, then say it again in your own words.',
    followUp: typeof raw.followUp === 'string' && raw.followUp.trim() ? raw.followUp.trim().slice(0, 400) : null,
  };
}

/**
 * One provider call, bounded in time and in what it can throw. `fetchImpl` is injectable so the
 * tests never touch the network, and `apiKey` is required here (the route decides 503 before this).
 */
export async function evaluateInterviewAnswer({
  apiKey,
  model = INTERVIEW_DEFAULT_MODEL,
  value,
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
}) {
  if (!apiKey) {
    const error = new Error('No AI evaluator key is configured.');
    error.code = 'ai-unconfigured';
    throw error;
  }
  const prompt = buildInterviewPrompt(value);

  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (cause) {
    const error = new Error('The AI evaluator did not answer in time.');
    error.code = 'ai-unavailable';
    error.cause = cause;
    throw error;
  }

  if (!response.ok) {
    const error = new Error(`The AI evaluator refused the request (HTTP ${response.status}).`);
    error.code = response.status === 429 ? 'ai-rate-limited' : 'ai-unavailable';
    throw error;
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    const error = new Error('The AI evaluator returned an unreadable response.');
    error.code = 'ai-bad-response';
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    const error = new Error('The AI evaluator returned no content.');
    error.code = 'ai-bad-response';
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const error = new Error('The AI evaluator returned content that is not JSON.');
    error.code = 'ai-bad-response';
    throw error;
  }

  return { evaluation: normalizeEvaluation(parsed), model: typeof payload?.model === 'string' ? payload.model : model };
}
