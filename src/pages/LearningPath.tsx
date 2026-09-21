import { Link } from 'react-router-dom';
import { useCurriculum } from '../data/curriculum';
import { useStore } from '../offline/store';
import { sectionProgress, isMastered } from '../engine/progress';
import { Bar } from '../components/ui';

const STATUS = {
  mastered: { label: 'MASTERED', color: 'var(--green)' },
  current: { label: 'CURRENT', color: 'var(--cyan)' },
  inProgress: { label: 'IN PROGRESS', color: 'var(--amber)' },
  available: { label: 'AVAILABLE', color: 'var(--muted)' },
};

export default function LearningPath() {
  const { sections } = useCurriculum();
  const state = useStore();
  let currentFound = false;

  return (
    <div>
      <h1>🗺️ Learning Path</h1>
      <p className="muted small">29 sections from the PDF, in study order. Each unlocks the next; mastered sections move to the review queue.</p>
      <div className="roadmap" style={{ marginTop: 14 }}>
        {sections.map((s) => {
          const { masterPct, tasks } = sectionProgress(s, state);
          const done = isMastered(s, state);
          const isCurrent = !done && !currentFound && (currentFound = true);
          const status = done ? STATUS.mastered : isCurrent ? STATUS.current : masterPct > 0 ? STATUS.inProgress : STATUS.available;
          return (
            <div key={s.id} className={`roadmap-node ${done ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
              <div className="roadmap-dot">{done ? '✓' : s.no}</div>
              <div className="card" style={{ margin: 0 }}>
                <div className="row spread" style={{ flexWrap: 'wrap' }}>
                  <div>
                    <b>{String(s.no).padStart(2, '0')} — {s.title}</b>
                    <div className="row small muted" style={{ marginTop: 4 }}>
                      <span className="chip" style={{ color: status.color, borderColor: status.color }}>{status.label}</span>
                      <span>{masterPct}%</span>
                      <span>· {s.learn.concepts.length} concepts · {s.coding.length} coding · {s.interview.length} interview</span>
                      {(s.pages.learn[0] || s.pages.mini[0]) && <a href={`#/pdf/${s.pages.learn[0] ?? s.pages.mini[0]}`}>📄 p.{s.pages.learn[0] ?? s.pages.mini[0]}</a>}
                    </div>
                  </div>
                  <div style={{ minWidth: 180, flex: 1, maxWidth: 320 }}>
                    <Bar pct={masterPct} />
                    <div className="row small muted" style={{ marginTop: 4, gap: 8 }}>
                      <span title="Theory">{tasks.learn ? '✓' : '○'} theory</span>
                      <span title="Coding">{tasks.coding >= 70 ? '✓' : '○'} code</span>
                      <span title="Mini project">{tasks.mini ? '✓' : '○'} mini</span>
                      <span title="Defense">{tasks.defense >= 60 ? '✓' : '○'} defense</span>
                    </div>
                  </div>
                  <Link className="btn small primary" to={`/lesson/${s.id}/learn`}>Open</Link>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
