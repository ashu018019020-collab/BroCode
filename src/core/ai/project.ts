/**
 * Project knowledge — the assistant's answers about THIS app.
 *
 * `assistant.ts` retrieves the bundled curriculum, so it can explain `lambda` but not "ye app kaise
 * bana hai", "naya question kaha add karun", or "test kaise chalaun". Those are the questions the
 * footer's AI is asked, and the answers are facts about the repository — not something a retrieval
 * index over lesson text can produce.
 *
 * Two rules keep this honest and testable:
 *
 *   · every fact is a statement about the real project (README, AGENTS.md and the pipeline scripts
 *     are the source), and every one that names a place carries its route, so the answer can hand
 *     the learner the page it is talking about;
 *   · matching is STRICT. A fact needs a phrase hit or two distinct key hits, because the same
 *     `askLocal` entry point also answers curriculum questions: a loose matcher here would hijack
 *     "variables aur data types" and cite the Settings page.
 *
 * Pure data + a scoring function, no React and no store, so a test can drive it directly.
 */

export interface ProjectAnswer {
  /** Plain-English answer text. */
  text: string;
  /** The page(s) this answer is about, so the UI can link them. */
  sources: { title: string; route: string }[];
  /** 0–1: how strongly the question matched, so callers can rank or explain. */
  confidence: number;
  kind: 'project';
}

export interface ProjectFact {
  id: string;
  /** Where the fact is about, used as the answer's source chip. */
  where: string;
  route: string;
  /** What the learner would type. Single words, lowercase, English (Hinglish aliases kept for matching). */
  keys: string[];
  /** Multi-word signals — worth more than a single key, because they are unambiguous. */
  phrases?: string[];
  body: string;
}

/**
 * The facts.
 *
 * Deliberately ordered: when two facts score the same the earlier one wins, so the general
 * "what is this app" entry sits first and the narrow ones (add a question, add a notebook) after it.
 */
export const PROJECT_FACTS: ProjectFact[] = [
  {
    id: 'what',
    where: 'Dashboard',
    route: '/',
    keys: ['app', 'project', 'brocode', 'website', 'site', 'built', 'made', 'bana', 'banaya'],
    phrases: ['ye app', 'this app', 'ye project', 'ye website', 'kya hai ye', 'what is this', 'what is this app', 'about this app'],
    body:
      'BroCode (AI Engineer Master Lab) — an AI/Data learning lab that runs entirely on this device.\n' +
      'All of its content is extracted from a 457-page PDF: 29 sections, 8 tracks (from Python Core to\n' +
      'Interview + Projects), with lesson stages, questions, notebooks, and projects in every section.\n' +
      'Python, SQL, and PDF reading — all run inside the browser: Pyodide (Python 3.12 + numpy/pandas),\n' +
      'sql.js, and pdf.js are bundled with this app.',
  },
  {
    id: 'runtime',
    where: 'Code Playground',
    route: '/playground',
    keys: ['python', 'pyodide', 'runtime', 'worker', 'numpy', 'pandas', 'run', 'chalao', 'chalta', 'engine', 'wasm', 'start', 'cache'],
    phrases: ['python kaise', 'numpy kaha', 'python kaha', 'runtime kaise', 'how does python', 'where is numpy', 'how does the runtime', 'python runtime'],
    body:
      'Python actually runs, it is not simulated: Pyodide (CPython 3.12 WASM) loads in a web worker,\n' +
      'and the numpy and pandas wheels are bundled in `public/pyodide`. On the first run the runtime\n' +
      'takes 30-60s to unpack; after that it starts instantly from cache.\n' +
      '`input()` reads from the Notebook\'s "Program input" box — one value per line.\n' +
      'SQL (sql.js) and PDF (pdf.js) load from local files in the same way.',
  },
  {
    id: 'storage',
    where: 'Settings',
    route: '/settings',
    keys: ['storage', 'save', 'saved', 'saving', 'data', 'progress', 'localstorage', 'backup', 'export', 'import', 'reset', 'persist', 'stored'],
    phrases: ['progress kaha', 'data kaha', 'backup kaise', 'export kaise', 'where is progress', 'where is data', 'how to backup', 'how to export'],
    body:
      'Your progress stays in the browser — localStorage key `aiml:state:v1` (XP, streak,\n' +
      'attempts, mistakes, notes, bookmarks, saved code). Nothing leaves the device.\n' +
      'Use Settings → Export/Import to export all progress to a JSON file or load it back.\n' +
      'If you want a hard reset, use Settings → reset, or delete that same localStorage key.',
  },
  {
    id: 'assistant',
    where: 'AI Assistant',
    route: '/',
    keys: ['assistant', 'tutor', 'ai', 'bot', 'answer', 'jawab', 'hint', 'explain', 'samjhao', 'doubt', 'model', 'help', 'chat'],
    phrases: ['ai kaise', 'assistant kaise', 'tum kaise', 'ai kaise kaam', 'how does ai', 'how does the assistant', 'how do you work', 'how does ai work'],
    body:
      'I am this app\'s own assistant, not a hosted model: your question is retrieved against the bundled\n' +
      'curriculum (`src/core/ai/assistant.ts` + `src/core/ai/rag.ts`), and\n' +
      'hint / debug / next-task answers come from the deterministic core (`src/core/ai/tutor.ts`,\n' +
      '`src/core/ai/coach.ts`).\n' +
      'That is why I do not invent wrong answers: when nothing matches, I say plainly "not found in the\n' +
      'curriculum". Project questions (setup, where to add content, how to test) come from a separate\n' +
      'knowledge layer — that is what this answer is using.',
  },
  {
    id: 'content-add-question',
    where: 'Question Bank',
    route: '/questions',
    keys: ['question', 'questions', 'bank', 'sawaal', 'add', 'jodo', 'naya', 'naye', 'expand', 'quota', 'authoring', 'create', 'insert'],
    phrases: ['naya question', 'question add', 'question jodo', 'questions add', 'bank me', 'add a question', 'where to add a question', 'new question'],
    body:
      'To add a new question:\n' +
      '  1. Write an item in `content/questions/expansion/<track>.json` (short keys s/t/d/i/q/a/x).\n' +
      '  2. `npm run questions:expand-track -- --track=<track> --file=content/questions/expansion/<track>.json`\n' +
      '  3. `npm run questions:quota` — per-track × per-type quota gate (if short, it exits 1 with an explanation).\n' +
      'The import is append-only and idempotent: duplicate ids and duplicate text are skipped, and\n' +
      'each item gains `source: "authored"`, `sourceVersion`, and `verifiedAt` provenance —\n' +
      'PDF-derived content never looks like hand-written content.',
  },
  {
    id: 'content-add-lesson',
    where: 'Courses',
    route: '/courses',
    keys: ['lesson', 'topic', 'concept', 'guide', 'pack', 'packs', 'curriculum', 'section', 'sections', 'badlo', 'content', 'author', 'edit'],
    phrases: ['lesson add', 'topic add', 'naya lesson', 'curriculum kaise', 'content kaha', 'add a lesson', 'where to add content', 'how does curriculum'],
    body:
      'Content has three layers, and each layer has its own source file:\n' +
      '  · extracted — `tools/extract.mjs` builds `public/generated/curriculum/*.json` from the PDF (regeneration\n' +
      '    needs the source PDF).\n' +
      '  · authored packs — `content/curriculum/packs/<sectionId>.json` (16-part topic workspace) →\n' +
      '    `npm run packs:write`; guides — `content/curriculum/guides/<track>.json` → `npm run curriculum:guides:write`.\n' +
      '  · notebooks — `content/notebooks/*.ipynb` → `npm run notebooks:write`.\n' +
      'Every pass executes its snippets against real Python to stamp the output, and marks anything that\n' +
      'cannot be true as `verified: false` — invented output is never stored.',
  },
  {
    id: 'dev-check',
    where: 'Settings',
    route: '/settings',
    keys: ['test', 'tests', 'typecheck', 'build', 'commands', 'run', 'install', 'setup', 'dev', 'npm', 'doctor', 'gate', 'ci', 'check'],
    phrases: ['test kaise', 'build kaise', 'kaise chalaun', 'kaise chalaye', 'how to run', 'commands kya', 'how to test', 'how to build'],
    body:
      'There is no CI in this repo — these are the gate commands:\n' +
      '  · `npm run dev` — local app (http://localhost:5173)\n' +
      '  · `npm run typecheck` — `tsc --noEmit`, strict\n' +
      '  · `npm test` — `node --test scripts/tests/*.test.{cjs,mjs}` (281 tests, ~4s)\n' +
      '  · `npm run build` — production bundle (~1 min; Monaco\'s >1500 kB chunk warning is normal)\n' +
      'Extra checks: `npm run doctor` (assets + deps), `npm run curriculum:validate`, `npm run questions:manifest`,\n' +
      '`npm run questions:quota`. When working on one file: `node --test scripts/tests/accuracy.test.mjs`.',
  },
  {
    id: 'code-map',
    where: 'Dashboard',
    route: '/',
    keys: ['code', 'structure', 'engine', 'file', 'files', 'folder', 'src', 'component', 'components', 'architecture', 'repo', 'repository'],
    phrases: ['code kaha', 'file kaha', 'code kaise', 'kaun si file', 'kitni files', 'architecture', 'where is the code', 'which file'],
    body:
      'Code map:\n' +
      '  · `src/core/*` — all the logic, in four pure layers: `learning` (progress, coverage, roadmap,\n' +
      '    review), `assessment` (accuracy, evaluate, exam, playbook, paths), `ai` (tutor, coach,\n' +
      '    mission, assistant, rag), and `platform` (keys, search, anim, notify). These are free of React,\n' +
      '    which is why they are testable.\n' +
      '  · `src/features/*` and `src/components/*` — screens and UI; the route table is in `src/app/App.tsx`.\n' +
      '  · `src/core/storage/*` — store (localStorage), theme/UI prefs, exam writes.\n' +
      '  · `src/core/data/*` — curriculum / questions / notebooks / tracks loaders (from `public/generated/`).\n' +
      '  · `scripts/tests/*.test.mjs` — node:test suite that runs against the real curriculum.\n' +
      '  · `content/**` is source; `public/**` is GENERATED or bundled runtime — do not edit it by hand,\n' +
      '    edit the pipeline (`scripts/*.cjs`).\n' +
      'Rule: put any rule you want to test in `src/core/*` (learning/assessment/ai/platform), because\n' +
      '`.tsx` cannot be imported by tests.',
  },
  {
    id: 'publish',
    where: 'Settings',
    route: '/settings',
    keys: ['deploy', 'deployment', 'publish', 'host', 'live', 'url', 'specific', 'static', 'production', 'online', 'serve'],
    phrases: ['deploy kaise', 'publish kaise', 'live kaise', 'host kaise', 'how to deploy', 'how to publish', 'how to host'],
    body:
      'The app is a static SPA: `npm run build` produces `dist/`, and that folder runs on any static\n' +
      'host (nginx/IIS/USB/Netlify/Specific). This repo also includes `specific.hcl`\n' +
      '(`specific dev` local, `specific deploy` production) — build with `npm run build` and serve with\n' +
      '`npx serve -s dist -l $PORT`.\n' +
      'The app works the same after deployment: all runtime assets ship with the same bundle.',
  },
  {
    id: 'pages',
    where: 'Dashboard',
    route: '/',
    keys: ['page', 'pages', 'screen', 'screens', 'route', 'routes', 'features', 'feature', 'navigation', 'nav'],
    phrases: ['kitne pages', 'kaunse pages', 'kya kya hai', 'features kya', 'pages kitne', 'how many pages', 'which pages', 'what features'],
    body:
      'Screens at a glance:\n' +
      '  · Learn — Dashboard, Learning Path (8 tracks), Concepts, Lesson (Learn/Coding/Debug/Project…),\n' +
      '    Review Queue, Mistake Tracker.\n' +
      '  · Practice — Question Bank, Playbook V15, Timed Exam, Notebook Lab, SQL Lab, NumPy+Pandas Lab,\n' +
      '    Interview Mode, Project Defense, Project Lab, Code Playground.\n' +
      '  · AI — AI/GenAI Lab, Agentic Lab, RAG Lab, Final Assessment.\n' +
      '  · Career — Project Defense, Mock Interviews, Job Prep, Progress (study time + mastery).\n' +
      '  · Tools — Notes, Cheat Sheets, PDF Reader, Settings.',
  },
  {
    id: 'language',
    where: 'Settings',
    route: '/settings',
    keys: ['language', 'lang', 'hinglish', 'english', 'hindi', 'bhasha', 'locale', 'switch', 'translate'],
    phrases: ['language kaise', 'hinglish kaise', 'english me', 'how to change language', 'how does language', 'switch to english'],
    body:
      'The UI is available in two languages: Hinglish and English. The toggle is in the header (on small\n' +
      'screens, in the quick-actions menu), and the choice is saved in localStorage. Packs are in\n' +
      '`src/i18n/locales.ts`, and a missing key falls back to English — so when adding a new key, put\n' +
      'English first, then Hinglish.',
  },
];

/**
 * Question filler, ignored when counting KEY hits (a phrase may still contain it).
 *
 * Without this list, two of these words alone satisfy the two-hit minimum: "lambda kya hai" scored
 * `kya` + `hai` against the "what is this app" fact and was answered with a project overview instead
 * of the concept. They are filler in a question, so they cannot be evidence for a topic.
 */
const STOP = new Set([
  'kya', 'kyun', 'kyu', 'hai', 'hain', 'ho', 'hota', 'hoga', 'kaise', 'kaha', 'kahan', 'kaun', 'kitna', 'kitne', 'kitni',
  'karo', 'karun', 'karna', 'karte', 'kar', 'me', 'mein', 'ka', 'ki', 'ke', 'se', 'ko', 'aur', 'ya', 'ye', 'yeh', 'is', 'ise',
  'batao', 'batado', 'chahiye', 'mujhe', 'mera', 'meri', 'nahi', 'to', 'bhi',
  'this', 'the', 'a', 'an', 'of', 'to', 'for', 'how', 'what', 'where', 'which', 'is', 'are', 'do', 'i', 'my', 'me', 'about',
]);

/** Lowercase, punctuation-free words. Hinglish text is latin script, so this is enough. */
function words(question: string): string[] {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Strict by design: a phrase counts 3, a single key word 1, and a candidate needs 2.
 *
 * Two consequences, both wanted: "test kaise chalaun" scores 3 (phrase) + 2 (keys) and wins, while
 * "variables aur data types" scores 0 and falls through to curriculum retrieval. The second term is
 * the one that matters — `askLocal` is one entry point for two very different corpora.
 */
const PHRASE_WEIGHT = 3;
const MIN_SCORE = 2;

export interface ProjectHit {
  fact: ProjectFact;
  score: number;
}

/** Score every fact, best first. Exported so a test can see near-misses, not just the winner. */
export function rankProjectFacts(question: string): ProjectHit[] {
  const ws = words(question);
  if (!ws.length) return [];
  // Keys are matched on the meaningful words only; phrases are matched on the question as typed,
  // because a phrase IS the meaning ("test kaise" is a request, not two filler words).
  const set = new Set(ws.filter((w) => !STOP.has(w)));
  const padded = ` ${ws.join(' ')} `;
  const hits: ProjectHit[] = [];
  for (const fact of PROJECT_FACTS) {
    let score = 0;
    for (const phrase of fact.phrases ?? []) if (padded.includes(` ${phrase} `)) score += PHRASE_WEIGHT;
    for (const key of fact.keys) if (set.has(key)) score += 1;
    if (score >= MIN_SCORE) hits.push({ fact, score });
  }
  // Stable: equal scores keep the data order, so the same question always gets the same answer.
  return hits.sort((a, b) => b.score - a.score || PROJECT_FACTS.indexOf(a.fact) - PROJECT_FACTS.indexOf(b.fact));
}

/**
 * The best project answer, or null when the question is not about this project.
 *
 * `null` is the important half of the contract: the caller then retrieves the curriculum exactly as
 * it did before this module existed.
 */
export function askProject(question: string): ProjectAnswer | null {
  const [best] = rankProjectFacts(question);
  if (!best) return null;
  return {
    text: best.fact.body,
    sources: [{ title: best.fact.where, route: best.fact.route }],
    // Normalised against the strongest possible single-phrase-plus-two-keys hit, so the number stays
    // comparable across facts instead of just counting words the fact happens to list.
    confidence: Number(Math.min(1, best.score / 8).toFixed(3)),
    kind: 'project',
  };
}
