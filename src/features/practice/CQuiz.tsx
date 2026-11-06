import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, RotateCcw } from 'lucide-react';
import type { CMcq } from '../../core/learning/ccourse';

export interface CModuleBank {
  id: string; no: number; title: string; level: string; brief: string; mcqs: CMcq[];
}

/**
 * C Programming questions, in their own pane.
 *
 * These are the module MCQs the course already ships. They are multiple-choice with one authored
 * answer and an explanation, so they are answered here instead of being pushed through the Python
 * bank's write-then-self-grade flow: pick an option, see the verdict and the reason, retry freely.
 */
export default function CQuiz({ module }: { module: CModuleBank | null }) {
  const [picked, setPicked] = useState<Record<number, number>>({});

  if (!module) {
    return <p className="muted small">Choose a C module from the C Programming box to start its questions.</p>;
  }

  return (
    <>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <span className="chip">C</span>
          <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{String(module.no).padStart(2, '0')} · {module.title}</h2>
        </div>
        <span className="chip small">{module.mcqs.length} MCQs</span>
      </div>
      <p className="muted small" style={{ marginTop: 4 }}>
        {module.brief} · pick an option to check it; the explanation appears after your answer.
      </p>

      {!module.mcqs.length && <p className="muted small">This module's checkpoint questions are loading…</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(420px, 100%), 1fr))', gap: 10, marginTop: 10 }}>
        {module.mcqs.map((q, i) => {
          const chosen = picked[i];
          const answered = chosen !== undefined;
          return (
            <div className="card" key={`${module.id}-${i}`} style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
              <div className="row spread" style={{ gap: 6 }}>
                <span className="chip">C</span>
                <span className="chip small">Module {module.id.toUpperCase()}</span>
              </div>
              <strong className="small" style={{ display: 'block', margin: '8px 0 6px' }}>{i + 1}. {q.q}</strong>
              <div style={{ display: 'grid', gap: 4 }}>
                {q.options.map((opt, oi) => {
                  const correct = answered && oi === q.answer;
                  const wrong = answered && chosen === oi && oi !== q.answer;
                  return (
                    <button
                      key={opt}
                      type="button"
                      className={`btn small${correct ? ' primary' : ''}`}
                      onClick={() => setPicked((p) => ({ ...p, [i]: oi }))}
                      disabled={answered}
                      style={{ textAlign: 'left', borderColor: wrong ? '#ef4444' : undefined }}
                    >
                      {String.fromCharCode(65 + oi)}. {opt}{correct ? ' ✓' : wrong ? ' ✗' : ''}
                    </button>
                  );
                })}
              </div>
              {answered && (
                <>
                  <p className="muted small" style={{ margin: '8px 0 0' }}>{q.explain}</p>
                  <button className="btn small" style={{ marginTop: 6 }} onClick={() => setPicked((p) => { const next = { ...p }; delete next[i]; return next; })}>
                    <RotateCcw size={12} /> Try again
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <Link className="btn small primary" style={{ marginTop: 12 }} to={`/c-programming/${module.id}`}>
        Open module <ChevronRight size={12} />
      </Link>
    </>
  );
}
