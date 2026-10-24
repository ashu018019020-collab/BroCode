/**
 * The canonical roadmap — 36 steps, in the order they should be walked.
 *
 * The app carries TWO sources, and they are not in the same order:
 *
 *   · the curriculum's 29 sections, grouped into the 8 tracks (TRACK_DEFS), and
 *   · the Playbook V15 document's 36 chapters, numbered the way the PDF prints them.
 *
 * The document's own order is not a learning order. Chapter 16 (Logic + DSA) belongs next to
 * Python, not after the agent labs; chapter 02 (LLM foundation) cannot come before step 17; the
 * interview bank (ch.18) is the LAST thing to open, not the fifth. Every page that printed the
 * document order therefore printed a sequence that was wrong to follow — which is what this module
 * fixes: it owns the ONE re-ordering, and every surface reads it from here.
 *
 * A step is a step of the ROAD, not a chapter of a book: six of the 36 have no playbook chapter at
 * all (Python Core, NumPy, Pandas, ML, ML Engineering, NLP are taught by the curriculum's own
 * sections), and four carry two or more chapters (step 34 is chapters 14 + 35, step 35 is 18 + 25 +
 * 19, step 36 is 20 + 26 + 36 + 28). That mapping is a bijection over chapters 01–36 and
 * `scripts/tests/roadmap.test.mjs` proves it against the real manifest, so no chapter can be
 * silently dropped from the road.
 *
 * `topics` / `goal` / `lab` / `project` are CONTENT, not chrome: they are the master roadmap
 * document's own lines for each step, shown in one language exactly like the playbook's verbatim
 * items and method lines are. Everything a translator would translate (headings, phase names,
 * buttons) lives in the locale pack.
 *
 * Pure on purpose: no React, no store, no fetch, no value imports at all (Node's type stripping
 * cannot resolve an extensionless relative import, so a value import here would make the module
 * unimportable — and `scripts/tests/roadmap.test.mjs` loads it directly with fixtures).
 */

/* ------------------------------- the phases ------------------------------ */

export type PhaseId =
  | 'orientation' | 'dataFoundation' | 'python' | 'analytics' | 'dataEngineering'
  | 'mlNlp' | 'genai' | 'agents' | 'build' | 'career';

export interface RoadmapPhase {
  id: PhaseId;
  /** Locale key for the phase's name. */
  key: string;
  /** One of the `.tone-*` families: colour on this page means "which phase", never "how good". */
  tone: string;
  /** First and last step number of the phase, inclusive. */
  first: number;
  last: number;
}

/**
 * Ten stages over the 36 steps. They are contiguous and non-overlapping — a step belongs to exactly
 * one stage — and the test asserts both, so a step added later cannot fall between two headings and
 * lose its tone. Each stage also carries its own tone, so "where am I" is readable from colour.
 *
 * The ten are the master roadmap's own stages, in its own order:
 *
 *   ORIENTATION → DATA FOUNDATION → PYTHON & PROGRAMMING → DATA ANALYTICS → DATA ENGINEERING →
 *   MACHINE LEARNING & NLP → GENERATIVE AI → AGENTIC AI → BUILD, PRODUCTION & SYSTEM DESIGN →
 *   FINAL INTERVIEW & CAREER
 *
 * Two edges in that sequence are load-bearing and easy to lose when a list is edited by hand, so
 * the test pins them: PYTHON COMES AFTER the data foundation (a learner meets data before the tool
 * that transforms it), and DATA ENGINEERING COMES BEFORE machine learning (pipelines before models).
 */
export const PHASES: RoadmapPhase[] = [
  { id: 'orientation', key: 'path.stageOrientation', tone: 'cyan', first: 1, last: 1 },
  { id: 'dataFoundation', key: 'path.stageDataFoundation', tone: 'green', first: 2, last: 3 },
  { id: 'python', key: 'path.stagePython', tone: 'blue', first: 4, last: 5 },
  { id: 'analytics', key: 'path.stageAnalytics', tone: 'orange', first: 6, last: 8 },
  { id: 'dataEngineering', key: 'path.stageDataEngineering', tone: 'violet', first: 9, last: 12 },
  { id: 'mlNlp', key: 'path.stageMlNlp', tone: 'fuchsia', first: 13, last: 17 },
  { id: 'genai', key: 'path.stageGenai', tone: 'purple', first: 18, last: 22 },
  { id: 'agents', key: 'path.stageAgents', tone: 'amber', first: 23, last: 28 },
  { id: 'build', key: 'path.stageBuild', tone: 'gold', first: 29, last: 34 },
  { id: 'career', key: 'path.stageCareer', tone: 'pink', first: 35, last: 36 },
];

/* -------------------------------- the steps ------------------------------ */

/** What kind of work a step is — decides the glyph, and nothing else. */
export type StepKind = 'concept' | 'code' | 'data' | 'ml' | 'genai' | 'agent' | 'build' | 'career';

/** The kinds, in one place: the page maps each to an icon and the test rejects a typo. */
export const STEP_KINDS: StepKind[] = ['concept', 'code', 'data', 'ml', 'genai', 'agent', 'build', 'career'];

export interface RoadmapStep {
  /** 1-based, contiguous, and the number printed in the rail. */
  no: number;
  title: string;
  kind: StepKind;
  /**
   * The track that teaches this step, declared ONLY where the step has no playbook chapter to
   * derive it from. Everything else resolves its track from its chapters (see `stepTrack`), so a
   * re-routed import moves the step with the content instead of leaving a stale hand-written id.
   */
  track?: string;
  /** Playbook V15 chapter numbers, in the order the step reads them. */
  chapters: string[];
  topics: string[];
  /** The step's exit condition — without one, "done" would mean nothing. */
  goal: string;
  lab?: string;
  project?: string;
}

export const STEPS: RoadmapStep[] = [
  {
    no: 1, title: 'Role map + how an AI Engineer thinks', kind: 'concept', chapters: ['01'],
    topics: ['AI / GenAI / Agentic Engineer roles', 'Data analyst vs scientist vs engineer', 'Data → ML → LLM → agent → production', 'Real company AI project lifecycle', 'Business problem → technical problem'],
    goal: 'Explain an end-to-end plan for a real AI problem in 2–3 minutes',
  },
  {
    no: 2, title: 'Statistics + data analysis', kind: 'ml', chapters: ['10'],
    topics: ['Mean, median, mode, range', 'Variance + standard deviation', 'Percentiles + distributions', 'Correlation + covariance', 'Sampling + confidence interval', 'Hypothesis testing + A/B basics'],
    goal: 'Tell whether data is biased and whether a difference is meaningful or random',
    project: 'Business analytics case study',
  },
  {
    no: 3, title: 'Data analyst toolkit', kind: 'data', chapters: ['21'],
    topics: ['Advanced Excel concepts', 'SQL + Pandas analytics', 'Power BI + DAX', 'KPI creation + dashboards', 'Data storytelling', 'Reporting automation'],
    goal: 'Convert raw data into executive-level dashboards and insights',
    project: 'SQL + Pandas + Power BI business dashboard',
  },
  {
    no: 4, title: 'Python Core', kind: 'code', track: 'python', chapters: [],
    topics: ['Variables, types, operators, I/O', 'if / elif / else', 'for & while, break/continue/range', 'Strings: slicing, formatting, methods', 'Lists, tuples, sets, dictionaries', 'Functions, *args, **kwargs, lambda, scope', 'OOP: class, object, inheritance, polymorphism', 'Files, JSON/CSV, modules, venv', 'Exceptions + custom errors', 'Type hints, logging, project structure'],
    goal: 'Build a small Python application without a tutorial',
    lab: 'Python Lab', project: 'Calculator · To-do CLI · File organizer · CSV analyzer',
  },
  {
    no: 5, title: 'Logic + DSA for AI Engineers', kind: 'code', chapters: ['16'],
    topics: ['Time & space complexity', 'Arrays, strings, hashing', 'Stack, queue, linked list', 'Searching + sorting', 'Recursion + tree basics', 'Two pointers + sliding window', 'Prefix sum + frequency counting'],
    goal: 'Break down a new problem and explain your solution approach',
  },
  {
    no: 6, title: 'NumPy foundation', kind: 'data', track: 'data', chapters: [],
    topics: ['ndarray, shape, dtype', 'Indexing, slicing, reshaping', 'Broadcasting + vectorization', 'Aggregation + maths operations', 'Random generation + masking'],
    goal: 'Write vectorized numerical code without unnecessary loops',
    lab: 'NumPy Lab',
  },
  {
    no: 7, title: 'Pandas + data cleaning + EDA', kind: 'data', track: 'data', chapters: [],
    topics: ['Series + DataFrame', 'CSV / Excel / JSON loading', 'Missing values + duplicates', 'Filter, sort, select, groupby', 'Merge, join, concat, pivot', 'Date/time + text columns', 'Outlier detection + basic plotting'],
    goal: 'Clean a messy dataset and extract business insights',
    lab: 'NumPy + Pandas Lab', project: 'Real-world EDA dashboard dataset',
  },
  {
    no: 8, title: 'SQL: fundamentals → advanced', kind: 'data', chapters: ['29'],
    topics: ['SELECT / WHERE / ORDER BY / LIMIT', 'COUNT, SUM, AVG + GROUP BY / HAVING', 'INNER, LEFT, RIGHT, FULL, SELF joins', 'CASE + subqueries + CTE', 'Window functions, ranking, lag/lead', 'Running totals + cohort analysis', 'Duplicate detection'],
    goal: 'Convert a business question into a SQL query',
    lab: 'SQL Lab',
  },
  {
    no: 9, title: 'Data engineering foundation', kind: 'data', chapters: ['11'],
    topics: ['Relational databases', 'ETL vs ELT', 'Pipelines + orchestration', 'Data warehouse, lake, lakehouse', 'Batch processing', 'Data quality + schema design'],
    goal: 'Explain the data flow from source to warehouse yourself',
    project: 'End-to-end data pipeline',
  },
  {
    no: 10, title: 'Data engineer advanced toolkit', kind: 'data', chapters: ['23'],
    topics: ['Advanced SQL', 'Warehouse modelling', 'Star schema + dimensional modelling', 'Pipeline design + data validation', 'Partitioning + optimization', 'Distributed systems basics'],
    goal: 'Design a production-style pipeline yourself',
    project: 'Production-style data pipeline',
  },
  {
    no: 11, title: 'Data engineer deep masterclass', kind: 'data', chapters: ['31'],
    topics: ['Pipeline scalability', 'Fault tolerance + retries', 'Idempotency', 'Partition strategy', 'Data contracts + schema evolution', 'Performance tuning', 'Data observability'],
    goal: 'Describe pipeline failure cases and their fixes',
  },
  {
    no: 12, title: 'Streaming + big data engineering', kind: 'data', chapters: ['32'],
    topics: ['Kafka: producers + consumers', 'Topics, partitions, offsets', 'Consumer groups', 'Event-driven architecture', 'Spark basics', 'Batch vs streaming'],
    goal: 'Explain the architecture of a real-time data pipeline',
    project: 'Events → Kafka → processing → storage → analytics',
  },
  {
    no: 13, title: 'Machine learning foundation', kind: 'ml', track: 'ml', chapters: [],
    topics: ['AI vs ML vs DL', 'Supervised + unsupervised', 'Regression, classification, clustering', 'Feature engineering + preprocessing', 'Train / validation / test split', 'Overfitting, underfitting, regularization', 'Linear/logistic regression, trees, forests, boosting, KNN, SVM, K-Means, PCA', 'Accuracy, precision, recall, F1, ROC-AUC, MAE/RMSE'],
    goal: 'Train, evaluate, and compare models on a dataset',
  },
  {
    no: 14, title: 'ML engineering workflow', kind: 'ml', track: 'ml', chapters: [],
    topics: ['Preprocessing pipelines', 'Feature scaling + encoding', 'Cross-validation', 'Hyperparameter tuning', 'Model selection + leakage detection', 'Imbalance handling', 'Feature importance + reproducibility'],
    goal: 'Re-run the workflow: data → EDA → features → train → tune → save model',
    project: 'End-to-end ML prediction system',
  },
  {
    no: 15, title: 'NLP foundation', kind: 'ml', track: 'ml', chapters: [],
    topics: ['Text preprocessing + tokenization', 'Stopwords, stemming, lemmatization', 'Bag of words + TF-IDF', 'Text classification', 'Semantic similarity + embeddings', 'Sequence concepts', 'spaCy + Transformers basics'],
    goal: 'Build the full text-classification flow yourself',
    project: 'NLP intent recognition system',
  },
  {
    no: 16, title: 'Data scientist advanced toolkit', kind: 'ml', chapters: ['22'],
    topics: ['Advanced EDA', 'Statistical reasoning', 'Experimentation design', 'Advanced feature engineering', 'Advanced ML', 'Model interpretation', 'Analytical storytelling'],
    goal: 'Run the loop: business question → data → EDA → stats → ML → recommendation',
    project: 'Complete data science case study',
  },
  {
    no: 17, title: 'Data scientist deep masterclass', kind: 'ml', chapters: ['30'],
    topics: ['Advanced feature engineering', 'Imbalanced datasets', 'Ensemble methods', 'Model interpretability', 'Forecasting + time-series concepts', 'Causal thinking', 'Model reliability + production concerns'],
    goal: 'Explain both the model output and its business impact',
  },
  {
    no: 18, title: 'LLM foundation + transformer deep dive', kind: 'genai', chapters: ['02'],
    topics: ['What an LLM is + tokens', 'Tokenization + context window', 'Embeddings + attention', 'Self-attention + transformer', 'Encoder vs decoder', 'Positional information', 'Temperature, hallucination, limits', 'Model selection'],
    goal: 'Explain transformers and LLMs in simple language',
  },
  {
    no: 19, title: 'Prompt + context engineering', kind: 'genai', chapters: ['03'],
    topics: ['System vs user instructions', 'Prompt structure + few-shot', 'Role prompting', 'Task decomposition', 'Context selection + compression', 'Structured JSON output', 'Output constraints + validation'],
    goal: 'Understand the journey from a poor prompt to a production prompt',
    project: 'Structured AI assistant',
  },
  {
    no: 20, title: 'RAG: basic → advanced', kind: 'genai', chapters: ['04'],
    topics: ['Parsing + chunking + overlap', 'Embeddings + metadata', 'Vector store + similarity search', 'Hybrid retrieval', 'Reranking + query transformation', 'Citations + hallucination reduction', 'Retrieval evaluation'],
    goal: 'Build an app that gives grounded answers from documents',
    lab: 'RAG Lab', project: 'Knowledge base AI assistant',
  },
  {
    no: 21, title: 'LangChain', kind: 'genai', chapters: ['05'],
    topics: ['Models, prompts, tools', 'Chains + retrievers', 'Structured outputs', 'Agent basics + memory concepts', 'Integrations'],
    goal: 'Build everything from a simple chain to a multi-step chain yourself',
    project: 'Tool-using AI assistant',
  },
  {
    no: 22, title: 'LangGraph', kind: 'genai', chapters: ['06'],
    topics: ['Graph, nodes, edges', 'State + transitions', 'Persistence + memory', 'Streaming + retries', 'Human-in-the-loop', 'Stateful workflows'],
    goal: 'Design a stateful AI workflow',
    project: 'Stateful AI workflow',
  },
  {
    no: 23, title: 'Agentic AI', kind: 'agent', chapters: ['07'],
    topics: ['Goal → plan → tool → observation loop', 'Tool use + function calling', 'Planning + routing', 'Memory + reflection', 'Retries + validation', 'Human approval + autonomous workflows'],
    goal: 'Design a tool-using agent yourself',
    project: 'AI task automation agent',
  },
  {
    no: 24, title: 'MCP + tool connectivity', kind: 'agent', chapters: ['08'],
    topics: ['MCP concepts', 'Tools, resources, prompts', 'Server / client architecture', 'External system integration', 'Permissions + tool discovery'],
    goal: 'Connect an agent to external tools, data, and services',
    project: 'MCP-enabled AI assistant',
  },
  {
    no: 25, title: 'Multi-agent + deep agents', kind: 'agent', chapters: ['09'],
    topics: ['Planner / executor / reviewer', 'Supervisor + specialist agents', 'Delegation + task decomposition', 'Agent communication', 'Shared state', 'Failure handling'],
    goal: 'Decide when to use a single agent vs a multi-agent setup',
    project: 'Multi-agent research / automation system',
  },
  {
    no: 26, title: 'Agentic AI advanced masterclass', kind: 'agent', chapters: ['24'],
    topics: ['Complex planning', 'Dynamic routing + tool selection', 'Memory architecture', 'Long-running agents', 'Reliability + failure recovery', 'Multi-agent coordination'],
    goal: 'Explain a production-grade agent architecture',
  },
  {
    no: 27, title: 'Agentic + LangChain implementation lab', kind: 'build', chapters: ['33'],
    topics: ['Tool calling', 'Structured output', 'Agent routing', 'RAG + agent', 'API + agent'],
    goal: 'Turn a concept you just read into code immediately',
  },
  {
    no: 28, title: 'LangGraph + MCP + multi-agent lab', kind: 'build', chapters: ['34'],
    topics: ['State + tools', 'Routing', 'Failure handling', 'Approvals', 'Memory'],
    goal: 'Complete the lab without following a tutorial',
    project: 'User → LangGraph → planner → MCP tool → specialist → validation',
  },
  {
    no: 29, title: 'Coding labs: practical implementation', kind: 'build', chapters: ['15'],
    topics: ['Python → NumPy/Pandas → SQL', 'ML → AI → RAG', 'Agentic → API lab', 'Learn → code → debug → improve → save'],
    goal: 'Write and save code for every major concept',
    lab: 'All labs, in one sequence',
  },
  {
    no: 30, title: 'Mini projects: end-to-end blueprints', kind: 'build', chapters: ['17'],
    topics: ['Python: automation, file processor, API client', 'Data: SQL analytics, EDA, dashboard', 'ML: prediction, classification, NLP', 'GenAI: chatbot, structured output, RAG assistant', 'Agentic: workflow, API, research agents', 'Capstones: support automation, knowledge assistant, agent platform'],
    goal: 'Build 3 of your own projects from the blueprints',
    project: '15 mini projects + 8 capstones',
  },
  {
    no: 31, title: 'End-to-end implementation playbook', kind: 'build', chapters: ['27'],
    topics: ['16-part project framework', 'Problem → requirements → data', 'Architecture + technology selection', 'Implementation + API', 'AI / ML / LLM + RAG, tools, agents', 'Evaluation, security, cost', 'Deployment, monitoring, documentation'],
    goal: 'Design a complete project on a whiteboard',
    project: 'Production-style AI application',
  },
  {
    no: 32, title: 'MLOps + LLMOps + evaluation + observability', kind: 'build', chapters: ['12'],
    topics: ['Model versioning + experiment tracking', 'Prompt versioning + eval datasets', 'Regression testing', 'Latency, token usage, cost tracking', 'Logs, traces, metrics', 'Tool + agent traces'],
    goal: 'Turn a working demo into a reliable system',
  },
  {
    no: 33, title: 'AI security + governance', kind: 'build', chapters: ['13'],
    topics: ['Prompt injection', 'Jailbreak + data leakage', 'Secrets management', 'Authentication + authorization', 'Least privilege + PII handling', 'Secure tool execution + guardrails', 'Responsible AI + governance'],
    goal: 'Identify and mitigate the major security risks of an AI application',
  },
  {
    no: 34, title: 'AI system design + production + cost', kind: 'build', chapters: ['14', '35'],
    topics: ['API + service architecture', 'Queues, caching, databases, vector DB', 'Horizontal scaling + concurrency', 'Latency, availability, fallbacks', 'Docker + CI/CD', 'Cost optimization + monitoring'],
    goal: 'Explain an end-to-end architecture on a whiteboard',
    project: 'Production AI system design + security',
  },
  {
    no: 35, title: 'Interview + project defense + portfolio', kind: 'career', chapters: ['18', '25', '19'],
    topics: ['Interview bank: Python → SQL → stats → ML → LLM → RAG → agents → MCP → system design', 'Role-wise rounds: AI, GenAI, Agentic, DS, DA, DE', 'Project defense: problem → architecture → challenges → fixes', 'Portfolio story: problem + action + technology + result'],
    goal: 'Defend your project professionally in 5–10 minutes',
  },
  {
    no: 36, title: 'Checkpoint + 30-day + 60-day master plan', kind: 'career', chapters: ['20', '26', '36', '28'],
    topics: ['Checkpoint loop: learned → practised → coded → built → defended', '30-day revision plan', '60-day master plan (phase A–K)', 'Sources + verification notes (reference, not a lesson)'],
    goal: 'Follow the full plan week by week',
  },

];

export const STEP_COUNT = STEPS.length;

/** The step a chapter is read at, or null when a chapter number is not on the road at all. */
export function stepOfChapter(no: string): number | null {
  for (const s of STEPS) if (s.chapters.includes(no)) return s.no;
  return null;
}

/** The phase a step falls in. Steps are numbered 1…STEP_COUNT and the phases tile that range. */
export function phaseOf(no: number): RoadmapPhase {
  return PHASES.find((p) => no >= p.first && no <= p.last) ?? PHASES[PHASES.length - 1];
}

/** The steps of one phase, in order. */
export function stepsOfPhase(p: RoadmapPhase): RoadmapStep[] {
  return STEPS.filter((s) => s.no >= p.first && s.no <= p.last);
}

/* --------------------------- playbook attribution ------------------------ */

/** The manifest chapter shape this module needs (structural — see the header on imports). */
export interface ChapterLike {
  no: string;
  items: number;
  pdfPage: number;
  sectionId: string;
  sections: Record<string, number>;
}

/** The items.json row shape this module needs. */
export interface ItemLike {
  id: string;
  chapter: string;
}

export interface ChapterStat {
  /** Items the banks actually hold for this chapter. */
  items: number;
  /** How many of those the learner has practised, from the caller's predicate. */
  practised: number;
  /** sectionId → items the document attributed to it. */
  sections: Record<string, number>;
  pdfPage: number;
  /** The chapter's home section — the fallback attribution when it contributed no items. */
  sectionId: string;
  /** A chapter with nothing to practise: a reading chapter, not a practice chapter. */
  concept: boolean;
}

/**
 * Per-chapter totals.
 *
 * Section attribution comes from the manifest (the document's own chapter → section map) while the
 * counts come from items.json when it loaded, because that view is derived from the banks — the
 * only thing the learner can actually open. A chapter the manifest lists but the banks took nothing
 * from stays a `concept` chapter rather than disappearing.
 */
export function chapterStats(
  chapters: ChapterLike[] | null,
  items: ItemLike[] | null,
  isTouched: (itemId: string) => boolean,
): Map<string, ChapterStat> {
  const out = new Map<string, ChapterStat>();
  const actual = new Map<string, number>();
  for (const it of items ?? []) actual.set(it.chapter, (actual.get(it.chapter) ?? 0) + 1);

  for (const ch of chapters ?? []) {
    out.set(ch.no, {
      items: actual.get(ch.no) ?? (items ? 0 : ch.items),
      practised: 0,
      sections: { ...ch.sections },
      pdfPage: ch.pdfPage,
      sectionId: ch.sectionId,
      concept: (actual.get(ch.no) ?? ch.items) === 0,
    });
  }
  for (const it of items ?? []) {
    if (!isTouched(it.id)) continue;
    const st = out.get(it.chapter);
    if (st) st.practised += 1;
  }
  return out;
}

export interface StepStat {
  /** Chapters of this step that carry practice items. */
  chapters: number;
  /** Chapters of this step that are reading only. */
  concepts: number;
  items: number;
  practised: number;
  /** sectionId → items, over the step's practised chapters. */
  sections: Record<string, number>;
  /** Earliest page of the step's chapters — where to start reading. */
  pdfPage: number | null;
  /** Where "Practice" should land: the section this step contributed the most items to. */
  topSection: string | null;
}

const EMPTY_STAT: StepStat = { chapters: 0, concepts: 0, items: 0, practised: 0, sections: {}, pdfPage: null, topSection: null };

/**
 * One step's share of the document.
 *
 * Returns zeroes — never a percentage — for a step with no chapters at all: it is not 0% of
 * anything, it is a step the document does not cover, and the page says exactly that.
 */
export function stepStat(step: RoadmapStep, stats: Map<string, ChapterStat>): StepStat {
  const out: StepStat = { ...EMPTY_STAT, sections: {} };
  let page: number | null = null;
  for (const no of step.chapters) {
    const st = stats.get(no);
    if (!st) continue;
    if (page === null || st.pdfPage < page) page = st.pdfPage;
    if (st.concept) { out.concepts += 1; continue; }
    out.chapters += 1;
    out.items += st.items;
    out.practised += st.practised;
    for (const [sid, n] of Object.entries(st.sections)) out.sections[sid] = (out.sections[sid] ?? 0) + n;
  }
  out.pdfPage = page;
  out.topSection = Object.entries(out.sections).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;
  return out;
}

/**
 * What one step's node on the master rail prints.
 *
 * Three different truths share one node, and collapsing them into a percentage is how a rail starts
 * lying — so the figure says WHICH truth it is:
 *
 *   · a step the curriculum teaches sections for reports their MASTERY, the same figure its lesson
 *     tiles and its own course page print;
 *   · a step with no sections of its own reports the COUNT of practice items the document carries
 *     for it. Deliberately not a share: the denominator a course page divides by is the step's own
 *     items in that course, and two screens printing two percentages for one step is the drift this
 *     project keeps out of every other measure;
 *   · a step the document only reads through says so, and a step the document never reached says
 *     that instead of borrowing the first line.
 *
 * `mastery` is the caller's average over the step's own course sections (null when it has none), so
 * this module still reads no store, no course file and no React.
 */
export interface StepFigure {
  /** A real percentage, or null when the honest answer is a fact rather than a share. */
  pct: number | null;
  kind: 'mastery' | 'questions' | 'reading' | 'undelivered';
  /** Practice items the document carries for this step (0 when it carries none). */
  items: number;
}

export function stepFigure(mastery: number | null, stat: StepStat): StepFigure {
  if (mastery !== null) {
    return { pct: Math.max(0, Math.min(100, Math.round(mastery))), kind: 'mastery', items: stat.items };
  }
  if (stat.items > 0) return { pct: null, kind: 'questions', items: stat.items };
  if (stat.chapters + stat.concepts > 0) return { pct: null, kind: 'reading', items: 0 };
  return { pct: null, kind: 'undelivered', items: 0 };
}

/* ------------------------------ curriculum side -------------------------- */

export interface TrackRange { id: string; from: number; to: number }
export interface SectionRef { id: string; no: number; title?: string }

/**
 * The curriculum track a step belongs to.
 *
 * Resolved from the step's own chapters — the track that received most of its items — so the link
 * and the tone follow the content instead of a hand-written id that a re-import would leave
 * pointing at the wrong track. A step with no practice items (or no chapters) falls back to the
 * track that owns its first chapter's section, and only a step with neither uses its declared
 * `track` (the six curriculum-only steps: Python, NumPy, Pandas, ML, ML engineering, NLP).
 */
export function stepTrack(
  step: RoadmapStep,
  stats: Map<string, ChapterStat>,
  sections: SectionRef[],
  tracks: TrackRange[],
): string | null {
  const sectionIds: string[] = [];
  const weight = new Map<string, number>();
  for (const no of step.chapters) {
    const st = stats.get(no);
    if (!st) continue;
    for (const [sid, n] of Object.entries(st.sections)) {
      weight.set(sid, (weight.get(sid) ?? 0) + n);
      sectionIds.push(sid);
    }
    // A chapter that contributed nothing (a reading chapter) still names its home section.
    if (st.sectionId) sectionIds.push(st.sectionId);
  }

  const byTrack = new Map<string, number>();
  for (const [sid, n] of weight) {
    const t = trackOfSection(sid, sections, tracks);
    if (t) byTrack.set(t, (byTrack.get(t) ?? 0) + n);
  }
  const best = [...byTrack.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (best) return best[0];

  // Nothing to weigh: fall back to the section its first chapter points at.
  for (const sid of sectionIds) {
    const t = trackOfSection(sid, sections, tracks);
    if (t) return t;
  }
  return step.track ?? null;
}

export function trackOfSection(sid: string, sections: SectionRef[], tracks: TrackRange[]): string | null {
  const sec = sections.find((s) => s.id === sid);
  if (!sec) return null;
  return tracks.find((t) => sec.no >= t.from && sec.no <= t.to)?.id ?? null;
}

/** The track record itself, for a caller that needs its range (first lesson, hours, tone). */
export function trackRange(id: string | null, tracks: TrackRange[]): TrackRange | undefined {
  return id ? tracks.find((t) => t.id === id) : undefined;
}

/**
 * The curriculum sections a step's lesson links should use: its own chapters' sections, or — for a
 * step the document never reached — the sections of the track that teaches it. Sorted by section
 * number so "Open lesson" is the earliest thing to read, not the biggest contributor.
 */
export function stepSections(
  step: RoadmapStep,
  stats: Map<string, ChapterStat>,
  sections: SectionRef[],
  tracks: TrackRange[],
): SectionRef[] {
  const ids = new Set<string>();
  for (const no of step.chapters) {
    const st = stats.get(no);
    if (st) for (const sid of Object.keys(st.sections)) ids.add(sid);
  }
  if (ids.size) return sections.filter((s) => ids.has(s.id)).sort((a, b) => a.no - b.no);

  const tr = trackRange(stepTrack(step, stats, sections, tracks), tracks);
  if (!tr) return [];
  return sections.filter((s) => s.no >= tr.from && s.no <= tr.to).sort((a, b) => a.no - b.no);
}

/**
 * Average mastery of a set of sections, or null when the step has no sections to weigh.
 * Null and 0 are different answers: "not measured" is not "nothing done".
 */
export function masteryOf(sectionIds: string[], pctOf: (sectionId: string) => number): number | null {
  if (!sectionIds.length) return null;
  return Math.round(sectionIds.reduce((a, id) => a + pctOf(id), 0) / sectionIds.length);
}
