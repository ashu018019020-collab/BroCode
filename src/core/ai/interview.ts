/**
 * The AI interviewer's evaluator — client side.
 *
 * One POST to the account API, one deadline, one validated reply. The provider key never appears
 * here (it lives in the server process; see `server/interview.mjs`), and this module never guesses
 * at an evaluation: when the endpoint is absent, unconfigured, slow or malformed it returns the
 * DETERMINISTIC rubric evaluation and a note that says exactly why. The page then labels the result
 * `Built-in rubric`, so a learner is never told a keyword count is a language model.
 *
 * The static deployment (GitHub Pages) has no `/api` at all. That is a normal, expected state: the
 * request resolves to `api-unreachable`, the rubric answers, and the interview keeps working.
 */
import { apiJson } from '../auth/client';
import type { QuestionRecord } from '../data/schema';
import {
  fallbackEvaluation, parseEvaluation, type AnswerEvaluation, type EvaluationSource,
} from '../assessment/interview-session';

export interface EvaluationInput {
  question: string;
  /** The authored curriculum answer — the authoritative reference the evaluator marks against. */
  modelAnswer: string;
  sectionTitle: string;
  kindLabel: string;
  difficulty: string;
  answer: string;
  lang: 'en-IN' | 'hi-IN';
}

export interface EvaluationResult {
  evaluation: AnswerEvaluation;
  source: EvaluationSource;
  /** Which model answered, when the server named one. */
  model?: string;
  /** A user-facing sentence explaining a fallback. Null when the AI really answered. */
  note: string | null;
}

/** The sentence under a fallback badge. Specific, never a generic "something went wrong". */
function fallbackNote(code: string | null, message: string): string {
  switch (code) {
    case 'ai-unconfigured':
      return 'The AI evaluator is not configured on this server, so this score comes from the built-in keyword rubric.';
    case 'api-unreachable':
      return 'This deployment has no account API, so the AI evaluator cannot be reached. This score is the built-in keyword rubric.';
    case 'signed-out':
      return 'Sign in to use the AI evaluator. Until then, this score is the built-in keyword rubric.';
    case 'timeout':
      return 'The AI evaluator did not answer in time. This score is the built-in keyword rubric — press Retry to ask the AI again.';
    case 'ai-rate-limited':
      return 'The AI evaluator is busy right now. This score is the built-in keyword rubric — try again in a minute for the AI review.';
    default:
      return message || 'The AI evaluator could not answer, so this score is the built-in keyword rubric.';
  }
}

export async function requestEvaluation(
  input: EvaluationInput,
  question: Pick<QuestionRecord, 'answer'>,
): Promise<EvaluationResult> {
  const response = await apiJson<{ evaluation?: unknown; model?: string }>(
    './api/interview/evaluate',
    {
      question: input.question,
      modelAnswer: input.modelAnswer,
      sectionTitle: input.sectionTitle,
      kind: input.kindLabel,
      difficulty: input.difficulty,
      answer: input.answer,
      lang: input.lang,
    },
    { timeoutMs: 15_000 },
  );

  if (!response.ok) {
    return {
      evaluation: fallbackEvaluation(question, input.answer),
      source: 'rubric',
      note: fallbackNote(response.code, response.message),
    };
  }

  const parsed = parseEvaluation(response.data?.evaluation);
  if (!parsed.ok) {
    return {
      evaluation: fallbackEvaluation(question, input.answer),
      source: 'rubric',
      note: `The AI reply was not in the expected shape (${parsed.reason}), so this score is the built-in keyword rubric.`,
    };
  }
  return {
    evaluation: parsed.evaluation,
    source: 'ai',
    model: typeof response.data?.model === 'string' ? response.data.model : undefined,
    note: null,
  };
}
