export interface KnowledgeDocument {
  id: string;
  kind: string;
  title: string;
  sectionId?: string;
  sectionTitle?: string;
  type?: string;
  difficulty?: string;
  course?: string;
  courseTitle?: string;
  chapter?: number;
  chapterTitle?: string;
  route: string;
  source: string;
  sourceRef: string;
  tags?: string[];
  answer?: string;
  explanation?: string;
  body?: string;
}

export interface KnowledgeCourse {
  slug: string;
  title: string;
  route: string;
  steps: { number: number; title: string; route: string }[];
  sections: Record<string, number>;
}

export interface KnowledgeIndex {
  version: 1;
  sourceHash: string;
  counts: {
    documents: number;
    bankQuestions: number;
    sections: number;
    courses: number;
    tracks: number;
    playbook: number;
    notebooks: number;
    mockInterviews: number;
    intensiveInterviewQuestions: number;
    byKind: Record<string, number>;
  };
  courses: KnowledgeCourse[];
  trackRoutes: { slug: string; title: string; route: string; course?: string }[];
  documents: KnowledgeDocument[];
  postings: Record<string, number[]>;
}

export interface KnowledgeContext {
  sectionId?: string;
  course?: string;
  type?: string;
  topic?: string;
  learningLevel?: string;
  learningGoal?: string;
}

export interface KnowledgeHit {
  document: KnowledgeDocument;
  score: number;
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'of', 'and', 'or', 'to', 'in', 'on',
  'for', 'with', 'as', 'at', 'by', 'it', 'its', 'this', 'that', 'from', 'we', 'you', 'your',
  'ka', 'ki', 'ke', 'hai', 'hain', 'aur', 'ek', 'me', 'mein', 'se', 'par', 'ko',
]);

const tokenize = (text: string) => (text.toLowerCase().match(/[a-z0-9_]+/g) ?? [])
  .filter((token) => token.length > 1 && !STOP.has(token));

/**
 * Words that describe the ASK, not the topic.
 *
 * The corpus is overwhelmingly assessment material whose titles are written in the learner's own
 * phrasing ("explain: OOP ka benefit simple words me?"). Matching `explain`/`simple`/`words` scored
 * those titles as a perfect hit and the +1.5 title boost finished the job, so "Explain Python
 * decorators in simple words" answered with an unrelated quiz prompt. Dropping them leaves the topic
 * (`python decorators`) and lets the lesson that teaches it win.
 */
const INSTRUCTION = new Set([
  'explain', 'explains', 'explained', 'describe', 'define', 'definition', 'meaning', 'simple',
  'simply', 'words', 'word', 'example', 'examples', 'eg', 'why', 'what', 'how', 'when', 'where',
  'which', 'difference', 'differentiate', 'compare', 'tell', 'give', 'show', 'use', 'using', 'used',
  'work', 'works', 'working', 'understand', 'overview', 'summary', 'summarize', 'basic', 'basics',
  'beginner', 'introduction', 'intro', 'question', 'questions', 'answer', 'answers', 'please',
  'help', 'kya', 'kyaa', 'kaise', 'kyu', 'kyun', 'batao', 'bata', 'samjhao', 'samjha', 'matlab',
  'bhasha', 'hota', 'hoti', 'hote', 'chahiye', 'dedo', 'do', 'karo', 'karte', 'kaun', 'kab',
  'kahan', 'kitna', 'kitni', 'padho', 'seekho', 'bolo', 'suno',
]);

/** Documents that ASK something rather than teach it. */
const QUESTION_KINDS = new Set(['question', 'checkpoint', 'defense-question']);

/**
 * Navigation and status surfaces. They are real pages, but "Python Core 100% mastered" is not an
 * explanation of Python — a progress badge must never be read aloud as the answer.
 */
const NAVIGATION_KINDS = new Set(['career', 'roadmap', 'track-topic', 'playbook', 'notebook-code']);

/**
 * A document is an assessment item when it is a question kind OR carries a bank `type`
 * (`logic`, `theory`, `solved`, `checkpoint`…). Those are still answers when the learner explicitly
 * asks for an interview/project question, and are demoted — never dropped — otherwise.
 */
function isAssessmentItem(document: KnowledgeDocument): boolean {
  return QUESTION_KINDS.has(document.kind) || Boolean(document.type);
}

/**
 * The query's TOPIC terms, falling back to every term when the ask is only instruction words
 * ("explain in simple words" has no topic of its own, so nothing is stripped).
 */
function queryTerms(question: string): string[] {
  const all = [...new Set(tokenize(question))];
  const topic = all.filter((term) => !INSTRUCTION.has(term));
  return topic.length ? topic : all;
}

/**
 * Postings for one query term. The index is not stemmed, so a plural ask must still find the
 * singular passage ("decorators" → "decorator"); only an exact miss falls back.
 */
function postingsFor(index: KnowledgeIndex, term: string): number[] {
  const direct = index.postings[term];
  if (direct) return direct;
  const singular = term.replace(/(?:es|s)$/, '');
  if (singular !== term) return index.postings[singular] ?? [];
  return [];
}

/** Everything a document can teach from — the title alone is never an answer. */
function teachableText(document: KnowledgeDocument): string {
  return `${document.body ?? ''} ${document.answer ?? ''} ${document.explanation ?? ''}`.trim();
}

function intentKind(question: string): string | null {
  if (/\b(interview|interview questions?|mock interview|interview me)\b/i.test(question)) return 'interview';
  if (/\b(project|portfolio|build idea|project idea)\b/i.test(question)) return 'project';
  return null;
}

/**
 * Search the generated inverted index. Only query-term postings are visited, then small, explicit
 * boosts account for the live lesson/course and interview/project intent.
 */
export function retrieveKnowledge(
  index: KnowledgeIndex,
  question: string,
  context: KnowledgeContext = {},
  limit = 5,
): KnowledgeHit[] {
  const query = question.trim();
  const terms = queryTerms(query);
  if (!terms.length || limit <= 0) return [];

  const intent = intentKind(query);
  // Distinct query terms per document: a doc reachable through both the plural and the singular
  // posting must count once, or a single word would look like two matches.
  const matched = new Map<number, Set<string>>();
  for (const term of terms) {
    for (const docIndex of postingsFor(index, term)) {
      const bucket = matched.get(docIndex) ?? new Set<string>();
      bucket.add(term);
      matched.set(docIndex, bucket);
    }
  }

  const hits: KnowledgeHit[] = [];
  for (const [docIndex, matchedTerms] of matched) {
    const overlap = matchedTerms.size;
    const document = index.documents[docIndex];
    if (!document) continue;
    if (intent === 'interview' && document.kind !== 'interview' && document.type !== 'interview') continue;
    if (intent === 'project' && document.kind !== 'project') continue;
    // A document with no body, answer or explanation can only contribute its title, so it cannot be
    // the answer to anything. Skipping it here also keeps empty passages out of the source chips.
    if (teachableText(document).length < 24) continue;

    let score = overlap / Math.sqrt(terms.length);
    // Title coverage of the TOPIC words only: a quiz title that repeats "explain … simple words"
    // earns nothing for the instruction part of the ask.
    const title = document.title.toLowerCase();
    const inTitle = terms.filter((term) => title.includes(term)
      || (term.length > 3 && title.includes(term.replace(/(?:es|s)$/, '')))).length;
    if (inTitle) score += (inTitle === terms.length ? 1.5 : 0.6) * (inTitle / terms.length);
    if (context.sectionId && document.sectionId === context.sectionId) score += 0.7;
    if (context.course && document.course === context.course) score += 0.35;
    if (context.type && document.type === context.type) score += 0.25;
    if (context.topic && document.title.toLowerCase().includes(context.topic.toLowerCase())) score += 0.4;
    if (context.learningGoal) {
      const goalTerms = new Set(tokenize(context.learningGoal));
      const docTerms = new Set(tokenize(`${document.title} ${document.courseTitle ?? ''} ${document.body ?? ''}`));
      for (const term of goalTerms) if (docTerms.has(term)) score += 0.03;
    }
    if (context.learningLevel && document.difficulty) {
      const level = context.learningLevel.toLowerCase();
      const difficulty = document.difficulty.toLowerCase();
      if (level === difficulty || (level.includes('beginner') && difficulty === 'easy') ||
          (level.includes('intermediate') && difficulty === 'medium') ||
          (level.includes('advanced') && ['hard', 'expert'].includes(difficulty))) score += 0.08;
    }
    if (intent === 'interview' && document.type === 'interview') score += 0.5;
    if (intent === 'project' && document.kind === 'project') score += 0.5;
    // A plain concept ask is answered by the material that TEACHES it. An explicit interview or
    // project ask is the opposite case: there the bank item is the right answer, so it is untouched.
    if (!intent) {
      if (isAssessmentItem(document) || NAVIGATION_KINDS.has(document.kind)) score *= 0.6;
      else score += 0.75;
    }
    hits.push({ document, score });
  }

  return hits.sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id)).slice(0, limit);
}

export function validateKnowledgeIndex(value: unknown): value is KnowledgeIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Partial<KnowledgeIndex>;

  /**
   * Every field the corpus PRINTS or TOKENIZES has to be a plain string. The previous check asked
   * only about the six required fields, so a bilingual `{ en, hi }` map that reached `courseTitle`
   * passed validation and then surfaced as "[object Object]" on a learner's screen (and poisoned the
   * inverted index, which tokenizes `courseTitle`). The document schema is the contract; validating
   * it here means a bad artifact is rejected at load instead of being rendered.
   */
  const optionalStrings = [
    'sectionId', 'sectionTitle', 'type', 'difficulty', 'course', 'courseTitle',
    'chapterTitle', 'answer', 'explanation', 'body',
  ] as const;
  const validDocument = (document: unknown): document is KnowledgeDocument => {
    if (!document || typeof document !== 'object') return false;
    const item = document as Record<string, unknown>;
    if (typeof item.id !== 'string' || typeof item.kind !== 'string' || typeof item.title !== 'string'
      || typeof item.route !== 'string' || typeof item.source !== 'string' || typeof item.sourceRef !== 'string') {
      return false;
    }
    for (const field of optionalStrings) {
      const fieldValue = item[field];
      if (fieldValue !== undefined && typeof fieldValue !== 'string') return false;
    }
    if (item.chapter !== undefined && typeof item.chapter !== 'number') return false;
    const tags = item.tags;
    if (tags !== undefined && (!Array.isArray(tags) || !tags.every((tag) => typeof tag === 'string'))) return false;
    return true;
  };
  const validCourse = (course: unknown): course is KnowledgeCourse => {
    if (!course || typeof course !== 'object') return false;
    const item = course as Record<string, unknown>;
    if (typeof item.slug !== 'string' || typeof item.title !== 'string' || typeof item.route !== 'string') return false;
    if (!item.sections || typeof item.sections !== 'object' || Array.isArray(item.sections)) return false;
    if (!Object.values(item.sections as Record<string, unknown>).every((step) => typeof step === 'number')) return false;
    return Array.isArray(item.steps) && item.steps.every((step) => {
      if (!step || typeof step !== 'object') return false;
      const entry = step as Record<string, unknown>;
      return typeof entry.number === 'number' && typeof entry.title === 'string' && typeof entry.route === 'string';
    });
  };
  return index.version === 1
    && typeof index.sourceHash === 'string'
    && Array.isArray(index.documents)
    && Array.isArray(index.courses)
    && Array.isArray(index.trackRoutes)
    && index.documents.every(validDocument)
    && index.courses.every(validCourse)
    && !!index.postings
    && typeof index.postings === 'object'
    && Object.values(index.postings).every((posting) =>
      Array.isArray(posting) && posting.every((docIndex) => Number.isInteger(docIndex) && docIndex >= 0 && docIndex < index.documents!.length),
    )
    && index.counts?.documents === index.documents.length
    && Object.values(index.counts.byKind).reduce((sum, count) => sum + count, 0) === index.counts.documents;
}
