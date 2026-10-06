/**
 * The career engine — the rules behind the Career pillar's every number.
 *
 * Career is the pillar that turns finished work into a job: it does not teach (that is the
 * courses/track layer), does not drill (practice) and does not run code (labs). Everything it
 * shows is derived from records OTHER surfaces already wrote — curriculum mastery from the lesson
 * gates, builds from the project stage, resume pitches from the defense answers, profile and
 * application ticks from the job-prep checklist — so this module never imports a store, React or
 * a page: the caller hands it one plain bag of counts, and every function here is pure arithmetic
 * over that bag. That is what lets `scripts/tests/career.test.mjs` drive it with fixtures under
 * `node --test` (see the loader ceiling in AGENTS.md).
 *
 * Three rules hold the file together:
 *
 *   1. NO INVENTED NUMBERS. A tile or bar shows a percentage only when a real denominator exists;
 *      where none does (`bankTotal` before the manifest loads, an empty mock set) the figure is
 *      `null` and the page shows the raw count instead. A percentage is never faked.
 *   2. ONE OWNER PER RULE. The job-prep checklist, its phase split and the readiness weights live
 *      HERE — JobPrep.tsx renders this data and the Career hub aggregates it, so the two screens
 *      cannot disagree. The portfolio trio rule lives HERE — ProjectLab and the Career hub both
 *      call `portfolioTrio` instead of each re-implementing "done first, then strongest".
 *   3. ROLES ARE AUTHORED, SKILLS ARE MEASURED. A target role is a choice (a small authored
 *      catalog, like TRACK_DEFS), but nothing about a role's readiness is hardcoded: its skills
 *      are track ids resolved against the caller's real per-track mastery, and an unknown track id
 *      is dropped, not crashed on — so a future track extends the roles without an edit here.
 */

/* ------------------------------------------------------------------ types */

export type ChecklistPhase = 'profile' | 'depth' | 'interview' | 'apply';

export interface ChecklistItem {
  id: string;
  label: string;
  hint: string;
  to: string;
  weight: number;
  phase: ChecklistPhase;
  /** The lucide icon NAME — the page resolves the component (an engine cannot import lucide). */
  icon: string;
}

export interface CareerCounts {
  /** Published curriculum sections — the honest denominator for build/defense coverage. */
  sections: number;
  /** Average section mastery, 0–100 (the lesson gates' own figure, averaged by the caller). */
  learningPct: number;
  mastered: number;
  /** Sections whose mini build is marked done. */
  miniDone: number;
  /** Sections whose Project Lab build gate is done (the record /projects writes). */
  projectGates: number;
  /** `miniDone + projectGates` — the builds a portfolio can draw from. */
  buildsDone: number;
  /** Sections defended (the defense stage's own gate). */
  defenseGates: number;
  /** `resume:<projId>:<i>` answers stored — the resume pitches a learner has written. */
  resumeAnswers: number;
  /** Every defense question, for every defense project (the real denominator). */
  resumeTotal: number;
  mockDone: number;
  /** Questions across every mock round + the intensive set; 0 before extras load. */
  mockTotal: number;
  bankPractised: number;
  /** Published questions, or null until the bank manifest arrives. */
  bankTotal: number | null;
  notebookCells: number;
  /** Total notebook code cells, or null until the notebook manifest arrives. */
  notebookCellsTotal: number | null;
  /** Written interview answers (`interviewAnswers` + the standalone lab's records). */
  interviewAnswers: number;
  /** The job-prep checklist record, as stored. */
  checklist: Record<string, boolean>;
}

/* ------------------------------------------------- the job-prep checklist */

export const CHECKLIST_PHASES: { id: ChecklistPhase; label: string; icon: string }[] = [
  { id: 'profile', label: 'Profile & CV', icon: 'Briefcase' },
  { id: 'depth', label: 'Technical Depth', icon: 'Target' },
  { id: 'interview', label: 'Interview Readiness', icon: 'TrendingUp' },
  { id: 'apply', label: 'Application Engine', icon: 'ClipboardList' },
];

/**
 * The 16-item checklist, as data.
 *
 * Moved here from JobPrep.tsx (which now renders this) because the Career hub needs the same
 * records — which ticks are profile, which are applications — and two screens must not hold two
 * copies of the list. The ids are STORAGE ids (`state.jobPrep[id]`): renaming one silently
 * unticks every learner who ticked it. Do not rename.
 */
export const CAREER_CHECKLIST: ChecklistItem[] = [
  { id: 'resume-defense', label: 'Har project ka 60-second pitch ready', hint: 'Project Defense lab me practice karo.', to: '/defense', weight: 3, phase: 'profile', icon: 'Briefcase' },
  { id: 'github', label: 'GitHub profile me pinned projects', hint: 'README me problem, stack, run steps.', to: '/projects', weight: 2, phase: 'profile', icon: 'Briefcase' },
  { id: 'linkedin', label: 'LinkedIn headline + skills update', hint: 'Python, SQL, ML, GenAI, FastAPI keywords.', to: '/progress', weight: 1, phase: 'profile', icon: 'Briefcase' },

  { id: 'python-core', label: 'Python Core 100% mastered', hint: 's01–s16 ka mastery pura karo.', to: '/course/python', weight: 4, phase: 'depth', icon: 'Target' },
  { id: 'data-stack', label: 'NumPy + Pandas + SQL comfortable', hint: 'Data track ke saare labs complete karo.', to: '/numpy-pandas', weight: 3, phase: 'depth', icon: 'Target' },
  { id: 'ml-nlp', label: 'ML + NLP ke core concepts clear', hint: 'Model evaluation aur NLP basics.', to: '/course/ml-nlp', weight: 3, phase: 'depth', icon: 'Target' },
  { id: 'genai-agentic', label: 'GenAI + RAG + Agentic hands-on', hint: 'RAG Lab me retrieval khud build karo.', to: '/rag-lab', weight: 4, phase: 'depth', icon: 'Target' },
  { id: 'apis', label: 'Ek API deploy kiya hua', hint: 'FastAPI + Docker + CI/CD.', to: '/course/build-production', weight: 3, phase: 'depth', icon: 'Target' },

  { id: 'mock-round-1', label: 'Kam se kam 2 mock rounds complete', hint: '60%+ score ke saath.', to: '/mock-interviews', weight: 3, phase: 'interview', icon: 'TrendingUp' },
  { id: 'aloud', label: '20 questions zor se bolke practice', hint: 'Aloud bolna fluency build karta hai.', to: '/interview-mode', weight: 2, phase: 'interview', icon: 'TrendingUp' },
  { id: 'mistakes-clear', label: 'Saare open mistakes close', hint: 'Mistake Tracker me fix mark karo.', to: '/mistakes', weight: 3, phase: 'interview', icon: 'TrendingUp' },
  { id: 'final', label: 'Final Assessment pass', hint: 'Poora curriculum ka final gate.', to: '/final-assessment', weight: 4, phase: 'interview', icon: 'TrendingUp' },

  { id: 'target-list', label: '20 target companies ki list', hint: 'Role, stack aur referral track karo.', to: '/job-prep', weight: 2, phase: 'apply', icon: 'ClipboardList' },
  { id: 'apply-5', label: 'Is hafte 5 applications bheje', hint: 'Tailored CV ke saath.', to: '/job-prep', weight: 3, phase: 'apply', icon: 'ClipboardList' },
  { id: 'referral', label: '2 referral ya cold DM', hint: 'Short, specific message likho.', to: '/job-prep', weight: 2, phase: 'apply', icon: 'ClipboardList' },
  { id: 'portfolio', label: 'Portfolio me 3 projects live', hint: 'Deployed link ke saath.', to: '/projects', weight: 3, phase: 'apply', icon: 'ClipboardList' },
];

/** The two ticks the "GitHub / LinkedIn" readiness row and the Profile tile read. */
export const PROFILE_IDS = ['github', 'linkedin'] as const;

export interface PhaseStat { id: ChecklistPhase; label: string; icon: string; done: number; total: number; pct: number }

export interface ChecklistReadiness {
  done: number;
  total: number;
  /** Weighted percentage — the same figure JobPrep's ring prints. */
  pct: number;
  byPhase: PhaseStat[];
}

/**
 * The checklist's readiness, weighted by each item's `weight`.
 *
 * Weighted because "Final Assessment pass" and "LinkedIn headline update" are not the same size
 * of step; the weights are the authored part, the arithmetic is the engine's. One loop per phase
 * so the ring, the per-phase bars and the counts come out of the same pass.
 */
export function checklistReadiness(checklist: Record<string, boolean> = {}): ChecklistReadiness {
  const byPhase = CHECKLIST_PHASES.map((p) => {
    const items = CAREER_CHECKLIST.filter((it) => it.phase === p.id);
    const totalW = items.reduce((a, it) => a + it.weight, 0);
    const doneW = items.filter((it) => checklist[it.id]).reduce((a, it) => a + it.weight, 0);
    return { ...p, done: items.filter((it) => checklist[it.id]).length, total: items.length, pct: Math.round((doneW / Math.max(1, totalW)) * 100) };
  });
  const totalW = CAREER_CHECKLIST.reduce((a, it) => a + it.weight, 0);
  const doneW = CAREER_CHECKLIST.filter((it) => checklist[it.id]).reduce((a, it) => a + it.weight, 0);
  return {
    done: CAREER_CHECKLIST.filter((it) => checklist[it.id]).length,
    total: CAREER_CHECKLIST.length,
    pct: Math.round((doneW / Math.max(1, totalW)) * 100),
    byPhase,
  };
}

/* ------------------------------------------------------- the flow + NBA */

/**
 * The career operating system's flow, in the order a learner walks it.
 * The Next Best Action names where in this flow the learner stands; the page renders the strip.
 */
export const CAREER_FLOW = ['LEARN', 'BUILD', 'PROVE', 'PRESENT', 'PREPARE', 'APPLY', 'INTERVIEW', 'GET HIRED'] as const;
export type CareerFlowPhase = (typeof CAREER_FLOW)[number];

export interface NextCareerAction {
  phase: CareerFlowPhase;
  /** The one sentence the learner should do next. */
  title: string;
  /** Why — always the real number that triggered the gate. */
  reason: string;
  to: string;
}

export interface FlowStep { phase: CareerFlowPhase; state: 'done' | 'current' | 'todo' }

/**
 * The first gate that fails, in flow order — the whole "what next" answer.
 *
 * Every gate is a REAL record, and the threshold is stated in the reason:
 *   LEARN    below 25% curriculum mastery — build on sand and the portfolio shows it;
 *   BUILD    zero completed builds;
 *   PROVE    zero defenses — an undefended build is a claim nobody tested;
 *   PRESENT  zero resume pitches (the defense answers ARE the pitch material);
 *   PREPARE  fewer than 2 mock rounds (the checklist's own bar);
 *   APPLY    GitHub/LinkedIn unticked, or the application items open;
 *   INTERVIEW mock rounds exist but not one written interview answer;
 *   GET HIRED every gate green.
 * A phase the learner has started but not finished does NOT block — the readiness section keeps
 * showing its percentage; the NBA only ever names the first thing with no progress at all.
 */
export function nextCareerAction(c: CareerCounts): NextCareerAction {
  const has = (id: string) => !!c.checklist[id];
  if (c.learningPct < 25) {
    return { phase: 'LEARN', title: 'Curriculum continue karo', reason: `Learning ${c.learningPct}% hai — pehle 25% fundamentals, project uske baad.`, to: '/courses' };
  }
  if (c.buildsDone === 0) {
    return { phase: 'BUILD', title: 'Pehla project build karo', reason: 'Ek bhi build complete nahi hui — portfolio ka pehla project yahin se banta hai.', to: '/projects' };
  }
  if (c.defenseGates === 0) {
    return { phase: 'PROVE', title: 'Project defend karo', reason: `${c.buildsDone === 1 ? 'Build' : 'Builds'} ready hain — ab interviewer ke sawalon me defend karo.`, to: '/defense' };
  }
  if (c.resumeAnswers === 0) {
    return { phase: 'PRESENT', title: 'Resume pitches likho', reason: 'Defense ke answers hi resume ke bullets hain — pehla pitch abhi tak likha nahi.', to: '/defense' };
  }
  if (c.mockDone < 2) {
    return { phase: 'PREPARE', title: 'Mock rounds do', reason: `${c.mockDone} / 2 mock rounds — interview pressure ki practice yahin hoti hai.`, to: '/mock-interviews' };
  }
  if (!has('github') || !has('linkedin')) {
    return { phase: 'APPLY', title: 'GitHub + LinkedIn set karo', reason: 'Applications se pehle profile recruiter-ready honi chahiye — checklist me 2 ticks bache hain.', to: '/job-prep' };
  }
  if (!CAREER_CHECKLIST.filter((it) => it.phase === 'apply').every((it) => has(it.id))) {
    return { phase: 'APPLY', title: 'Applications bhejo', reason: 'Target list, applications, referral — apply engine chalao.', to: '/job-prep' };
  }
  if (c.interviewAnswers === 0) {
    return { phase: 'INTERVIEW', title: 'Bolkar interview practice', reason: 'Written answers hain — Interview Mode me zor se bolke fluency banao.', to: '/interview-mode' };
  }
  return { phase: 'GET HIRED', title: 'Sab systems ready — apply karo', reason: 'Learn, build, prove, present, prepare, apply: sab green. Ab interviews crack karo.', to: '/job-prep' };
}

/** The flow strip's state: every phase before the NBA's is done, the NBA's is current. */
export function careerFlow(c: CareerCounts): FlowStep[] {
  const current = nextCareerAction(c).phase;
  const at = CAREER_FLOW.indexOf(current);
  return CAREER_FLOW.map((phase, i) => ({ phase, state: i < at ? 'done' : i === at ? 'current' : 'todo' }));
}

/* ------------------------------------------------------- roadmap tiles */

export interface CareerTile {
  id: string;
  label: string;
  emoji: string;
  hint: string;
  to: string;
  done: number;
  total: number;
  /** null when no honest denominator exists — the page shows the raw count, never a made-up pct. */
  pct: number | null;
}

/** The six roadmap tiles, each with its own real denominator. */
export function careerRoadmap(c: CareerCounts): CareerTile[] {
  const ck = c.checklist;
  const ticked = (ids: readonly string[]) => ids.filter((id) => ck[id]).length;
  const applyItems = CAREER_CHECKLIST.filter((it) => it.phase === 'apply');
  const pctOf = (done: number, total: number) => (total > 0 ? Math.round((done / total) * 100) : null);
  return [
    { id: 'learn', label: 'Learn', emoji: '📚', hint: `${c.mastered}/${c.sections} sections mastered`, to: '/courses', done: c.learningPct, total: 100, pct: c.learningPct },
    { id: 'build', label: 'Build', emoji: '💻', hint: 'Project Lab builds', to: '/projects', done: c.projectGates, total: c.sections, pct: pctOf(c.projectGates, c.sections) },
    { id: 'prove', label: 'Prove', emoji: '🛡️', hint: 'Sections defended', to: '/defense', done: c.defenseGates, total: c.sections, pct: pctOf(c.defenseGates, c.sections) },
    { id: 'resume', label: 'Resume', emoji: '📄', hint: 'Defense answers = resume bullets', to: '/defense', done: c.resumeAnswers, total: c.resumeTotal, pct: pctOf(c.resumeAnswers, c.resumeTotal) },
    { id: 'profile', label: 'Profile', emoji: '🌐', hint: 'GitHub + LinkedIn ready', to: '/job-prep', done: ticked(PROFILE_IDS), total: PROFILE_IDS.length, pct: pctOf(ticked(PROFILE_IDS), PROFILE_IDS.length) },
    { id: 'apply', label: 'Apply', emoji: '📨', hint: 'Application engine ticks', to: '/job-prep', done: ticked(applyItems.map((it) => it.id)), total: applyItems.length, pct: pctOf(ticked(applyItems.map((it) => it.id)), applyItems.length) },
  ];
}

/* --------------------------------------------------- job readiness rows */

export type ReadinessState = 'ready' | 'building' | 'started' | 'empty';

export interface ReadinessRow {
  id: string;
  label: string;
  emoji: string;
  to: string;
  hint: string;
  done: number;
  total: number;
  pct: number | null;
  state: ReadinessState;
}

/** A row's state, from its own percentage — the page renders the chip, the engine owns the word. */
export function readinessState(pct: number | null): ReadinessState {
  if (pct === null || pct <= 0) return 'empty';
  if (pct >= 100) return 'ready';
  if (pct >= 50) return 'building';
  return 'started';
}

/** The six readiness rows under 💼 JOB READINESS. */
export function jobReadiness(c: CareerCounts): ReadinessRow[] {
  const ck = c.checklist;
  const profileDone = PROFILE_IDS.filter((id) => ck[id]).length;
  const rows: Omit<ReadinessRow, 'state'>[] = [
    { id: 'resume', label: 'Resume', emoji: '📄', to: '/defense', hint: 'har project ke pitch answers', done: c.resumeAnswers, total: c.resumeTotal, pct: c.resumeTotal > 0 ? Math.round((c.resumeAnswers / c.resumeTotal) * 100) : null },
    { id: 'portfolio', label: 'Portfolio', emoji: '🌐', to: '/projects', hint: '3 live projects', done: Math.min(c.buildsDone, 3), total: 3, pct: Math.round((Math.min(c.buildsDone, 3) / 3) * 100) },
    { id: 'projects', label: 'Projects', emoji: '💻', to: '/projects', hint: 'sections with a shipped build', done: c.projectGates, total: c.sections, pct: c.sections > 0 ? Math.round((c.projectGates / c.sections) * 100) : null },
    { id: 'interview', label: 'Interview', emoji: '🎤', to: '/mock-interviews', hint: 'mock questions passed', done: c.mockDone, total: c.mockTotal, pct: c.mockTotal > 0 ? Math.round((c.mockDone / c.mockTotal) * 100) : null },
    { id: 'defense', label: 'Project Defense', emoji: '🛡️', to: '/defense', hint: 'sections defended', done: c.defenseGates, total: c.sections, pct: c.sections > 0 ? Math.round((c.defenseGates / c.sections) * 100) : null },
    { id: 'github-linkedin', label: 'GitHub / LinkedIn', emoji: '🔗', to: '/job-prep', hint: 'profile ticks', done: profileDone, total: PROFILE_IDS.length, pct: Math.round((profileDone / PROFILE_IDS.length) * 100) },
  ];
  return rows.map((r) => ({ ...r, state: readinessState(r.pct) }));
}

/* ---------------------------------------------------- career progress */

export interface ProgressLine {
  id: string;
  label: string;
  /** null = no honest denominator yet; the page prints the raw count from `note`. */
  pct: number | null;
  note: string;
}

/** The 📊 CAREER PROGRESS bars — one per pillar of the work, all from real records. */
export function careerProgress(c: CareerCounts): ProgressLine[] {
  const pctOf = (done: number, total: number | null) => (total !== null && total > 0 ? Math.round((done / total) * 100) : null);
  return [
    { id: 'learning', label: 'Learning', pct: c.learningPct, note: `${c.mastered}/${c.sections} sections mastered` },
    { id: 'practice', label: 'Practice', pct: pctOf(c.bankPractised, c.bankTotal), note: `${c.bankPractised} answers` },
    { id: 'labs', label: 'Labs', pct: pctOf(c.notebookCells, c.notebookCellsTotal), note: `${c.notebookCells} notebook cells run` },
    { id: 'projects', label: 'Projects', pct: pctOf(c.projectGates, c.sections), note: `${c.projectGates}/${c.sections} builds` },
    { id: 'interview', label: 'Interview', pct: pctOf(c.mockDone, c.mockTotal), note: `${c.mockDone} mock Qs passed` },
    { id: 'resume', label: 'Resume', pct: pctOf(c.resumeAnswers, c.resumeTotal), note: `${c.resumeAnswers}/${c.resumeTotal} pitches` },
    { id: 'portfolio', label: 'Portfolio', pct: Math.round((Math.min(c.buildsDone, 3) / 3) * 100), note: `${Math.min(c.buildsDone, 3)}/3 live projects` },
  ];
}

/* -------------------------------------------------------- target roles */

/** Mastery at or above this = a skill is interview-ready. */
export const SKILL_READY = 75;
/** Mastery at or above this = the skill is building; below it = missing. */
export const SKILL_BUILDING = 40;

export interface TrackSkill {
  id: string;
  label: string;
  pct: number;
  status: 'ready' | 'building' | 'missing';
}

export interface TrackDefLike { id: string; label: string; from: number; to: number }

/**
 * Per-track mastery from the caller's per-section figures.
 *
 * A track with no sections in range (impossible today, possible after a re-import) reads 0 rather
 * than NaN — a skill that teaches nothing cannot be ready.
 */
export function trackMastery(sections: { no: number; masterPct: number }[], tracks: TrackDefLike[]): TrackSkill[] {
  return tracks.map((t) => {
    const secs = sections.filter((s) => s.no >= t.from && s.no <= t.to);
    const pct = secs.length ? Math.round(secs.reduce((a, s) => a + s.masterPct, 0) / secs.length) : 0;
    return { id: t.id, label: t.label, pct, status: pct >= SKILL_READY ? 'ready' : pct >= SKILL_BUILDING ? 'building' : 'missing' } as TrackSkill;
  });
}

export interface TargetRole {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  /** Track ids the role needs — resolved against the caller's tracks, unknown ids dropped. */
  tracks: string[];
}

/**
 * The role catalog — AUTHORED (a choice, like TRACK_DEFS), never measured here.
 *
 * Each role's skills are track ids, so a role's readiness moves when the learner's mastery moves,
 * and a future track extends the roles by being added to a role's list — no new mechanism.
 */
export const TARGET_ROLES: TargetRole[] = [
  { id: 'ai-engineer', label: 'AI Engineer', emoji: '🤖', blurb: 'LLM apps, RAG aur agents ship karne wala end-to-end role.', tracks: ['python', 'data', 'sql', 'ml', 'genai', 'agentic', 'apis'] },
  { id: 'data-analyst', label: 'Data Analyst', emoji: '📊', blurb: 'Data se sawalon ke jawab — SQL, pandas, dashboards.', tracks: ['python', 'data', 'sql'] },
  { id: 'ml-engineer', label: 'ML Engineer', emoji: '🧠', blurb: 'Models train, evaluate aur production me deploy karna.', tracks: ['python', 'data', 'sql', 'ml', 'apis'] },
  { id: 'genai-engineer', label: 'GenAI Engineer', emoji: '✨', blurb: 'Prompting, RAG pipelines aur LLM products.', tracks: ['python', 'genai', 'agentic', 'apis'] },
  { id: 'backend-engineer', label: 'Backend (API) Engineer', emoji: '🔌', blurb: 'FastAPI services, databases, deployment.', tracks: ['python', 'sql', 'apis'] },
];

export interface RoleView {
  role: TargetRole;
  skills: TrackSkill[];
  ready: number;
  /** Average of the role's skill percentages — the role's readiness. */
  pct: number;
  /** The lowest-mastery skill: what "Fix Skill Gaps" opens. */
  weakest: TrackSkill | null;
}

/**
 * One role's view over the real skill figures. A track id the caller does not have is dropped —
 * a role that names a future track simply loses that row until the track exists.
 */
export function roleSkills(role: TargetRole, skills: TrackSkill[]): RoleView {
  const mine = role.tracks
    .map((id) => skills.find((s) => s.id === id))
    .filter((s): s is TrackSkill => !!s);
  const pct = mine.length ? Math.round(mine.reduce((a, s) => a + s.pct, 0) / mine.length) : 0;
  const weakest = mine.length ? [...mine].sort((a, b) => a.pct - b.pct)[0] : null;
  return { role, skills: mine, ready: mine.filter((s) => s.status === 'ready').length, pct, weakest };
}

/** The role the learner is closest to — the default selection, data-driven, no hardcoded pick. */
export function bestRole(skills: TrackSkill[], roles: TargetRole[] = TARGET_ROLES): TargetRole {
  let best = roles[0];
  let bestPct = -1;
  for (const r of roles) {
    const pct = roleSkills(r, skills).pct;
    if (pct > bestPct) { best = r; bestPct = pct; }
  }
  return best;
}

/* -------------------------------------------------- the portfolio trio */

export interface PortfolioCard {
  key: string;
  name: string;
  done: boolean;
  /** The build's section mastery — the same figure the Project Lab card prints. */
  pct: number;
  /** What KIND of build it is (`Mini project`, or the Project Lab tier) — a section's mini project
   *  and its real build can carry near-identical names, and without this they read as duplicates. */
  kind?: string;
}

/**
 * The three portfolio-ready projects: completed builds first, then the strongest by mastery.
 *
 * ONE rule, two callers (ProjectLab's rail and the Career hub) — re-implementing it per page is
 * how a rule ends up with two answers to "which 3 projects go on the portfolio".
 */
export function portfolioTrio(cards: PortfolioCard[]): PortfolioCard[] {
  return [...cards]
    .sort((a, b) => (b.done ? 1 : 0) - (a.done ? 1 : 0) || b.pct - a.pct)
    .slice(0, 3);
}
