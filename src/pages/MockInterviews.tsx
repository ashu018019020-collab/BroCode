import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mic2, Play, Pause, RotateCcw, CheckCircle2, AlertTriangle, ArrowRight, Timer, ListChecks } from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useStore, recordAttempt, addXp, addMistake, setState, today } from '../offline/store';
import { labAttempt } from '../engine/keys';
import { keywordScore, questionRubric } from '../engine/evaluate';
import { Bar } from '../components/ui';
import { toast } from '../components/Toast';

interface Round { round: number; questions: { cat: string; q: string; a: string }[] }

export default function MockInterviews() {
  const { extras } = useCurriculum();
  const state = useStore();

  const rounds: Round[] = useMemo(() => {
    const fromMock = extras.mockInterview.map((r) => ({ ...r }));
    const intensive = extras.intensive ?? [];
    if (intensive.length) fromMock.push({ round: fromMock.length + 1, questions: intensive.slice(0, 12) });
    return fromMock;
  }, [extras]);

  const [roundIdx, setRoundIdx] = useState(0);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState('');
  const [graded, setGraded] = useState<{ pct: number; missing: string[]; depth: number; comm: number } | null>(null);
  const [seconds, setSeconds] = useState(120);
  const [running, setRunning] = useState(false);
  const timer = useRef<number | null>(null);

  const round = rounds[Math.min(roundIdx, rounds.length - 1)];
  const question = round?.questions[Math.min(i, round.questions.length - 1)];
  const doneKey = question ? labAttempt('mock', `${round.round}:${i}`) : '';
  const wasDone = !!state.attempts[doneKey]?.done;

  useEffect(() => {
    if (!running) return;
    timer.current = window.setInterval(() => {
      setSeconds((s) => {
        if (s <= 1) { setRunning(false); toast('Time up — answer submit karo.', 'warning'); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [running]);

  useEffect(() => {
    setAnswer('');
    setGraded(null);
    setSeconds(120);
    setRunning(false);
  }, [roundIdx, i]);

  const grade = () => {
    if (!question) return;
    const text = answer.trim();
    if (text.length < 15) { toast('Thoda detail me likho (15+ characters).', 'warning'); return; }
    const keywords = questionRubric(question.a);
    const { pct, missing } = keywordScore(text, keywords);
    const words = text.split(/\s+/).filter(Boolean);
    // Technical depth: how many of the model answer's key terms actually appear.
    const depth = keywords.length ? Math.round((keywords.length - missing.length) / keywords.length * 100) : 0;
    // Communication: sentence structure + length band (40–160 words is ideal for an answer aloud).
    const sentences = Math.max(1, (text.match(/[.!?]/g) ?? []).length);
    const lenScore = words.length < 25 ? words.length * 3 : words.length > 200 ? 70 : 100;
    const comm = Math.min(100, Math.round(lenScore * 0.6 + Math.min(100, sentences * 18) * 0.4));
    setGraded({ pct, missing, depth, comm });
    setRunning(false);
    recordAttempt(doneKey, { done: pct >= 60, score: pct, tries: (state.attempts[doneKey]?.tries ?? 0) + 1, answer: text.slice(0, 400) });
    if (pct >= 60) {
      if (!wasDone) addXp(5, 'interview', `Mock round ${round.round} · Q${i + 1}`);
      toast(`Achha jawab — ${pct}% match. +${wasDone ? 0 : 5} XP`, 'success');
    } else {
      toast(`Sirf ${pct}% match. Missing points dekho.`, 'warning');
      addMistake({
        section: 'mock',
        topic: question.cat || 'Mock Interview',
        question: question.q.slice(0, 140),
        myAnswer: text.slice(0, 220),
        correct: question.a.slice(0, 240),
        type: 'interview',
        source: 'mock',
      });
    }
  };

  const roundScore = useMemo(() => {
    if (!round) return 0;
    const scored = round.questions.map((_, qi) => state.attempts[labAttempt('mock', `${round.round}:${qi}`)]?.score ?? 0);
    return Math.round(scored.reduce((a, b) => a + b, 0) / Math.max(1, round.questions.length));
  }, [round, state.attempts]);

  if (!round || !question) return <div className="loading">Mock question bank load ho raha hai…</div>;

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><Mic2 size={24} color="var(--pink)" /> MOCK INTERVIEWS</h1>
          <p className="muted small" style={{ maxWidth: 700 }}>
            Timed interview simulation — <b>zor se bolke</b> answer karo, phir yahan likho. Feedback
            real curriculum answer ke keywords se calculate hota hai: concept accuracy, technical
            depth, communication aur missing points.
          </p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span className="chip">{rounds.length} rounds</span>
          <span className="chip">{rounds.reduce((a, r) => a + r.questions.length, 0)} questions</span>
        </div>
      </div>

      <div className="path-grid" style={{ marginTop: 14 }}>
        <div>
          <div className="card">
            <div className="row spread" style={{ flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Round {round.round}</h3>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {rounds.map((r, ri) => (
                  <button key={r.round} className={`tabbtn ${ri === roundIdx ? 'active' : ''}`} onClick={() => { setRoundIdx(ri); setI(0); }}>
                    Round {r.round} <span className="muted">({r.questions.length})</span>
                  </button>
                ))}
              </div>
            </div>
            <Bar pct={roundScore} />
            <p className="muted small" style={{ marginTop: 6 }}>Round score {roundScore}% — 60%+ wale answers pass count hote hain.</p>
          </div>

          <div className="card" style={{ marginTop: 12 }}>
            <div className="row spread">
              <span className="chip">Q{i + 1} / {round.questions.length}</span>
              <span className="row" style={{ gap: 8 }}>
                <span className="chip" style={{ borderColor: seconds <= 20 ? 'rgba(248,113,113,.5)' : undefined }}>
                  <Timer size={11} /> {String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}
                </span>
                <button className="btn small" onClick={() => setRunning((v) => !v)}>
                  {running ? <><Pause size={13} /> Pause</> : <><Play size={13} /> Start timer</>}
                </button>
                <button className="btn small ghost" onClick={() => { setSeconds(120); setRunning(false); }}><RotateCcw size={13} /> Reset</button>
              </span>
            </div>

            <p className="small muted" style={{ marginTop: 4 }}>{question.cat}</p>
            <h3 style={{ marginTop: 2 }}>{question.q}</h3>
            {wasDone && <span className="chip easy">Pehle attempt kiya — dobara practice</span>}

            <textarea
              rows={6}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Aloud bolke yeh apna answer likho… Jitna specific (nouns, methods, edge cases) utna better score."
              style={{ width: '100%', marginTop: 10 }}
            />
            <div className="row" style={{ gap: 8, marginTop: 8 }}>
              <button className="btn primary" onClick={grade}><CheckCircle2 size={14} /> Answer submit karo</button>
              <button className="btn small" onClick={() => setI((v) => Math.min(v + 1, round.questions.length - 1))}>Skip / Next <ArrowRight size={13} /></button>
              <button className="btn small ghost" onClick={() => setI((v) => Math.max(0, v - 1))}>← Previous</button>
            </div>
          </div>

          {graded && (
            <div className="card fadeup" style={{ marginTop: 12 }}>
              <h3 className="row" style={{ gap: 8, margin: 0 }}>
                {graded.pct >= 60 ? <CheckCircle2 size={17} color="var(--green)" /> : <AlertTriangle size={17} color="var(--amber)" />}
                Structured feedback
              </h3>
              <div className="scoregrid" style={{ marginTop: 10 }}>
                <div className="scorecell"><span className="small muted">Concept Accuracy</span><b>{graded.pct}%</b><Bar pct={graded.pct} /></div>
                <div className="scorecell"><span className="small muted">Technical Depth</span><b>{graded.depth}%</b><Bar pct={graded.depth} /></div>
                <div className="scorecell"><span className="small muted">Communication</span><b>{graded.comm}%</b><Bar pct={graded.comm} /></div>
              </div>
              {graded.missing.length > 0 && (
                <>
                  <p className="small" style={{ marginTop: 12, marginBottom: 4 }}><b>Missing points</b> — ye terms answer me aane chahiye the:</p>
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    {graded.missing.slice(0, 10).map((m) => <span key={m} className="chip hard">{m}</span>)}
                  </div>
                </>
              )}
              <details style={{ marginTop: 10 }}>
                <summary className="small muted" style={{ cursor: 'pointer' }}>Model answer dekho</summary>
                <div className="bubble">{question.a}</div>
              </details>
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {graded.pct < 60 && <Link className="btn small" to="/mistakes">Mistake Tracker me gaye <ArrowRight size={12} /></Link>}
                <button className="btn small primary" onClick={() => { setAnswer(''); setGraded(null); setI((v) => Math.min(v + 1, round.questions.length - 1)); }}>
                  Next question <ArrowRight size={13} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* right rail */}
        <div className="path-rail">
          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} color="var(--cyan)" /> Round {round.round} progress</h3>
            <div style={{ marginTop: 8 }}>
              {round.questions.map((qq, qi) => {
                const a = state.attempts[labAttempt('mock', `${round.round}:${qi}`)];
                const on = qi === i;
                return (
                  <button
                    key={qi}
                    className="row spread"
                    style={{
                      width: '100%', background: on ? 'rgba(34,211,238,.08)' : 'transparent', border: '1px solid ' + (on ? 'rgba(34,211,238,.4)' : 'transparent'),
                      borderRadius: 8, padding: '6px 8px', cursor: 'pointer', textAlign: 'left', color: 'inherit',
                    }}
                    onClick={() => setI(qi)}
                  >
                    <span className="small" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {qi + 1}. {qq.q.slice(0, 42)}…
                    </span>
                    {a?.done ? <span className="chip easy">{a.score ?? 0}%</span> : a ? <span className="chip hard">{a.score ?? 0}%</span> : <span className="chip">—</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card">
            <h3>Interview readiness</h3>
            <p className="muted small">
              Attempted {rounds.reduce((a, r) => a + r.questions.filter((_, qi) => state.attempts[labAttempt('mock', `${r.round}:${qi}`)]?.done).length, 0)} questions
              out of {rounds.reduce((a, r) => a + r.questions.length, 0)}.
            </p>
            <Link className="btn small" to="/progress" style={{ width: '100%', justifyContent: 'center' }}>Progress dekho <ArrowRight size={12} /></Link>
          </div>

          <div className="card" style={{ borderLeft: '3px solid var(--violet)' }}>
            <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>
              “Pehle 30 second me structure bolo — definition, example, phir edge case. Isse interviewer ko clarity milti hai.”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
