/**
 * Single owner of every persisted-key shape and gamification policy.
 * Anything that reads or writes state.attempts, state.savedCode, or derives
 * a level from XP must go through here — a typo in a key silently severs a
 * mastery gate, and the typecheck cannot see string shapes.
 * Keys must stay byte-identical to what existing learners have stored.
 */
import type { Stage } from '../learning/progress';

// ---- state.attempts: per-section stage/item completion and scores ----
/** Whole-stage gates: interview, mini, project, defense, checkpoint. */
export const stageAttempt = (sid: string, stage: Stage) => `st:${sid}:${stage}`;
/** Per-item completion inside a stage: coding, logic, solved. */
export const itemAttempt = (sid: string, stage: Stage, i: number) => `st:${sid}:${stage}${i}`;
/**
 * The whole stage/item family. A tally that asks "kitni stage activity hui" counts this prefix as
 * such, and gets it from here — the string `st:` has no business appearing in a page.
 */
export const STAGE_ATTEMPT_PREFIX = 'st:';
/** Debug stage: a single "fixed the bug" record per section. */
export const debugDone = (sid: string) => `st:${sid}:debugdone`;
/** Learn stage: theory-viewed marker. */
export const LEARN_VIEW_PREFIX = 'view:';
export const learnView = (sid: string) => `${LEARN_VIEW_PREFIX}${sid}:learn`;
/** Final assessment coding tasks. */
export const finalTaskAttempt = (i: number) => `final:task${i}`;
/**
 * Final assessment WRITTEN answers — `<partId>:<questionIndex>`, or `defense:<i>` for the ten
 * defense prompts. Its own family so an answer can never be mistaken for the part SCORE, which
 * lives in `finalPart`; both are attempt records and the score is `score`, the text is `answer`.
 */
export const finalAnswer = (k: string) => `final:answer:${k}`;
/** Question-bank self-grade: one record per bank question id. */
export const bankAttempt = (questionId: string) => `qb:${questionId}`;
export const BANK_ATTEMPT_PREFIX = 'qb:';
/** Final assessment per-part scores. */
export const finalPart = (k: string) => `final:part:${k}`;
/**
 * Topic-workspace progress: one record per completed part item of a section's pack
 * (`part` is the 16-part block name, `i` the index inside it) plus the whole-part gate.
 */
export const packItem = (sid: string, part: string, i: number | string) => `tp:${sid}:${part}:${i}`;
export const packPart = (sid: string, part: string) => `tp:${sid}:${part}`;
export const PACK_PREFIX = 'tp:';

/**
 * Notebook Lab (content/notebooks → public/notebooks): one record per executed cell, plus the
 * cell's working copy of the code. `file` is the notebook file name, `cellId` the cell's id.
 */
export const notebookCell = (file: string, cellId: string) => `nb:${file}:${cellId}`;
export const NOTEBOOK_PREFIX = 'nb:';
/** One notebook's cell family, e.g. `notebookFamily('pandas.ipynb')` → `'nb:pandas.ipynb:'`. */
export const notebookFamily = (file: string) => `nb:${file}:`;

/** Non-section labs (RAG retrieval rounds, project lab steps, …). */
export const labAttempt = (lab: string, i: number | string) => `lab:${lab}:${i}`;
export const LAB_ATTEMPT_PREFIX = 'lab:';
/**
 * One lab's own family, e.g. `labFamily('mock')` → `'lab:mock:'`. Prefixes are spelled here so a
 * tally counts a family by asking for it, never by writing the string itself.
 */
export const labFamily = (lab: string) => `lab:${lab}:`;
/**
 * The Playground's "has run Python at least once" marker. An attempt key with no section and no lab
 * behind it — its own owner rather than a literal repeated across the page's three reads.
 */
export const playgroundRun = 'pg:run';

// ---- state.interviewAnswers ----
export const interviewAnswer = (sid: string, i: number) => `ia:${sid}:${i}`;

// ---- state.defenseAnswers ----
export const lessonDefenseAnswer = (sid: string, i: number) => `df:${sid}:${i}`;
export const resumeDefenseAnswer = (projId: string, i: number) => `resume:${projId}:${i}`;

// ---- state.savedCode slots ----
export const codeSlot = {
  playgroundPython: 'pg:python',
  playgroundJs: 'pg:js',
  playgroundSql: 'pg:sql',
  playgroundHtml: 'pg:html',
  sqlLab: 'sql:lab',
  lesson: (sid: string, stage: string, i: number | string) => `code:${sid}:${stage}:${i}`,
  final: (i: number) => `final:code:${i}`,
  npLab: (tab: string, i: number | string) => `nplab:${tab}:${i}`,
  notebook: (file: string, cellId: string) => `nbc:${file}:${cellId}`,
  /** Question-bank practice notebook: one code slot per bank question (`code:qb:s01:coding:19`). */
  bank: (questionId: string) => `code:qb:${questionId}`,
} as const;

/** Saved notebook cells live in their own slot family so they never collide with lessons. */
export const NOTEBOOK_CODE_PREFIX = 'nbc:';
/**
 * Question-bank notebook code. Distinct from `BANK_ATTEMPT_PREFIX` on purpose: the attempt
 * record and the saved code are read and written by different surfaces, and a shared prefix
 * would let a `startsWith` scan count one as the other (the bank page counts its own grades).
 */
export const BANK_CODE_PREFIX = 'code:qb:';

/**
 * ---- AI mentor and spoken interview ----
 *
 * Neither of these is an AppState attempt family. The mentor transcript is a device conversation
 * (account-scoped by `accountStorageKey`, never uploaded), and a spoken-interview report is a
 * learner's own record of a practice round. They live here anyway because this file is the single
 * owner of every persisted key shape — a literal `aiml:mock-interview:...` in a page is the bug this
 * file exists to prevent.
 */
export const MENTOR_LOG_KEY = 'aiml:mentor:log';
export const MOCK_HISTORY_KEY = 'aiml:mock-interview:history';
/**
 * The Interview Room's unfinished-sitting DRAFT and finished-round HISTORY. Same family as the
 * mentor log on purpose: a sitting is device-local practice, not an AppState attempt family —
 * the learner wants it back after a navigation, but must never confuse it with the `st:`/`qb:`
 * records the curriculum reads.
 */
export const INTERVIEW_DRAFT_KEY = 'aiml:interview-room:draft';
export const INTERVIEW_HISTORY_KEY = 'aiml:interview-room:history';
/**
 * The learner's own "Online AI Voice" consent, stored on THIS device only. It is a decision, not a
 * preference: it gates every realtime session request, and it is cleared the moment they turn it off.
 */
export const ONLINE_VOICE_CONSENT_KEY = 'aiml:online-voice-consent';

// ---- gamification policy ----
export const XP_PER_LEVEL = 50;
export const levelForXp = (xp: number) => Math.floor(Math.sqrt(xp / XP_PER_LEVEL)) + 1;
/** Fraction (0..1) of progress toward the next level. */
export const levelProgress = (xp: number) => (xp % XP_PER_LEVEL) / XP_PER_LEVEL;
export const LEVEL_NAMES = ['Initiate', 'Coder', 'Builder', 'Analyst', 'Engineer', 'Architect', 'AI Engineer', 'AI Master'];
