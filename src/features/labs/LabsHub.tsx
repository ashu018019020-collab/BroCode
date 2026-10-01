import { FlaskConical } from 'lucide-react';
import { usePathCtx } from '../../core/data/paths';
import { HubGrid } from '../../components/shared/HubGrid';

/**
 * The Labs pillar: every surface where the learner RUNS something.
 *
 * `core/data/paths.ts` already computes the counts these cards print (saved slots per runtime,
 * notebook cells run, RAG rounds), so the hub only renders the registry.
 */
const ROUTES = ['/playground', '/notebooks', '/sql', '/numpy-pandas', '/ai', '/agentic', '/rag'];

export default function LabsHub() {
  const ctx = usePathCtx();
  const cells = ctx.notebooks ? ctx.notebooks.cells : null;
  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>LABS</div>
            <h1 style={{ margin: 0 }}>Code likho, turant chalao.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              Python, SQL, NumPy + Pandas, notebooks, aur AI / RAG / Agentic labs — sab browser me chalte
              hain, internet ke bina.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><FlaskConical size={12} /> {ROUTES.length} labs</span>
            {cells !== null && <span className="chip">{ctx.counts.notebookCells} / {cells} notebook cells run</span>}
            {ctx.counts.ragRounds > 0 && <span className="chip">{ctx.counts.ragRounds} RAG rounds</span>}
          </div>
        </div>
      </div>
      <div className="sec-head"><h2>All labs</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />
    </div>
  );
}
