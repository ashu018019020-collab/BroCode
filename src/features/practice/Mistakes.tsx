import { Link } from 'react-router-dom';
import { useStore, setState } from '../../core/storage/store';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { openMistakes } from '../../core/learning/review';

/**
 * A mistake is a dead end without a way back to the question it came from: the page promises
 * "retry until fixed", so each open row links to the bank filtered to its own section and text.
 *
 * The `section` guard is honesty, not caution: records filed from the Playground and the C course
 * carry a non-section label (`playground`, …), and `/questions?section=playground` would open an
 * empty bank and look like the question vanished.
 */
function retryHref(section: string, question: string): string | null {
  if (!/^s\d+$/i.test(section)) return null;
  const params = new URLSearchParams();
  params.set('section', section);
  params.set('find', question.slice(0, 40));
  return `/questions?${params.toString()}`;
}

export default function MistakesPage() {
  const state = useStore();
  const open = openMistakes(state);
  const fixed = state.mistakes.filter((m) => m.fixed);

  return (
    <div>
      <HubCrumb hub="/practice" hubLabel="Practice" page="Mistake Tracker" />
      <h1>🐞 Mistake Tracker</h1>
      <p className="muted small">
        Every failed interview answer, logic check and debugging explanation lands here. Retry until fixed — that is
        where mastery comes from.
      </p>

      <h2 style={{ marginTop: 14 }}>Open ({open.length})</h2>
      {!open.length && <p className="muted small">No open mistakes. 🎉</p>}
      {open.map((m) => {
        const retry = retryHref(m.section, m.question);
        return (
          <div key={m.id} className="mistake-item card">
            <div className="row spread" style={{ flexWrap: 'wrap' }}>
              <div>
                <b className="small">{m.topic}</b>
                <p className="small">{m.question}</p>
                <p className="small muted">Your answer: {m.myAnswer.slice(0, 140) || '—'}</p>
                <p className="small" style={{ color: 'var(--green)' }}>Correct: {m.correct.slice(0, 160)}</p>
                <p className="small muted">{m.type} · {m.date} · {m.attempts} attempt(s)</p>
                {retry && (
                  <Link className="btn small" to={retry} style={{ marginTop: 6 }}>
                    Retry this question
                  </Link>
                )}
              </div>
              <button
                className="btn small"
                onClick={() => setState((s) => ({ ...s, mistakes: s.mistakes.map((x) => (x.id === m.id ? { ...x, fixed: true } : x)) }))}
              >
                Mark fixed ✓
              </button>
            </div>
          </div>
        );
      })}

      {fixed.length > 0 && <h2 style={{ marginTop: 18 }}>Fixed ({fixed.length})</h2>}
      {fixed.map((m) => (
        <div key={m.id} className="mistake-item fixed card">
          <div className="row spread" style={{ flexWrap: 'wrap' }}>
            <div>
              <b className="small">{m.topic}</b>
              <p className="small muted">{m.question.slice(0, 100)}</p>
            </div>
            {/* A mis-clicked "fixed" must be reversible — otherwise the only cure is a full reset. */}
            <button
              className="btn small ghost"
              onClick={() => setState((s) => ({ ...s, mistakes: s.mistakes.map((x) => (x.id === m.id ? { ...x, fixed: false } : x)) }))}
            >
              Reopen
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
