"use strict";
/**
 * Helpers that draft the pitch keywords the ATS check will suggest, from records the learner
 * already has — the same `roleKeywords` + `keywordCoverage` the ATS check already runs, plus the
 * learner's strongest-measured track skill.
 *
 * No React, no store, no new denominator. This only inspects what `CareerWorkspaceInput` already
 * carries.
 */
import { roleKeywords, keywordCoverage, storedAnswers } from './career-workspace';

/** The words the page should tell a learner to put into a pitch next. */
export interface PitchWordSuggestion {
  /** Keywords the role's measured skills define but the stored pitches do not yet include. */
  missingKeywords: string[];
  /** How many of the role's measured keywords are already present. */
  coverage: { matched: number; total: number; pct: number };
}

/**
 * Keep only the strongest-measured supported track and use *its* authored label to draft the
 * keywords the ATS check should suggest. The label is split the same way `roleKeywords` does and
 * filtered with the same `KEYWORD_STOP` set, so the suggested words are the exact role keywords
 * from the learner's best track that are still missing from the stored pitches.
 */
export function pitchWordSuggestion(input: {
  answers: Record<string, string>;
  skills: { label: string; pct: number }[];
}): PitchWordSuggestion {
  const stored = storedAnswers(input.answers);
  const strong = input.skills.length > 0
    ? input.skills.slice().sort((a, b) => b.pct - a.pct)[0]!
    : null;
  const words = roleKeywords(strong ? [strong] : []);
  const coverage = keywordCoverage(stored, words.map((label) => ({ label })));
  const missingKeywords = words.filter((w) => !stored.join(' ').toLowerCase().includes(w));
  return { missingKeywords, coverage };
}
