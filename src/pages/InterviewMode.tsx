import { useEffect, useMemo, useState } from 'react';
import { useCurriculum } from '../data/curriculum';
import { useStore, setState, addXp, addMistake } from '../offline/store';
import { keywordScore, questionRubric } from '../engine/evaluate';
import type { MockQuestion } from '../types';

interface Q { cat: string; q: string; a: string; source: string }

export default function InterviewMode() {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const [catFilter, setCatFilter] = useState<string>('ALL');
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<{ pct: number; missing: string[] } | null>(null);

  const all: Q[] = useMemo(() => {
    const out: Q[] = [];
    sections.forEach((s) => s.interview.forEach((q, i) => out.push({ cat: s.title, q: q.q, a: q.a, source: `s${s.no}·p${s.pages.interview[0] ?? ''}` })));
    extras.mockInterview.forEach((r) => r.questions.forEach((q) => out.push({ cat: q.cat, q: q.q, a: q.a, source: 'Final Mock' })));
    extras.intensive.forEach((q) => out.push({ cat: q.cat, q: q.q, a: q.a, source: 'Intensive' }));
    return out;
  }, [sections, extras]);

  const cats = ['ALL', ...Array.from(new Set(all.map((x) => x.cat))).sort()];
  const pool = catFilter === 'ALL' ? all : all.filter((x) => x.cat === catFilter);
  const q = pool[idx % Math.max(1, pool.length)];

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
    setGraded(g);
    if (g.pct >= 70) addXp(8, 'interview', 'Interview answer');
    else addMistake({ section: 'interview-mode', topic: q.cat, question: q.q, myAnswer: answer, correct: q.a, type: 'interview' });
  };

  const next = (d: number) => { setIdx((i) => (i + d + pool.length) % pool.length); setAnswer(''); setRevealed(false); setGraded(null); };

  return (
    <div>
      <h1>🎤 Interview Mode</h1>
      <p className="muted small">{all.length} questions from the PDF. Arrow keys navigate. Speak the answer first, then reveal.</p>

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
            <button className="btn small" onClick={() => next(-1)} aria-label="Previous">←</button>
            <button className="btn small" onClick={() => next(1)} aria-label="Next">→</button>
          </div>
        </div>
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
      </div>
    </div>
  );
}
