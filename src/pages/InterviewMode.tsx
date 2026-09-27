import { useEffect, useMemo, useState } from 'react';
import { useCurriculum } from '../data/curriculum';
import { useStore, setState, addXp, addMistake, recordAttempt } from '../offline/store';
import { keywordScore, questionRubric } from '../engine/evaluate';
import { labAttempt } from '../engine/keys';
import { pctText } from '../engine/accuracy';
import { AssistantCard } from '../components/AssistantCard';
import type { MockQuestion } from '../types';

/**
 * A stable key for one interview question, so its percentage survives a reload.
 *
 * These questions come from the curriculum and the playbook rather than from a bank, so there is no
 * question id to hang an attempt on. A hash of the question TEXT is the honest equivalent: the same
 * question always lands on the same `lab:interview:<hash>` record, and nothing else can collide
 * with it (`lab:` is the family engine/keys.ts reserves for non-section labs).
 */
function qKey(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return labAttempt('interview', Math.abs(h));
}

interface Q { cat: string; q: string; a: string; source: string; book: string }

/**
 * The V15 playbook's own Q&A, read from the small derived view the import writes (the banks are
 * 11 MB, too much to load for one interview round).
 *
 * Only items with a real model answer enter the keyword-graded pool: the document's checkpoint and
 * production-scenario prompts carry its METHOD line instead of an answer, and scoring those against
 * a rubric built from "answer verbally first…" would be noise. They are counted and pointed at
 * their section's stage instead of silently disappearing.
 */
function usePlaybookQA(): { items: Q[]; methodOnly: number } {
  const [pack, setPack] = useState<{ items: { type: string; question: string; answer: string; chapter: string; sectionTitle: string; selfGrade: boolean }[] } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('./playbook/items.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setPack(d); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return useMemo(() => {
    const rows = (pack?.items ?? []).filter((it) => ['interview', 'defense', 'theory'].includes(it.type));
    const gradable = rows.filter((it) => !it.selfGrade);
    return {
      methodOnly: rows.length - gradable.length,
      items: gradable.map((it) => ({
        cat: it.sectionTitle,
        q: it.question,
        a: it.answer,
        source: `playbook ch.${it.chapter}`,
        book: 'Playbook V15',
      })),
    };
  }, [pack]);
}

export default function InterviewMode() {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [bookFilter, setBookFilter] = useState<string>('ALL');
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<{ pct: number; missing: string[] } | null>(null);
  /** This sitting's percentages — the running accuracy figure, kept in the page (not invented). */
  const [history, setHistory] = useState<number[]>([]);
  const playbook = usePlaybookQA();

  const all: Q[] = useMemo(() => {
    const out: Q[] = [];
    sections.forEach((s) => s.interview.forEach((q) => out.push({ cat: s.title, q: q.q, a: q.a, source: `s${s.no}·p${s.pages.interview[0] ?? ''}`, book: 'Curriculum PDF' })));
    extras.mockInterview.forEach((r) => r.questions.forEach((q) => out.push({ cat: q.cat, q: q.q, a: q.a, source: 'Final Mock', book: 'Curriculum PDF' })));
    extras.intensive.forEach((q) => out.push({ cat: q.cat, q: q.q, a: q.a, source: 'Intensive', book: 'Curriculum PDF' }));
    out.push(...playbook.items);
    return out;
  }, [sections, extras, playbook.items]);

  // Two independent filters: which section, and which SOURCE BOOK the question came from.
  const books = ['ALL', ...Array.from(new Set(all.map((x) => x.book)))];
  const cats = ['ALL', ...Array.from(new Set(all.map((x) => x.cat))).sort()];
  const pool = all
    .filter((x) => catFilter === 'ALL' || x.cat === catFilter)
    .filter((x) => bookFilter === 'ALL' || x.book === bookFilter);
  const q = pool[idx % Math.max(1, pool.length)];
  const playbookCount = all.filter((x) => x.book === 'Playbook V15').length;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); next(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); next(-1); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!q) return <div className="card muted">No questions.</div>;

  const grade = () => {
    const kws = questionRubric(q.a);
    const g = keywordScore(answer, kws);
    const prev = state.attempts[qKey(q.q)];
    setGraded(g);
    setHistory((h) => [...h, g.pct]);
    // Stored, so the percentage is still there when the learner comes back to this question — and
    // so the Progress page and the offline assistant can report real interview accuracy instead of
    // a number that vanishes with the page.
    recordAttempt(qKey(q.q), { done: g.pct >= 70, score: g.pct, answer, tries: (prev?.tries ?? 0) + 1 });
    if (g.pct >= 70) addXp(8, 'interview', 'Interview answer');
    else addMistake({ section: 'interview-mode', topic: q.cat, question: q.q, myAnswer: answer, correct: q.a, type: 'interview', source: 'interview' });
  };

  const sessionPct = history.length ? Math.round(history.reduce((a, b) => a + b, 0) / history.length) : null;
  const lastAttempt = q ? state.attempts[qKey(q.q)] : undefined;
  const answered = Object.keys(state.attempts).filter((k) => k.startsWith('lab:interview:')).length;

  const next = (d: number) => { setIdx((i) => (i + d + pool.length) % pool.length); setAnswer(''); setRevealed(false); setGraded(null); };

  return (
    <div>
      <h1>🎤 Interview Mode</h1>
      <p className="muted small">
        {all.length - playbookCount} questions from the curriculum PDF + {playbookCount} from the V15 Playbook.
        Arrow keys navigate. Speak the answer first, then reveal.
      </p>

      <div className="row" style={{ margin: '10px 0 4px', flexWrap: 'wrap' }}>
        {books.map((b) => (
          <button
            key={b}
            className={`stagepill ${bookFilter === b ? 'active' : ''}`}
            onClick={() => { setBookFilter(b); setIdx(0); setAnswer(''); setRevealed(false); setGraded(null); }}
            title={b === 'Playbook V15' ? 'Doosre source (V15) ka Q&A bank' : undefined}
          >
            {b === 'Playbook V15' ? `📘 Playbook V15 (${playbookCount})` : b === 'ALL' ? `Sabhi sources (${all.length})` : b}
          </button>
        ))}
      </div>
      {playbook.methodOnly > 0 && (
        <p className="small muted" style={{ margin: '0 0 6px' }}>
          Playbook ke {playbook.methodOnly} checkpoint/scenario prompts ke paas model answer ki jagah document ka method hai —
          wo rubric se grade nahi hote, unhe apne section ke Checkpoint stage me bolo.
        </p>
      )}

      <div className="row" style={{ margin: '10px 0', maxHeight: 120, overflowY: 'auto' }}>
        {cats.map((c) => (
          <button key={c} className={`stagepill ${catFilter === c ? 'active' : ''}`} onClick={() => { setCatFilter(c); setIdx(0); setAnswer(''); setRevealed(false); setGraded(null); }}>
            {c}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="row spread">
          <span className="small muted">{q.cat} · {q.source} · #{idx + 1}/{pool.length}</span>
          <div className="row">
            {/* The percentage of the last answer to THIS question, and of this sitting. Both are
                measured; neither is shown when nothing was answered yet. */}
            {lastAttempt && (
              <span className={`chip ${lastAttempt.done ? 'easy' : 'hard'}`} title="Pichhli baar is question par kitna sahi">
                pichhla: {pctText(lastAttempt.score ?? null)}
              </span>
            )}
            <span className="chip" title="Is sitting me kitne answers, aur unka average">
              {history.length} answers · avg {pctText(sessionPct)}
            </span>
            <button className="btn small" onClick={() => next(-1)} aria-label="Previous">←</button>
            <button className="btn small" onClick={() => next(1)} aria-label="Next">→</button>
          </div>
        </div>
        {(history.length > 0 || answered > 0) && (
          <div className="row spread small muted" style={{ marginTop: 6 }}>
            <span>Is sitting ki accuracy: <b>{pctText(sessionPct)}</b></span>
            <span>Total interview answers saved: {answered}</span>
          </div>
        )}
        {history.length > 0 && <div className="bar" style={{ marginTop: 4 }}><div style={{ width: `${sessionPct ?? 0}%` }} /></div>}
        <h2 style={{ margin: '10px 0' }}>{q.q}</h2>
        <textarea rows={4} placeholder="Answer aloud, or type here…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal model answer'}</button>
          <button className="btn primary" onClick={grade} disabled={!answer.trim()}>Check</button>
        </div>
        {graded && (
          <div className="card fadeup" style={{ marginTop: 10, borderColor: graded.pct >= 70 ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
            <b>{graded.pct >= 70 ? '✅' : '⚠️'} Keyword rubric: {graded.pct}%</b>
            {graded.missing.length > 0 && <p className="small muted">Missing: {graded.missing.join(', ')}</p>}
          </div>
        )}
        {revealed && (
          <div className="fadeup" style={{ marginTop: 10 }}>
            <b className="small">MODEL ANSWER:</b>
            <p className="small">{q.a}</p>
            <p className="small muted">Structure: definition → tiny example → practical use → edge case.</p>
          </div>
        )}

        {/* The assistant, scoped to this question: its answer, an escalating hint about THIS item,
            and the rubric percentage of what was typed above. */}
        <div style={{ marginTop: 10 }}>
          <AssistantCard
            compact
            embedded
            context={{
              where: `${q.cat} · ${q.source}`,
              question: { text: q.q, model: q.a, mine: answer, type: 'interview', source: `${q.book} · ${q.source}` },
            }}
          />
        </div>
      </div>
    </div>
  );
}
