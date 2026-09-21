import type { Section, Extras } from '../types';

export interface SearchItem {
  id: string;
  kind: 'Concept' | 'Interview' | 'Coding' | 'Logic' | 'Debug' | 'Solved' | 'MiniProject' | 'ProjectLab' | 'Section' | 'Mock' | 'Checkpoint' | 'Page';
  title: string;
  detail: string;
  route: string;
  page?: number;
}

const norm = (s: string) => (s ?? '').toLowerCase();

export function searchAll(sections: Section[], extras: Extras): SearchItem[] {
  const items: SearchItem[] = [];
  for (const s of sections) {
    items.push({ id: `sec:${s.id}`, kind: 'Section', title: `${String(s.no).padStart(2, '0')} — ${s.title}`, detail: 'Open lesson', route: `/lesson/${s.id}/learn`, page: s.pages.learn[0] ?? s.pages.mini[0] });
    s.learn.concepts.forEach((c, i) => items.push({ id: `c:${s.id}:${i}`, kind: 'Concept', title: c.title, detail: (c.body || c.code || '').slice(0, 90), route: `/lesson/${s.id}/learn`, page: s.pages.learn[0] }));
    s.interview.forEach((q, i) => items.push({ id: `i:${s.id}:${i}`, kind: 'Interview', title: q.q, detail: q.a.slice(0, 90), route: `/lesson/${s.id}/interview`, page: s.pages.interview[0] }));
    s.coding.forEach((t, i) => items.push({ id: `cd:${s.id}:${i}`, kind: t.difficulty === 'debug' ? 'Debug' : 'Coding', title: t.text.slice(0, 80), detail: t.solution.slice(0, 90), route: `/lesson/${s.id}/${t.difficulty === 'debug' ? 'debug' : 'coding'}`, page: s.pages.code[0] }));
    s.logic.forEach((l, i) => items.push({ id: `l:${s.id}:${i}`, kind: 'Logic', title: `${l.kind}: ${l.text.slice(0, 70)}`, detail: l.answer.slice(0, 90), route: `/lesson/${s.id}/logic`, page: s.pages.logic[0] }));
    s.solved.forEach((it, i) => items.push({ id: `sv:${s.id}:${i}`, kind: 'Solved', title: it.text.slice(0, 80), detail: it.solution.slice(0, 90), route: `/lesson/${s.id}/solved`, page: s.pages.solved[0] }));
    if (s.mini.what) items.push({ id: `m:${s.id}`, kind: 'MiniProject', title: s.mini.name, detail: s.mini.what.slice(0, 90), route: `/lesson/${s.id}/mini`, page: s.pages.mini[0] });
    s.projectLab.forEach((p, i) => items.push({ id: `p:${s.id}:${i}`, kind: 'ProjectLab', title: `${p.tier}: ${p.name}`, detail: p.what.slice(0, 90), route: `/lesson/${s.id}/project`, page: s.pages.project[0] }));
    s.checkpoint.forEach((c, i) => items.push({ id: `cp:${s.id}:${i}`, kind: 'Checkpoint', title: c.q.slice(0, 80), detail: c.key.slice(0, 90), route: `/lesson/${s.id}/checkpoint`, page: s.pages.checkpoint[0] }));
  }
  extras.mockInterview.forEach((r) => r.questions.forEach((q, i) => items.push({ id: `mk:${r.round}:${i}`, kind: 'Mock', title: q.q.slice(0, 80), detail: q.a.slice(0, 90), route: `/final` })));
  extras.intensive.forEach((q, i) => items.push({ id: `in:${i}`, kind: 'Mock', title: q.q.slice(0, 80), detail: q.a.slice(0, 90), route: `/final` }));
  return items;
}

export function searchItems(items: SearchItem[], query: string): SearchItem[] {
  const q = norm(query.trim());
  if (!q) return [];
  const terms = q.split(/\s+/);
  return items
    .map((it) => {
      const hay = norm(`${it.title} ${it.detail} ${it.kind}`);
      let score = 0;
      for (const t of terms) {
        if (!hay.includes(t)) return { it, score: -1 };
        score += norm(it.title).startsWith(t) ? 3 : 1;
        if (norm(it.title).includes(t)) score += 2;
      }
      return { it, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 40)
    .map((x) => x.it);
}
