import { Briefcase } from 'lucide-react';
import { usePathCtx } from '../../core/data/paths';
import { JOB_PREP_ITEMS } from '../../core/learning/paths';
import { HubGrid } from '../../components/shared/HubGrid';

/**
 * The Career pillar: turn the work into a resume, a checklist and a visible record.
 *
 * The three cards are the registered career routes; resume answers, checklist progress and the
 * level/streak figures all come from the path context (one owner per number).
 */
const ROUTES = ['/resume', '/jobprep', '/progress'];

export default function CareerHub() {
  const ctx = usePathCtx();
  const { counts } = ctx;
  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>CAREER</div>
            <h1 style={{ margin: 0 }}>Kaam ko resume aur interview answer banao.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              Project bullets, a 60-second pitch, aur ek job-prep checklist — sab tumhare asli progress
              se bhare hue.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><Briefcase size={12} /> {counts.resumeAnswers} defense answers</span>
            <span className="chip">{counts.jobPrepDone} / {JOB_PREP_ITEMS} checklist items</span>
            <span className="chip">Level {counts.level} · {counts.xp} XP</span>
          </div>
        </div>
      </div>
      <div className="sec-head"><h2>All career tools</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />
    </div>
  );
}
