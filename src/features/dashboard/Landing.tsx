import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, FlaskConical, ListChecks, Play, Sparkles } from 'lucide-react';
import { TRACK_DEFS } from '../../app/App';
import { trackHref } from '../../core/learning/surfaces';
import { useCurriculum } from '../../core/data/curriculum';
import { useAuth } from '../../core/auth/AuthProvider';
import { usePathCtx } from '../../core/data/paths';
import { useStore } from '../../core/storage/store';
import { resumeTarget } from '../../core/learning/resume';

/**
 * The front door — the PUBLIC page an unauthenticated visitor sees at `/`.
 *
 * Every figure is read from a real content manifest or from the path context — the headline numbers
 * ARE the app's own (8 tracks, 29 modules, the published question count, the Playbook's item count).
 * No seeded, rounded-up or invented figure appears on this page: a study app that lies about its size
 * on the first screen has spent its only first impression.
 *
 * WHAT CHANGED WHEN ACCOUNTS BECAME MANDATORY: this page used to be an entry point INTO the app
 * ("Start Learning Free" went straight to onboarding, and the pillar tiles walked a visitor in). It
 * is now a public OVERVIEW: the two buttons that lead anywhere are Sign in and Create account, and
 * the pillar/domain links still name where each subject lives (they are honest previews — the guard
 * sends a visitor to sign-in and brings them back to that exact page afterwards).
 *
 * Everything private is gone from it: no progress, no streak, no XP, no "continue learning". A
 * visitor must not be able to read another learner's data from the marketing page.
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
  const { user } = useAuth();
  const { sections } = useCurriculum();
  const ctx = usePathCtx();
  const state = useStore();
  /**
   * A signed-in learner's "Continue Learning" is not a link to `/` — that was a self-link that
   * looked like a dead button. It resolves the same resume position the dashboard and the footer
   * use, so all three controls land on the same real lesson.
   */
  const resume = resumeTarget(state, sections);

  const stats = [
    { icon: Sparkles, n: `${TRACK_DEFS.length}`, l: 'Learning Tracks' },
    { icon: BookOpen, n: `${sections.length}`, l: 'Hands-on Modules' },
    { icon: ListChecks, n: ctx.published ? `${ctx.published.total}` : '—', l: 'Practice Questions' },
    { icon: FlaskConical, n: ctx.playbook ? `${ctx.playbook.items}` : '—', l: 'Playbook Items' },
  ];

  /*
   * The call to action depends on who is looking, and a SIGNED-IN learner can still reach this page
   * (they are redirected to `/` after signing in, but a bookmark or the footer can bring them back).
   * They get a way into the app; a visitor gets the two doors, and nothing that leads into protected
   * content without one.
   */
  const signedIn = !!user;

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
          {signedIn ? (
            <Link className="btn primary" to={resume.route} title={resume.reason}>
              <Play size={14} /> Continue Learning
            </Link>
          ) : (
            <>
              <Link className="btn primary" to="/login" state={{ from: '/courses' }}>
                <Play size={14} /> Create account &amp; start
              </Link>
              <Link className="btn" to="/login">Sign in</Link>
            </>
          )}
          <Link className="btn" to="/courses">
            Browse Courses <ArrowRight size={14} />
          </Link>
        </div>
        {!signedIn && (
          <p className="muted small" style={{ margin: '12px 0 0' }}>
            An account is required to open courses, lessons, practice questions, labs and your
            progress. Creating one takes a minute.
          </p>
        )}
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
        {signedIn
          ? 'Progress, notes and code are saved to your account.'
          : 'Sign in to open any of these — your progress is saved to your account.'}
      </p>
    </div>
  );
}
