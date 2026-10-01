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
  /** Hinglish answer text. */
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
  /** What the learner would type. Single words, lowercase, Hinglish and English. */
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
    keys: ['app', 'project', 'brocode', 'website', 'site', 'built', 'bana', 'banaya'],
    phrases: ['ye app', 'this app', 'ye project', 'ye website', 'kya hai ye', 'what is this'],
    body:
      'BroCode (AI Engineer Master Lab) — ek AI/Data learning lab jo poori tarah is device par chalta hai.\n' +
      'Iski poori content ek 457-page PDF se extract hui hai: 29 sections, 8 tracks (Python Core se\n' +
      'Interview + Projects tak), har section me lesson stages, questions, notebooks aur projects.\n' +
      'Python, SQL, PDF reading — sab browser ke andar chalta hai: Pyodide (Python 3.12 + numpy/pandas),\n' +
      'sql.js aur pdf.js is app ke saath bundled hain, isliye internet ki zaroorat nahi padti.',
  },
  {
    id: 'runtime',
    where: 'Code Playground',
    route: '/playground',
    keys: ['python', 'pyodide', 'runtime', 'worker', 'numpy', 'pandas', 'run', 'chalao', 'chalta', 'engine', 'wasm'],
    phrases: ['python kaise', 'numpy kaha', 'python kaha', 'runtime kaise'],
    body:
      'Python asli me chal raha hota hai, simulate nahi: Pyodide (CPython 3.12 WASM) ek web worker me\n' +
      'load hota hai, numpy aur pandas ke wheels `public/pyodide` me bundled hain. First run me runtime\n' +
      'unpack hone me 30-60s lagte hain, uske baad cache se turant uthta hai.\n' +
      '`input()` Notebook ke "Program input" box se padhta hai — ek value per line.\n' +
      'SQL (sql.js) aur PDF (pdf.js) bhi isi tarah local files se load hote hain.',
  },
  {
    id: 'storage',
    where: 'Settings',
    route: '/settings',
    keys: ['storage', 'save', 'saved', 'saving', 'data', 'progress', 'localstorage', 'backup', 'export', 'import', 'reset'],
    phrases: ['progress kaha', 'data kaha', 'backup kaise', 'export kaise'],
    body:
      'Tumhara progress browser me hi rehta hai — localStorage key `aiml:state:v1` (XP, streak,\n' +
      'attempts, mistakes, notes, bookmarks, saved code). Kuch bhi device se bahar nahi jata.\n' +
      'Settings → Export/Import se pura progress JSON file me nikal ya wapas load kar sakte ho.\n' +
      'Hard reset chahiye to Settings → reset, ya wahi localStorage key delete kar do.',
  },
  {
    id: 'assistant',
    where: 'AI Assistant',
    route: '/',
    keys: ['assistant', 'tutor', 'ai', 'bot', 'answer', 'jawab', 'hint', 'explain', 'samjhao', 'doubt', 'model'],
    phrases: ['ai kaise', 'assistant kaise', 'tum kaise', 'ai kaise kaam'],
    body:
      'Main is app ka apna assistant hoon, aur koi hosted model nahi hoon: tumhara sawaal bundled\n' +
      'curriculum par retrieve hota hai (`src/core/ai/assistant.ts` + `src/core/ai/rag.ts`), aur\n' +
      'hint / debug / next-task ke jawab deterministic core dete hain (`src/core/ai/tutor.ts`,\n' +
      '`src/core/ai/coach.ts`).\n' +
      'Isi liye main galat jawab invent nahi karta: jo match nahi hota uske liye saaf "curriculum me\n' +
      'nahi mila" bolta hoon. Project ke sawaal (setup, content kaha add karein, kaise test karein)\n' +
      'alag knowledge layer se aate hain — wahi ye jawab de raha hai.',
  },
  {
    id: 'content-add-question',
    where: 'Question Bank',
    route: '/questions',
    keys: ['question', 'questions', 'bank', 'sawaal', 'add', 'jodo', 'naya', 'naye', 'expand', 'quota', 'authoring'],
    phrases: ['naya question', 'question add', 'question jodo', 'questions add', 'bank me'],
    body:
      'Naya question add karne ka rasta:\n' +
      '  1. `content/questions/expansion/<track>.json` me item likho (short keys s/t/d/i/q/a/x).\n' +
      '  2. `npm run questions:expand-track -- --track=<track> --file=content/questions/expansion/<track>.json`\n' +
      '  3. `npm run questions:quota` — per-track × per-type quota gate (short ho to exit 1 ke saath batata hai).\n' +
      'Import append-only aur idempotent hai: duplicate id aur duplicate text skip ho jate hain, aur\n' +
      'item par `source: "authored"`, `sourceVersion` aur `verifiedAt` provenance chadh jati hai —\n' +
      'PDF se aaya content kabhi hand-written content jaisa nahi dikhta.',
  },
  {
    id: 'content-add-lesson',
    where: 'Learning Path',
    route: '/path',
    keys: ['lesson', 'topic', 'concept', 'guide', 'pack', 'packs', 'curriculum', 'section', 'sections', 'badlo', 'content'],
    phrases: ['lesson add', 'topic add', 'naya lesson', 'curriculum kaise', 'content kaha'],
    body:
      'Content three layers me hai, aur teenon ka source alag file hai:\n' +
      '  · extracted — `tools/extract.mjs` PDF se `public/generated/curriculum/*.json` banata hai (regeneration\n' +
      '    ke liye source PDF chahiye).\n' +
      '  · authored packs — `content/curriculum/packs/<sectionId>.json` (16-part topic workspace) →\n' +
      '    `npm run packs:write`; guides — `content/curriculum/guides/<track>.json` → `npm run curriculum:guides:write`.\n' +
      '  · notebooks — `content/notebooks/*.ipynb` → `npm run notebooks:write`.\n' +
      'Har pass apne snippets asli Python se execute karke output stamp karta hai, aur jo sach nahi\n' +
      'ban sakta use `verified: false` mark karta hai — invented output kabhi store nahi hota.',
  },
  {
    id: 'dev-check',
    where: 'Settings',
    route: '/settings',
    keys: ['test', 'tests', 'typecheck', 'build', 'commands', 'run', 'install', 'setup', 'dev', 'npm', 'doctor', 'gate'],
    phrases: ['test kaise', 'build kaise', 'kaise chalaun', 'kaise chalaye', 'how to run', 'commands kya'],
    body:
      'Is repo me CI nahi hai — ye teen commands hi gate hain:\n' +
      '  · `npm run dev` — local app (http://localhost:5173)\n' +
      '  · `npm run typecheck` — `tsc --noEmit`, strict\n' +
      '  · `npm test` — `node --test scripts/tests/*.test.{cjs,mjs}` (281 tests, ~4s)\n' +
      '  · `npm run build` — production bundle (~1 min; Monaco ka >1500 kB chunk warning normal hai)\n' +
      'Extra checks: `npm run doctor` (assets + deps), `npm run curriculum:validate`, `npm run questions:manifest`,\n' +
      '`npm run questions:quota`. Ek file par kaam karte waqt: `node --test scripts/tests/accuracy.test.mjs`.',
  },
  {
    id: 'code-map',
    where: 'Dashboard',
    route: '/',
    keys: ['code', 'structure', 'engine', 'file', 'files', 'folder', 'src', 'component', 'components', 'architecture'],
    phrases: ['code kaha', 'file kaha', 'code kaise', 'kaun si file', 'kitni files', 'architecture'],
    body:
      'Code ka naksha:\n' +
      '  · `src/core/*` — saara logic, chaar pure layer me: `learning` (progress, coverage, roadmap,\n' +
      '    review), `assessment` (accuracy, evaluate, exam, playbook, paths), `ai` (tutor, coach,\n' +
      '    mission, assistant, rag) aur `platform` (keys, search, anim, notify). Ye React se azaad\n' +
      '    hain, isliye yahi testable hain.\n' +
      '  · `src/features/*` aur `src/components/*` — screens aur UI; route table `src/app/App.tsx` me.\n' +
      '  · `src/core/storage/*` — store (localStorage), theme/UI prefs, exam writes.\n' +
      '  · `src/core/data/*` — curriculum / questions / notebooks / tracks loaders (`public/generated/` se).\n' +
      '  · `scripts/tests/*.test.mjs` — node:test suite, jo asli curriculum par chalti hai.\n' +
      '  · `content/**` source hai, `public/**` GENERATED ya bundled runtime — use haath se edit nahi karte,\n' +
      '    pipeline (`scripts/*.cjs`) edit karte hain.\n' +
      'Rule: jo rule test karna ho use `src/core/*` (learning/assessment/ai/platform) me rakho, kyunki\n' +
      '`.tsx` ko test import nahi kar sakta.',
  },
  {
    id: 'publish',
    where: 'Settings',
    route: '/settings',
    keys: ['deploy', 'deployment', 'publish', 'host', 'live', 'url', 'specific', 'static', 'production', 'online'],
    phrases: ['deploy kaise', 'publish kaise', 'live kaise', 'host kaise'],
    body:
      'App ek static SPA hai: `npm run build` se `dist/` banta hai, aur wahi folder kisi bhi static\n' +
      'host (nginx/IIS/USB/Netlify/Specific) par chal jata hai. Is repo me `specific.hcl` bhi hai\n' +
      '(`specific dev` local, `specific deploy` production) — build `npm run build` aur service\n' +
      '`npx serve -s dist -l $PORT`.\n' +
      'Deploy ke baad bhi app waise hi chalta hai: sab runtime assets usi bundle ke saath jaate hain.',
  },
  {
    id: 'pages',
    where: 'Dashboard',
    route: '/',
    keys: ['page', 'pages', 'screen', 'screens', 'route', 'routes', 'features', 'feature'],
    phrases: ['kitne pages', 'kaunse pages', 'kya kya hai', 'features kya', 'pages kitne'],
    body:
      'Screen-wise kya kya hai:\n' +
      '  · Learn — Dashboard, Learning Path (8 tracks), Concepts, Lesson (Learn/Coding/Debug/Project…),\n' +
      '    Review Queue, Mistake Tracker.\n' +
      '  · Practice — Question Bank, Playbook V15, Timed Exam, Notebook Lab, SQL Lab, NumPy+Pandas Lab,\n' +
      '    Interview Mode, Project Defense, Project Lab, Code Playground.\n' +
      '  · AI — AI/GenAI Lab, Agentic Lab, RAG Lab, Final Assessment.\n' +
      '  · Career — Resume Labs, Mock Interviews, Job Prep, Progress (study time + mastery).\n' +
      '  · Tools — Notes, Cheat Sheets, PDF Reader, Settings.',
  },
  {
    id: 'language',
    where: 'Settings',
    route: '/settings',
    keys: ['language', 'lang', 'hinglish', 'english', 'hindi', 'bhasha', 'locale'],
    phrases: ['language kaise', 'hinglish kaise', 'english me'],
    body:
      'UI do bhasha me hai: Hinglish aur English. Toggle header me (chhoti screens par quick-actions\n' +
      'menu me) hai, aur choice localStorage me save hoti hai. Packs `src/i18n/locales.ts` me hain,\n' +
      'aur missing key English par fall back karti hai — isliye naya key add karte waqt pehle English\n' +
      'me daalo, phir Hinglish.',
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
