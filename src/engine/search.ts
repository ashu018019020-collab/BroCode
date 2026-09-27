import type { Section, Extras, AppState } from '../types';

export interface SearchItem {
  id: string;
  kind: 'Concept' | 'Interview' | 'Coding' | 'Logic' | 'Debug' | 'Solved' | 'MiniProject' | 'ProjectLab' | 'Section' | 'Mock' | 'Checkpoint' | 'Page' | 'Note';
  title: string;
  detail: string;
  route: string;
  page?: number;
}

/** Every screen in the app, so Ctrl+K doubles as a command launcher. */
export const PAGES: { title: string; detail: string; route: string }[] = [
  { title: 'Dashboard', detail: 'Mission, next best action, progress', route: '/' },
  { title: 'Learning Path', detail: '8-track AI Engineer roadmap', route: '/path' },
  { title: 'Concepts', detail: 'Browse every concept in the curriculum', route: '/concepts' },
  { title: 'Review Queue', detail: 'Spaced repetition — due today', route: '/review' },
  { title: 'Mistake Tracker', detail: 'Your repeated mistakes and weak topics', route: '/mistakes' },
  { title: 'Interview Mode', detail: 'Answer aloud with structured feedback', route: '/interview' },
  { title: 'Project Defense', detail: 'Explain your projects like an interview', route: '/defense' },
  { title: 'Code Playground', detail: 'Offline Python IDE + AI tutor', route: '/playground' },
  { title: 'Project Lab', detail: 'Mini and real projects with build steps', route: '/projects' },
  { title: 'Question Bank', detail: 'Practice questions from every section, with self-grading', route: '/questions' },
  { title: 'Playbook V15', detail: 'Second source: 36 chapters, coding labs and mini projects, chapter-wise', route: '/playbook' },
  { title: 'Timed Exam', detail: 'Offline mock interview: timed paper, self-grade, file mistakes', route: '/exam' },
  { title: 'NumPy + Pandas Lab', detail: 'Arrays, DataFrames, analysis', route: '/numpy-pandas' },
  { title: 'Notebook Lab', detail: 'Jupyter notebooks: run cells offline, NumPy + Pandas included', route: '/notebooks' },
  { title: 'SQL Lab', detail: 'Queries, joins, real-world data', route: '/sql' },
  { title: 'AI / GenAI Lab', detail: 'LLMs, prompt engineering, RAG basics', route: '/ai' },
  { title: 'Agentic AI Lab', detail: 'Agents, tool use, workflows', route: '/agentic' },
  { title: 'RAG Lab', detail: 'Chunk, embed, retrieve, answer — offline', route: '/rag' },
  { title: 'Final Assessment', detail: 'Everything, in one final gate', route: '/final' },
  { title: 'Resume Labs', detail: 'Project bullets, defense and portfolio', route: '/resume' },
  { title: 'Mock Interviews', detail: 'Timed mock rounds with scoring', route: '/mock' },
  { title: 'Job Prep', detail: 'Application checklist and prep tracker', route: '/jobprep' },
  { title: 'Progress', detail: 'Detailed analytics of your mastery', route: '/progress' },
  { title: 'Notes', detail: 'Your own notes, tags and favourites', route: '/notes' },
  { title: 'Cheat Sheets', detail: 'Printable prompts built from the curriculum', route: '/cheats' },
  { title: 'PDF Reader', detail: 'The source book, offline', route: '/pdf' },
  { title: 'Settings', detail: 'Language, motion, data export and import', route: '/settings' },
];

const norm = (s: string) => (s ?? '').toLowerCase();

export function searchAll(sections: Section[], extras: Extras, state?: AppState): SearchItem[] {
  const items: SearchItem[] = PAGES.map((p) => ({
    id: `pg:${p.route}`, kind: 'Page' as const, title: p.title, detail: p.detail, route: p.route,
  }));
  for (const n of state?.notes ?? []) {
    items.push({
      id: `nt:${n.id}`, kind: 'Note',
      title: n.title || '(untitled note)',
      detail: [n.body.slice(0, 80), n.tags.map((t) => `#${t}`).join(' ')].filter(Boolean).join(' · '),
      route: '/notes',
    });
  }
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
