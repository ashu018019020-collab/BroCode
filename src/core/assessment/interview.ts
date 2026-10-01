/**
 * Interview Mode's skills, grouped — the rule behind "one section per skill".
 *
 * The page's 45 category labels arrive from three unrelated places (29 curriculum section titles,
 * the mock-interview round labels, and the intensive-drill labels) and share no vocabulary:
 * `SQL` and `SQL + Databases` are two different strings for one skill, and neither the order nor the
 * spelling of either says which of them a question belongs to. Painted as one flat alphabet, the
 * learner got 45 pills and no way to see that 17 of them are Python.
 *
 * So the grouping lives here, in ONE copy, and the page only renders it: this module has no imports
 * at all, which is what lets `scripts/tests/interview.test.mjs` pin the mapping of every real label.
 * A rule that has to be *right* (a new section title must land in the right skill, not in a
 * catch-all) has to be reachable from a test, and a `.tsx` page is not.
 *
 * Two decisions worth stating:
 *
 *   · Labels are matched by KEYWORD, not by an exhaustive list of the 45 strings, because the
 *     curriculum grows. Every label that matches nothing lands in `more` — visible and counted, not
 *     dropped — so the fallback shows up on the page instead of failing silently.
 *   · The first matching rule wins, so the rules are ordered most-specific-first: `MLOps + Docker`
 *     must not be claimed by the ML rule, `APIs, Flask/FastAPI & Production Python` must not be
 *     claimed by the Python rule, and `AI Engineer … Interview Mastery` must not be claimed by the
 *     data rule just because it mentions a Data Scientist.
 */

export type SkillTone = 'green' | 'blue' | 'violet' | 'fuchsia' | 'amber' | 'cyan' | 'orange' | 'gold' | 'purple';

export interface SkillGroup {
  /** Stable id. The page also uses it as the filter value (`skillKey`) while a whole skill is selected. */
  id: string;
  label: string;
  /** The name of a `lucide-react` icon; resolved to a component by the page, since a component cannot live here. */
  icon: string;
  tone: SkillTone;
  hint: string;
}

export interface InterviewCategory {
  name: string;
  /** Questions carrying this category, *within the source the learner has selected*. */
  count: number;
}

export interface SkillSection extends SkillGroup {
  cats: InterviewCategory[];
  /** Questions across the section's categories. */
  count: number;
}

/** The filter value that means "no category filter". */
export const ALL_CATS = 'ALL';

/** The filter value for a whole skill rather than one category. `#` cannot appear in a label, so it cannot collide with one. */
export function skillKey(id: string): string {
  return `#${id}`;
}

/** The eight skills, in the learning path's own order, so a section on this page matches a track there. */
export const SKILL_GROUPS: SkillGroup[] = [
  { id: 'python', label: 'Python Core', icon: 'Code2', tone: 'green', hint: 'Sections 1–16 · the language itself' },
  { id: 'data', label: 'NumPy + Pandas', icon: 'BarChart3', tone: 'blue', hint: 'Arrays, frames, Power BI' },
  { id: 'sql', label: 'SQL & Databases', icon: 'Database', tone: 'violet', hint: 'Queries, joins, window functions' },
  { id: 'ml', label: 'ML + NLP', icon: 'Brain', tone: 'fuchsia', hint: 'scikit-learn, transformers, evaluation' },
  { id: 'genai', label: 'GenAI + LLMs', icon: 'Sparkles', tone: 'amber', hint: 'RAG, prompting, model behaviour' },
  { id: 'agentic', label: 'Agentic AI', icon: 'Bot', tone: 'cyan', hint: 'Agents, LangChain, n8n' },
  { id: 'apis', label: 'APIs + Production', icon: 'Server', tone: 'orange', hint: 'FastAPI, Docker, monitoring, system design' },
  { id: 'career', label: 'Interview + Projects', icon: 'Briefcase', tone: 'gold', hint: 'Resume, behaviour, coding rounds' },
];

/** Where a label goes when nothing claims it. Rendered like any other section, so an unmapped skill is noticed. */
export const MORE_TOPICS: SkillGroup = { id: 'more', label: 'More topics', icon: 'Layers', tone: 'purple', hint: 'Not yet mapped to a skill' };

/**
 * Resolution order — deliberately NOT the display order above. `MLOps + Docker + Git + AWS` and
 * `Machine Learning + scikit-learn` both contain "ML", and `Variables & Data Types` contains "Data",
 * so the narrow, structural rules are asked first and the broad language rules last.
 */
const RULES: [string, RegExp][] = [
  // Integration, delivery and design — the outward-facing half of the job.
  ['apis', /(^|\W)(api|apis|flask|fastapi|mlops|docker|git|aws|system|production)(\W|$)/i],
  ['agentic', /langchain|n8n|agent/i],
  ['genai', /genai|generative|\bllms?\b|\brag\b/i],
  ['ml', /(^|\W)(ml|nlp)(\W|$)|machine learning|scikit|transformer/i],
  ['sql', /sql|database/i],
  // Before `data`: "AI Engineer + Data Scientist Interview Mastery" is an interview section.
  ['career', /interview|resume|\bcareer\b|behavior|coding|pattern/i],
  // `^data$` is the mock round's bare label; "Data Science" is named explicitly so that the far more
  // common "Data Types" is never swept up by the word alone.
  ['data', /numpy|pandas|analytic|power bi|data science|^data$/i],
  ['python', /python|variable|operator|input|output|if \/|elif|else|loop|function|reusable|list|tuple|set|dict|string|exception|file|module|object oriented|\boop\b|advanced/i],
];

/** The skill a category label belongs to. */
export function skillOf(name: string): string {
  const s = String(name ?? '');
  for (const [id, re] of RULES) if (re.test(s)) return id;
  return MORE_TOPICS.id;
}

/** Does a category survive the current filter? `ALL` keeps everything, `#id` keeps a whole skill. */
export function catMatchesFilter(filter: string, cat: string): boolean {
  if (!filter || filter === ALL_CATS) return true;
  if (filter.charAt(0) === '#') return skillOf(cat) === filter.slice(1);
  return cat === filter;
}

/**
 * The categories, bucketed into their skills.
 *
 * Empty skills are dropped — with a source selected, most of them have nothing in them, and a
 * heading over an empty row is noise. Categories are sorted inside their section so the order is
 * stable and reads as a list of topics rather than of whatever order the data happened to load in.
 */
export function groupCategories(cats: InterviewCategory[]): SkillSection[] {
  const byId = new Map<string, InterviewCategory[]>();
  for (const c of cats) {
    const id = skillOf(c.name);
    const bucket = byId.get(id);
    if (bucket) bucket.push(c);
    else byId.set(id, [c]);
  }
  const out: SkillSection[] = [];
  for (const g of [...SKILL_GROUPS, MORE_TOPICS]) {
    const bucket = byId.get(g.id);
    if (!bucket?.length) continue;
    bucket.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ ...g, cats: bucket, count: bucket.reduce((n, c) => n + c.count, 0) });
  }
  return out;
}
