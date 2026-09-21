import { useStore, setState } from '../offline/store';
import { openMistakes } from '../engine/review';

export default function MistakesPage() {
  const state = useStore();
  const open = openMistakes(state);
  const fixed = state.mistakes.filter((m) => m.fixed);

  return (
    <div>
      <h1>🐞 Mistake Tracker</h1>
      <p className="muted small">Every failed interview answer, logic check and debugging explanation lands here. Retry until fixed — that is where mastery comes from.</p>

      <h3 style={{ marginTop: 14 }}>Open ({open.length})</h3>
      {!open.length && <p className="muted small">No open mistakes. 🎉</p>}
      {open.map((m) => (
        <div key={m.id} className="mistake-item card">
          <div className="row spread" style={{ flexWrap: 'wrap' }}>
            <div>
              <b className="small">{m.topic}</b>
              <p className="small">{m.question}</p>
              <p className="small muted">Your answer: {m.myAnswer.slice(0, 140) || '—'}</p>
              <p className="small" style={{ color: 'var(--green)' }}>Correct: {m.correct.slice(0, 160)}</p>
              <p className="small muted">{m.type} · {m.date} · {m.attempts} attempt(s)</p>
            </div>
            <button
              className="btn small"
              onClick={() => setState((s) => ({ ...s, mistakes: s.mistakes.map((x) => (x.id === m.id ? { ...x, fixed: true } : x)) }))}
            >
              Mark fixed ✓
            </button>
          </div>
        </div>
      ))}

      {fixed.length > 0 && <h3 style={{ marginTop: 18 }}>Fixed ({fixed.length})</h3>}
      {fixed.map((m) => (
        <div key={m.id} className="mistake-item fixed card">
          <b className="small">{m.topic}</b>
          <p className="small muted">{m.question.slice(0, 100)}</p>
        </div>
      ))}
    </div>
  );
}
