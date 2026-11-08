import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, FlaskConical, ListChecks, Play, Sparkles, Code2, NotebookPen, Mic2, GraduationCap, FolderGit2 } from 'lucide-react';
import { TRACK_DEFS } from '../../app/App';
import { trackHref } from '../../core/learning/surfaces';
import { AUTH_SIGN_IN_ACTION } from '../../core/ai/actions';
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
 *
 * The page answers four questions in order, and each band is a real link into the product rather
 * than a claim about it: what this is (hero + figures), what I can learn (domains), where each part
 * lives (pillars), how the loop works (four steps), what I actually open (the surfaces), and what a
 * stranger reasonably asks next (FAQ). Nothing here promises a job, a salary or a user count.
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
 * The loop the product actually runs, in the order a learner meets it. Each step names the page it
 * opens — a "how it works" band whose rows are not links is a diagram of nothing.
 */
const STEPS: { n: string; label: string; sub: string; to: string; icon: typeof BookOpen }[] = [
  { n: '01', label: 'Learn the concept', sub: 'A numbered step with an objective, examples, line-by-line code and common mistakes.', to: '/courses', icon: BookOpen },
  { n: '02', label: 'Practise it', sub: 'Graded questions from that exact section, with review and a mistake tracker.', to: '/practice', icon: ListChecks },
  { n: '03', label: 'Build it', sub: 'Run the code in the browser, finish a lab, then ship a project step by step.', to: '/projects', icon: FolderGit2 },
  { n: '04', label: 'Prove it', sub: 'Mock interviews, a project defense and a job-prep checklist that report real numbers.', to: '/interviews', icon: Mic2 },
];

/** The working surfaces, named the way the rail names them (one place, one name). */
const SURFACES: { to: string; label: string; sub: string; icon: typeof BookOpen }[] = [
  { to: '/playground', label: 'Code Playground', sub: 'A Python editor that runs in the browser, with error explanations and an AI coach.', icon: Code2 },
  { to: '/notebooks', label: 'Code Bro Lab', sub: 'Notebook cells with a real kernel: run all, restart, and export your work.', icon: NotebookPen },
  { to: '/labs', label: 'Labs', sub: 'Python, SQL, NumPy + Pandas, AI, RAG and agentic labs — datasets included.', icon: FlaskConical },
  { to: '/ai-mentor', label: 'AI Mentor', sub: 'Ask about the lesson you are on, by voice or text, and get guided rather than handed the answer.', icon: Sparkles },
];

/**
 * Honest answers only: what the product is, what it needs from you, and what it does not promise.
 * The account answer is the same sentence the hero prints, because a visitor meets both.
 */
const FAQ: { q: string; a: string }[] = [
  { q: 'Is BroCode free?', a: 'Yes. The courses, the practice bank and the labs are free to use. An account is required so your progress is saved to you rather than to this browser.' },
  { q: 'Do I need an account?', a: 'Yes — an account is required to open courses, lessons, practice questions, labs and your progress. Creating one takes a minute.' },
  { q: 'Do I need to install anything?', a: 'No. Python, SQL, the notebook and the editor run inside the page. The C course compiles on a connected compiler service and says so when it is not reachable.' },
  { q: 'Does my progress follow me to another device?', a: 'Yes. Your progress snapshot is stored against your account, so signing in on a new device resumes where you stopped.' },
  { q: 'Is there a Hinglish version?', a: 'Yes. The interface and the course names can switch between English and Hinglish from Profile & Settings.' },
  { q: 'Will this get me a job?', a: 'It prepares you: real projects, interview practice, a project defense and a job-prep checklist. It does not promise or invent placements, and no employer is claimed as a partner.' },
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
          Learn. Practice. Build. Become job ready.
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
              <Link className="btn" to="/login" data-agent-action={AUTH_SIGN_IN_ACTION}>Sign in</Link>
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

      {/* How the loop works — each row opens the page it names, so the band is a path, not a diagram. */}
      <div className="sec-head"><h2>How BroCode works</h2><span className="line" /></div>
      <div className="tile-grid">
        {STEPS.map((s) => (
          <Link key={s.n} to={s.to} className="tile">
            <span className="ic"><s.icon size={16} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b><span style={{ opacity: 0.6, fontVariantNumeric: 'tabular-nums' }}>{s.n}</span> · {s.label}</b>
              <span>{s.sub}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* The surfaces a learner actually opens, under the names the rail uses for them. */}
      <div className="sec-head"><h2>Inside the platform</h2><span className="line" /></div>
      <div className="tile-grid">
        {SURFACES.map((s) => (
          <Link key={s.to} to={s.to} className="tile">
            <span className="ic"><s.icon size={16} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{s.label}</b>
              <span>{s.sub}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* FAQ — native <details>, so it works with the keyboard and with no JavaScript of its own. */}
      <div className="sec-head"><h2>Questions a beginner actually asks</h2><span className="line" /></div>
      <div style={{ display: 'grid', gap: 8 }}>
        {FAQ.map((f) => (
          <details key={f.q} className="card" style={{ padding: '12px 14px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{f.q}</summary>
            <p className="muted small" style={{ margin: '8px 0 0' }}>{f.a}</p>
          </details>
        ))}
      </div>

      <section className="card" style={{ padding: '18px 20px', marginTop: 16 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <GraduationCap size={18} color="var(--cyan)" aria-hidden="true" />
          <b style={{ flex: 1, minWidth: 200 }}>
            {signedIn ? 'Your next step is already picked.' : 'Start with the first course step — it is free once you sign in.'}
          </b>
          {signedIn ? (
            <Link className="btn primary" to={resume.route} title={resume.reason}>
              <Play size={14} /> Continue Learning
            </Link>
          ) : (
            <Link className="btn primary" to="/login" state={{ from: '/courses' }}>
              Create account <ArrowRight size={14} />
            </Link>
          )}
        </div>
      </section>

      <p className="small muted" style={{ marginTop: 14 }}>
        {signedIn
          ? 'Progress, notes and code are saved to your account.'
          : 'Sign in to open any of these — your progress is saved to your account.'}
      </p>
    </div>
  );
}
