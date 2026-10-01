/** Deterministic offline evaluation — no fake AI. Keyword rubrics + output checks only. */

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Keyword-rubric check: each entry is a group "a|b|c" — any match in a group counts; all groups must hit. */
export function keywordScore(answer: string, keywords: string[]): { pct: number; missing: string[] } {
  const a = norm(answer);
  const missing: string[] = [];
  const groups = keywords.map((k) => k.split('|').map((x) => norm(x)));
  for (const g of groups) {
    if (!g.some((k) => a.includes(k))) missing.push(g.join(' / '));
  }
  const pct = Math.round(100 * (groups.length - missing.length) / Math.max(1, groups.length));
  return { pct, missing };
}

/** Keyword rubric for an interview Q&A: significant words of each model-answer clause, as OR-groups. */
export function questionRubric(a: string): string[] {
  return a
    .split(/[.,;]/)
    .map((x) => x.trim())
    .filter((x) => x.length > 4)
    .slice(0, 4)
    .map((clause) => clause.split(/\s+/).filter((w) => w.length > 3).slice(0, 6).join('|'));
}

/** Output similarity: exact-after-normalize, or line-multiset overlap. */
export function outputCheck(actual: string, expected: string): { ok: boolean; pct: number } {
  const a = norm(actual);
  const e = norm(expected);
  if (a === e) return { ok: true, pct: 100 };
  // Line mode: collapse whitespace within each line but keep line boundaries intact.
  const lines = (s: string) =>
    s.trim().split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).sort();
  const al = lines(actual);
  const el = lines(expected);
  let hits = 0;
  const pool = [...al];
  for (const line of el) {
    const i = pool.indexOf(line);
    if (i >= 0) { hits++; pool.splice(i, 1); }
  }
  const pct = Math.round(100 * (2 * hits) / Math.max(1, al.length + el.length));
  return { ok: pct >= 80, pct };
}

/** The 10 fixed defense questions with their keyword rubrics. */
export const DEFENSE_QUESTIONS = [
  { q: 'What problem did you solve?', k: ['problem', 'solve', 'goal', 'purpose', 'need'] },
  { q: 'Why did you choose this technology?', k: ['because', 'reason', 'advantage', 'simple', 'fit'] },
  { q: 'Explain the architecture.', k: ['input', 'output', 'step', 'flow', 'module', 'layer'] },
  { q: 'What did you personally implement?', k: ['i ', 'my', 'wrote', 'built', 'implemented'] },
  { q: 'What was the biggest bug?', k: ['bug', 'error', 'issue', 'fail', 'crash', 'wrong'] },
  { q: 'How did you debug it?', k: ['print', 'log', 'reproduce', 'isolate', 'check', 'step'] },
  { q: 'How is data flowing?', k: ['input', 'transform', 'output', 'store', 'flow', 'pass'] },
  { q: 'What happens if the API/input fails?', k: ['try', 'except', 'valid', 'error', 'fallback', 'handle'] },
  { q: 'What happens at 10x scale?', k: ['memory', 'time', 'slow', 'chunk', 'batch', 'limit', 'scale'] },
  { q: 'What would you improve?', k: ['improve', 'next', 'better', 'refactor', 'add', 'test'] },
];

/** Average keyword-rubric score across all answers. */
export function defenseScore(answers: string[]): { total: number; per: { pct: number; missing: string[] }[] } {
  const per = answers.map((a, i) => keywordScore(a, DEFENSE_QUESTIONS[i].k));
  const total = Math.round(per.reduce((acc, p) => acc + p.pct, 0) / Math.max(1, per.length));
  return { total, per };
}
