/**
 * The spoken mock interview — plan, follow-ups, separate score dimensions, report.
 *
 * Design commitments, in the order they constrain the code:
 *
 *  1. **Questions are real.** Every prompt comes from the bundled curriculum (`Section.interview`,
 *     `coding`, `logic`, `projectLab`); this engine never authors a question. The only authored text
 *     is the interviewer's follow-up wording and the report's explanation of its own method.
 *  2. **Dimensions stay separate.** Technical correctness is the keyword rubric over the model
 *     answer. Reasoning is a count of visible reasoning signals. Communication is word/sentence
 *     structure. Coding is recorded RUN evidence — and is `null`, not zero, when no run exists.
 *     Accent, voice and audio are never inputs; the report says so.
 *  3. **A follow-up is about THIS answer.** The first choice is the curriculum's own authored
 *     follow-up (`InterviewQ.fu`). Otherwise it names the rubric group the answer missed, or asks
 *     for a complexity/edge case when the answer is already complete. No generic "tell me more".
 *  4. **History is inspectable data, not a renderer's guess.** `sanitizeReports` rejects malformed
 *     stored records before the page can crash on them.
 *
 * Pure: no React, no store, no fetch. `scripts/tests/mock-interview.test.mjs` drives it with real
 * curriculum fixtures.
 */
import type { Section } from '../../types';
import { keywordScore, questionRubric } from './evaluate';

/* --------------------------------- the roles -------------------------------- */

export type MockRoleId =
  | 'ai-engineer'
  | 'data-scientist'
  | 'ml-engineer'
  | 'data-analyst'
  | 'python-developer'
  | 'backend-engineer';

export interface MockRole {
  id: MockRoleId;
  label: string;
  hint: string;
  topics: MockTopicId[];
}

export type MockTopicId =
  | 'python' | 'dsa' | 'sql' | 'data' | 'ml' | 'nlp'
  | 'genai' | 'agentic' | 'production' | 'projects' | 'hr';

export interface MockTopic {
  id: MockTopicId;
  label: string;
  hint: string;
  /** Real curriculum section numbers this topic draws from. */
  sections: number[];
  kinds: MockQuestionKind[];
}

export type MockQuestionKind = 'concept' | 'coding' | 'debug' | 'logic' | 'project';

export const MOCK_ROLES: MockRole[] = [
  { id: 'ai-engineer', label: 'AI Engineer', hint: 'Python, LLMs, RAG, agents, production APIs', topics: ['python', 'genai', 'agentic', 'ml', 'production'] },
  { id: 'data-scientist', label: 'Data Scientist', hint: 'Python, pandas, SQL, ML, projects', topics: ['python', 'data', 'sql', 'ml', 'projects'] },
  { id: 'ml-engineer', label: 'ML Engineer', hint: 'scikit-learn, transformers, MLOps', topics: ['python', 'ml', 'nlp', 'production'] },
  { id: 'data-analyst', label: 'Data Analyst', hint: 'SQL, pandas, analytics, storytelling', topics: ['sql', 'data', 'python', 'projects'] },
  { id: 'python-developer', label: 'Python Developer', hint: 'Language, DSA, APIs, debugging', topics: ['python', 'dsa', 'production', 'sql'] },
  { id: 'backend-engineer', label: 'Backend Engineer', hint: 'Python, APIs, SQL, production', topics: ['production', 'python', 'sql', 'dsa'] },
];

/**
 * The topic registry is a VIEW over the real section ranges, not a second question bank.
 *
 * Section numbers come from `public/generated/questions/manifest.json` and the curriculum's own
 * titles. JavaScript, C and C++ are deliberately absent: the bundled curriculum has no bank for
 * them, and inventing one would break the app's "content comes from a real source" contract. The
 * page says so rather than showing an empty round.
 */
export const MOCK_TOPICS: MockTopic[] = [
  { id: 'python', label: 'Python & Programming Fundamentals', hint: 'Sections 1–16', sections: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], kinds: ['concept', 'coding', 'debug'] },
  { id: 'dsa', label: 'DSA, Logic & Coding Patterns', hint: 'Loops, collections, patterns, complexity', sections: [7, 8, 9, 10, 11, 12, 13, 14, 28], kinds: ['coding', 'logic'] },
  { id: 'sql', label: 'SQL & Data Analytics', hint: 'Sections 19 + 25', sections: [19, 25], kinds: ['concept', 'coding', 'logic'] },
  { id: 'data', label: 'NumPy, Pandas & Data Science', hint: 'Sections 17, 18, 25', sections: [17, 18, 25], kinds: ['concept', 'coding'] },
  { id: 'ml', label: 'Machine Learning & scikit-learn', hint: 'Section 20', sections: [20], kinds: ['concept', 'coding'] },
  { id: 'nlp', label: 'NLP & Transformers', hint: 'Section 21', sections: [21], kinds: ['concept', 'coding'] },
  { id: 'genai', label: 'Generative AI, LLMs & RAG', hint: 'Sections 22–23', sections: [22, 23], kinds: ['concept', 'coding'] },
  { id: 'agentic', label: 'Agentic AI & LangChain', hint: 'Section 23', sections: [23], kinds: ['concept', 'coding'] },
  { id: 'production', label: 'APIs, FastAPI, Docker & MLOps', hint: 'Sections 24 + 26', sections: [24, 26], kinds: ['concept', 'coding'] },
  { id: 'projects', label: 'Projects & System Design', hint: 'Sections 27–29', sections: [27, 28, 29], kinds: ['project', 'concept'] },
  { id: 'hr', label: 'HR & Behavioural', hint: 'Career sections 27–29', sections: [27, 29], kinds: ['concept', 'project'] },
];

export const UNAVAILABLE_TOPICS = [
  { id: 'javascript', label: 'JavaScript', reason: 'No JavaScript question bank is bundled in this curriculum.' },
  { id: 'c', label: 'C', reason: 'No C question bank is bundled in this curriculum.' },
  { id: 'cpp', label: 'C++', reason: 'No C++ question bank is bundled in this curriculum.' },
] as const;

export const MOCK_DIFFICULTIES = ['intern', 'junior', 'mid', 'senior'] as const;
export type MockDifficulty = (typeof MOCK_DIFFICULTIES)[number];

export const MOCK_MINUTES = [5, 10, 15, 20, 30] as const;
export type MockMinutes = (typeof MOCK_MINUTES)[number];

export function mockRole(id: MockRoleId): MockRole {
  return MOCK_ROLES.find((role) => role.id === id) ?? MOCK_ROLES[0];
}

export function mockTopic(id: MockTopicId): MockTopic | null {
  return MOCK_TOPICS.find((topic) => topic.id === id) ?? null;
}

export function normalizeDifficulty(value: unknown): MockDifficulty {
  return MOCK_DIFFICULTIES.includes(value as MockDifficulty) ? (value as MockDifficulty) : 'mid';
}

export function normalizeMinutes(value: unknown): MockMinutes {
  const n = Number(value);
  if (!Number.isFinite(n)) return 15;
  let best: MockMinutes = 15;
  for (const candidate of MOCK_MINUTES) {
    if (Math.abs(candidate - n) < Math.abs(best - n)) best = candidate;
  }
  return best;
}

export function normalizeTopics(value: unknown): MockTopicId[] {
  const list = Array.isArray(value) ? value : [];
  const valid = MOCK_TOPICS.map((topic) => topic.id);
  const out = [...new Set(list.filter((id): id is MockTopicId => typeof id === 'string' && valid.includes(id as MockTopicId)))];
  return out.length ? out : ['python'];
}

/* --------------------------------- questions -------------------------------- */

export interface MockQuestion {
  id: string;
  sectionId: string;
  sectionNo: number;
  sectionTitle: string;
  topic: MockTopicId;
  kind: MockQuestionKind;
  prompt: string;
  model: string;
  /** The curriculum's own follow-up line, when the item has one (`InterviewQ.fu`). */
  authoredFollowUp?: string;
  /** A real check/expected value for a coding task, when the source has one. */
  check?: string;
  /** A real authored tip, when the item has one. */
  tip?: string;
  /** The source's own difficulty label, if it has one. Never invented for a concept item. */
  sourceDifficulty?: string;
  /** Keyword-rubric groups from the model answer. */
  rubric: string[];
}

const clean = (value: unknown): string => String(value ?? '').replace(/\s+/g, ' ').trim();

function sourceDifficulty(value: string | undefined): string | undefined {
  const v = clean(value).toLowerCase();
  return v || undefined;
}

/** Does a source difficulty fall in the band the learner chose? Untagged items are always eligible. */
export function difficultyMatches(level: MockDifficulty, tag: string | undefined): boolean {
  if (!tag) return true;
  const t = tag.toLowerCase();
  if (level === 'intern' || level === 'junior') return /easy|beginner|debug|basic|medium/.test(t);
  if (level === 'mid') return /medium|hard|debug|easy/.test(t);
  return /hard|expert|advanced|medium/.test(t);
}

/** Which topic claims one section? The first registry match — one question belongs to one round. */
export function topicsForSection(no: number): MockTopicId[] {
  return MOCK_TOPICS.filter((topic) => topic.sections.includes(no)).map((topic) => topic.id);
}

/**
 * Build every eligible question for one section.
 *
 * `coding` and `debug` items share the same authored array; the `difficulty` field is how the
 * curriculum distinguishes a debugging task (`difficulty: 'debug'`). No item is copied — this is a
 * projection, and the UI links back to the lesson it came from.
 */
export function questionsForSection(section: Section, topics: MockTopicId[] = MOCK_TOPICS.map((t) => t.id)): MockQuestion[] {
  const out: MockQuestion[] = [];
  const sectionTopics = topicsForSection(section.no).filter((t) => topics.includes(t));
  if (!sectionTopics.length) return out;
  const firstTopic = sectionTopics[0];
  const allowedKinds = new Set<MockQuestionKind>(
    MOCK_TOPICS.filter((t) => sectionTopics.includes(t.id)).flatMap((t) => t.kinds),
  );

  if (allowedKinds.has('concept')) {
    section.interview.forEach((item, i) => {
      if (!clean(item.q) || !clean(item.a)) return;
      out.push({
        id: `${section.id}:interview:${i}`,
        sectionId: section.id,
        sectionNo: section.no,
        sectionTitle: section.title,
        topic: firstTopic,
        kind: 'concept',
        prompt: clean(item.q),
        model: item.a.trim(),
        authoredFollowUp: clean(item.fu) || undefined,
        tip: clean(item.tip) || undefined,
        rubric: questionRubric(item.a),
      });
    });
  }

  if (allowedKinds.has('coding') || allowedKinds.has('debug')) {
    section.coding.forEach((task, i) => {
      if (!clean(task.text) || !clean(task.solution)) return;
      const isDebug = /debug/i.test(task.difficulty);
      const kind: MockQuestionKind = isDebug ? 'debug' : 'coding';
      if (!allowedKinds.has(kind)) return;
      out.push({
        id: `${section.id}:${kind}:${i}`,
        sectionId: section.id,
        sectionNo: section.no,
        sectionTitle: section.title,
        topic: firstTopic,
        kind,
        prompt: clean(task.text),
        model: task.solution.trim(),
        check: clean(task.check) || undefined,
        sourceDifficulty: sourceDifficulty(task.difficulty),
        rubric: questionRubric(task.text),
      });
    });
  }

  if (allowedKinds.has('logic')) {
    section.logic.forEach((card, i) => {
      if (!clean(card.text) || !clean(card.answer)) return;
      out.push({
        id: `${section.id}:logic:${i}`,
        sectionId: section.id,
        sectionNo: section.no,
        sectionTitle: section.title,
        topic: firstTopic,
        kind: 'logic',
        prompt: clean(card.text),
        model: card.answer.trim(),
        rubric: questionRubric(card.answer),
      });
    });
  }

  if (allowedKinds.has('project')) {
    section.projectLab.forEach((project, i) => {
      if (!clean(project.name)) return;
      out.push({
        id: `${section.id}:project:${i}`,
        sectionId: section.id,
        sectionNo: section.no,
        sectionTitle: section.title,
        topic: firstTopic,
        kind: 'project',
        prompt: `Defend this project: ${clean(project.name)}. What problem does it solve, what did you personally build, and why did you choose this design?`,
        model: clean(project.defense) || clean(project.architecture) || clean(project.use),
        authoredFollowUp: clean(project.followUp) || undefined,
        rubric: questionRubric(project.defense || project.architecture || project.use),
      });
    });
  }

  return out;
}

/* ---------------------------------- planning --------------------------------- */

export interface MockConfig {
  role: MockRoleId;
  topics: MockTopicId[];
  difficulty: MockDifficulty;
  minutes: MockMinutes;
}

export interface MockPlan {
  config: MockConfig;
  /** Seeded so the same plan can be reproduced in a test; the page uses the clock as its seed. */
  seed: number;
  questions: MockQuestion[];
  /** How many eligible questions existed before the target was applied. */
  available: number;
  /** Human-readable notes about what the plan could NOT do (missing topic, no coding evidence). */
  notes: string[];
}

/** Deterministic PRNG — one seed, one plan. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Target questions by round length. A spoken answer plus a follow-up takes about 2.5 minutes. */
export function targetQuestionCount(minutes: MockMinutes): number {
  return Math.max(2, Math.min(12, Math.round(minutes / 2.5)));
}

/**
 * Build the round.
 *
 * The plan chooses a CONCEPT opener, then mixes kinds, caps two questions per section so a round is
 * not one chapter repeated, and includes at most one coding item — the part of an interview that
 * needs the editor and a real run. Unanswered kinds are reported, not simulated: if a topic has no
 * coding question, the plan never produces a coding step with empty content.
 */
export function buildMockPlan(
  sections: Section[],
  config: Partial<MockConfig> & { seed?: number } = {},
): MockPlan {
  const role = MOCK_ROLES.some((r) => r.id === config.role) ? config.role! : 'ai-engineer';
  const topics = normalizeTopics(config.topics?.length ? config.topics : mockRole(role).topics);
  const difficulty = normalizeDifficulty(config.difficulty);
  const minutes = normalizeMinutes(config.minutes);
  const seed = Number.isFinite(config.seed) ? Math.abs(Math.floor(config.seed!)) : 1;
  const rng = mulberry32(seed);
  const notes: string[] = [];

  const allowed = new Set(sections.filter((section) =>
    topics.some((id) => mockTopic(id)?.sections.includes(section.no))).map((section) => section.id));

  const all: MockQuestion[] = [];
  for (const section of sections) {
    if (!allowed.has(section.id)) continue;
    for (const question of questionsForSection(section, topics)) {
      // A question is eligible when its authored difficulty band fits OR it has no tag (concept and
      // project items are not tagged by the source; pretending otherwise would invent a level).
      if (question.sourceDifficulty && !difficultyMatches(difficulty, question.sourceDifficulty)) continue;
      all.push(question);
    }
  }

  // If the difficulty band emptied a topic, be explicit and fall back for that topic rather than
  // returning a one-question round. The note says the source has no item at that level.
  if (all.length < 2) {
    const fallback: MockQuestion[] = [];
    for (const section of sections) {
      if (!allowed.has(section.id)) continue;
      fallback.push(...questionsForSection(section, topics));
    }
    if (fallback.length > all.length) {
      notes.push(`No ${difficulty}-level items exist for this selection; the round uses the real questions that do exist.`);
      all.splice(0, all.length, ...fallback);
    }
  }

  if (topics.includes('hr')) {
    const behavioural = all.filter((q) => q.kind === 'project'
      || (q.kind === 'concept' && /\b(tell me|yourself|your (best|strength|weakness)|team|conflict|pressure|fail|mistake|project|why should|salary|career)\b/i.test(q.prompt)));
    if (behavioural.length) {
      all.splice(0, all.length, ...behavioural);
      if (behavioural.length < targetQuestionCount(minutes)) {
        notes.push('Only a few authored behavioural/project questions were found; the round is shorter than requested rather than padded with technical questions.');
      }
    } else {
      notes.push('The bundled curriculum has no authored HR question at this level; the round uses project/defence questions, not invented HR prompts.');
    }
  }

  for (const id of topics) {
    if (!all.some((question) => question.topic === id)) {
      notes.push(`No eligible ${mockTopic(id)?.label ?? id} question was found in the bundled curriculum for this level.`);
    }
  }

  const target = targetQuestionCount(minutes);
  const perSection = new Map<string, number>();
  const picked: MockQuestion[] = [];
  const take = (predicate: (q: MockQuestion) => boolean, limit = 1): number => {
    let added = 0;
    const pool = all.filter((question) => !picked.includes(question) && predicate(question));
    // Shuffle within a kind so two rounds on the same topic are not identical.
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const question of pool) {
      if (added >= limit || picked.length >= target) break;
      const count = perSection.get(question.sectionId) ?? 0;
      if (count >= 2) continue;
      picked.push(question);
      perSection.set(question.sectionId, count + 1);
      added += 1;
    }
    return added;
  };

  // 1 concept opener, then logic, then one coding/debug item (if the round is long enough), then the
  // rest concept. This is a real interview shape, not a shuffled dump.
  take((q) => q.kind === 'concept', 1);
  take((q) => q.kind === 'logic', minutes >= 15 ? 2 : 1);
  if (minutes >= 10) take((q) => q.kind === 'coding' || q.kind === 'debug', 1);
  take((q) => q.kind === 'project', 1);
  take((q) => q.kind === 'concept', target);
  take(() => true, target);

  if (!picked.length) {
    notes.push('No questions matched this selection. Choose another topic — the curriculum has no bank for that combination.');
  }
  if (!picked.some((q) => q.kind === 'coding' || q.kind === 'debug')) {
    notes.push(minutes < 10
      ? 'This is a short round, so no coding question is included. Choose 10 minutes or more for a coding round.'
      : 'No coding question was available for this selection, so the round is spoken only.');
  }

  return {
    config: { role, topics, difficulty, minutes },
    seed,
    questions: picked,
    available: all.length,
    notes,
  };
}

/* --------------------------------- evaluation -------------------------------- */

export interface MockCodingEvidence {
  /** True only when the runner actually executed this code. */
  ran: boolean;
  /** The runner's success flag. */
  ok: boolean;
  /** Set only when the source has a check/expected value AND it was compared. */
  matchesExpected?: boolean;
  output?: string;
}

export interface MockAnswerScore {
  technical: number | null;
  reasoning: number | null;
  communication: number | null;
  /** Null when no recorded run exists — never 0, which would look like a failed test. */
  coding: number | null;
  overall: number | null;
  missing: string[];
  strengths: string[];
  weaknesses: string[];
  evidence: string[];
  basis: {
    technical: string;
    reasoning: string;
    communication: string;
    coding: string;
  };
}

const words = (text: string): number => clean(text).split(' ').filter(Boolean).length;
const sentences = (text: string): number => Math.max(1, (clean(text).match(/[.!?](\s|$)/g) ?? []).length);
const has = (text: string, pattern: RegExp): boolean => pattern.test(text);

/**
 * One answer → four independent numbers.
 *
 * Reasoning and communication are heuristics over the TEXT. They are not a language model and the
 * report says which signals were counted. Communication deliberately has no audio input: accent,
 * pace and voice are not technical ability.
 */
export function evaluateMockAnswer(
  question: MockQuestion,
  answer: string,
  coding?: MockCodingEvidence,
): MockAnswerScore {
  const text = clean(answer);
  const wordCount = words(text);
  const sentenceCount = sentences(text);
  const rubric = question.rubric.length ? question.rubric : questionRubric(question.model);
  const scored = text
    ? keywordScore(text, rubric)
    : { pct: 0, missing: rubric };
  const technical = text ? scored.pct : 0;

  const causal = has(text, /\b(because|since|so that|therefore|which means|reason|kyunki|isliye|tabhi)\b/i);
  const example = has(text, /\b(for example|for instance|e\.g\.|example|jaise|suppose|consider)\b/i);
  const edge = has(text, /\b(edge case|empty|zero|none|null|invalid|fail|error|boundary|overflow|complexity|o\()\b/i);
  const structure = sentenceCount >= 3;
  const reasoning = text
    ? Math.max(0, Math.min(100,
      20
      + (wordCount >= 25 ? 15 : 0)
      + (causal ? 20 : 0)
      + (example ? 20 : 0)
      + (edge ? 15 : 0)
      + (structure ? 10 : 0)))
    : 0;

  const communication = !text
    ? 0
    : wordCount < 15 ? 25
      : wordCount < 40 ? 65
        : wordCount <= 180 ? 100
          : wordCount <= 260 ? 80
            : 60;

  let codingScore: number | null = null;
  let codingBasis = 'No code run was recorded for this answer, so there is no coding score.';
  if (coding?.ran) {
    if (coding.matchesExpected === true) {
      codingScore = 100;
      codingBasis = 'The code ran and its output matched the task check.';
    } else if (coding.matchesExpected === false) {
      codingScore = 25;
      codingBasis = 'The code ran but its output did not match the task check.';
    } else if (coding.ok) {
      codingScore = 60;
      codingBasis = 'The code ran without an error. No expected output was compared, so this is execution evidence only.';
    } else {
      codingScore = 15;
      codingBasis = 'The code ran and raised an error.';
    }
  }

  const dims = { technical, reasoning, communication } as Record<string, number | null>;
  if (codingScore !== null) dims.coding = codingScore;
  const weights = codingScore === null
    ? { technical: 0.5, reasoning: 0.3, communication: 0.2 }
    : { technical: 0.35, reasoning: 0.25, communication: 0.15, coding: 0.25 };
  let weighted = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = dims[key];
    if (value === null || value === undefined) continue;
    weighted += value * weight;
    total += weight;
  }
  const overall = text || codingScore !== null ? Math.round(weighted / Math.max(0.0001, total)) : null;

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (technical >= 70) strengths.push(`Covered ${rubric.length - scored.missing.length}/${rubric.length} rubric points from the model answer.`);
  if (technical < 50) weaknesses.push(`Missed ${scored.missing.length}/${rubric.length} rubric points.`);
  if (reasoning >= 70) strengths.push('The answer shows reasoning: a cause, an example or an edge case is stated.');
  if (reasoning < 50 && text) weaknesses.push('The reasoning is thin — add why it works, an example, or an edge case.');
  if (communication >= 90) strengths.push(`Clear spoken length: ${wordCount} words in ${sentenceCount} sentence${sentenceCount === 1 ? '' : 's'}.`);
  if (communication < 50 && text) weaknesses.push(`The answer is too short for a spoken round (${wordCount} words); aim for 2–3 sentences with a reason.`);
  if (codingScore === 100) strengths.push('The code matched the task check after a real run.');
  if (codingScore !== null && codingScore < 60) weaknesses.push('The coding evidence shows a failed or mismatched run.');

  const evidence = [
    `Keyword rubric: ${rubric.length ? `${rubric.length - scored.missing.length}/${rubric.length} groups matched` : 'no rubric groups were extractable'}.`,
    `Answer: ${wordCount} words, ${sentenceCount} sentence${sentenceCount === 1 ? '' : 's'}.`,
    `Reasoning signals: ${[causal && 'cause', example && 'example', edge && 'edge case', structure && 'structure'].filter(Boolean).join(', ') || 'none detected'}.`,
    coding?.ran
      ? `Code run: ${coding.ok ? 'completed without an error' : 'raised an error'}${coding.matchesExpected === undefined ? '; no expected output was compared' : coding.matchesExpected ? '; output matched' : '; output did not match'}.`
      : 'Code run: none recorded for this answer.',
  ];

  return {
    technical,
    reasoning,
    communication,
    coding: codingScore,
    overall,
    missing: scored.missing,
    strengths,
    weaknesses,
    evidence,
    basis: {
      technical: rubric.length
        ? 'Keyword rubric over the authored model answer (same evaluator as the Question Bank).'
        : 'The model answer is too short to build a rubric, so no technical percentage is claimed.',
      reasoning: 'Visible reasoning signals in the written/spoken transcript (cause, example, edge case, structure). Not a language-model judgement.',
      communication: 'Word count and sentence count only. Audio, accent and voice are not analysed.',
      coding: codingBasis,
    },
  };
}

/* --------------------------------- follow-ups -------------------------------- */

export interface MockFollowUp {
  prompt: string;
  reason: string;
  target: 'authored' | 'missing-rubric' | 'deeper' | 'open';
}

const readableGroup = (group: string): string => group.split('|').slice(0, 2).join(' / ');

/**
 * One meaningful follow-up, in priority order:
 * authored → the exact rubric group that is missing → a deeper case for a complete answer.
 * Returns at most two, and the caller decides how many the round can afford.
 */
export function followUpsFor(
  question: MockQuestion,
  answer: string,
  opts: { lang?: 'en-IN' | 'hi-IN'; limit?: number } = {},
): MockFollowUp[] {
  const out: MockFollowUp[] = [];
  const limit = Math.max(1, Math.min(2, opts.limit ?? 1));
  const hi = opts.lang === 'hi-IN';
  const score = evaluateMockAnswer(question, answer);

  if (!clean(answer)) {
    out.push({
      prompt: hi ? 'Shuru karo: iska pehla step kya hoga, aur kyun?' : 'Start me off: what is the first step here, and why?',
      reason: 'No answer has been recorded yet.',
      target: 'open',
    });
    return out.slice(0, limit);
  }

  if (score.technical !== null && score.missing.length) {
    out.push({
      prompt: hi
        ? `Tumne kuch points cover kiye. Ab batao: "${readableGroup(score.missing[0])}" isme kaise fit hota hai?`
        : `You covered part of it. Can you also explain "${readableGroup(score.missing[0])}"?`,
      reason: 'This key point from the model answer is not in the response yet.',
      target: 'missing-rubric',
    });
  }

  if (question.authoredFollowUp) {
    out.push({
      prompt: question.authoredFollowUp,
      reason: 'Follow-up authored in the curriculum for this exact question.',
      target: 'authored',
    });
  }

  if (out.length < limit) {
    const deeper = question.kind === 'coding' || question.kind === 'debug'
      ? (hi
        ? 'Tumhare solution ki time aur space complexity kya hai? Kaunsa input isko sabse slow banayega?'
        : 'What are the time and space complexity of your solution, and which input would make it slowest?')
      : question.kind === 'project'
        ? (hi ? 'Agar traffic 10x badh jaye to kya badloge?' : 'What would you change if traffic grew 10×?')
        : (hi ? 'Ek concrete example do, aur ek case batao jahan yeh kaam nahi karega.' : 'Give one concrete example, and one case where this would not work.');
    out.push({ prompt: deeper, reason: 'The answer covers the basics; this checks depth.', target: 'deeper' });
  }

  if (score.technical !== null && score.technical < 50 && !question.authoredFollowUp) {
    out.push({
      prompt: hi ? 'Hint chahiye? Socho ki is topic ka core rule kya hai.' : 'Would a hint help? Start from the core rule of this topic.',
      reason: 'The answer is incomplete; the interviewer offers a nudge before moving on.',
      target: 'open',
    });
  }

  return out.slice(0, limit);
}

/* ---------------------------------- the round -------------------------------- */

export type MockAnswerPhase = 'main' | 'follow-up';

export interface MockRecordedAnswer {
  questionId: string;
  /** The main spoken/typed answer. */
  text: string;
  followUps: { prompt: string; answer: string }[];
  coding?: MockCodingEvidence;
}

/** What a caller records; the question id is the second argument so it cannot disagree with the key. */
export type MockAnswerDraft = Omit<MockRecordedAnswer, 'questionId'>;

export interface MockSession {
  id: string;
  startedAt: number;
  finishedAt?: number;
  plan: MockPlan;
  answers: MockRecordedAnswer[];
}

export function createMockSession(plan: MockPlan, now = Date.now(), id?: string): MockSession {
  return {
    id: id ?? `mock-${now}-${plan.seed}`,
    startedAt: now,
    plan,
    answers: [],
  };
}

export function recordMockAnswer(
  session: MockSession,
  questionId: string,
  answer: MockAnswerDraft,
): MockSession {
  const answers = session.answers.filter((item) => item.questionId !== questionId);
  return { ...session, answers: [...answers, { ...answer, questionId }] };
}

/* ----------------------------------- report ---------------------------------- */

export interface MockQuestionResult {
  question: MockQuestion;
  answer: string;
  followUps: { prompt: string; answer: string }[];
  score: MockAnswerScore;
  answered: boolean;
}

export interface MockRevisionItem {
  sectionId: string;
  sectionTitle: string;
  topic: MockTopicId;
  reason: string;
  route: string;
}

export interface MockReport {
  id: string;
  createdAt: number;
  durationSeconds: number;
  config: MockConfig;
  totals: {
    technical: number | null;
    reasoning: number | null;
    communication: number | null;
    coding: number | null;
    overall: number | null;
  };
  answered: number;
  total: number;
  results: MockQuestionResult[];
  strengths: string[];
  weaknesses: string[];
  incomplete: {
    prompt: string;
    sectionTitle: string;
    answer: string;
    missing: string[];
    model: string;
    explanation: string;
  }[];
  revision: MockRevisionItem[];
  notes: string[];
  disclaimer: string;
}

export const MOCK_DISCLAIMER =
  'These scores are deterministic estimates from the keyword rubric, the structure of your written/spoken answer, and code-run evidence that was actually recorded. They are not a hiring judgment. Accent, voice and audio are never scored.';

/** Average of the non-null dimension values; null when nothing was measured. */
function average(values: (number | null)[]): number | null {
  const measured = values.filter((value): value is number => typeof value === 'number');
  if (!measured.length) return null;
  return Math.round(measured.reduce((sum, value) => sum + value, 0) / measured.length);
}

/**
 * The report is built from the SAME per-answer numbers the candidate saw — no second scoring pass,
 * so a report cannot silently disagree with the feedback after question 3.
 */
export function buildMockReport(session: MockSession, now = Date.now()): MockReport {
  const answeredMap = new Map(session.answers.map((answer) => [answer.questionId, answer]));
  const results: MockQuestionResult[] = session.plan.questions.map((question) => {
    const recorded = answeredMap.get(question.id);
    const text = clean(recorded?.text);
    return {
      question,
      answer: recorded?.text ?? '',
      followUps: recorded?.followUps ?? [],
      score: evaluateMockAnswer(question, recorded?.text ?? '', recorded?.coding),
      answered: Boolean(text || recorded?.coding?.ran),
    };
  });

  const answered = results.filter((result) => result.answered);
  const totals = {
    technical: average(answered.map((result) => result.score.technical)),
    reasoning: average(answered.map((result) => result.score.reasoning)),
    communication: average(answered.map((result) => result.score.communication)),
    coding: average(answered.map((result) => result.score.coding)),
    overall: average(answered.map((result) => result.score.overall)),
  };

  const strengths: string[] = [];
  const weaknesses: string[] = [];
  if (totals.technical !== null) {
    (totals.technical >= 70 ? strengths : weaknesses).push(
      `Technical correctness: ${totals.technical}% average across ${answered.length} answered question${answered.length === 1 ? '' : 's'} (keyword rubric against the authored answers).`,
    );
  }
  if (totals.reasoning !== null) {
    (totals.reasoning >= 70 ? strengths : weaknesses).push(
      `Reasoning: ${totals.reasoning}% average (cause, example, edge-case and structure signals).`,
    );
  }
  if (totals.communication !== null) {
    (totals.communication >= 70 ? strengths : weaknesses).push(
      `Communication: ${totals.communication}% average (word and sentence structure only).`,
    );
  }
  if (totals.coding !== null) {
    (totals.coding >= 70 ? strengths : weaknesses).push(
      `Coding evidence: ${totals.coding}% average from recorded runs.`,
    );
  }
  if (answered.length < results.length) {
    weaknesses.push(`${results.length - answered.length} question${results.length - answered.length === 1 ? ' was' : 's were'} not answered, so no score was invented for ${results.length - answered.length === 1 ? 'it' : 'them'}.`);
  }
  if (!strengths.length && answered.length) strengths.push('You completed the round and produced a record of your answers — that is the first step to improving them.');
  if (!weaknesses.length) weaknesses.push('No dimension fell below the threshold in this round. Keep testing edge cases; a short round is not proof of readiness.');

  const incomplete = results
    .filter((result) => !result.answered || (result.score.technical !== null && result.score.technical < 60))
    .map((result) => ({
      prompt: result.question.prompt,
      sectionTitle: result.question.sectionTitle,
      answer: result.answer,
      missing: result.score.missing,
      model: result.question.model,
      explanation: result.answered
        ? `The answer matched ${result.score.technical ?? 0}% of the model answer's key points. Missing: ${result.score.missing.slice(0, 4).map(readableGroup).join('; ') || 'structure/depth rather than a named point'}.`
        : 'No answer was recorded for this question.',
    }));

  const bySection = new Map<string, { sectionTitle: string; topic: MockTopicId; weak: number; total: number }>();
  for (const result of results) {
    const current = bySection.get(result.question.sectionId) ?? {
      sectionTitle: result.question.sectionTitle,
      topic: result.question.topic,
      weak: 0,
      total: 0,
    };
    current.total += 1;
    if (!result.answered || (result.score.overall !== null && result.score.overall < 60)) current.weak += 1;
    bySection.set(result.question.sectionId, current);
  }
  const revision: MockRevisionItem[] = [...bySection.entries()]
    .filter(([, data]) => data.weak > 0)
    .sort((a, b) => b[1].weak - a[1].weak || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([sectionId, data]) => ({
      sectionId,
      sectionTitle: data.sectionTitle,
      topic: data.topic,
      reason: `${data.weak}/${data.total} question${data.total === 1 ? '' : 's'} in this section scored below 60 or were not answered.`,
      route: `/lesson/${sectionId}/learn`,
    }));

  const durationSeconds = Math.max(0, Math.round(((session.finishedAt ?? now) - session.startedAt) / 1000));
  return {
    id: session.id,
    createdAt: session.finishedAt ?? now,
    durationSeconds,
    config: session.plan.config,
    totals,
    answered: answered.length,
    total: results.length,
    results,
    strengths,
    weaknesses,
    incomplete,
    revision,
    notes: session.plan.notes,
    disclaimer: MOCK_DISCLAIMER,
  };
}

/* ---------------------------------- history --------------------------------- */

export const MOCK_HISTORY_LIMIT = 12;

/** Defensive decode: stored data is untrusted, and a malformed report must not blank the page. */
export function sanitizeReports(value: unknown): MockReport[] {
  if (!Array.isArray(value)) return [];
  const out: MockReport[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Partial<MockReport>;
    if (typeof raw.id !== 'string' || !raw.id || typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) continue;
    if (!raw.config || typeof raw.config !== 'object') continue;
    if (!Array.isArray(raw.results) || !Array.isArray(raw.revision)) continue;
    if (!raw.totals || typeof raw.totals !== 'object') continue;
    const config = raw.config as Partial<MockConfig>;
    const totals = raw.totals as Partial<MockReport['totals']>;
    const numberOrNull = (n: unknown): number | null =>
      typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
    out.push({
      id: raw.id,
      createdAt: raw.createdAt,
      durationSeconds: typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds) ? Math.max(0, Math.round(raw.durationSeconds)) : 0,
      config: {
        role: (MOCK_ROLES.some((role) => role.id === config.role) ? config.role : 'ai-engineer') as MockRoleId,
        topics: normalizeTopics(config.topics),
        difficulty: normalizeDifficulty(config.difficulty),
        minutes: normalizeMinutes(config.minutes),
      },
      totals: {
        technical: numberOrNull(totals.technical),
        reasoning: numberOrNull(totals.reasoning),
        communication: numberOrNull(totals.communication),
        coding: numberOrNull(totals.coding),
        overall: numberOrNull(totals.overall),
      },
      answered: typeof raw.answered === 'number' ? Math.max(0, Math.round(raw.answered)) : 0,
      total: typeof raw.total === 'number' ? Math.max(0, Math.round(raw.total)) : 0,
      results: raw.results.filter((result) => result && typeof result === 'object' && result.question) as MockQuestionResult[],
      strengths: Array.isArray(raw.strengths) ? raw.strengths.filter((s) => typeof s === 'string') : [],
      weaknesses: Array.isArray(raw.weaknesses) ? raw.weaknesses.filter((s) => typeof s === 'string') : [],
      incomplete: Array.isArray(raw.incomplete) ? raw.incomplete.filter((entry) => entry && typeof entry.prompt === 'string') : [],
      revision: raw.revision.filter((entry) => entry && typeof entry.route === 'string') as MockRevisionItem[],
      notes: Array.isArray(raw.notes) ? raw.notes.filter((note) => typeof note === 'string') : [],
      disclaimer: typeof raw.disclaimer === 'string' ? raw.disclaimer : MOCK_DISCLAIMER,
    });
  }
  return out
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MOCK_HISTORY_LIMIT);
}

export function addReport(existing: MockReport[], report: MockReport): MockReport[] {
  return [report, ...existing.filter((item) => item.id !== report.id)].slice(0, MOCK_HISTORY_LIMIT);
}

export function removeReport(existing: MockReport[], id: string): MockReport[] {
  return existing.filter((report) => report.id !== id);
}

/** A short, honest headline for the history row. */
export function reportHeadline(report: MockReport): string {
  if (report.totals.overall === null) return 'Round finished — no answer recorded';
  return `${report.totals.overall}% overall · ${report.answered}/${report.total} answered`;
}
