import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, FlaskConical, ListChecks, Play, Sparkles, WifiOff } from 'lucide-react';
import { TRACK_DEFS } from '../../app/App';
import { useCurriculum } from '../../core/data/curriculum';
import { useStore } from '../../core/storage/store';
import { usePathCtx } from '../../core/data/paths';

/**
 * The front door: what the app is, how much of it there is, and where to start.
 *
 * Every figure is read from a real content manifest or from the path context — the headline numbers
 * ARE the app's own (8 tracks, 29 modules, the published question count, the Playbook's item count).
 * No seeded, rounded-up or invented figure appears on this page: an offline study app that lies
 * about its size on the first screen has spent its only first impression.
 */
const PILLARS: { to: string; label: string; sub: string }[] = [
  { to: '/path', label: 'Learning', sub: 'The 36-step roadmap' },
  { to: '/practice', label: 'Practice', sub: 'Bank, exams, review' },
  { to: '/labs', label: 'Labs', sub: 'Python, SQL, AI' },
  { to: '/projects', label: 'Projects', sub: 'Real builds' },
  { to: '/interviews', label: 'Interview', sub: 'Mock + defense' },
  { to: '/career', label: 'Career', sub: 'Resume + job prep' },
  { to: '/progress', label: 'Progress', sub: 'Mastery analytics' },
];

export default function Landing() {
  const state = useStore();
  const { sections } = useCurriculum();
  const ctx = usePathCtx();
  const start = state.profile.onboarded ? '/path' : '/onboarding';

  const stats = [
    { icon: Sparkles, n: `${TRACK_DEFS.length}`, l: 'Learning Tracks' },
    { icon: BookOpen, n: `${sections.length}`, l: 'Hands-on Modules' },
    { icon: ListChecks, n: ctx.published ? `${ctx.published.total}` : '—', l: 'Practice Questions' },
    { icon: FlaskConical, n: ctx.playbook ? `${ctx.playbook.items}` : '—', l: 'Playbook Items' },
  ];

  return (
    <div className="fadeup">
      <section className="card glow" style={{ padding: '26px 22px' }}>
        <div className="chip" style={{ marginBottom: 10 }}>BROCODE · AI ENGINEER MASTER LAB</div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.9rem', lineHeight: 1.15 }}>
          Learn Python. Build real-world skills.
        </h1>
        <p className="muted small" style={{ margin: '0 0 16px', maxWidth: 640 }}>
          Interactive courses, hands-on coding, real projects, interview prep and AI-powered practice —
          sab ek jagah, aur poora app bina internet chalega.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn primary" to={start}>
            <Play size={14} /> {state.profile.onboarded ? 'Continue Learning' : 'Start Learning Free'}
          </Link>
          <Link className="btn" to="/path">
            View Learning Path <ArrowRight size={14} />
          </Link>
          <Link className="btn" to="/practice">
            Practice Questions
          </Link>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <span className="chip"><WifiOff size={12} /> Works offline</span>
          <span className="chip">Python 3.12 (Pyodide)</span>
          <span className="chip">SQLite in the browser</span>
          <span className="chip">Progress stays on this device</span>
        </div>
      </section>

      <div className="kpi-row">
        {stats.map((s) => (
          <div key={s.l} className="kpi tone-cyan">
            <span className="ic"><s.icon size={18} /></span>
            <div className="kpi-body">
              <div className="n">{s.n}</div>
              <div className="l">{s.l}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="sec-head"><h2>Pick a pillar</h2><span className="line" /></div>
      <div className="tile-grid">
        {PILLARS.map((p) => (
          <Link key={p.to} to={p.to} className="tile">
            <span className="ic"><ArrowRight size={16} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{p.label}</b>
              <span>{p.sub}</span>
            </span>
          </Link>
        ))}
      </div>

      <p className="small muted" style={{ marginTop: 14 }}>
        {state.profile.onboarded
          ? 'Sab kuch local hai — progress tumhare browser me hi rehta hai.'
          : 'Pehla step 30 second ka onboarding hai, uske baad tumhara personal dashboard ban jayega.'}
      </p>
    </div>
  );
}
