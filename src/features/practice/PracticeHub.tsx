import { Link } from 'react-router-dom';
import { Repeat, Bug, ChevronRight, Zap, ListChecks } from 'lucide-react';
import { useStore } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import { dueReview, openMistakes } from '../../core/learning/review';
import { openBySection, sourceLabel } from '../../core/ai/coach';
import { usePathCtx } from '../../core/data/paths';
import { HubGrid } from '../../components/shared/HubGrid';

/**
 * The Practice pillar: every surface where the learner ANSWERS something.
 *
 * The numbers come from the modules that own them — `core/learning/review.ts` for what is due,
 * `core/ai/coach.ts` for the open mistake pile and the per-section weak areas, and
 * `core/data/paths.ts` for the bank/published figures. Nothing here re-counts an attempt key,
 * which is the rule the architecture doc states and the engines test enforces.
 */
const ROUTES = ['/questions', '/playbook', '/exam', '/final', '/review', '/mistakes'];

export default function PracticeHub() {
  const state = useStore();
  const { sections } = useCurriculum();
  const ctx = usePathCtx();
  const due = dueReview(state).length;
  const open = openMistakes(state).length;

  // Weak areas: the coach already groups open mistakes by section, so the hub only sorts and prints.
  const weak = [...openBySection(state, sections).entries()]
    .map(([id, list]) => ({ id, list, section: sections.find((s) => s.id === id) }))
    .filter((w) => w.section)
    .sort((a, b) => b.list.length - a.list.length)
    .slice(0, 3);

  const practised = ctx.counts.bankPractised;
  const published = ctx.published?.total ?? null;

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>PRACTICE</div>
            <h1 style={{ margin: 0 }}>Answer karo — yahi mastery banti hai.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              Question Bank, Playbook ke coding labs, timed papers aur spaced-repetition — sab ek jagah,
              sab asli numbers ke saath.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><ListChecks size={12} /> {published !== null ? `${practised} / ${published} questions` : `${practised} questions practised`}</span>
            <span className="chip"><Repeat size={12} /> {due} due now</span>
            <span className="chip"><Bug size={12} /> {open} open mistakes</span>
          </div>
        </div>
      </div>

      <div className="sec-head"><h2>Smart Practice</h2><span className="line" /></div>
      <div className="card fadeup">
        {!weak.length && (
          <p className="muted small" style={{ margin: 0 }}>
            Abhi koi weak area nahi — jab koi jawab galat hoga, coach yahan us section ko dikhayega.
          </p>
        )}
        {weak.map((w) => (
          <Link key={w.id} className="q-row tone-red" to="/questions" title={w.list.map((m) => sourceLabel(m)).join(' · ')}>
            <span className="ic"><Bug size={14} /></span>
            <span className="t">{w.section ? `${String(w.section.no).padStart(2, '0')} · ${w.section.title}` : w.id}</span>
            <b>{w.list.length}</b>
            <ChevronRight size={14} />
          </Link>
        ))}
        {due > 0 && (
          <Link className="q-row tone-blue" to="/review">
            <span className="ic"><Repeat size={14} /></span>
            <span className="t">Spaced repetition — aaj due</span>
            <b>{due}</b>
            <ChevronRight size={14} />
          </Link>
        )}
      </div>

      <div className="sec-head"><h2><Zap size={16} color="var(--amber)" /> Practice surfaces</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />

      <p className="small muted" style={{ marginTop: 12 }}>
        Interview ke sawaalon ke liye <Link to="/interviews">Interview pillar</Link> kholo — wahan mock,
        defense aur final assessment hain.
      </p>
    </div>
  );
}
