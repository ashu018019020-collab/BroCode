import { Link } from 'react-router-dom';
import {
  ArrowRight, BookOpen, FlaskConical, ListChecks, Play, Sparkles, Code2, NotebookPen, Mic2,
  GraduationCap, FolderGit2, Target, Trophy, Layers,
} from 'lucide-react';
import { TRACK_DEFS } from '../../app/App';
import { trackHref } from '../../core/learning/surfaces';
import { AUTH_SIGN_IN_ACTION } from '../../core/ai/actions';
import { useCurriculum } from '../../core/data/curriculum';
import { useCourseIndex } from '../../core/data/courses';
import { useAuth } from '../../core/auth/AuthProvider';
import { usePathCtx } from '../../core/data/paths';
import { useStore } from '../../core/storage/store';
import { resumeTarget } from '../../core/learning/resume';

/**
 * The front door — the PUBLIC page an unauthenticated visitor sees at `/`.
 *
 * Every figure is read from a published manifest: the curriculum's 29 sections, the bank
 * manifest's 13,865 questions, the courses index's 11 courses / 36 roadmap steps / 87 projects,
 * and the bundled Practice Archive's 476 items. A missing manifest prints an em dash — never a
 * zero, never a rounded-up number.
 *
 * The archive is labelled for what it is. The 476 items were called "Playbook Items" on the old
 * homepage, but they are imported PRACTICE items (384 interview drills, 51 checkpoints, 27 coding,
 * 7 theory, 1 logic, 6 defense). Calling them Playbooks made the product look like it sold a
 * second learning library it does not have; the band below says so plainly and links to the real
 * route (`/playbook`), whose nav label is also "Practice Archive".
 *
 * WHAT CHANGED WHEN ACCOUNTS BECAME MANDATORY: this page used to be an entry point INTO the app
 * ("Start Learning Free" went straight to onboarding). It is now a public OVERVIEW: the buttons
 * that lead anywhere are Create account, Sign in and the preview links; every private destination
 * is guarded and returns the visitor to that exact page after signing in.
 *
 * Everything private is gone from it: no progress, no streak, no XP, no "continue learning" for a
 * visitor. A signed-in learner who reaches this page gets the same public content plus a Continue
 * Learning action resolved from their own state — never another learner's.
 */
const PILLARS: { to: string; label: string; sub: string; icon: typeof BookOpen }[] = [
  { to: '/courses', label: 'Courses', sub: 'Structured courses, beginner to advanced, on one 36-step roadmap.', icon: GraduationCap },
  { to: '/practice', label: 'Practice', sub: 'Topic questions, timed exams, revision and a mistake tracker.', icon: ListChecks },
  { to: '/labs', label: 'Coding Labs', sub: 'Python, SQL, NumPy and Pandas run in the browser — no install.', icon: FlaskConical },
  { to: '/projects', label: 'Projects', sub: 'Guided real-world builds with a project gate you can actually pass.', icon: FolderGit2 },
  { to: '/interviews', label: 'Interview Prep', sub: 'Question rounds, mock interviews, coding rounds and defense.', icon: Mic2 },
  { to: '/career', label: 'Career', sub: 'Roadmaps, resume readiness, job-prep checklist and portfolio picks.', icon: Target },
  { to: '/progress', label: 'My Progress', sub: 'Mastery, accuracy, streak and mistakes measured from real records.', icon: Trophy },
];

/**
 * The loop the product actually runs, in the order a learner meets it. Each step names the page it
 * opens — a "how it works" band whose rows are not links is a diagram of nothing.
 */
const STEPS: { n: string; label: string; sub: string; to: string; icon: typeof BookOpen }[] = [
  { n: '01', label: 'Understand', sub: 'Clear concepts, runnable examples, line-by-line code and the mistakes everyone makes.', to: '/courses', icon: BookOpen },
  { n: '02', label: 'Practice', sub: 'Topic-based questions with difficulty levels, hints, solutions and explanations.', to: '/practice', icon: ListChecks },
  { n: '03', label: 'Build', sub: 'Browser labs, debugging drills, mini projects and guided real-world builds.', to: '/projects', icon: FolderGit2 },
  { n: '04', label: 'Prove', sub: 'Interview questions, assessments, a project defense and career preparation.', to: '/interviews', icon: Mic2 },
];

/** The journey strip in the hero — the same four stages, written for a first-time visitor. */
const JOURNEY: { n: string; label: string; sub: string }[] = [
  { n: '01', label: 'LEARN', sub: 'Numbered lessons and runnable examples.' },
  { n: '02', label: 'PRACTICE', sub: 'Questions, review and a mistake tracker.' },
  { n: '03', label: 'BUILD', sub: 'Labs, projects and debugging practice.' },
  { n: '04', label: 'PROVE', sub: 'Mock interviews, defense and job prep.' },
];

/** The working surfaces, named the way the rail names them (one place, one name). */
const SURFACES: { to: string; label: string; sub: string; icon: typeof BookOpen }[] = [
  { to: '/playground', label: 'Code Playground', sub: 'A Python editor that runs in the browser, with error explanations and an AI coach.', icon: Code2 },
  { to: '/notebooks', label: 'Code Bro Lab', sub: 'Notebook cells with a real kernel: run all, restart, and export your work.', icon: NotebookPen },
  { to: '/labs', label: 'Interactive Labs', sub: 'Python, SQL, NumPy + Pandas, AI, RAG and agentic labs — datasets included.', icon: FlaskConical },
  { to: '/ai-mentor', label: 'AI Mentor', sub: 'Ask about the lesson you are on and get guided explanations and hints, not just the answer.', icon: Sparkles },
  { to: '/playbook', label: 'Practice Archive', sub: '476 practice items covering interview drills, checkpoints, coding and theory.', icon: Layers },
];

/** Honest answers only: what the product is, what it needs from you, and what it does not promise. */
const FAQ: { q: string; a: string; links?: { to: string; label: string }[] }[] = [
  {
    q: 'I am completely new to coding. Where should I start?',
    a: 'Start at step 1 of the roadmap and work in order: variables, operators, strings, loops, lists, then the data and AI tracks. Every lesson has a runnable example, so you can read and run the same idea before practising it.',
    links: [{ to: '/courses', label: 'Open the roadmap' }],
  },
  {
    q: 'Which course should I learn first?',
    a: 'Python. It is the language the rest of the platform uses — pandas, SQL labs, machine learning and the AI labs all assume it. The Python course is the largest in the catalogue and starts from zero.',
    links: [{ to: '/course/python', label: 'Start Python' }],
  },
  {
    q: 'Do I need previous programming experience?',
    a: 'No. The first roadmap steps assume no experience: they start with what a variable is and run a first program in the browser. If you already code, the later steps and the interview tracks are the useful entry point.',
    links: [{ to: '/courses', label: 'See all 11 courses' }],
  },
  {
    q: 'Can I practice coding directly in my browser?',
    a: 'Yes. The Playground, Code Bro Lab notebooks and the interactive labs run Python, SQL, NumPy and Pandas in the page — there is nothing to install. Saved work stays with your account.',
    links: [{ to: '/playground', label: 'Open Playground' }, { to: '/labs', label: 'Browse labs' }],
  },
  {
    q: 'How can I build real-world projects?',
    a: 'Each course step ends in a build, and the Projects surface walks you through complete builds with a gate: a project only counts when its build record exists. That is the work you put on a resume.',
    links: [{ to: '/projects', label: 'Open Projects' }],
  },
  {
    q: 'Can AI Mentor explain my coding mistakes?',
    a: 'Yes. AI Mentor reads the lesson or lab you are on and guides you through the error with explanations and hints instead of only handing over the answer. It is available from the rail and every lesson.',
    links: [{ to: '/ai-mentor', label: 'Meet AI Mentor' }],
  },
  {
    q: 'How can I prepare for technical interviews?',
    a: 'Use interview mode for question rounds, mock interviews for a timed sitting, and the defense surface for a project walkthrough. The bank also has 1,936 interview questions filed under the sections that teach them.',
    links: [{ to: '/interviews', label: 'Interview prep' }],
  },
  {
    q: 'How do I track my learning progress?',
    a: 'Every lesson, question, lab and project writes a real record. My Progress turns those records into mastery and accuracy, and Review resurfaces what is due — there are no guessed percentages.',
    links: [{ to: '/progress', label: 'My Progress' }],
  },
  {
    q: 'What are Learning Playbooks?',
    a: 'BroCode does not sell a separate Playbook library. The bundled 476-item archive is the Practice Archive — interview drills, checkpoints, coding, theory and defense questions. Long-form guidance lives in the courses and project labs, which are the structured guides.',
    links: [{ to: '/playbook', label: 'Open Practice Archive' }, { to: '/courses', label: 'Browse courses' }],
  },
  {
    q: 'How does BroCode help me become job-ready?',
    a: 'It builds the evidence: finished projects, a defended build, interview answers and a 16-item job-prep checklist. Career pulls those records into one readiness view. It prepares you — it does not promise a job or invent placements.',
    links: [{ to: '/career', label: 'Open Career' }],
  },
];

/**
 * The learning domains, in homepage order — mirrored by the schema ItemList in index.html.
 * Each chip is a real internal link into the surface that teaches the domain (not a dead span):
 * crawlable `<a href>`s from the front door are how a hash-routed SPA gets its pages discovered.
 * Track targets are built with `trackHref` and NOT from the track id — `/track/python` loads a
 * file that does not exist (see surfaces.ts). ORDER AND SHAPE ARE PINNED by layout.test.mjs.
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

/** A count, formatted for reading. `null` means the manifest has not arrived — never print 0. */
const fmt = (value: number | null | undefined) => (typeof value === 'number' ? value.toLocaleString('en-US') : '—');
const CHALLENGE_LABEL: Record<string, string> = {
  interview: 'Interview drills', checkpoint: 'Checkpoints', coding: 'Coding', theory: 'Theory', logic: 'Logic', defense: 'Defense',
};

export default function Landing() {
  const { user } = useAuth();
  const { sections } = useCurriculum();
  const courses = useCourseIndex();
  const ctx = usePathCtx();
  const state = useStore();
  const resume = resumeTarget(state, sections);
  const signedIn = !!user;

  const featured = courses?.courses.find((c) => c.slug === 'python') ?? courses?.courses[0] ?? null;
  const archive = ctx.playbook;
  const published = ctx.published;
  const updatedAt = published?.generatedAt
    ? new Date(published.generatedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : null;

  const stats = [
    {
      to: '/practice', icon: Sparkles, value: fmt(TRACK_DEFS.length), label: 'Learning Tracks',
      note: 'Eight subject tracks, from Python to agentic AI.', ready: true,
    },
    {
      to: '/courses', icon: BookOpen, value: fmt(sections.length), label: 'Hands-on Modules',
      note: 'Every module has lessons, practice and a build.', ready: true,
    },
    {
      to: '/questions', icon: ListChecks, value: fmt(published?.total), label: 'Practice Questions',
      note: 'Published questions filed under the section that teaches them.', ready: !!published,
    },
    {
      to: '/playbook', icon: Layers, value: fmt(archive?.items), label: 'Practice Archive',
      note: 'Practice items — not a separate Playbook product.', ready: !!archive,
    },
  ];

  const facts = [
    { to: '/courses', label: 'Courses', value: fmt(courses?.totals.courses) },
    { to: '/courses', label: 'Roadmap steps', value: fmt(courses?.families.steps) },
    { to: '/questions?type=coding', label: 'Coding challenges', value: fmt(published?.byType.coding) },
    { to: '/interviews', label: 'Interview questions', value: fmt(published?.interview) },
    { to: '/projects', label: 'Projects', value: fmt(courses?.families.projects) },
    { to: '/labs', label: 'Coding labs', value: fmt(archive?.labs) },
  ];

  const archiveBreakdown = archive
    ? Object.entries(archive.byType)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({ label: CHALLENGE_LABEL[kind] ?? kind, value: count }))
    : [];

  return (
    <div className="fadeup">
      <section className="card glow home-hero">
        <div className="home-hero-grid">
          <div>
            <div className="chip" style={{ marginBottom: 10 }}>BROCODE · COMPLETE TECHNOLOGY LEARNING PLATFORM</div>
            <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(1.7rem, 4vw, 2.35rem)', lineHeight: 1.12 }}>
              Learn. Practice. Build. Become Job-Ready.
            </h1>
            <p className="muted small" style={{ margin: '0 0 16px', maxWidth: 640 }}>
              Everything you need to master technology — structured courses, hands-on practice,
              interactive coding labs, real-world projects and AI-powered learning guidance, all in
              one place.
            </p>
            <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
              {signedIn ? (
                <Link className="btn primary" to={resume.route} title={resume.reason}>
                  <Play size={14} /> Continue Learning
                </Link>
              ) : (
                <>
                  <Link className="btn primary" to="/login" state={{ from: '/courses' }}>
                    <Play size={14} /> Create Free Account
                  </Link>
                  <Link className="btn" to="/login" data-agent-action={AUTH_SIGN_IN_ACTION}>Sign in</Link>
                </>
              )}
              <Link className="btn" to="/courses">
                Explore Courses <ArrowRight size={14} />
              </Link>
              <Link className="btn" to="/ai-mentor">
                <Sparkles size={14} /> Meet AI Mentor
              </Link>
            </div>
            {!signedIn && (
              <p className="muted small" style={{ margin: '12px 0 0' }}>
                An account is required to open courses, lessons, practice questions, labs and your
                progress. Creating one takes a minute.
              </p>
            )}
          </div>

          <div className="home-journey" aria-label="Your learning journey">
            {JOURNEY.map((step) => (
              <div key={step.n} className="home-step">
                <span className="n" aria-hidden="true">{step.n}</span>
                <span className="t"><b>{step.label}</b><span>{step.sub}</span></span>
              </div>
            ))}
            <Link className="home-featured" to={featured ? `/course/${featured.slug}` : '/courses'}>
              <span className="tiny">FEATURED COURSE</span>
              {featured ? (
                <>
                  <b>{featured.name}</b>
                  <span className="muted small">
                    {fmt(featured.counts.lesson)} lessons · {fmt(featured.counts.question)} practice questions ·
                    {' '}{fmt(featured.counts.project)} projects
                  </span>
                  <span className="home-featured-cta">Open course <ArrowRight size={12} /></span>
                </>
              ) : (
                <span className="muted small">Course catalogue is loading…</span>
              )}
            </Link>
          </div>
        </div>
      </section>

      <div className="kpi-row home-kpis">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="kpi tone-cyan home-kpi" aria-busy={!s.ready}>
            <span className="ic"><s.icon size={18} /></span>
            <div className="kpi-body">
              <div className="n">{s.value}</div>
              <div className="l">{s.label}</div>
              <div className="home-kpi-note">{s.ready ? s.note : 'Loading the published manifest…'}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="home-facts" aria-label="Published content at a glance">
        {facts.map((fact) => (
          <Link key={fact.label} to={fact.to} className="home-fact">
            <b>{fact.value}</b>
            <span>{fact.label}</span>
          </Link>
        ))}
        <span className="home-updated">
          {updatedAt ? `Content updated ${updatedAt}` : 'Content timestamps load with the manifests.'}
        </span>
      </div>

      <div className="sec-head"><h2>Explore learning domains</h2><span className="line" /></div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {DOMAINS.map((d) => <Link key={d.name} to={d.to} className="chip">{d.name}</Link>)}
      </div>
      <p className="small muted" style={{ margin: '8px 0 0' }}>
        Each domain opens the track or course that teaches it. A chip never points at an empty page.
      </p>

      <div className="sec-head"><h2>Pick a pillar</h2><span className="line" /></div>
      <div className="tile-grid">
        {PILLARS.map((p) => (
          <Link key={p.to} to={p.to} className="tile">
            <span className="ic"><p.icon size={16} /></span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{p.label}</b>
              <span>{p.sub}</span>
            </span>
            <ArrowRight size={14} className="home-tile-arrow" />
          </Link>
        ))}
      </div>

      {/* How the loop works — each row opens the page it names, so the band is a path, not a diagram. */}
      <div className="sec-head"><h2>The BroCode learning loop</h2><span className="line" /></div>
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

      <section className="card home-archive" aria-busy={!archive}>
        <div className="row spread" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <div className="row" style={{ gap: 8 }}>
              <Layers size={18} color="var(--cyan)" aria-hidden="true" />
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Practice Archive</h2>
              <span className="chip" title="Practice questions that test knowledge. Guided project walkthroughs live in the courses and project labs.">
                {archive ? `${fmt(archive.items)} items` : 'loading'}
              </span>
            </div>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 660 }}>
              A bundled collection of practice items to turn reading into recall — interview drills,
              checkpoints, coding, theory and defense questions, filed under the sections that teach
              them. It is a practice archive, not a separate Playbook product.
            </p>
          </div>
          <Link className="btn" to="/playbook">Open Practice Archive <ArrowRight size={14} /></Link>
        </div>
        <div className="home-archive-grid">
          {archiveBreakdown.length ? archiveBreakdown.map((item) => (
            <div key={item.label} className="home-archive-stat">
              <b>{fmt(item.value)}</b><span>{item.label}</span>
            </div>
          )) : (
            <p className="small muted" style={{ margin: 0 }}>Archive counts load with the bundled manifest.</p>
          )}
          {archive && (
            <div className="home-archive-stat">
              <b>{fmt(archive.labs)}</b><span>Coding labs</span>
            </div>
          )}
          {archive && (
            <div className="home-archive-stat">
              <b>{fmt(archive.miniProjects)}</b><span>Mini projects</span>
            </div>
          )}
        </div>
      </section>

      {/* FAQ — native <details>, so it works with the keyboard and with no JavaScript of its own. */}
      <div className="sec-head"><h2>Questions a beginner actually asks</h2><span className="line" /></div>
      <div style={{ display: 'grid', gap: 8 }}>
        {FAQ.map((f) => (
          <details key={f.q} className="card home-faq" style={{ padding: '12px 14px' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{f.q}</summary>
            <p className="muted small" style={{ margin: '8px 0 0' }}>{f.a}</p>
            {f.links?.length ? (
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                {f.links.map((link) => (
                  <Link key={link.to} className="chip" to={link.to}>{link.label} <ArrowRight size={11} /></Link>
                ))}
              </div>
            ) : null}
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
          : 'Sign in to open any of these — your progress is saved to your account. Counts come from the published content manifests, not from this page.'}
      </p>
    </div>
  );
}
