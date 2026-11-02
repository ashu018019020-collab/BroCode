/**
 * The Smart Tools registry.
 *
 * Every entry is a real action, and each one says which system performs it:
 *
 *  · `ask`   — a prompt for the SAME grounded mentor engine the conversation uses (`useMentorAsk` →
 *              `askLocal` + `mentorTurn`). The prompt only frames the question; the answer still comes
 *              from the bundled curriculum, so a tool cannot invent a lesson that does not exist.
 *  · `route` — opens the surface that already owns that job: the question bank for practice and
 *              quizzes, the mock-interview engine, the project lab, the course index. A tool that
 *              cannot produce its own output does not pretend to; it takes the learner where the
 *              output really lives.
 *
 * Pure by contract (no React, no store): the UI supplies the context and renders the result.
 */

export type SmartToolId =
  | 'explain-simple'
  | 'deep-explanation'
  | 'real-example'
  | 'debug-code'
  | 'practice'
  | 'interview'
  | 'interview-prep'
  | 'project'
  | 'quiz'
  | 'summarize'
  | 'compare'
  | 'plan'
  | 'follow-up'
  | 'code-review';

export type SmartToolKind = 'ask' | 'route';

export interface SmartTool {
  id: SmartToolId;
  label: string;
  hint: string;
  kind: SmartToolKind;
  /** What it does with the answer, said plainly under the button. */
  note: string;
}

export const SMART_TOOLS: readonly SmartTool[] = [
  {
    id: 'explain-simple', label: 'Explain simply', hint: 'Beginner words, one example',
    kind: 'ask', note: 'Grounded answer, read aloud',
  },
  {
    id: 'deep-explanation', label: 'Deep explanation', hint: 'Architecture and internals',
    kind: 'ask', note: 'Grounded answer, read aloud',
  },
  {
    id: 'real-example', label: 'Real-world example', hint: 'How teams actually use it',
    kind: 'ask', note: 'Grounded answer, read aloud',
  },
  {
    id: 'debug-code', label: 'Debug my code', hint: 'Read the real error',
    kind: 'ask', note: 'Uses the code you pasted',
  },
  {
    id: 'code-review', label: 'Code review', hint: 'Bugs, clarity, performance',
    kind: 'ask', note: 'Uses the code you pasted',
  },
  {
    id: 'summarize', label: 'Summarize lesson', hint: 'The lesson in five lines',
    kind: 'ask', note: 'From the open lesson',
  },
  {
    id: 'compare', label: 'Compare concepts', hint: 'A vs B, with the trade-off',
    kind: 'ask', note: 'Ask it as “A vs B”',
  },
  {
    id: 'follow-up', label: 'Ask follow-up', hint: 'Continue this conversation',
    kind: 'ask', note: 'Keeps the thread',
  },
  {
    id: 'practice', label: 'Generate practice', hint: 'Questions on this section',
    kind: 'route', note: 'Opens the real question bank',
  },
  {
    id: 'quiz', label: 'Quiz me', hint: 'Graded questions, real scores',
    kind: 'route', note: 'Opens the real question bank',
  },
  {
    id: 'interview', label: 'Mock interview', hint: 'Role and level aware round',
    kind: 'route', note: 'Opens the interview engine',
  },
  {
    id: 'interview-prep', label: 'Interview prep', hint: 'Questions and evaluation',
    kind: 'route', note: 'Opens the interview engine',
  },
  {
    id: 'project', label: 'Project ideas', hint: 'Portfolio-ready builds',
    kind: 'route', note: 'Opens the project lab',
  },
  {
    id: 'plan', label: 'Learning plan', hint: 'What to study next',
    kind: 'route', note: 'Opens the course index',
  },
];

export function smartTool(id: string): SmartTool | null {
  return SMART_TOOLS.find((tool) => tool.id === id) ?? null;
}

export interface SmartToolContext {
  /** The topic the conversation is about — the open lesson, or the last question asked. */
  topic?: string;
  /** The real curriculum section id (`s12`), when one is open. */
  sectionId?: string;
  /** The learner's previous message, so "follow-up" continues the actual thread. */
  lastLearner?: string;
  /** A code block from the conversation or the input box. */
  code?: string;
  /** `hi` only changes the instruction language, not the answer's source. */
  lang?: 'en' | 'hi';
}

/** The topic, or the honest fallback the engine can still answer from. */
function topicOf(context: SmartToolContext): string {
  const topic = String(context.topic ?? '').replace(/\s+/g, ' ').trim();
  if (topic) return topic;
  const last = String(context.lastLearner ?? '').replace(/\s+/g, ' ').trim();
  return last;
}

/**
 * The prompt for an `ask` tool, or `null` when it genuinely cannot run (no topic, or a code tool with
 * no code). The caller shows a hint instead of sending an empty question to the engine.
 */
export function smartToolPrompt(id: SmartToolId, context: SmartToolContext = {}): string | null {
  const topic = topicOf(context);
  const code = String(context.code ?? '').trim();
  const hindi = context.lang === 'hi';

  switch (id) {
    case 'explain-simple':
      return topic
        ? `Explain ${topic} in simple beginner words, with one small example.`
        : null;
    case 'deep-explanation':
      return topic
        ? `Explain ${topic} technically: how it works internally, its architecture and the implementation details.`
        : null;
    case 'real-example':
      return topic
        ? `Give a real-world industry example of ${topic} and explain what problem it solved.`
        : null;
    case 'summarize':
      return topic ? `Summarize the lesson on ${topic} in a short structured summary.` : null;
    case 'compare':
      return topic
        ? `Compare ${topic}: the differences, when to use each, and the trade-off.`
        : null;
    case 'follow-up':
      return topic ? `Continue from my last question about ${topic}.` : null;
    case 'debug-code':
      if (!code) return null;
      return `Debug this code and explain the actual error, then show the fix:\n\n\`\`\`\n${code}\n\`\`\``;
    case 'code-review':
      if (!code) return null;
      return `Review this code for bugs, clarity and performance, and list the improvements:\n\n\`\`\`\n${code}\n\`\`\``;
    case 'practice':
    case 'quiz':
    case 'interview':
    case 'interview-prep':
    case 'project':
    case 'plan':
      return null;
    default:
      return hindi ? null : null;
  }
}

/**
 * Where a `route` tool goes. An empty string means "nothing to open yet" — the UI keeps the button
 * disabled rather than navigating to a guess.
 */
export function smartToolRoute(id: SmartToolId, context: SmartToolContext = {}): string {
  const section = String(context.sectionId ?? '').trim();
  const bank = section ? `/questions?section=${encodeURIComponent(section)}` : '';
  switch (id) {
    case 'practice':
    case 'quiz':
      return bank || '/practice';
    case 'interview':
    case 'interview-prep':
      return '/ai-mentor?tab=interview';
    case 'project':
      return '/projects';
    case 'plan':
      return '/courses';
    default:
      return '';
  }
}

/** A stable message id for a tool run, so a repeat press replaces the previous answer. */
export function toolTurnLabel(id: SmartToolId): string {
  return smartTool(id)?.label ?? 'Smart tool';
}
