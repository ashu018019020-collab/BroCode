import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, Link, Navigate, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Layers, Repeat, Bug, Mic2, Shield, FlaskConical,
  Sigma, Database, Sparkles, Bot, Briefcase, BarChart3, FileText, Settings as SettingsIcon,
  Search, Star, Flame, Target, Trophy, Code2, GraduationCap, ListChecks,
  Bell, FolderGit2, Network, ClipboardList, StickyNote, BookMarked, Moon, Sun, Focus, Library,
  Menu, PanelLeftClose, X, ChevronRight, ChevronLeft, Award,
  Plus, Download, Languages, Timer, BookOpen, Cloud, UserRound, LogIn, LogOut,
} from 'lucide-react';
import { CurriculumProvider, useCurriculum } from '../core/data/curriculum';
import { useStore, bumpStreak, markNotifsRead, clearNotifs, exportProgress } from '../core/storage/store';
import { toast } from '../components/ui/Toast';
import { levelForXp, levelProgress, XP_PER_LEVEL } from '../core/platform/keys';
import { routeMeta } from '../core/platform/meta';
import { I18nProvider, useI18n, setLang } from './i18n';
import { buildNotifications, unreadCount } from '../core/platform/notify';
import { dueReview, openMistakes } from '../core/learning/review';
import { studyStreak, today } from '../core/learning/study';
import { formatLastSeen } from '../core/platform/last-seen';
// Eager: the landing route, so the first paint has real content.
import Dashboard from '../features/dashboard/Dashboard';
// Lazy: every other route is code-split, keeping the initial bundle small.
const ConceptHub = lazy(() => import('../features/learning/ConceptHub'));
const Lesson = lazy(() => import('../features/learning/Lesson'));
const Playground = lazy(() => import('../features/labs/Playground'));
const SQLLab = lazy(() => import('../features/labs/SQLLab'));
const NotebookLab = lazy(() => import('../features/labs/NotebookLab'));
const InterviewMode = lazy(() => import('../features/interview/InterviewMode'));
const MistakesPage = lazy(() => import('../features/practice/Mistakes'));
const ReviewPage = lazy(() => import('../features/practice/Review'));
const ProgressPage = lazy(() => import('../features/progress/Progress'));
const PDFReader = lazy(() => import('../features/tools/PDFReader'));
const SettingsPage = lazy(() => import('../features/tools/Settings'));
const Onboarding = lazy(() => import('../features/dashboard/Onboarding'));
const FinalAssessment = lazy(() => import('../features/interview/FinalAssessment'));
const AILab = lazy(() => import('../features/labs/AILab'));
const AgenticLab = lazy(() => import('../features/labs/AgenticLab'));
const NumPyPandasLab = lazy(() => import('../features/labs/NumPyPandasLab'));
const DefensePage = lazy(() => import('../features/interview/DefensePage'));
const PlaybookPage = lazy(() => import('../features/practice/Playbook'));
const TrackOverview = lazy(() => import('../features/learning/TrackOverview'));
const QuestionBank = lazy(() => import('../features/practice/QuestionBank'));
const ProjectLab = lazy(() => import('../features/projects/ProjectLab'));
const RagLab = lazy(() => import('../features/labs/RagLab'));
const MockInterviews = lazy(() => import('../features/interview/MockInterviews'));
const JobPrep = lazy(() => import('../features/career/JobPrep'));
const NotesPage = lazy(() => import('../features/tools/Notes'));
const CheatSheets = lazy(() => import('../features/tools/CheatSheets'));
const ExamMode = lazy(() => import('../features/practice/ExamMode'));
const PracticeHub = lazy(() => import('../features/practice/PracticeHub'));
const LabsHub = lazy(() => import('../features/labs/LabsHub'));
const InterviewsHub = lazy(() => import('../features/interview/InterviewsHub'));
const CareerHub = lazy(() => import('../features/career/CareerHub'));
const Landing = lazy(() => import('../features/dashboard/Landing'));
const RequireAuth = lazy(() => import('../features/auth/RequireAuth'));
const ResetPassword = lazy(() => import('../features/auth/ResetPassword'));
import { searchAll } from '../core/platform/search';
import { CommandPalette } from '../components/shared/CommandPalette';
import { useQuestionIndex } from '../core/data/searchindex';
import { useUi, setUi } from '../core/storage/ui';
import { STAGE_META, type Stage } from '../core/learning/progress';
import { resumeTarget } from '../core/learning/resume';
import { PAGES } from '../core/platform/search';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { AiDock } from '../components/shared/AiDock';
import { GuideLayer } from '../components/shared/GuideLayer';
import { AUTH_SIGN_IN_ACTION } from '../core/ai/actions';
import { ToastHost } from '../components/ui/Toast';
import { useAuth } from '../core/auth/AuthProvider';
import { authErrorCopy } from '../core/auth/messages';
// Type-only: erased at compile time, so it cannot pull the form into the shell's chunk.
import type { AuthMode } from '../features/auth/AuthForm';

const LoginPage = lazy(() => import('../features/auth/LoginPage'));
const AdminUsersPage = lazy(() => import('../features/auth/AdminUsersPage'));
const AuthDialog = lazy(() => import('../features/auth/AuthDialog'));
const CoursesHome = lazy(() => import('../features/courses/CoursesHome'));
const CoursePage = lazy(() => import('../features/courses/CoursePage'));
const StepPage = lazy(() => import('../features/courses/StepPage'));

type GroupKey = 'nav.pillars' | 'nav.tools' | 'hidden';

/**
 * Wraps a route in the one authorization boundary. A thin alias so the route table below reads as
 * "this page needs an account" instead of a wall of imported JSX.
 */
const Protect = ({ children }: { children: React.ReactNode }) => <RequireAuth>{children}</RequireAuth>;

/**
 * `/` — the front door, for both audiences.
 *
 * A signed-in learner gets the Dashboard (their own XP, streak, next action). A visitor gets the
 * public Landing page. The split exists because the Dashboard prints private learning data: showing
 * it to a visitor would either leak that data or render a page of zeroes that lies about what the
 * product is. `RequireAuth` is NOT used here — this is a choice between two public-safe outcomes, and
 * a redirect on `/` would bounce a visitor into a sign-in wall they never asked for.
 */
function PublicHome() {
  const { user, loading } = useAuth();
  if (loading) return <RouteSkeleton />;
  return user ? <Dashboard /> : <Suspense fallback={<RouteSkeleton />}><Landing /></Suspense>;
}

/**
 * `/start` — the public landing page, but NEVER for a signed-in learner.
 *
 * The old first-run gate sent an authenticated learner here, and this page has no way forward for
 * them: it is a marketing overview, not their dashboard. That produced the reported loop — sign in,
 * land on the landing page, and every further click appears to do nothing. The gate is gone, but a
 * bookmark, an old `/start` link or a stale deployment can still put a signed-in learner here, so
 * the route itself resolves them to the Dashboard. A visitor still gets the public page.
 */
function StartPage() {
  const { user, loading } = useAuth();
  if (loading) return <RouteSkeleton />;
  if (user) return <Navigate to="/" replace />;
  return <Suspense fallback={<RouteSkeleton />}><Landing /></Suspense>;
}

/**
 * A row's accent hue. Each destination owns one colour, so the rail reads as a map of the product
 * rather than a stack of identical links: the hue lives on the ICON, the row itself stays neutral
 * until it is active. The values are the CSS custom properties' names in `styles.css`.
 */
type NavTone = 'cyan' | 'blue' | 'violet' | 'amber' | 'rose' | 'slate';

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  group: GroupKey;
  tone?: NavTone;
  badge?: 'review' | 'mistakes';
  /**
   * Registered but NOT a sidebar link. The Playground is still a support-path card and the label/icon
   * for that card comes from here (`PathGrid` looks the route up in NAV), so deleting the entry would
   * leave the card showing a raw URL — `scripts/tests/playbook.test.mjs` fails on exactly that.
   */
  sidebar?: false;
}

/**
 * Two sections, like the product spec: the eight learner pillars, then the tools. The pillar list
 * renders WITHOUT a heading — those eight entries ARE the navigation — so only TOOLS is labelled.
 * `hidden` is the bucket for the registered-but-not-in-the-sidebar entries below.
 */
const GROUPS: ('nav.pillars' | 'nav.tools')[] = ['nav.pillars', 'nav.tools'];

/**
 * The sidebar is also the label/icon owner for the support-path cards
 * (see engine/paths.ts + components/PathGrid.tsx), so it is exported on purpose: a page cannot be
 * described two different ways if both surfaces read the same list.
 */
export const NAV: NavItem[] = [
  // The eight pillars — the sidebar IS the learning journey, not a filing system.
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'nav.pillars', tone: 'cyan' },
  // Courses sits next to the Dashboard because it is the way IN: eleven courses over the same 36
  // steps the Path orders. (The 8-section navbar restructure is a later phase; this is the one
  // entry that makes the new surface reachable without moving anything else.)
  { to: '/courses', icon: GraduationCap, label: 'Courses', group: 'nav.pillars', tone: 'blue' },
  { to: '/practice', icon: ListChecks, label: 'Practice', group: 'nav.pillars', tone: 'cyan' },
  { to: '/labs', icon: FlaskConical, label: 'Labs', group: 'nav.pillars', tone: 'cyan' },
  { to: '/projects', icon: FolderGit2, label: 'Projects', group: 'nav.pillars', tone: 'blue' },
  { to: '/interviews', icon: Mic2, label: 'Interview', group: 'nav.pillars', tone: 'violet' },
  { to: '/career', icon: Briefcase, label: 'Career', group: 'nav.pillars', tone: 'amber' },
  { to: '/progress', icon: BarChart3, label: 'Progress', group: 'nav.pillars', tone: 'blue' },

  // Tools — reference material, one step below the plan.
  { to: '/notes', icon: StickyNote, label: 'Notes', group: 'nav.tools', tone: 'blue' },
  { to: '/cheat-sheets', icon: BookMarked, label: 'Cheat Sheets', group: 'nav.tools', tone: 'blue' },
  { to: '/pdf', icon: FileText, label: 'PDF Reader', group: 'nav.tools', tone: 'rose' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings', group: 'nav.tools', tone: 'slate' },

  //
  // Registered, deliberately NOT sidebar links. Each of these is now reached through the pillar
  // hub that owns it, but the entry has to stay: the support-path cards, the hub grids and the
  // command palette all take a page's LABEL and ICON from this list, and the route-registry test
  // diffs it against the <Route> table — dropping an entry here prints a raw URL on a card.
  //
  { to: '/concepts', icon: Layers, label: 'Concepts', group: 'hidden', sidebar: false },
  { to: '/review', icon: Repeat, label: 'Review Queue', group: 'hidden', badge: 'review', sidebar: false },
  { to: '/mistakes', icon: Bug, label: 'Mistake Tracker', group: 'hidden', badge: 'mistakes', sidebar: false },
  { to: '/interview-mode', icon: Mic2, label: 'Interview Mode', group: 'hidden', sidebar: false },
  { to: '/defense', icon: Shield, label: 'Project Defense', group: 'hidden', sidebar: false },
  { to: '/playground', icon: FlaskConical, label: 'Code Playground', group: 'hidden', sidebar: false },
  { to: '/questions', icon: ListChecks, label: 'Question Bank', group: 'hidden', sidebar: false },
  // Surface 37. Named for what it IS — 476 imported practice items the master path teaches — and
  // not "Playbook V15", which made a migration sound like a second product. Its provenance stays
  // `source: 'v15'` in the data; a learner never has to know which import it came from.
  { to: '/playbook', icon: Library, label: 'Practice Archive', group: 'hidden', sidebar: false },
  { to: '/exam', icon: Timer, label: 'Timed Exam', group: 'hidden', sidebar: false },
  { to: '/numpy-pandas', icon: Sigma, label: 'NumPy + Pandas Lab', group: 'hidden', sidebar: false },
  { to: '/notebooks', icon: BookOpen, label: 'Notebook Lab', group: 'hidden', sidebar: false },
  { to: '/sql', icon: Database, label: 'SQL Lab', group: 'hidden', sidebar: false },
  { to: '/ai-lab', icon: Sparkles, label: 'AI / GenAI Lab', group: 'hidden', sidebar: false },
  { to: '/agentic', icon: Bot, label: 'Agentic AI Lab', group: 'hidden', sidebar: false },
  { to: '/rag-lab', icon: Network, label: 'RAG Lab', group: 'hidden', sidebar: false },
  { to: '/final-assessment', icon: Target, label: 'Final Assessment', group: 'hidden', sidebar: false },
  { to: '/mock-interviews', icon: Mic2, label: 'Mock Interviews', group: 'hidden', sidebar: false },
  { to: '/job-prep', icon: ClipboardList, label: 'Job Prep', group: 'hidden', sidebar: false },
];

/** Mobile bottom navigation — the four highest-frequency destinations. */
const BOTTOM = ['/', '/courses', '/practice', '/notes'];

/** The 8 reference tracks mapped onto the 29 PDF-derived sections (1-indexed). */
export const TRACK_DEFS = [
  { id: 'python', icon: Code2, color: 'var(--green)', tone: 'green' as const, from: 1, to: 16, hours: 8, desc: 'Basics, Variables, Loops, Functions, OOP, File Handling', nameKey: 'track.python' as const },
  { id: 'data', icon: Sigma, color: 'var(--blue)', tone: 'blue' as const, from: 17, to: 18, hours: 12, desc: 'Arrays, DataFrames, Data Analysis, Visualization', nameKey: 'track.data' as const },
  { id: 'sql', icon: Database, color: 'var(--violet)', tone: 'violet' as const, from: 19, to: 19, hours: 8, desc: 'Databases, Queries, Joins, Real-world Data', nameKey: 'track.sql' as const },
  { id: 'ml', icon: BrainIcon, color: 'var(--pink)', tone: 'fuchsia' as const, from: 20, to: 21, hours: 15, desc: 'Supervised/Unsupervised, NLP, Model Evaluation', nameKey: 'track.ml' as const, prereq: ['data'] },
  { id: 'genai', icon: Sparkles, color: 'var(--amber)', tone: 'amber' as const, from: 22, to: 22, hours: 15, desc: 'LLMs, Prompt Engineering, RAG, Fine-tuning (Basics)', nameKey: 'track.genai' as const, prereq: ['ml'] },
  { id: 'agentic', icon: Bot, color: 'var(--cyan)', tone: 'cyan' as const, from: 23, to: 23, hours: 12, desc: 'AI Agents, Tool Use, Workflows, n8n, LangChain', nameKey: 'track.agentic' as const, prereq: ['genai'] },
  { id: 'apis', icon: ServerIcon, color: 'var(--green)', tone: 'green' as const, from: 24, to: 26, hours: 10, desc: 'FastAPI, REST APIs, Deployment, Docker, CI/CD', nameKey: 'track.apis' as const, prereq: ['agentic'] },
  { id: 'interview', icon: Briefcase, color: 'var(--amber)', tone: 'gold' as const, from: 27, to: 29, hours: 10, desc: 'Mock Interviews, System Design, Real Projects', nameKey: 'track.interview' as const, prereq: ['apis'] },
];

/**
 * Old slugs that must keep resolving. Seven destinations were renamed to descriptive kebab-case
 * (`/jobprep` → `/job-prep`), and a link, bookmark or search result shared before the rename is
 * still something a learner can click.
 *
 * This is DATA rather than seven literal route elements on purpose: the sitemap generator and
 * every route reader in the test suite regex-read this file as TEXT (so even this comment must
 * never spell the route tag out), and an alias is not a page —
 * it must not enter the sitemap, claim a path card or count as a surface. `layout.test.mjs` holds
 * the alias contract instead: no alias may shadow a live route, and every target must exist.
 */
const LEGACY_ROUTES: [string, string][] = [
  ['/jobprep', '/job-prep'],          // the only glued compound slug
  ['/cheats', '/cheat-sheets'],       // the page is "Cheat Sheets"
  ['/mock', '/mock-interviews'],      // the page is "Mock Interviews"
  ['/final', '/final-assessment'],    // the page is "Final Assessment"
  ['/rag', '/rag-lab'],               // the page is "RAG Lab"
  ['/ai', '/ai-lab'],                 // the page is "AI / GenAI Lab"
  ['/interview', '/interview-mode'],  // the MODE — /interviews is the pillar hub over it
];

function BrainIcon({ size = 16 }: { size?: string | number }) { return <GraduationCap size={size} />; }
function ServerIcon({ size = 16 }: { size?: string | number }) { return <Layers size={size} />; }

export default function App() {
  return (
    <I18nProvider>
      <CurriculumProvider>
        {/* Opting into the v7 behaviours now keeps the console warning-free. */}
        <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <ErrorBoundary>
            <Shell />
          </ErrorBoundary>
        </HashRouter>
      </CurriculumProvider>
    </I18nProvider>
  );
}

function Shell() {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const { user, loading: authLoading, progressSync, redirectError, logout } = useAuth();
  bumpStreak();
  const nav = useNavigate();
  const loc = useLocation();
  const { t, locale } = useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const bankIndex = useQuestionIndex(paletteOpen);
  const prefs = useUi();
  const [drawer, setDrawer] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncClock, setSyncClock] = useState(Date.now());
  const [lastSeenAt, setLastSeenAt] = useState(Date.now());
  const [lastSeenClock, setLastSeenClock] = useState(Date.now());
  const [signingOut, setSigningOut] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  /** Which tab the shared AuthForm opens on: the entry point that opened it names the tab. */
  const [authMode, setAuthMode] = useState<AuthMode>('register');
  /**
   * The last-seen timestamp is per ACCOUNT, and there is no account to be anonymous under any more:
   * a signed-out visitor never reaches a page that records a visit, because every page that does is
   * behind the guard. The signed-out fallback key is therefore kept only so a stored value from an
   * older release cannot collide with a real account's namespace.
   */
  const lastSeenKey = `brocode:last-seen:v1:${user ? encodeURIComponent(user.id) : 'signed-out'}`;
  const mainRef = useRef<HTMLElement>(null);
  const handledRedirectError = useRef<string | null>(null);

  const signOut = async () => {
    setSigningOut(true);
    try {
      await logout();
      // Signing out of a page that needs an account (the owner dashboard) would bounce straight
      // back to /login, so the guest lands on the Dashboard instead.
      nav('/', { replace: true });
    } catch (error) {
      console.error('[BroCode] Could not sign out.', error);
      // Through the shared mapping: a toast is as public as a form banner, so it must not carry a
      // raw HTTP status either.
      toast(error instanceof Error ? authErrorCopy(error.message) : 'Sign out failed. Please try again.', 'error');
    } finally {
      setSigningOut(false);
    }
  };

  /**
   * Every entry point into the account flow — the rail's block, the greeting below, a deep link
   * into a page that needs an account — opens the SAME dialog. This only remembers which tab it
   * should land on, so "Sign in" and "Create account" are one click each instead of two.
   */
  const openAuth = (mode: AuthMode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  /**
   * The account dialog is now opened EXPLICITLY and only from a control that asks for it (the rail's
   * account block, the Landing page's buttons, the quick-actions menu).
   *
   * It used to auto-open once per browser session as a "greeting" for a signed-out visitor, because
   * the app was guest-first and that dialog was the only sign-up prompt a visitor would see. With
   * learning gated behind sign-in, the `/login` page IS that prompt, and an uninvited modal on top of
   * it (or over a deep link the guard is already redirecting) is a second, competing front door.
   */

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === '/' && !(e.target instanceof HTMLElement && (
        e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
      ))) { e.preventDefault(); setQuickOpen((open) => !open); }
      if (e.key === 'Escape') { setPaletteOpen(false); setDrawer(false); setNotifOpen(false); setAiOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  useEffect(() => {
    if (!progressSync.lastSyncedAt) return;
    const timer = window.setInterval(() => setSyncClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [progressSync.lastSyncedAt]);

  useEffect(() => {
    const recordVisit = () => {
      const now = Date.now();
      try {
        const previous = Number(window.localStorage.getItem(lastSeenKey));
        if (Number.isFinite(previous) && previous > 0) setLastSeenAt(previous);
        window.localStorage.setItem(lastSeenKey, String(now));
      } catch (error) {
        console.error('[BroCode] Could not persist the last-seen timestamp.', error);
      }
      setLastSeenAt(now);
      setLastSeenClock(now);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') recordVisit();
    };
    recordVisit();
    const clock = window.setInterval(() => setLastSeenClock(Date.now()), 30_000);
    window.addEventListener('focus', recordVisit);
    window.addEventListener('pageshow', recordVisit);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(clock);
      window.removeEventListener('focus', recordVisit);
      window.removeEventListener('pageshow', recordVisit);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [lastSeenKey]);

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
  }, [state.settings.reduceMotion]);

  // Close transient panels whenever the route changes.
  useEffect(() => { setDrawer(false); setNotifOpen(false); setQuickOpen(false); }, [loc.pathname]);

  /**
   * FIRST-RUN GATE — deliberately REMOVED.
   *
   * This used to send every route except a four-entry allow-list to `/start` while
   * `profile.onboarded` was false. Onboarding is the only writer of that flag, and a sign-in
   * switches the store to the account's namespace, whose fresh state is `onboarded: false`. The
   * result was a signed-in learner being bounced from `/`, `/courses` and every lesson straight
   * back to the public landing page: the sidebar rendered, but no destination could be reached and
   * both "Continue Learning" buttons appeared dead. That is the exact Dashboard trap this fix is
   * for, so the redirect is gone rather than being re-ordered into another way to get stuck.
   *
   * Nothing is lost: `/onboarding` is still a real, guarded route a learner can open, the dashboard
   * already tolerates a blank profile name, and signup collects the name. Authorization was never
   * decided here (`RequireAuth` and the server do that), so removing this effect opens no door.
   */

  // A cancelled or failed provider return lands back on the redirect origin with its reason in
  // the query string (AuthProvider reads and cleans it). That reason belongs on the sign-in page,
  // so send the learner there — once per message, or every later navigation would be hijacked.
  useEffect(() => {
    if (!redirectError || handledRedirectError.current === redirectError) return;
    handledRedirectError.current = redirectError;
    if (loc.pathname !== '/login') nav('/login', { replace: true });
  }, [redirectError, loc.pathname, nav]);

  const xp = state.xp;
  const level = levelForXp(xp);
  const streakDays = studyStreak(state.study ?? {}, today());

  // Badge counts — always real numbers derived from learner state.
  const badges = useMemo(() => ({ review: dueReview(state).length, mistakes: openMistakes(state).length }), [state]);
  const notes = useMemo(() => buildNotifications(state, sections), [state, sections]);
  const unread = unreadCount(notes, state.readNotifs);

  /** Breadcrumb derived from the live route — the header always says where you are. */
  const crumb = useMemo(() => {
    const p = loc.pathname;
    if (p.startsWith('/lesson/')) {
      const sid = p.split('/')[2] ?? '';
      const st = (p.split('/')[3] ?? 'learn') as Stage;
      const sec = sections.find((s) => s.id === sid);
      const meta = STAGE_META[st] ?? STAGE_META.learn;
      return { icon: meta.icon, title: sec ? `${String(sec.no).padStart(2, '0')} · ${sec.title}` : 'Lesson', sub: meta.label, back: '/courses' };
    }
    if (p.startsWith('/track/')) {
      const slug = p.split('/')[2] ?? '';
      return { icon: '🗂️', title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), sub: 'Track overview', back: '/courses' };
    }
    if (p.startsWith('/course/')) {
      // The course pages are parameterised, so PAGES cannot hold them: without this branch the
      // breadcrumb fell through to the Dashboard title on every course and step page.
      const slug = p.split('/')[2] ?? '';
      const step = p.split('/')[3] ?? '';
      const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      return step
        ? { icon: <GraduationCap size={18} />, title: `Step ${step} · ${name}`, sub: 'Course step', back: `/course/${slug}` }
        : { icon: <GraduationCap size={18} />, title: name, sub: 'Course', back: '/courses' };
    }
    const page = PAGES.find((x) => x.route === p) ?? PAGES.find((x) => x.route !== '/' && p.startsWith(x.route));
    const navItem = NAV.find((n) => n.to === (page?.route ?? '/'));
    return {
      icon: navItem ? <navItem.icon size={18} /> : '🧭',
      title: page?.title ?? 'Dashboard',
      sub: page?.detail ?? '',
      back: undefined as string | undefined,
    };
  }, [loc.pathname, sections]);

  /**
   * Per-route document metadata (title + description).
   *
   * The rule is `core/platform/meta.ts` (pure, so the suite can test it); this effect only applies
   * it. It reads the shell's own strings ONCE, before overriding anything, and restores them when
   * the resolver has nothing better to say — so index.html stays the single source for the home
   * page's pinned title/description instead of a second copy living in this component.
   */
  const shellMeta = useRef<{ title: string; description: string } | null>(null);
  useEffect(() => {
    shellMeta.current ??= {
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.getAttribute('content') ?? '',
    };
    const next = routeMeta(loc.pathname, { sectionTitle: crumb.title }) ?? shellMeta.current;
    if (next.title && document.title !== next.title) document.title = next.title;
    const tag = document.querySelector('meta[name="description"]');
    if (tag && next.description && tag.getAttribute('content') !== next.description) {
      tag.setAttribute('content', next.description);
    }
  }, [loc.pathname, crumb.title]);

  /**
   * The single most useful next thing — and the ONE destination both "Continue Learning" controls
   * share. `resumeTarget` resolves the last lesson this account actually opened (or the newest
   * stage record, or the first lesson of the roadmap), validates the section against the live
   * curriculum and builds a real `/lesson/:sid/:stage` URL. It is never a hand-written link, so a
   * renamed section cannot leave the button pointing at a page that does not exist.
   */
  const smart = useMemo(() => {
    const target = resumeTarget(state, sections);
    const short = target.label.length > 34 ? `${target.label.slice(0, 32)}…` : target.label;
    return {
      kind: 'go' as const,
      icon: <Target size={14} />,
      label: short,
      why: target.reason,
      route: target.route,
    };
  }, [state, sections]);

  const onFocus = prefs.focus;
  const collapsed = prefs.navCollapsed && !onFocus;

  return (
    <div className={`shell ${drawer ? 'nav-open' : ''} ${onFocus ? 'focus' : ''}`}>
      {!onFocus && (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary">
          <div className="brand">
            <div className="logo pic">
              {/* The wordmark text beside the tile names the brand while it is visible; a collapsed
                  rail hides that text (`display: none`), so the tile itself must carry the name. */}
              <img src="./brocode.png" alt={collapsed ? 'BroCode' : ''} width={44} height={44} />
            </div>
            <div className="brand-txt">
              <b>Bro<span className="grad">Code</span></b>
              {/* The brand line as a stepper: the four verbs, a drawn dot between them instead of a
                  text arrow, so the journey scans at a glance instead of reading as one run-on
                  string — and it no longer claims a scope ("Local") the shell does not need to state. */}
              <span className="sub brand-tag">
                {t('app.tagline').split('→').map((word, i) => (
                  <Fragment key={word.trim()}>
                    {i > 0 && <i aria-hidden="true" />}
                    <em>{word.trim()}</em>
                  </Fragment>
                ))}
              </span>
            </div>
            {/*
              * Collapse sits at the panel's own top-right: the control belongs to the thing it
              * folds, and folding it from here keeps the header free for the page's own actions.
              * The header keeps the mirror-image button for the COLLAPSED rail, where the brand —
              * and so this button — is gone. On phones the drawer's close button takes this corner.
              */}
            <button
              className="side-fold"
              onClick={() => setUi({ navCollapsed: true })}
              title={t('nav.collapse')}
              aria-label={t('nav.collapse')}
            >
              <ChevronLeft size={15} />
            </button>
            <button className="side-toggle mobile-only" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={14} /></button>
          </div>

          <nav>
            {GROUPS.map((g) => (
              <div key={g}>
                {/* The eight pillars need no heading — they are the navigation. Only the tools
                    get a label, and the rule above it separates the two families. */}
                {g !== 'nav.pillars' && <div className="navsep">{t(g)}</div>}
                {NAV.filter((n) => n.group === g && n.sidebar !== false).map((n) => {
                  const count = n.badge ? badges[n.badge] : 0;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === '/'}
                      data-tone={n.tone}
                      data-tip={n.label}
                      data-agent-action={`nav:${n.to}`}
                      title={collapsed ? n.label : undefined}
                      className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
                    >
                      <span className="ico"><n.icon size={20} /></span>
                      <span className="lbl">{n.label}</span>
                      {count > 0 && <span className="navbadge">{count > 99 ? '99+' : count}</span>}
                      {/* A destination, not a control: the chevron says "this goes somewhere". */}
                      <span className="navchev" aria-hidden="true"><ChevronRight size={16} /></span>
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="side-foot">
            {/*
             * The rail's account block. BroCode now REQUIRES an account for learning, so a signed-out
             * visitor is not a "Guest learner" with partial access — they are simply not signed in,
             * and the only useful thing this block can do is offer the two doors. Signed in it
             * identifies the account, links the owner dashboard for an administrator, and is the way out.
             */}
            <div className="side-account">
              <span className="side-account-avatar" aria-hidden="true">
                {user ? initials(user.name || user.email) : <UserRound size={17} />}
              </span>
              <span className="side-account-copy" title={user?.email || undefined}>
                <b>{user ? user.name || user.email : t('acct.signedOut')}</b>
                {user
                  ? user.name
                    ? <small>{user.email}</small>
                    : user.role === 'admin' ? <small>{t('acct.admin')}</small> : null
                  : <small>{t('acct.signInHint')}</small>}
              </span>
            </div>
            {user ? (
              <>
                {user.role === 'admin' && (
                  <Link className="btn side-act" to="/admin">
                    <Shield size={15} />
                    <span>{t('acct.dashboard')}</span>
                  </Link>
                )}
                <button className="btn side-act" disabled={signingOut} onClick={() => void signOut()} type="button">
                  <LogOut size={15} />
                  <span>{signingOut ? t('acct.signingOut') : t('acct.signOut')}</span>
                </button>
              </>
            ) : (
              <>
                <Link className="btn primary side-act" to="/login">
                  <LogIn size={15} />
                  <span>{t('acct.signUp')}</span>
                </Link>
                <Link className="btn side-act" to="/login" data-agent-action={AUTH_SIGN_IN_ACTION}>
                  <span>{t('acct.signIn')}</span>
                </Link>
              </>
            )}
          </div>
        </aside>
      )}
      {drawer && !onFocus && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}

      <main className="main" ref={mainRef} onScroll={(e) => setScrolled((e.target as HTMLElement).scrollTop > 24)}>
        <header className={`topbar ${scrolled ? 'compact' : ''}`}>
          {/*
           * The sidebar toggle lives in the header, hard against the sidebar's edge, instead of
           * inside the rail it collapses — and because the topbar is sticky it stays reachable at
           * any scroll position. On phones the sidebar is an off-canvas drawer, so the menu button
           * below takes over and this one is hidden by CSS.
           */}
          {!onFocus && (
            <button
              className="side-btn-desk"
              onClick={() => setUi({ navCollapsed: !collapsed })}
              title={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-expanded={!collapsed}
            >
              <Menu size={17} />
            </button>
          )}
          <button className="side-btn" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}><Menu size={17} /></button>

          <nav className="topbar-nav" aria-label="Main navigation">
            {[
              { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
              { to: '/courses', label: 'Courses', icon: BookOpen },
              { to: '/projects', label: 'Projects', icon: FolderGit2 },
              { to: '/questions', label: 'Quizzes', icon: ClipboardList },
            ].map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => `topbar-nav-link${isActive ? ' active' : ''}`}>
                <Icon size={17} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>

          <button className="searchbox" onClick={() => setPaletteOpen(true)} aria-label={t('top.search')}>
            <Search size={15} />
            <span>Search courses, lessons, skills...</span>
            <span className="kbd">Ctrl + K</span>
          </button>

          <div className="row topbar-right">
            {onFocus ? (
              <>
                <ThemeToggle />
                <button className="icon-btn focus-toggle active" onClick={() => setUi({ focus: false })} title="Focus Mode" aria-label="Exit Focus Mode">
                  <Focus size={17} />
                </button>
              </>
            ) : (
              <>
                <div className="quickmenu">
                  <button
                    className="icon-btn"
                    onClick={() => setQuickOpen((v) => !v)}
                    title="Quick actions"
                    aria-label="Quick actions"
                    aria-expanded={quickOpen}
                  >
                    <Plus size={17} />
                  </button>
                  {quickOpen && (
                    <div className="quickmenu-panel" role="menu">
                      {[
                        { icon: StickyNote, label: 'New note', sub: 'Write in Notes', run: () => nav('/notes') },
                        { icon: FlaskConical, label: 'Playground', sub: 'Run Python', run: () => nav('/playground') },
                        { icon: Sparkles, label: 'Ask the AI Tutor', sub: 'Explain, hint, debug', run: () => nav('/playground') },
                        { icon: prefs.theme === 'dark' ? Sun : Moon, label: prefs.theme === 'dark' ? t('top.themeLight') : t('top.themeDark'), sub: t('top.theme'), run: () => setUi({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }) },
                        { icon: Focus, label: prefs.focus ? 'Turn off Focus Mode' : 'Turn on Focus Mode', sub: 'Distraction free', run: () => setUi({ focus: !prefs.focus }) },
                        { icon: Download, label: 'Export progress', sub: 'JSON backup', run: () => { exportProgress(); toast('Progress file downloaded.', 'success'); } },
                        { icon: Languages, label: locale === 'hi' ? 'Switch to English' : 'Switch to Hinglish', sub: t('lang.label'), run: () => setLang(locale === 'hi' ? 'en' : 'hi') },
                      ].map((a) => (
                        <button key={a.label} className="quickmenu-item" role="menuitem" onClick={() => { a.run(); setQuickOpen(false); }}>
                          <span className="ico"><a.icon size={15} /></span>
                          <span><b>{a.label}</b><span>{a.sub}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* The shell's two switches, side by side in the reference's icon-button style:
                    theme (sun/moon) and Focus Mode. Focus mode used to BE the moon button, which
                    said "dark" and did "hide the sidebar". */}
                <ThemeToggle />

                <button
                  className={`icon-btn focus-toggle${prefs.focus ? ' active' : ''}`}
                  onClick={() => setUi({ focus: true })}
                  title="Focus Mode"
                  aria-label="Focus Mode"
                  aria-pressed={prefs.focus}
                >
                  <Focus size={16} />
                </button>

                <div className="notif-wrap">
                  <button
                    className="icon-btn"
                    onClick={() => setNotifOpen((v) => !v)}
                    title={t('top.notif')}
                    aria-label={`${t('top.notif')} (${unread})`}
                    aria-expanded={notifOpen}
                  >
                    <Bell size={17} />
                    {unread > 0 && <span className="notif-dot">{unread > 9 ? '9+' : unread}</span>}
                  </button>
                  {notifOpen && (
                    <div className="notif-panel" role="dialog" aria-label={t('top.notif')}>
                      <div className="row spread" style={{ padding: '2px 4px 8px' }}>
                        <b className="small">{t('top.notif')}</b>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn small ghost" onClick={() => markNotifsRead(notes.map((n) => n.id))}>{t('top.notifClear')}</button>
                          <button className="btn small ghost" onClick={() => clearNotifs()}>Reset</button>
                        </div>
                      </div>
                      {!notes.length && <p className="muted small" style={{ padding: '6px 8px' }}>{t('top.notifEmpty')}</p>}
                      {notes.map((n) => {
                        const Icon = NOTIF_ICON[n.kind] ?? Bell;
                        const isUnread = !state.readNotifs.includes(n.id);
                        return (
                          <button
                            key={n.id}
                            className={`notif-item ${isUnread ? 'unread' : ''}`}
                            onClick={() => { markNotifsRead([n.id]); if (n.to) nav(n.to); setNotifOpen(false); }}
                          >
                            <span className="kind" style={{ color: NOTIF_COLOR[n.kind] }}><Icon size={14} /></span>
                            <span style={{ flex: 1, textAlign: 'left' }}>
                              <b>{n.title}</b>
                              <span>{n.body}</span>
                            </span>
                            <ChevronRight size={13} className="muted" />
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

              </>
            )}

            <Link className="profile-chip" to="/progress" title="Open profile" aria-label={`Open ${state.profile.name || 'learner'} profile`}>
              <span className="avatar">
                {state.profile.avatar ? <img src={state.profile.avatar} alt={`${state.profile.name || 'Learner'} profile photo`} /> : initials(state.profile.name)}
              </span>
              <i className={`profile-online ${online ? 'online' : 'offline'}`} aria-hidden="true" />
            </Link>
          </div>
        </header>

        <ErrorBoundary>
          <div className="content">
            <Suspense fallback={<RouteSkeleton />}>
            <Routes>
              {/* ---------- PUBLIC ----------
                  `/` is the front door for BOTH audiences and decides which one it is: a signed-in
                  learner gets the Dashboard, a visitor gets the Landing page. It is NOT the Dashboard
                  itself any more — that page prints the learner's own progress, which a visitor has
                  no business seeing. */}
              <Route path="/" element={<PublicHome />} />
              <Route path="/start" element={<StartPage />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              {/* `/onboarding` asks for a display name and a daily goal. It exposes no private data,
                  but there is nobody to onboard without an account, so it is gated. */}
              <Route path="/onboarding" element={<Protect><Onboarding /></Protect>} />

              {/* ---------- PROTECTED ----------
                  One wrapper, one decision (`features/auth/RequireAuth.tsx`). Adding a page here
                  without `Protect` is the ONLY way to re-open a door, which makes the omission
                  reviewable instead of invisible. */}
              <Route path="/courses" element={<Protect><CoursesHome /></Protect>} />
              <Route path="/course/:slug" element={<Protect><CoursePage /></Protect>} />
              <Route path="/course/:slug/:step" element={<Protect><StepPage /></Protect>} />
              <Route path="/practice" element={<Protect><PracticeHub /></Protect>} />
              <Route path="/labs" element={<Protect><LabsHub /></Protect>} />
              <Route path="/interviews" element={<Protect><InterviewsHub /></Protect>} />
              <Route path="/career" element={<Protect><CareerHub /></Protect>} />
              <Route path="/track/:trackSlug" element={<Protect><TrackOverview /></Protect>} />
              <Route path="/concepts" element={<Protect><ConceptHub /></Protect>} />
              <Route path="/lesson/:sid/:stage" element={<Protect><Lesson /></Protect>} />
              <Route path="/lesson/:sid" element={<Protect><Lesson /></Protect>} />
              <Route path="/playground" element={<Protect><Playground /></Protect>} />
              <Route path="/questions" element={<Protect><QuestionBank /></Protect>} />
              <Route path="/exam" element={<Protect><ExamMode /></Protect>} />
              <Route path="/projects" element={<Protect><ProjectLab /></Protect>} />
              <Route path="/sql" element={<Protect><SQLLab /></Protect>} />
              <Route path="/notebooks" element={<Protect><NotebookLab /></Protect>} />
              <Route path="/interview-mode" element={<Protect><InterviewMode /></Protect>} />
              <Route path="/defense" element={<Protect><DefensePage /></Protect>} />
              <Route path="/mock-interviews" element={<Protect><MockInterviews /></Protect>} />
              <Route path="/mistakes" element={<Protect><MistakesPage /></Protect>} />
              <Route path="/review" element={<Protect><ReviewPage /></Protect>} />
              <Route path="/progress" element={<Protect><ProgressPage /></Protect>} />
              <Route path="/job-prep" element={<Protect><JobPrep /></Protect>} />
              <Route path="/notes" element={<Protect><NotesPage /></Protect>} />
              <Route path="/cheat-sheets" element={<Protect><CheatSheets /></Protect>} />
              <Route path="/pdf" element={<Protect><PDFReader /></Protect>} />
              {/* Deep link straight to a page: the reader reads :page, so this
                  route must exist or "PDF Reference p.8" tiles land on the dashboard. */}
              <Route path="/pdf/:page" element={<Protect><PDFReader /></Protect>} />
              {/* The same reader, second source. `/pdf/playbook/:page` is a DIFFERENT page space
                  (the V15 book), so it must never be reachable as `/pdf/:page`. */}
              <Route path="/pdf/playbook" element={<Protect><PDFReader /></Protect>} />
              <Route path="/pdf/playbook/:page" element={<Protect><PDFReader /></Protect>} />
              <Route path="/playbook" element={<Protect><PlaybookPage /></Protect>} />
              <Route path="/settings" element={<Protect><SettingsPage /></Protect>} />
              {/* The owner dashboard gates itself on the server-issued role; `Protect` only ensures
                  there IS a session to check. The role is never read from the client. */}
              <Route path="/admin" element={<Protect><AdminUsersPage /></Protect>} />
              <Route path="/final-assessment" element={<Protect><FinalAssessment /></Protect>} />
              <Route path="/ai-lab" element={<Protect><AILab /></Protect>} />
              <Route path="/rag-lab" element={<Protect><RagLab /></Protect>} />
              <Route path="/agentic" element={<Protect><AgenticLab /></Protect>} />
              <Route path="/numpy-pandas" element={<Protect><NumPyPandasLab /></Protect>} />
              {/* The pre-cleanup slugs, redirected in place so nothing shared before the rename
                  dead-ends on the Dashboard. Rendered from LEGACY_ROUTES above because a literal
                  path here would be read as a real page by the sitemap and the route tests.
                  Deliberately NOT wrapped: a redirect decides nothing, and its target is protected. */}
              {LEGACY_ROUTES.map(([from, to]) => (
                <Route key={from} path={from} element={<Navigate to={to} replace />} />
              ))}
              {/* An unknown path is not a page. It resolves through `PublicHome`, so a typo shows
                  the SAME thing the front door does to that audience — the Dashboard to a signed-in
                  learner, the Landing page to a visitor — instead of leaking a protected page. */}
              <Route path="*" element={<PublicHome />} />
            </Routes>
            </Suspense>
          </div>
        </ErrorBoundary>

        {!onFocus && (
          <footer className="statusbar" aria-label="Learning progress and quick actions">
            <div className="sb-status-group">
              <div
                className="sb-last-seen"
                data-tooltip={`Last seen: ${new Date(lastSeenAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`}
                aria-label={`Last seen ${formatLastSeen(lastSeenAt, lastSeenClock)}. Exact time ${new Date(lastSeenAt).toLocaleString()}`}
                tabIndex={0}
              >
                <UserRound size={16} />
                <span><b>Last Seen</b><i aria-hidden="true"> · </i><small>{formatLastSeen(lastSeenAt, lastSeenClock)}</small></span>
              </div>
              <span className="sb-divider" aria-hidden="true" />
              <Link className="sb-stat tone-amber" to="/progress" title={`${streakDays} study days in a row`}>
                <span aria-hidden="true">🔥</span><span>{streakDays} Day Streak</span>
              </Link>
              <span className="sb-divider hide-sm" aria-hidden="true" />
              <Link className="sb-xp-block" to="/progress" title="Open profile and progress">
                <span aria-hidden="true">🏆</span>
                <span><b>{xp} / {level * XP_PER_LEVEL} XP</b><small>Level {level}</small></span>
                <i aria-hidden="true"><i style={{ width: `${Math.min(100, levelProgress(xp) * 100)}%` }} /></i>
              </Link>
              <span className="sb-divider hide-sm" aria-hidden="true" />
              <div
                className={`sb-sync-block ${progressSync.status}`}
                title={!user
                  ? 'Signed-out progress is stored on this device; sign in to sync a private progress summary.'
                  : progressSync.status === 'synced' && progressSync.lastSyncedAt
                    ? `Progress summary synced at ${new Date(progressSync.lastSyncedAt).toLocaleTimeString()}`
                    : progressSync.status === 'error'
                      ? 'Cloud sync failed. Your local progress is still available.'
                      : progressSync.status === 'offline'
                        ? 'Waiting for an internet connection to sync.'
                        : 'Syncing your private progress summary to your account.'}
              >
                <Cloud size={15} />
                <span>
                  <b>{!user
                    ? 'Local save'
                    : progressSync.status === 'synced' ? 'Last synced'
                      : progressSync.status === 'error' ? 'Sync issue'
                        : progressSync.status === 'offline' || !online ? 'Waiting to sync'
                          : progressSync.status === 'syncing' || authLoading ? 'Syncing…' : 'Account sync'}</b>
                  <small>{!user
                    ? 'This device'
                    : progressSync.lastSyncedAt
                      ? formatSyncAge(progressSync.lastSyncedAt, syncClock)
                      : progressSync.status === 'error' ? 'Saved on device'
                        : progressSync.status === 'offline' || !online ? 'Offline'
                          : 'Progress summary only'}</small>
                </span>
              </div>
            </div>
            <div className="sb-actions">
              <button
                className={`sb-ai${aiOpen ? ' on' : ''}`}
                onClick={() => setAiOpen((open) => !open)}
                aria-expanded={aiOpen}
                aria-label={aiOpen ? 'Close AI assistant' : 'Open AI assistant'}
                title="AI — ask about this app"
                data-agent-action="ai:open"
              >
                <span className="sb-ai-orb"><Bot size={25} /></span>
                <b>AI</b>
              </button>
              <Link className="sb-continue" to={smart.route} title={smart.why}>
                <span aria-hidden="true">▶</span>
                Continue Learning <ChevronRight size={14} />
              </Link>
            </div>
          </footer>
        )}

        {/* The footer's AI, as a panel above it — see components/AiDock.tsx. */}
        <AiDock open={aiOpen && !onFocus} onClose={() => setAiOpen(false)} />

        {/* Guided navigation — the ring, the real label and the verification. Mounted once, here,
            because a highlight must survive the assistant card that asked for it. */}
        <GuideLayer />

        {/*
         * Mobile bottom navigation. The assistant sits BETWEEN Learning and Review: it is the one
         * entry that is a control rather than a route, so it is lit (accent gradient + halo) instead
         * of merely coloured — and it is the only way to reach the assistant from the two thirds of
         * the app that render neither the Dashboard card nor a notebook.
         */}
        {!onFocus && (
          <nav className="bottomnav" aria-label="Quick navigation">
            {NAV.filter((n) => BOTTOM.includes(n.to)).map((n, i) => (
              <Fragment key={n.to}>
                <NavLink to={n.to} end={n.to === '/'} aria-label={n.label} data-agent-action={`nav:${n.to}`} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
                  <span className="bn-icon"><n.icon size={18} /></span>
                  <span>{n.label.split(' ')[0]}</span>
                  {n.badge && badges[n.badge] > 0 && <i className="bn-dot" />}
                </NavLink>
                {i === 1 && (
                  <button
                    className={`bn-ai${aiOpen ? ' on' : ''}`}
                    onClick={() => setAiOpen((v) => !v)}
                    aria-expanded={aiOpen}
                    aria-label={aiOpen ? 'Close AI assistant' : 'Open AI assistant'}
                  >
                    <span className="bn-ai-ic"><Bot size={16} /></span>
                    <span>AI</span>
                  </button>
                )}
              </Fragment>
            ))}
          </nav>
        )}
      </main>

      {/* The bank index loads lazily, on the first palette open — 1.6 MB has no business on any
          page's critical path, and most sessions never search. */}
      {paletteOpen && (
        <CommandPalette
          items={searchAll(sections, extras, state)}
          bank={bankIndex}
          bankLoading={!bankIndex}
          onClose={() => setPaletteOpen(false)}
        />
      )}
      {authOpen && (
        <Suspense fallback={null}>
          {/* The tab comes from whichever control opened it: the rail's button is "Sign up". */}
          <AuthDialog initialMode={authMode} open onClose={() => setAuthOpen(false)} />
        </Suspense>
      )}
      <ToastHost />
    </div>
  );
}

/**
 * The dark/light switch. One button, in both chrome states: it is the only way back out of light
 * mode, and focus mode hides the rest of the header, so it must live in that branch too.
 *
 * The icon is what you will GET, not what you have — a moon on a dark screen reads as "you are here",
 * and the tooltip says the same thing ("Light mode"). The theme itself is applied by `applyTheme()`
 * in offline/ui.ts, which writes `data-theme` on <html> before the first paint.
 */
function ThemeToggle() {
  const prefs = useUi();
  const { t } = useI18n();
  const to = prefs.theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      // `theme-toggle` is a phone-width hook: the same action lives in the quick-actions menu, so
      // styles.css drops this duplicate from the header when the row cannot hold it any more.
      className="icon-btn theme-toggle"
      onClick={() => setUi({ theme: to })}
      title={to === 'light' ? t('top.themeLight') : t('top.themeDark')}
      aria-label={to === 'light' ? t('top.themeLight') : t('top.themeDark')}
      // Deliberately NO `aria-pressed`. This is a two-state toggle whose icon shows the theme you
      // would GET, while its label announces that same action — so "pressed" has no honest meaning
      // here. The previous `aria-pressed={prefs.theme === 'light'}` was worse than absent: it read
      // the current theme as a pressed state, announcing "pressed" in one theme and "not pressed" in
      // the other for the same action, which is exactly backwards for a screen reader.
    >
      {to === 'light' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

const NOTIF_ICON = {
  success: Star, info: Bell, warning: Bug, review: Repeat, streak: Flame, achievement: Award,
} as const;
const NOTIF_COLOR: Record<string, string> = {
  success: 'var(--green)', info: 'var(--cyan)', warning: 'var(--amber)',
  review: 'var(--violet)', streak: 'var(--pink)', achievement: 'var(--amber)',
};

/**
 * The letters an avatar shows. A supplied name is not always one word per letter — "Ashu (owner)"
 * would otherwise print "A(" — so a token contributes only its first LETTER or digit.
 */
const initials = (name: string) =>
  name.trim().split(/\s+/)
    .map((part) => part.replace(/[^\p{L}\p{N}]/gu, '')[0]?.toUpperCase() ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('') || 'AI';

function formatSyncAge(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Skeleton shown while a lazily-loaded route chunk arrives — never a blank screen. */
function RouteSkeleton() {
  return (
    <div className="fadeup" aria-busy="true" aria-live="polite">
      <div className="skeleton" style={{ height: 26, width: '38%', marginBottom: 10 }} />
      <div className="skeleton" style={{ height: 14, width: '62%', marginBottom: 18 }} />
      <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton" style={{ height: 96 }} />)}
      </div>
      <div className="skeleton" style={{ height: 220, marginTop: 16 }} />
      <span className="sr-only">Loading screen…</span>
    </div>
  );
}
