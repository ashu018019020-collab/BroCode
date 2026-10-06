import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, FlaskConical, ListChecks, Play, Sparkles } from 'lucide-react';
import { TRACK_DEFS } from '../../app/App';
import { trackHref } from '../../core/learning/surfaces';
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
 *
 * Positioning: BroCode is a COMPLETE technology learning platform — Learn → Practice → Build →
 * Prepare → Grow — and AI/ML is one major domain among several, never the umbrella identity.
 * DOMAINS below and the ItemList in index.html's JSON-LD are the same list on purpose; change
 * the two together (scripts/tests/sitemap.test.mjs pins the pair).
 */
const PILLARS: { to: string; label: string; sub: string }[] = [
  { to: '/courses', label: 'Courses', sub: '11 courses · the 36-step roadmap' },
  { to: '/practice', label: 'Practice', sub: 'Bank, exams, review' },
  { to: '/labs', label: 'Labs', sub: 'Python, SQL, data' },
  { to: '/projects', label: 'Projects', sub: 'Real builds' },
  { to: '/interviews', label: 'Interview', sub: 'Mock + defense' },
  { to: '/career', label: 'Career', sub: 'Defense + job prep' },
  { to: '/progress', label: 'Progress', sub: 'Mastery analytics' },
];

/**
 * The learning domains, in homepage order — mirrored by the schema ItemList in index.html.
 * Each chip is a real internal link into the surface that teaches the domain (not a dead span):
 * crawlable `<a href>`s from the front door are how a hash-routed SPA gets its pages discovered,
 * and they give the first-impression list a click path. Track targets are built with `trackHref`
 * and NOT from the track id — `/track/python` loads a file that does not exist (see surfaces.ts),
 * and a hash URL that matches a route but never resolves does not 404, it just sits there loading.
 * `scripts/tests/layout.test.mjs` re-resolves every target below against the real registries.
 */
const DOMAINS: { name: string; to: string }[] = [
  { name: 'Programming', to: trackHref('python') },
  { name: 'Web Development', to: '/projects' },
  { name: 'Data & Analytics', to: trackHref('data') },
  { name: 'AI & Machine Learning', to: trackHref('ml') },
  { name: 'Generative AI', to: trackHref('genai') },
  { name: 'Backend & APIs', to: trackHref('apis') },
  { name: 'Databases', to: trackHref('sql') },
  { name: 'Cloud & DevOps', to: '/course/build-production' },
  { name: 'DSA & Problem Solving', to: '/concepts' },
  { name: 'Career & Interview', to: '/interviews' },
];

export default function Landing() {
  const state = useStore();
  const { sections } = useCurriculum();
  const ctx = usePathCtx();
  const start = state.profile.onboarded ? '/courses' : '/onboarding';

  const stats = [
    { icon: Sparkles, n: `${TRACK_DEFS.length}`, l: 'Learning Tracks' },
    { icon: BookOpen, n: `${sections.length}`, l: 'Hands-on Modules' },
    { icon: ListChecks, n: ctx.published ? `${ctx.published.total}` : '—', l: 'Practice Questions' },
    { icon: FlaskConical, n: ctx.playbook ? `${ctx.playbook.items}` : '—', l: 'Playbook Items' },
  ];

  return (
    <div className="fadeup">
      <section className="card glow" style={{ padding: '26px 22px' }}>
        <div className="chip" style={{ marginBottom: 10 }}>BROCODE · COMPLETE TECHNOLOGY LEARNING PLATFORM</div>
        <h1 style={{ margin: '0 0 8px', fontSize: '1.9rem', lineHeight: 1.15 }}>
          Learn Skills. Build Projects. Grow Your Career.
        </h1>
        <p className="muted small" style={{ margin: '0 0 16px', maxWidth: 640 }}>
          Interactive courses, hands-on practice, coding labs, real-world projects, interview
          preparation aur career-focused learning — sab ek jagah.
        </p>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <Link className="btn primary" to={start}>
            <Play size={14} /> {state.profile.onboarded ? 'Continue Learning' : 'Start Learning Free'}
          </Link>
          <Link className="btn" to="/courses">
            Browse Courses <ArrowRight size={14} />
          </Link>
          <Link className="btn" to="/practice">
            Practice Questions
          </Link>
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

      <div className="sec-head"><h2>Explore learning domains</h2><span className="line" /></div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {DOMAINS.map((d) => <Link key={d.name} to={d.to} className="chip">{d.name}</Link>)}
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
