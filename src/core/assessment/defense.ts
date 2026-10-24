/**
 * The capstone defense projects — the canonical record both surfaces read.
 *
 * This used to live inside `features/interview/DefensePage.tsx`, which made it unreachable from
 * the tests (the `.tsx` loader ceiling) and forced any other surface that wants to reason about
 * the resume-pitch answers (`resume:<projId>:<i>` in `state.defenseAnswers`) to re-type the
 * project list — a second copy that could drift. The record is DATA, so it lives here, next to
 * its scoring engine (`evaluate.ts` holds the 10 fixed defense questions): pure, testable, and
 * imported by the Defense page (which renders it) and the Career hub (which counts the answers).
 *
 * The `id` of each entry is the storage id — `resumeDefenseAnswer(id, i)` builds the key
 * DefensePage writes, so renaming an id would orphan stored answers. Do not rename.
 */

import { DEFENSE_QUESTIONS } from './evaluate';

export interface DefenseProject {
  id: string;
  name: string;
  arch: string[];
  pitch: Record<string, string>;
  questions: string[];
}

export const DEFENSE_PROJECTS: DefenseProject[] = [
  {
    id: 'chatbot',
    name: 'AI-Powered Professional Chatbot',
    arch: ['User', 'Flask API', 'Validation', 'NLP/LLM service', 'Database (history)', 'Response'],
    pitch: {
      '60-second': 'I built an AI chatbot to automate first-line customer questions. Flask exposes a /chat endpoint; requests are validated, the intent is classified, and a response is generated and stored with history in a database for continuity and analytics. The modular design let me swap the response engine without touching the API layer.',
      'Deep technical': 'Request → validation → intent classification → response generation → persistence. I personally implemented the routing, the persistence schema and the error path: invalid payloads get structured 400s, and provider failures fall back to a safe canned response. The biggest bug was session mixing — I isolated it by logging request IDs end-to-end and fixed it by scoping history per user.',
    },
    questions: [
      'Why Flask for this? (lightweight, easy REST endpoints)',
      'Why store chat history in a DB? (persistence, continuity, analytics)',
      'Where would this break at 10x traffic? (sync model calls, no queue, DB pooling)',
    ],
  },
  {
    id: 'n8n',
    name: 'Agentic AI Automation Workflow (n8n)',
    arch: ['Trigger (webhook)', 'n8n workflow', 'State / context', 'Agent decision', 'Allow-listed tools', 'Validation', 'Action (email/CRM)', 'Logs'],
    pitch: {
      '60-second': 'I automated a multi-step business workflow in n8n: a webhook trigger feeds an agent step that decides an action from an allow-list, validation blocks anything unexpected, and side effects like CRM updates run with idempotency keys. Manual handling dropped because the routing decisions — not the whole process — were automated.',
      'Deep technical': 'Key trade-off: deterministic nodes for fixed steps, agent decisions only where variability adds value. I validate the payload schema first, allow-list the action field, and never blindly retry side-effecting calls — idempotency keys and human approval guard high-impact actions.',
    },
    questions: [
      'Why an agent step at all — why not pure workflow? (context-dependent routing)',
      'How do you prove the "reduction in manual work" claim? (before/after measurement)',
      'What happens on duplicate webhook delivery? (idempotency keys)',
    ],
  },
  {
    id: 'powerbi',
    name: 'Power BI Dashboard (Real-World Analytics)',
    arch: ['Source data', 'Cleaning / transform', 'Data model + relationships', 'DAX measures', 'KPI visuals', 'Business insight'],
    pitch: {
      '60-second': 'I built a KPI-driven Power BI dashboard on real business data: cleaned the source, defined grain and relationships, wrote DAX measures like Total Revenue, Order Count and AOV, and designed visuals around the three questions the business actually asks. The value is decisions: trends and outliers became visible instead of buried in spreadsheets.',
      'Deep technical': 'Grain first: I verify the fact-table grain and relationship cardinality before trusting any number — that was also my biggest early bug (revenue doubling from a many-to-many join). Filter context matters for every measure; DIVIDE handles divide-by-zero safely.',
    },
    questions: [
      'What is the grain of your fact table? (row = one order line)',
      'Why did revenue double after a join? (many-to-many relationship)',
      'How do you verify a KPI is correct? (reconcile against a source query)',
    ],
  },
];

/** The honest denominator for the resume-pitch answers: every question, for every project. */
export const RESUME_ANSWER_TOTAL = DEFENSE_PROJECTS.length * DEFENSE_QUESTIONS.length;
