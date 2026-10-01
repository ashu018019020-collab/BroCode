import { Link } from 'react-router-dom';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore, setState, addXp } from '../../core/storage/store';
import { dueReview, INTERVALS } from '../../core/learning/review';
import { isMastered } from '../../core/learning/progress';

export default function ReviewPage() {
  const { sections } = useCurriculum();
  const state = useStore();
  const due = dueReview(state).filter((r) => r.id.startsWith('s'));
  const mastered = sections.filter((s) => isMastered(s, state));

  const enroll = () => {
    setState((s) => {
      const review = { ...s.review };
      mastered.forEach((m) => { if (!review[m.id]) review[m.id] = { level: 0, last: new Date(0).toISOString() }; });
      return { ...s, review };
    });
  };

  return (
    <div>
      <h1>🔁 Review Queue</h1>
      <p className="muted small">Spaced repetition: 1 → 3 → 7 → 14 → 30 days. Mastered sections stay sharp without deleting them from the path.</p>

      {mastered.length > Object.keys(state.review).filter((k) => k.startsWith('s')).length && (
        <button className="btn" onClick={enroll}>Enroll {mastered.length} mastered section(s)</button>
      )}

      <h3 style={{ marginTop: 14 }}>Due now ({due.length})</h3>
      {!due.length && <p className="muted small">Nothing due. Next interval: {INTERVALS.join('/')} days.</p>}
      {due.map((r) => {
        const s = sections.find((x) => x.id === r.id);
        if (!s) return null;
        return (
          <div key={r.id} className="card row spread">
            <div>
              <b className="small">{s.title}</b>
              <p className="small muted">Review level {r.level} (next in {INTERVALS[Math.min(r.level, INTERVALS.length - 1)]} days)</p>
            </div>
            <div className="row">
              <Link className="btn small" to={`/lesson/${s.id}/learn`}>Re-read</Link>
              <button
                className="btn small primary"
                onClick={() => { setState((st) => ({ ...st, review: { ...st.review, [r.id]: { level: Math.min(r.level + 1, 4), last: new Date().toISOString() } } })); addXp(10, 'review', 'Review done'); }}
              >
                Reviewed ✓
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
