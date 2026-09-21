import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCurriculum } from '../data/curriculum';
import { useStore, setState, addXp, recordAttempt, addMistake } from '../offline/store';
import { STAGES, STAGE_META, sectionProgress, missingForMastery, type Stage } from '../engine/progress';
import { stageAttempt, itemAttempt, debugDone, learnView, lessonDefenseAnswer, interviewAnswer, codeSlot } from '../engine/keys';
import { CodeLab } from '../components/CodeLab';
import { SectionHeader, Chip } from '../components/ui';
import { keywordScore, questionRubric, defenseScore, DEFENSE_QUESTIONS } from '../engine/evaluate';
import { outputCheck } from '../engine/evaluate';
import type { Section, Concept } from '../types';

const chipFor = (d: string) => (
  <Chip kind={d === 'easy' ? 'easy' : d === 'medium' ? 'medium' : 'hard'}>{d.toUpperCase()}</Chip>
);

export default function Lesson() {
  const { sid, stage } = useParams();
  const { sections } = useCurriculum();
  const state = useStore();
  const nav = useNavigate();
  const sec = sections.find((s) => s.id === sid);
  if (!sec) return <div className="loading">Section not found.</div>;
  const active: Stage = (STAGES.includes(stage as Stage) ? stage : 'learn') as Stage;
  const { masterPct } = sectionProgress(sec, state);
  const idx = STAGES.indexOf(active);

  return (
    <div>
      <SectionHeader
        no={String(sec.no).padStart(2, '0')}
        title={sec.title}
        level={sec.learn.concepts.some((c) => c.level === 'advanced') ? 'Beginner → Advanced' : 'Beginner'}
        minutes={45 + sec.coding.length * 4}
        pct={masterPct}
      />

      <div className="stages">
        {STAGES.map((st) => (
          <button key={st} className={`stagepill ${st === active ? 'active' : ''}`} onClick={() => nav(`/lesson/${sec.id}/${st}`)}>
            {STAGE_META[st].icon} {STAGE_META[st].label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {(sec.pages.learn[0] || sec.pages.mini[0]) && (
          <a className="btn small" href={`#/pdf/${sec.pages.learn[0] ?? sec.pages.mini[0]}`}>📄 PDF p.{sec.pages.learn[0] ?? sec.pages.mini[0]}</a>
        )}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {idx > 0 && <button className="btn small" onClick={() => nav(`/lesson/${sec.id}/${STAGES[idx - 1]}`)}>← {STAGE_META[STAGES[idx - 1]].label}</button>}
        {idx < STAGES.length - 1 && <button className="btn small" onClick={() => nav(`/lesson/${sec.id}/${STAGES[idx + 1]}`)}>Next: {STAGE_META[STAGES[idx + 1]].label} →</button>}
      </div>

      {active === 'learn' && <LearnStage sec={sec} />}
      {active === 'interview' && <InterviewStage sec={sec} />}
      {active === 'coding' && <CodingStage sec={sec} />}
      {active === 'logic' && <LogicStage sec={sec} />}
      {active === 'debug' && <DebugStage sec={sec} />}
      {active === 'solved' && <SolvedStage sec={sec} />}
      {active === 'mini' && <MiniStage sec={sec} />}
      {active === 'project' && <ProjectStage sec={sec} />}
      {active === 'defense' && <DefenseStage sec={sec} />}
      {active === 'checkpoint' && <CheckpointStage sec={sec} />}
    </div>
  );
}

/* ============================ STAGES ============================ */

function LearnStage({ sec }: { sec: Section }) {
  const state = useStore();
  const viewed = !!state.attempts[learnView(sec.id)];
  useEffect(() => { if (!viewed) { recordAttempt(learnView(sec.id), { done: true }); addXp(2, 'read', 'Concept read'); } }, [sec.id]);
  return (
    <div>
      {sec.learn.concepts.map((c: Concept, i: number) => (
        <div key={i} className="card fadeup">
          <div className="row spread">
            <h3>{i + 1}. {c.title}</h3>
            <Chip kind={c.level === 'advanced' ? 'hard' : 'easy'}>{c.level === 'advanced' ? 'ADVANCED' : c.level === 'notes' ? 'NOTES' : 'CORE'}</Chip>
          </div>
          {c.body && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>}
          {c.code && (
            <>
              <div className="small muted">CODE</div>
              <pre className="codeblock"><code>{c.code}</code></pre>
            </>
          )}
          {c.output && <p className="small"><b>OUTPUT:</b> <code>{c.output}</code></p>}
          {c.tip && <p className="small muted">💡 {c.tip}</p>}
        </div>
      ))}
      {sec.learn.recap && (
        <div className="card">
          <h3>🧾 Quick Recap</h3>
          <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{sec.learn.recap}</p>
        </div>
      )}
      {sec.learn.remember.map((r, i) => r && (
        <div key={i} className="card" style={{ borderLeft: '3px solid var(--purple)' }}>
          <b className="small">YAAD RAKHO:</b> <span className="small">{r}</span>
        </div>
      ))}
      {sec.learn.practice.length > 0 && (
        <div className="card">
          <h3>✍️ Practice Time</h3>
          {sec.learn.practice.map((p, i) => (
            <p key={i} className="small">{chipFor(p.difficulty)} {p.text}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function InterviewStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<{ pct: number; missing: string[] } | null>(null);
  const qs = sec.interview;
  const key = interviewAnswer(sec.id, idx);

  useEffect(() => { setAnswer(state.interviewAnswers[key] ?? ''); setRevealed(false); setGraded(null); }, [key]);

  if (!qs.length) return <div className="card muted">No interview questions extracted for this section.</div>;
  const q = qs[idx];
  const prevScore = state.attempts[stageAttempt(sec.id, 'interview')]?.score ?? 0;

  const grade = () => {
    const kws = questionRubric(q.a);
    const g = keywordScore(answer, kws);
    setGraded(g);
    recordAttempt(stageAttempt(sec.id, 'interview'), { score: Math.max(prevScore, g.pct) });
    if (g.pct >= 70) addXp(8, 'interview', 'Interview answer');
    else addMistake({ section: sec.id, topic: sec.title, question: q.q, myAnswer: answer, correct: q.a, type: 'interview' });
  };

  return (
    <div className="card">
      <div className="row spread">
        <span className="small muted">Question {idx + 1} of {qs.length}</span>
        <div className="row">
          <button className="btn small" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Previous question">←</button>
          <button className="btn small" disabled={idx === qs.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Next question">→</button>
        </div>
      </div>
      <h2 style={{ margin: '10px 0' }}>{q.q}</h2>
      <p className="small muted">Think first. Answer out loud or type it, then reveal the model answer.</p>
      <textarea
        rows={4}
        value={answer}
        placeholder="Your answer (speak it aloud too)…"
        onChange={(e) => { setAnswer(e.target.value); setState((s) => ({ ...s, interviewAnswers: { ...s.interviewAnswers, [key]: e.target.value } })); }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={grade} disabled={!answer.trim()}>Check answer</button>
        <button className="btn" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal model answer'}</button>
        {q.tip && <span className="chip">TIP: {q.tip.slice(0, 60)}</span>}
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
          {q.fu && <p className="small muted"><b>FOLLOW-UP:</b> {q.fu}</p>}
          {q.tip && <p className="small muted"><b>TIP:</b> {q.tip}</p>}
        </div>
      )}
    </div>
  );
}

function CodingStage({ sec }: { sec: Section }) {
  const state = useStore();
  const tasks = sec.coding.filter((c) => c.difficulty !== 'debug');
  const [sel, setSel] = useState(0);
  if (!tasks.length) return <div className="card muted">No coding tasks for this section.</div>;
  const t = tasks[Math.min(sel, tasks.length - 1)];
  const done = !!state.attempts[itemAttempt(sec.id, 'coding', sel)];
  const starter = `# Task: ${t.text}\n\n`;
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {tasks.map((tt, i) => (
          <button key={i} className={`stagepill ${i === sel ? 'active' : ''} ${state.attempts[itemAttempt(sec.id, 'coding', i)] ? 'done' : ''}`} onClick={() => setSel(i)}>
            {tt.difficulty === 'interview' ? 'IC' : tt.difficulty.slice(0, 1).toUpperCase()}{i + 1}{state.attempts[itemAttempt(sec.id, 'coding', i)] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row spread">
          <h3>{chipFor(t.difficulty)} Task {sel + 1}</h3>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
        <p className="small">{t.text}</p>
        {t.check && <p className="small muted">CHECK: {t.check}</p>}
      </div>
      <CodeLab
        storageKey={codeSlot.lesson(sec.id, 'coding', sel)}
        starter={starter}
        solution={t.solution || undefined}
        onComplete={() => recordAttempt(itemAttempt(sec.id, 'coding', sel), { done: true })}
      />
    </div>
  );
}

function LogicStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [idx, setIdx] = useState(0);
  const [ans, setAns] = useState('');
  const [res, setRes] = useState<{ ok: boolean; pct: number } | null>(null);
  const cards = sec.logic;
  if (!cards.length) return <div className="card muted">No logic cards for this section.</div>;
  const c = cards[Math.min(idx, cards.length - 1)];
  const doneKey = itemAttempt(sec.id, 'logic', idx);
  const done = !!state.attempts[doneKey];

  const check = () => {
    const g = outputCheck(ans, c.answer);
    const ok = g.ok;
    setRes({ ok, pct: g.pct });
    recordAttempt(doneKey, { done: ok });
    if (ok) addXp(6, 'logic', 'Logic card');
    else addMistake({ section: sec.id, topic: `${sec.title} — logic`, question: c.text, myAnswer: ans, correct: c.answer, type: 'logic' });
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {cards.map((cd, i) => (
          <button key={i} className={`stagepill ${i === idx ? 'active' : ''} ${state.attempts[itemAttempt(sec.id, 'logic', i)] ? 'done' : ''}`} onClick={() => setIdx(i)}>
            {cd.kind}{state.attempts[itemAttempt(sec.id, 'logic', i)] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="card">
        <span className="chip">{c.kind.toUpperCase()}</span>
        <h3 style={{ marginTop: 8 }}>{c.text}</h3>
        <p className="small muted">Predict the output / decide your answer BEFORE revealing.</p>
        <textarea rows={3} value={ans} placeholder="My answer…" onChange={(e) => setAns(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={check} disabled={!ans.trim()}>Check</button>
          <button className="btn" onClick={() => setRes({ ok: true, pct: 100 })}>Reveal answer</button>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ done</span>}
        </div>
        {res && (
          <div className="fadeup card" style={{ marginTop: 10, borderColor: res.ok ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
            <b>{res.ok ? '✅ Correct' : '❌ Not quite'}</b>
            <p className="small"><b>ANSWER:</b> {c.answer}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function DebugStage({ sec }: { sec: Section }) {
  const state = useStore();
  const bugs = sec.coding.filter((c) => c.difficulty === 'debug');
  const [explanation, setExplanation] = useState('');
  if (!bugs.length) return <div className="card muted">No debug tasks for this section — the DEBUG chips live in the Coding Lab.</div>;
  const b = bugs[0];
  const done = !!state.attempts[debugDone(sec.id)];

  const submit = () => {
    const g = keywordScore(explanation, ['error', 'convert|cast|type|int|float|input', 'valid|fix|check']);
    recordAttempt(debugDone(sec.id), { done: true, score: g.pct });
    if (g.pct >= 50) addXp(10, 'debug', 'Debug exercise');
    else addMistake({ section: sec.id, topic: `${sec.title} — debug`, question: b.text, myAnswer: explanation, correct: b.solution || 'Fix the conversion', type: 'debug' });
  };

  return (
    <div>
      <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
        <div className="row spread"><h3>🐞 Broken code</h3>{chipFor('hard')}</div>
        <p className="small">{b.text}</p>
        <p className="small muted"><b>1. RUN it</b> in the lab below. <b>2. Explain the problem</b>. <b>3. Fix it</b>.</p>
        <textarea rows={3} placeholder="What is the problem? Why?" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={submit} disabled={!explanation.trim()}>Submit explanation</button>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
      </div>
      <CodeLab
        storageKey={codeSlot.lesson(sec.id, 'debug', '')}
        starter={`# Broken code:\n# ${b.text}\n\n# Fix it below:\n\n`}
        solution={b.solution || undefined}
        onComplete={() => recordAttempt(debugDone(sec.id), { done: true })}
      />
    </div>
  );
}

function SolvedStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [open, setOpen] = useState<number | null>(null);
  const items = sec.solved;
  if (!items.length) return <div className="card muted">No solved practice extracted for this section.</div>;
  return (
    <div>
      <div className="card">
        <p className="small muted">Practice rule: solve first, compare second, then change one input. Mark only after you can explain why the output changes.</p>
      </div>
      {items.map((it, i) => (
        <div key={i} className="card">
          <div className="row spread">
            <span>{chipFor(it.difficulty)} <b className="small">{it.text.slice(0, 110)}</b></span>
            <div className="row">
              {state.attempts[itemAttempt(sec.id, 'solved', i)] && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓</span>}
              <button className="btn small" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide' : 'Show solution'}</button>
              <button className="btn small" onClick={() => recordAttempt(itemAttempt(sec.id, 'solved', i), { done: true })}>Mark done</button>
            </div>
          </div>
          {open === i && (
            <div className="fadeup">
              <div className="small muted" style={{ marginTop: 8 }}>SOLUTION CODE</div>
              <pre className="codeblock"><code>{it.solution || '(see coding lab)'}</code></pre>
              {it.result && <p className="small"><b>EXPECTED RESULT:</b> <code>{it.result}</code></p>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function MiniStage({ sec }: { sec: Section }) {
  const state = useStore();
  const m = sec.mini;
  const done = !!state.attempts[stageAttempt(sec.id, 'mini')];
  return (
    <div>
      <div className="card glow">
        <div className="row spread">
          <h3>🏗️ Mini Project — {m.name || sec.title}</h3>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
        <div className="grid2">
          <div>
            <p className="small"><b>WHAT DOES IT DO?</b><br />{m.what || '—'}</p>
            <p className="small"><b>WHY IS IT USEFUL?</b><br />{m.use || '—'}</p>
            <p className="small"><b>ARCHITECTURE:</b> {m.architecture || '—'}</p>
            <p className="small"><b>FILES:</b> {m.files || 'main.py'} · <b>BUILD TARGET:</b> {m.buildTarget || '—'}</p>
          </div>
          <div>
            <p className="small"><b>EXPECTED OUTPUT:</b><br /><code>{m.output || '(run to see)'}</code></p>
            {m.edgeCases.length > 0 && <p className="small"><b>EDGE CASES:</b> {m.edgeCases.join(' · ')}</p>}
          </div>
        </div>
        <p className="small muted"><b>PROJECT EXPLANATION:</b> {m.explanation || 'Explain: what it does, how data flows, one bug you fixed, what you would improve.'}</p>
      </div>
      <CodeLab
        storageKey={codeSlot.lesson(sec.id, 'mini', '')}
        starter={`# Mini Project: ${m.name || sec.title}\n# ${m.what}\n# Build target: ${m.buildTarget || 'working program with clean output'}\n\n`}
        solution={m.code || undefined}
        onComplete={() => { recordAttempt(stageAttempt(sec.id, 'mini'), { done: true }); addXp(25, 'mini', 'Mini project'); }}
      />
      <div className="card">
        <b className="small">🎤 INTERVIEW QUESTION: "Explain this project."</b>
        <p className="small muted">{m.interview || 'Use: problem → stack → architecture → your contribution → result → limitation → next step.'}</p>
      </div>
    </div>
  );
}

function ProjectStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [tier, setTier] = useState<'simple' | 'medium' | 'hard'>('simple');
  const p = sec.projectLab.find((x) => x.tier === tier) ?? sec.projectLab[0];
  if (!p) return <div className="card muted">No project lab extracted for this section.</div>;
  const done = !!state.attempts[stageAttempt(sec.id, 'project')];
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {(['simple', 'medium', 'hard'] as const).map((t2) => (
          <button key={t2} className={`stagepill ${tier === t2 ? 'active' : ''} ${state.attempts[stageAttempt(sec.id, 'project')]?.answer === t2 ? 'done' : ''}`} onClick={() => setTier(t2)}>
            {t2.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row spread">
          <h3>🚀 {p.name}</h3>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
        <div className="grid2">
          <div>
            <p className="small"><b>WHAT:</b> {p.what || '—'}</p>
            <p className="small"><b>USE:</b> {p.use || '—'}</p>
            <p className="small"><b>ARCHITECTURE:</b> {p.architecture || '—'}</p>
            <p className="small"><b>FILES:</b> {p.files || 'app.py'} · <b>BUILD TARGET:</b> {p.buildTarget || '—'}</p>
          </div>
          <div>
            <p className="small"><b>DEBUG CUE:</b> {p.debugCue || '—'}</p>
            <p className="small"><b>FOLLOW-UP:</b> {p.followUp || '—'}</p>
          </div>
        </div>
        {p.code && <pre className="codeblock"><code>{p.code}</code></pre>}
        <p className="small muted"><b>INTERVIEW DEFENSE:</b> {p.defense || '—'}</p>
      </div>
      <CodeLab
        storageKey={codeSlot.lesson(sec.id, 'project', tier)}
        starter={`# ${p.name}\n# ${p.what}\n# Build target: ${p.buildTarget || ''}\n\n`}
        solution={p.code || undefined}
        onComplete={() => { recordAttempt(stageAttempt(sec.id, 'project'), { done: true, answer: tier }); addXp(30, 'project', 'Project lab build'); }}
      />
    </div>
  );
}

function DefenseStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [answers, setAnswers] = useState<string[]>(() => DEFENSE_QUESTIONS.map((_, i) => state.defenseAnswers[lessonDefenseAnswer(sec.id, i)] ?? ''));
  const [score, setScore] = useState<{ total: number; per: { pct: number; missing: string[] }[] } | null>(null);

  const submit = () => {
    const sc = defenseScore(answers);
    setScore(sc);
    recordAttempt(stageAttempt(sec.id, 'defense'), { done: true, score: sc.total });
    answers.forEach((a, i) => setState((s) => ({ ...s, defenseAnswers: { ...s.defenseAnswers, [lessonDefenseAnswer(sec.id, i)]: a } })));
    if (sc.total >= 60) addXp(20, 'defense', 'Project defense');
  };

  return (
    <div className="card">
      <h3>🛡️ Project Defense — {sec.mini.name || sec.title}</h3>
      <p className="small muted">Answer all 10. Keyword-rubric scoring — deterministic, offline, no fake AI.</p>
      {DEFENSE_QUESTIONS.map((dq, i) => (
        <div key={i} style={{ margin: '10px 0' }}>
          <label className="small"><b>{i + 1}. {dq.q}</b></label>
          <textarea rows={2} value={answers[i]} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
          {score && (
            <div className="small" style={{ color: score.per[i].pct >= 60 ? 'var(--green)' : 'var(--red)' }}>
              {score.per[i].pct}%{score.per[i].missing.length ? ` — missing: ${score.per[i].missing.join(', ')}` : ''}
            </div>
          )}
        </div>
      ))}
      <button className="btn primary" onClick={submit}>Score my defense</button>
      {score && <p className="small">TOTAL: <b>{score.total}/100</b> {score.total >= 60 ? '✅ pass' : '⚠️ keep practicing'}</p>}
    </div>
  );
}

function CheckpointStage({ sec }: { sec: Section }) {
  const state = useStore();
  const missing = missingForMastery(sec, state);
  const { tasks } = sectionProgress(sec, state);

  const recordSelfCheckpoint = () => {
    // Self-graded: average of interview/coding/logic/debug/defense gates
    const pct = Math.round((tasks.interview + tasks.coding + tasks.logic + tasks.debug + tasks.solved + tasks.defense) / 6);
    recordAttempt(stageAttempt(sec.id, 'checkpoint'), { done: true, score: pct });
    if (pct >= 70) addXp(30, 'checkpoint', 'Checkpoint passed');
  };

  return (
    <div className="card">
      <h3>🏆 Checkpoint — Section {String(sec.no).padStart(2, '0')}</h3>
      <p className="small muted">"Mastered" unlocks only when every gate below passes.</p>
      {([
        ['Theory viewed', tasks.learn],
        ['Interview ≥ 70%', tasks.interview >= 70],
        ['Coding ≥ 70%', tasks.coding >= 70],
        ['Logic ≥ 70%', tasks.logic >= 70],
        ['Debug ≥ 70%', tasks.debug >= 70],
        ['Practice solutions ≥ 70%', tasks.solved >= 70],
        ['Mini project', tasks.mini],
        ['Project Lab build', tasks.project],
        ['Defense ≥ 60', tasks.defense >= 60],
        ['Checkpoint ≥ 70%', tasks.checkpoint >= 70],
      ] as [string, boolean][]).map(([label, ok]) => (
        <div key={label} className="row spread small" style={{ padding: '3px 0' }}>
          <span>{ok ? '✅' : '❌'} {label}</span>
          <span className="muted">{ok ? 'PASS' : 'FAIL'}</span>
        </div>
      ))}
      {missing.length > 0 && (
        <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
          <b className="small">Keep practicing — missing:</b>
          <ul className="small" style={{ margin: '6px 0 0 18px' }}>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {missing.length === 0 && (
        <div className="card" style={{ borderColor: 'rgba(52,211,153,.5)' }}>
          <b>✅ ALL GATES PASS — section MASTERED! It now enters the spaced-repetition review queue.</b>
        </div>
      )}
      {sec.checkpoint.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <b className="small">PDF 20-Question Checkpoint (self-graded):</b>
          {sec.checkpoint.slice(0, 6).map((c, i) => (
            <details key={i} style={{ margin: '6px 0' }}>
              <summary className="small">{i + 1}. {c.q}</summary>
              <p className="small muted">KEY: {c.key}</p>
            </details>
          ))}
        </div>
      )}
      <button className="btn primary" style={{ marginTop: 10 }} onClick={recordSelfCheckpoint}>
        Record checkpoint (avg of gate scores)
      </button>
    </div>
  );
}
