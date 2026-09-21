import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurriculum } from '../data/curriculum';
import { useStore, addXp, addMistake, recordAttempt } from '../offline/store';
import { keywordScore, questionRubric, DEFENSE_QUESTIONS, defenseScore } from '../engine/evaluate';
import { finalTaskAttempt, finalPart, codeSlot } from '../engine/keys';
import { CodeLab } from '../components/CodeLab';

interface AQ { cat: string; q: string; a: string; src: string }
interface Part { id: string; label: string; qs?: AQ[]; coding?: boolean; defense?: boolean; project?: boolean }

const RAG_RE = /rag|retriev|vector|embedding|chunk/i;

export default function FinalAssessment() {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const [part, setPart] = useState(0);
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<{ pct: number; missing: string[] } | null>(null);
  const [defense, setDefense] = useState<string[]>(() => DEFENSE_QUESTIONS.map(() => ''));
  const [dResult, setDResult] = useState<{ total: number; per: { pct: number; missing: string[] }[] } | null>(null);

  const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
  const mock = (cat: string): AQ[] => extras.mockInterview.flatMap((r) => r.questions.filter((q) => q.cat === cat).map((q) => ({ ...q, src: 'Mock R' + r.round })));
  const inten = (cat: string): AQ[] => extras.intensive.filter((q) => q.cat === cat).map((q) => ({ ...q, src: 'Intensive' }));
  const secIv = (id: string): AQ[] => (byId[id]?.interview ?? []).map((q) => ({ cat: byId[id].title, q: q.q, a: q.a, src: 's' + byId[id].no }));
  const secIvWhere = (id: string, re: RegExp): AQ[] => secIv(id).filter((x) => re.test(x.q + ' ' + x.a));
  const secRange = (a: number, b: number): AQ[] =>
    sections.filter((s) => s.no >= a && s.no <= b).flatMap((s) => s.interview.map((q) => ({ cat: s.title, q: q.q, a: q.a, src: 's' + s.no })));
  const debugChips: AQ[] = sections
    .filter((s) => s.no <= 16 || s.no >= 27)
    .flatMap((s) => s.coding.filter((c) => c.difficulty === 'debug').map((c) => ({ cat: s.title, q: c.text, a: c.solution + (c.check ? '\nCHECK: ' + c.check : ''), src: 's' + s.no })));
  const codingTasks = sections.slice(0, 16)
    .flatMap((s) => s.coding.filter((c) => c.difficulty !== 'debug').map((c) => ({ ...c, sid: s.id })));
  const pickTask = (d: string, fb: number) => codingTasks.find((c) => c.difficulty === d) ?? codingTasks[fb];
  const finalCoding = [pickTask('easy', 0), pickTask('medium', 1), pickTask('hard', 2)].filter(Boolean);

  const parts: Part[] = [
    { id: 'py', label: '1·Python', qs: [...mock('PYTHON'), ...secRange(1, 16)] },
    { id: 'code', label: '2·Coding', coding: true },
    { id: 'np', label: '3·NumPy', qs: secIv('s17') },
    { id: 'pd', label: '4·Pandas', qs: secIv('s18') },
    { id: 'sql', label: '5·SQL', qs: [...mock('SQL'), ...secIv('s19')] },
    { id: 'ml', label: '6·ML', qs: [...mock('ML'), ...inten('ML'), ...secIv('s20')] },
    { id: 'genai', label: '7·GenAI', qs: [...mock('GENAI'), ...secIv('s22')] },
    { id: 'rag', label: '8·RAG', qs: [...mock('GENAI').filter((x) => RAG_RE.test(x.q + ' ' + x.a)), ...secIvWhere('s22', RAG_RE)] },
    { id: 'agent', label: '9·Agentic', qs: [...mock('AGENTS'), ...inten('Agentic AI'), ...secIv('s23')] },
    { id: 'api', label: '10·APIs', qs: [...mock('APIS'), ...inten('AI API'), ...secIv('s24')] },
    { id: 'debug', label: '11·Debug', qs: debugChips },
    { id: 'defense', label: '12·Defense', defense: true },
    { id: 'sys', label: '13·System', qs: mock('SYSTEM') },
    { id: 'proj', label: '14·Project', project: true },
  ];

  /** Average of recorded per-question scores for a part; null until something is graded. */
  const partScore = (p: Part): number | null => {
    if (!p.qs) return null;
    const vals = p.qs.map((_, i) => state.attempts[finalPart(p.id + ':' + i)]?.score).filter((v): v is number => typeof v === 'number');
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const scored = parts.filter((p) => p.qs?.length);
  const overall = (() => {
    const vals = scored.map(partScore).filter((v): v is number => v !== null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  })();

  const p = parts[part];
  const pool = p.qs ?? [];
  const q: AQ | undefined = pool[Math.min(idx, Math.max(0, pool.length - 1))];

  const switchPart = (i: number) => { setPart(i); setIdx(0); setAnswer(''); setRevealed(false); setGraded(null); };

  const grade = () => {
    if (!q) return;
    const g = keywordScore(answer, questionRubric(q.a));
    setGraded(g);
    recordAttempt(finalPart(p.id + ':' + Math.min(idx, pool.length - 1)), { score: g.pct });
    if (g.pct >= 70) addXp(10, 'final', 'Final assessment answer');
    else addMistake({ section: 'final', topic: q.cat, question: q.q, myAnswer: answer, correct: q.a, type: 'final' });
  };

  const cap = byId['s28']?.projectLab?.[0];

  return (
    <div>
      <h1>🏁 Final AI Engineer Assessment</h1>
      <p className="muted small">14 parts built from the PDF's final material — theory, coding, NumPy, Pandas, SQL, ML, GenAI, RAG, Agentic, APIs, debugging, project defense, system design, capstone. Deterministic keyword rubrics; no fake AI.</p>

      <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap' }}>
        {parts.map((x, i) => (
          <button key={x.id} className={`stagepill ${part === i ? 'active' : ''}`} onClick={() => switchPart(i)}>
            {x.label}{partScore(x) !== null ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {p.qs && q && (
        <div className="card">
          <div className="row spread">
            <span className="small muted">{q.cat} · {q.src} · #{Math.min(idx, pool.length - 1) + 1}/{pool.length}</span>
            <div className="row">
              <button className="btn small" onClick={() => setIdx((i) => Math.max(0, i - 1))}>←</button>
              <button className="btn small" onClick={() => setIdx((i) => Math.min(pool.length - 1, i + 1))}>→</button>
            </div>
          </div>
          <h2 style={{ margin: '10px 0' }}>{q.q}</h2>
          <textarea rows={4} placeholder="Answer aloud first…" value={answer} onChange={(e) => setAnswer(e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn primary" onClick={grade} disabled={!answer.trim()}>Check</button>
            <button className="btn" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal model answer'}</button>
          </div>
          {graded && (
            <div className="card fadeup" style={{ marginTop: 10, borderColor: graded.pct >= 70 ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
              <b>{graded.pct >= 70 ? '✅' : '⚠️'} Keyword rubric: {graded.pct}%</b>
              {graded.missing.length > 0 && <p className="small muted">Missing: {graded.missing.join(', ')}</p>}
            </div>
          )}
          {revealed && <div className="fadeup" style={{ marginTop: 10 }}><b className="small">MODEL ANSWER:</b><p className="small" style={{ whiteSpace: 'pre-wrap' }}>{q.a}</p></div>}
        </div>
      )}

      {p.coding && (
        <div>
          <p className="small muted">Tasks drawn from the PDF's core-Python coding labs. Run, verify, then compare with the solution.</p>
          {finalCoding.map((t, i) => (
            <div key={i}>
              <h3 className="small" style={{ margin: '12px 0 4px' }}>Task {i + 1} ({t.difficulty}, from section {t.sid})</h3>
              <p className="small muted">{t.text}</p>
              <CodeLab storageKey={codeSlot.final(i)} starter={`# Task: ${t.text}\n\n`} solution={t.solution} compact onComplete={() => recordAttempt(finalTaskAttempt(i), { done: true })} />
            </div>
          ))}
        </div>
      )}

      {p.defense && (
    <div className="card">
      <p className="small muted">Defend your capstone: answer all 10, then score. Same rubric as the Defense pages.</p>
      {DEFENSE_QUESTIONS.map((dq, i) => (
        <div key={i} style={{ margin: '10px 0' }}>
          <p className="small"><b>{i + 1}. {dq.q}</b></p>
          <textarea rows={2} value={defense[i]} onChange={(e) => setDefense(defense.map((v, j) => (j === i ? e.target.value : v)))} />
        </div>
      ))}
      <button className="btn primary" onClick={() => { const r = defenseScore(defense); setDResult(r); r.per.forEach((x, i) => recordAttempt(finalPart('defense:' + i), { score: x.pct })); }}>
        Score defense
      </button>
      {dResult && (
        <div className="card fadeup" style={{ marginTop: 10, borderColor: dResult.total >= 60 ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
          <b>{dResult.total >= 60 ? '✅' : '⚠️'} Defense score: {dResult.total}</b>
          {dResult.per.map((x, i) => x.missing.length > 0 && <p key={i} className="small muted">Q{i + 1} missing: {x.missing.join(', ')}</p>)}
        </div>
      )}
    </div>
  )}

  {p.project && cap && (
    <div className="card">
      <h3>Capstone: build, then defend</h3>
      <p className="small">{cap.name}{cap.what ? ' — ' + cap.what : ''}</p>
      <div className="row" style={{ marginTop: 10 }}>
        <Link className="btn" to="/lesson/s28/project">Open Project Lab</Link>
        <Link className="btn" to="/lesson/s28/defense">Defend it</Link>
        <Link className="btn" to="/resume">Resume labs</Link>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>The Part 12 defense and your Section 28 defense use the same rubric — one standard, everywhere.</p>
    </div>
  )}

  <div className="card" style={{ marginTop: 16 }}>
    <h3>Verdict</h3>
    {overall === null ? (
      <p className="muted small">Grade answers in any part — your per-part and overall verdict appear here.</p>
    ) : (
      <>
        <p className="small">
          Overall: <b>{overall}%</b> — 
          <b style={{ color: overall >= 85 ? 'var(--green)' : overall >= 70 ? 'var(--amber)' : 'var(--red)' }}>
            {overall >= 85 ? 'AI ENGINEER READY' : overall >= 70 ? 'Almost there — polish weak parts' : 'Keep building — work the low parts'}
          </b>
        </p>
        {scored.map((x) => {
          const s = partScore(x);
          return (
            <div key={x.id} className="row spread small" style={{ padding: '2px 0' }}>
              <span>{x.label}</span>
              <span className="muted">{s === null ? 'not graded' : s + '%'}</span>
            </div>
          );
        })}
      </>
    )}
  </div>
    </div>
  );
}
