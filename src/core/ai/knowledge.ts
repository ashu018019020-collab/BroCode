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
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || limit <= 0) return [];

  const intent = intentKind(query);
  const scores = new Map<number, number>();
  for (const term of terms) {
    for (const docIndex of index.postings[term] ?? []) {
      scores.set(docIndex, (scores.get(docIndex) ?? 0) + 1);
    }
  }

  const phrase = query.toLowerCase();
  const hits: KnowledgeHit[] = [];
  for (const [docIndex, overlap] of scores) {
    const document = index.documents[docIndex];
    if (!document) continue;
    if (intent === 'interview' && document.kind !== 'interview' && document.type !== 'interview') continue;
    if (intent === 'project' && document.kind !== 'project') continue;

    let score = overlap / Math.sqrt(terms.length);
    if (document.title.toLowerCase().includes(phrase)) score += 1.5;
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
    hits.push({ document, score });
  }

  return hits.sort((a, b) => b.score - a.score || a.document.id.localeCompare(b.document.id)).slice(0, limit);
}

export function validateKnowledgeIndex(value: unknown): value is KnowledgeIndex {
  if (!value || typeof value !== 'object') return false;
  const index = value as Partial<KnowledgeIndex>;
  const validDocument = (document: unknown): document is KnowledgeDocument => {
    if (!document || typeof document !== 'object') return false;
    const item = document as Partial<KnowledgeDocument>;
    return typeof item.id === 'string' && typeof item.kind === 'string'
      && typeof item.title === 'string' && typeof item.route === 'string'
      && typeof item.source === 'string' && typeof item.sourceRef === 'string';
  };
  return index.version === 1
    && typeof index.sourceHash === 'string'
    && Array.isArray(index.documents)
    && Array.isArray(index.courses)
    && Array.isArray(index.trackRoutes)
    && index.documents.every(validDocument)
    && !!index.postings
    && typeof index.postings === 'object'
    && Object.values(index.postings).every((posting) =>
      Array.isArray(posting) && posting.every((docIndex) => Number.isInteger(docIndex) && docIndex >= 0 && docIndex < index.documents!.length),
    )
    && index.counts?.documents === index.documents.length
    && Object.values(index.counts.byKind).reduce((sum, count) => sum + count, 0) === index.counts.documents;
}
