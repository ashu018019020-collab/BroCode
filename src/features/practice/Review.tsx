import { Link } from 'react-router-dom';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore, setState, addXp } from '../../core/storage/store';
import { dueReview, INTERVALS, nextReviewRecord, reviewInfo, reviewLabel } from '../../core/learning/review';
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
      <HubCrumb hub="/practice" hubLabel="Practice" page="Review Queue" />
      <h1>🔁 Review Queue</h1>
      <p className="muted small">
        Spaced repetition: {INTERVALS.join(' → ')} days. Mastered sections stay sharp without deleting them from the path.
      </p>

      {mastered.length > Object.keys(state.review).filter((k) => k.startsWith('s')).length && (
        <button className="btn" onClick={enroll}>Enroll {mastered.length} mastered section(s)</button>
      )}

      <h2 style={{ marginTop: 14 }}>Due now ({due.length})</h2>
      {!due.length && <p className="muted small">Nothing due. Next interval: {INTERVALS.join('/')} days.</p>}
      {due.map((r) => {
        const s = sections.find((x) => x.id === r.id);
        if (!s) return null;
        /*
         * The schedule line comes from `reviewLabel`/`reviewInfo`, not from arithmetic here: the engine
         * owns the ladder (1/3/7/14/30), the clamp at the last slot and the "how late" count, and a
         * page that re-derives them is how "Review level 1 (next in 1 days)" and a silently overflowed
         * level came to disagree with the engine. `reviewInfo` returns null only for a record that no
         * longer exists, which is not a due row.
         */
        const info = reviewInfo(state, r.id);
        if (!info) return null;
        return (
          <div key={r.id} className="card row spread">
            <div>
              <b className="small">{s.title}</b>
              <p className="small muted">{reviewLabel(info)}</p>
            </div>
            <div className="row">
              <Link className="btn small" to={`/lesson/${s.id}/learn`}>Re-read</Link>
              <button
                className="btn small primary"
                onClick={() => {
                  // `nextReviewRecord` is the engine's own "reviewed" transition (clamped to the last
                  // interval), so this button can never write a level the ladder does not have.
                  setState((st) => ({ ...st, review: { ...st.review, [r.id]: nextReviewRecord(info.level) } }));
                  addXp(10, 'review', 'Review done');
                }}
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
