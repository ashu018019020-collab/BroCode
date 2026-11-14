import { BookOpen, GraduationCap, Layers, ShieldCheck } from 'lucide-react';
import { useSqliteMasterclass } from '../../core/data/sqlitemasterclass';
import { MasterclassPanel } from '../labs/SqlMasterclass';
import { SqliteLogo } from './SqliteLogo';

/**
 * The SQLite Complete Masterclass.
 *
 * Phase 1 ships Module 00 as a real course page and card: 24 authored topics and six banks,
 * all generated from `content/sqlite-mastery/` by `scripts/sqlite-masterclass.cjs`. Later modules
 * publish through the same pipeline; the generator refuses an empty module.
 */
export default function SqliteCoursePage() {
  const file = useSqliteMasterclass();

  if (!file) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 12 }} />
      </div>
    );
  }

  const { course, stats } = file;
  const bankItems = stats.learn + stats.interview + stats.labs + stats.logic + stats.debug + stats.revision;

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="row" style={{ gap: 12, minWidth: 'min(260px, 100%)' }}>
            <span className="cc-logo"><SqliteLogo size={64} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="chip" style={{ marginBottom: 6 }}>
                <GraduationCap size={12} /> SQLITE MASTERCLASS
              </div>
              <h1 style={{ margin: 0 }}>{course.title}</h1>
              <p className="muted small" style={{ margin: '6px 0 0', maxWidth: 680 }}>{course.tagline}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip"><BookOpen size={12} /> {stats.modules} module</span>
            <span className="chip"><Layers size={12} /> {stats.topics} topics</span>
            <span className="chip"><ShieldCheck size={12} /> {bankItems} bank items</span>
            <span className="chip">{course.hours}h</span>
          </div>
        </div>
        <p className="small muted" style={{ margin: '12px 0 0', maxWidth: 860 }}>{course.description}</p>
      </div>

      <MasterclassPanel file={file} label="SQLITE MASTERCLASS" />

      <div className="card" style={{ marginTop: 10 }}>
        <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b className="small">Phase 1 — real content, not an empty outline</b>
          <span className="chip">{stats.topics} topics · {bankItems} questions</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          Module 00 contains every authored topic and bank item counted here. Later modules are added
          through `content/sqlite-mastery/` and the same generator; a module with empty topics or banks
          fails the build instead of shipping a card with no lesson.
        </p>
      </div>

      <div className="sec-head" style={{ marginTop: 14 }}>
        <h2><BookOpen size={16} color="var(--blue, #2563eb)" /> Learning outcomes</h2><span className="line" />
      </div>
      <div className="card">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
          {course.outcomes.map((outcome) => <li key={outcome} style={{ marginBottom: 6 }}>{outcome}</li>)}
        </ol>
        <p className="small muted" style={{ margin: '10px 0 0' }}>{course.standard}</p>
      </div>
    </div>
  );
}
