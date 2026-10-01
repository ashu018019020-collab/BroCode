import { Mic2 } from 'lucide-react';
import { usePathCtx } from '../../core/data/paths';
import { FINAL_PARTS } from '../../core/learning/paths';
import { HubGrid } from '../../components/shared/HubGrid';

/**
 * The Interview pillar: answer aloud, defend your projects, then sit the final paper.
 *
 * Counts come from the path context (interview answers + their measured average, mock rounds that
 * cleared the bar, defended sections) — the same bag the roadmap cards read.
 */
const ROUTES = ['/interview', '/mock', '/defense', '/final'];

export default function InterviewsHub() {
  const ctx = usePathCtx();
  const { counts, mockTotal, sections, defenseGates } = ctx;
  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>INTERVIEW</div>
            <h1 style={{ margin: 0 }}>Bolkar practice karo, phir defend karo.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              Structured interview answers, timed mock rounds, project defense aur ek final paper —
              har ek apne asli score ke saath.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><Mic2 size={12} /> {counts.interviewAnswers} answers recorded</span>
            {typeof counts.interviewPct === 'number' && <span className="chip">{counts.interviewPct}% average</span>}
            <span className="chip">{counts.mockDone} / {mockTotal} mock rounds</span>
            <span className="chip">{defenseGates} / {sections.length} sections defended</span>
            <span className="chip">{counts.finalParts} / {FINAL_PARTS} final parts scored</span>
          </div>
        </div>
      </div>
      <div className="sec-head"><h2>All interview surfaces</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />
    </div>
  );
}
