import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Routes, Route, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Map, Layers, Repeat, Bug, Mic2, Shield, FlaskConical,
  Sigma, Database, Sparkles, Bot, Briefcase, BarChart3, FileText, Settings as SettingsIcon,
  Search, Star, Flame, Target, Trophy, Code2, GraduationCap, ListChecks,
  Bell, FolderGit2, Network, ClipboardList, StickyNote, BookMarked, Moon, Sun, Focus, Library,
  Menu, PanelLeftClose, PanelLeftOpen, X, LogOut, ChevronRight, ChevronLeft, Award,
  Plus, Download, Languages, Timer, BookOpen, Zap,
} from 'lucide-react';
import { CurriculumProvider, useCurriculum } from '../core/data/curriculum';
import { useStore, bumpStreak, markNotifsRead, clearNotifs, exportProgress } from '../core/storage/store';
import { toast } from '../components/ui/Toast';
import { levelForXp, levelProgress, XP_PER_LEVEL } from '../core/platform/keys';
import { I18nProvider, useI18n, setLang } from './i18n';
import { buildNotifications, unreadCount } from '../core/platform/notify';
import { dueReview, openMistakes } from '../core/learning/review';
// Eager: the landing route, so the first paint has real content.
import Dashboard from '../features/dashboard/Dashboard';
// Lazy: every other route is code-split, keeping the initial bundle small.
const ConceptHub = lazy(() => import('../features/learning/ConceptHub'));
const LearningPath = lazy(() => import('../features/learning/LearningPath'));
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
const ResumeLabs = lazy(() => import('../features/career/ResumeLabs'));
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
import { searchAll } from '../core/platform/search';
import { CommandPalette } from '../components/shared/CommandPalette';
import { useQuestionIndex } from '../core/data/searchindex';
import { useUi, setUi } from '../core/storage/ui';
import { STAGE_META, type Stage } from '../core/learning/progress';
import { nextTask } from '../core/ai/tutor';
import { PAGES } from '../core/platform/search';
import { ErrorBoundary } from '../components/ui/ErrorBoundary';
import { AiDock } from '../components/shared/AiDock';
import { ToastHost } from '../components/ui/Toast';

type GroupKey = 'nav.pillars' | 'nav.tools' | 'hidden';

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
   * Registered but NOT a sidebar link. The Playground is still a Learning Path card and the label/icon
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
 * The sidebar is also the label/icon owner for the Learning Path's extra path cards
 * (see engine/paths.ts + components/PathGrid.tsx), so it is exported on purpose: a page cannot be
 * described two different ways if both surfaces read the same list.
 */
export const NAV: NavItem[] = [
  // The eight pillars — the sidebar IS the learning journey, not a filing system.
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'nav.pillars', tone: 'cyan' },
  { to: '/path', icon: Map, label: 'Learning', group: 'nav.pillars', tone: 'blue' },
  { to: '/practice', icon: ListChecks, label: 'Practice', group: 'nav.pillars', tone: 'cyan' },
  { to: '/labs', icon: FlaskConical, label: 'Labs', group: 'nav.pillars', tone: 'cyan' },
  { to: '/projects', icon: FolderGit2, label: 'Projects', group: 'nav.pillars', tone: 'blue' },
  { to: '/interviews', icon: Mic2, label: 'Interview', group: 'nav.pillars', tone: 'violet' },
  { to: '/career', icon: Briefcase, label: 'Career', group: 'nav.pillars', tone: 'amber' },
  { to: '/progress', icon: BarChart3, label: 'Progress', group: 'nav.pillars', tone: 'blue' },

  // Tools — reference material, one step below the plan.
  { to: '/notes', icon: StickyNote, label: 'Notes', group: 'nav.tools', tone: 'blue' },
  { to: '/cheats', icon: BookMarked, label: 'Cheat Sheets', group: 'nav.tools', tone: 'blue' },
  { to: '/pdf', icon: FileText, label: 'PDF Reader', group: 'nav.tools', tone: 'rose' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings', group: 'nav.tools', tone: 'slate' },

  //
  // Registered, deliberately NOT sidebar links. Each of these is now reached through the pillar
  // hub that owns it, but the entry has to stay: the Learning Path's cards, the hub grids and the
  // command palette all take a page's LABEL and ICON from this list, and the route-registry test
  // diffs it against the <Route> table — dropping an entry here prints a raw URL on a card.
  //
  { to: '/concepts', icon: Layers, label: 'Concepts', group: 'hidden', sidebar: false },
  { to: '/review', icon: Repeat, label: 'Review Queue', group: 'hidden', badge: 'review', sidebar: false },
  { to: '/mistakes', icon: Bug, label: 'Mistake Tracker', group: 'hidden', badge: 'mistakes', sidebar: false },
  { to: '/interview', icon: Mic2, label: 'Interview Mode', group: 'hidden', sidebar: false },
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
  { to: '/ai', icon: Sparkles, label: 'AI / GenAI Lab', group: 'hidden', sidebar: false },
  { to: '/agentic', icon: Bot, label: 'Agentic AI Lab', group: 'hidden', sidebar: false },
  { to: '/rag', icon: Network, label: 'RAG Lab', group: 'hidden', sidebar: false },
  { to: '/final', icon: Target, label: 'Final Assessment', group: 'hidden', sidebar: false },
  { to: '/resume', icon: Briefcase, label: 'Resume Labs', group: 'hidden', sidebar: false },
  { to: '/mock', icon: Mic2, label: 'Mock Interviews', group: 'hidden', sidebar: false },
  { to: '/jobprep', icon: ClipboardList, label: 'Job Prep', group: 'hidden', sidebar: false },
];

/** Mobile bottom navigation — the four highest-frequency destinations. */
const BOTTOM = ['/', '/path', '/practice', '/notes'];

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
  bumpStreak();
  const nav = useNavigate();
  const loc = useLocation();
  const { t, lang, locales } = useI18n();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const bankIndex = useQuestionIndex(paletteOpen);
  const prefs = useUi();
  const [drawer, setDrawer] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') { setPaletteOpen(false); setDrawer(false); setNotifOpen(false); setAiOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
  }, [state.settings.reduceMotion]);

  // Close transient panels whenever the route changes.
  useEffect(() => { setDrawer(false); setNotifOpen(false); setQuickOpen(false); }, [loc.pathname]);

  // First-run gate: the landing page is the front door, onboarding is one click behind it.
  useEffect(() => {
    if (!state.profile.onboarded && loc.pathname !== '/onboarding' && loc.pathname !== '/start') nav('/start');
  }, [state.profile.onboarded, loc.pathname]);

  const xp = state.xp;
  const level = levelForXp(xp);
  const toNext = XP_PER_LEVEL - (xp % XP_PER_LEVEL);

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
      return { icon: meta.icon, title: sec ? `${String(sec.no).padStart(2, '0')} · ${sec.title}` : 'Lesson', sub: meta.label, back: '/path' };
    }
    if (p.startsWith('/track/')) {
      const slug = p.split('/')[2] ?? '';
      return { icon: '🗂️', title: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), sub: 'Track overview', back: '/path' };
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
   * The single most useful next thing, computed live: overdue reviews win,
   * otherwise the tutor engine's own next-task recommendation.
   */
  const smart = useMemo(() => {
    if (badges.review > 0) {
      return {
        kind: 'warn' as const,
        icon: <Repeat size={14} />,
        label: `${badges.review} review due`,
        why: 'Spaced repetition',
        route: '/review',
      };
    }
    const nt = nextTask(state, sections);
    return {
      kind: 'go' as const,
      icon: <Target size={14} />,
      label: nt.label.length > 30 ? `${nt.label.slice(0, 28)}…` : nt.label,
      why: nt.reason.length > 42 ? `${nt.reason.slice(0, 40)}…` : nt.reason,
      route: nt.route,
    };
  }, [badges.review, state, sections]);

  const onFocus = prefs.focus;
  const collapsed = prefs.navCollapsed && !onFocus;

  return (
    <div className={`shell ${drawer ? 'nav-open' : ''} ${onFocus ? 'focus' : ''}`}>
      {!onFocus && (
        <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`} aria-label="Primary">
          <div className="brand">
            <div className="logo pic">
              <img src="./brocode.png" alt="" width={44} height={44} />
            </div>
            <div className="brand-txt">
              <b>Bro<span className="grad">Code</span></b>
              <span className="sub">{t('app.tagline')} {t('app.offlineNote')}</span>
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
            {/* Level, XP and streak in one card — the same three real numbers the header shows.
                "XP to next level" moved into the card's tooltip: the bar already shows the gap. */}
            <Link2 to="/progress" className="side-xp" title={`${toNext} ${t('top.xpTo')}`}>
              <div className="row spread xp-top">
                <span className="row" style={{ gap: 6 }}><BarChart3 size={15} className="xp-ico" /> {t('top.level')} {level}</span>
                <span className="xp-num">{xp} / {level * XP_PER_LEVEL} XP</span>
              </div>
              <div className="bar xp-bar"><div style={{ width: `${Math.min(100, levelProgress(xp) * 100)}%` }} /></div>
              <div className="row spread xp-streak">
                <span className="row" style={{ gap: 6 }}><Zap size={15} className="xp-zap" /> {state.streak.current} {t('top.streak')}</span>
                <ChevronRight size={16} className="navchev" />
              </div>
            </Link2>

            {/* The one line of encouragement. Its bar is the same real level progress — nothing
                invented, just a second, quieter read of it under the words. */}
            <Link2 to="/settings" className="side-keep">
              <span className="keep-badge"><Star size={17} /></span>
              <span className="keep-txt">{t('side.keep')}</span>
              <ChevronRight size={16} className="keep-go" />
              <span className="keep-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, levelProgress(xp) * 100)}%` }} /></span>
            </Link2>
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
          {/* Only while the rail is collapsed: expanded, the fold control lives in the panel's own
              brand block, and two buttons for one panel would be a trap. */}
          {!onFocus && collapsed && (
            <button
              className="side-btn-desk"
              onClick={() => setUi({ navCollapsed: false })}
              title={t('nav.expand')}
              aria-label={t('nav.expand')}
              aria-expanded={false}
            >
              <PanelLeftOpen size={16} />
            </button>
          )}
          <button className="side-btn" onClick={() => setDrawer(true)} aria-label={t('nav.menu')}><Menu size={17} /></button>

          {/* Where am I? — derived from the route, not hardcoded. */}
          <div className="crumbs" title={crumb.sub}>
            {crumb.back && (
              <button className="crumb-back" onClick={() => nav(crumb.back!)} aria-label="Back">←</button>
            )}
            <span className="crumb-ico">{crumb.icon}</span>
            <div className="crumb-txt">
              <b>{crumb.title}</b>
              <span>{crumb.sub}</span>
            </div>
          </div>

          <button className="searchbox" onClick={() => setPaletteOpen(true)} aria-label={t('top.search')}>
            <Search size={15} />
            <span>{t('top.search')}</span>
            <span className="kbd">Ctrl + K</span>
          </button>

          <div className="row topbar-right" style={{ gap: 8 }}>
            {onFocus ? (
              <>
                <ThemeToggle />
                <button className="btn small" onClick={() => setUi({ focus: false })}>
                  <LogOut size={13} /> {t('top.focus')} band karo
                </button>
              </>
            ) : (
              <>
                {/* The single most useful next thing, one click away. */}
                {smart && (
                  <Link className={`smart-chip ${smart.kind}`} to={smart.route} title={smart.why}>
                    <span className="sc-ico">{smart.icon}</span>
                    <span className="sc-txt"><b>{smart.label}</b><span>{smart.why}</span></span>
                    <ChevronRight size={13} />
                  </Link>
                )}

                <div className="lang-toggle" role="group" aria-label="Language">
                  {locales.map((l) => (
                    <button key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)} title={l.name}>
                      {l.code === 'hinglish' ? 'HI' : 'EN'}
                    </button>
                  ))}
                </div>

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
                        { icon: StickyNote, label: 'Nayi note', sub: 'Notes me likho', run: () => nav('/notes') },
                        { icon: FlaskConical, label: 'Playground', sub: 'Python chalao', run: () => nav('/playground') },
                        { icon: Sparkles, label: 'AI Tutor se poocho', sub: 'Explain, hint, debug', run: () => nav('/playground') },
                        { icon: prefs.theme === 'dark' ? Sun : Moon, label: prefs.theme === 'dark' ? t('top.themeLight') : t('top.themeDark'), sub: t('top.theme'), run: () => setUi({ theme: prefs.theme === 'dark' ? 'light' : 'dark' }) },
                        { icon: Focus, label: prefs.focus ? 'Focus Mode band karo' : 'Focus Mode chalao', sub: 'Distraction free', run: () => setUi({ focus: !prefs.focus }) },
                        { icon: Download, label: 'Progress export karo', sub: 'JSON backup', run: () => { exportProgress(); toast('Progress file download ho gayi.', 'success'); } },
                        { icon: Languages, label: lang === 'hinglish' ? 'Switch to English' : 'Hinglish me switch karo', sub: 'Interface language', run: () => setLang(lang === 'hinglish' ? 'en' : 'hinglish') },
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
                  className="icon-btn hide-xs"
                  onClick={() => setUi({ focus: true })}
                  title={t('top.focus')}
                  aria-label={t('top.focus')}
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

                <button className="icon-btn hide-xs" onClick={() => nav('/settings')} title={t('top.settings')} aria-label={t('top.settings')}>
                  <SettingsIcon size={16} />
                </button>
              </>
            )}

            <button className="profile-chip" onClick={() => nav('/progress')} title={`${state.xp} XP · ${t('top.level')} ${level}`}>
              {/* The same photo the Progress page uploads — the header is where a profile picture
                  earns its keep, and it is one field, not a second copy of the state. */}
              <span className="avatar">
                {state.profile.avatar ? <img src={state.profile.avatar} alt="" /> : initials(state.profile.name)}
              </span>
              <span className="meta">
                <b>{state.profile.name}</b>
                <span>{t('top.level')} {level} · {state.xp} XP</span>
              </span>
            </button>
          </div>
        </header>

        <ErrorBoundary>
          <div className="content">
            <Suspense fallback={<RouteSkeleton />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/start" element={<Landing />} />
              <Route path="/practice" element={<PracticeHub />} />
              <Route path="/labs" element={<LabsHub />} />
              <Route path="/interviews" element={<InterviewsHub />} />
              <Route path="/career" element={<CareerHub />} />
              <Route path="/path" element={<LearningPath />} />
              <Route path="/track/:trackSlug" element={<TrackOverview />} />
              <Route path="/concepts" element={<ConceptHub />} />
              <Route path="/lesson/:sid/:stage" element={<Lesson />} />
              <Route path="/lesson/:sid" element={<Lesson />} />
              <Route path="/playground" element={<Playground />} />
              <Route path="/questions" element={<QuestionBank />} />
              <Route path="/exam" element={<ExamMode />} />
              <Route path="/projects" element={<ProjectLab />} />
              <Route path="/sql" element={<SQLLab />} />
              <Route path="/notebooks" element={<NotebookLab />} />
              <Route path="/interview" element={<InterviewMode />} />
              <Route path="/defense" element={<DefensePage />} />
              <Route path="/mock" element={<MockInterviews />} />
              <Route path="/mistakes" element={<MistakesPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/jobprep" element={<JobPrep />} />
              <Route path="/notes" element={<NotesPage />} />
              <Route path="/cheats" element={<CheatSheets />} />
              <Route path="/pdf" element={<PDFReader />} />
              {/* Deep link straight to a page: the reader reads :page, so this
                  route must exist or "PDF Reference p.8" tiles land on the dashboard. */}
              <Route path="/pdf/:page" element={<PDFReader />} />
              {/* The same reader, second source. `/pdf/playbook/:page` is a DIFFERENT page space
                  (the V15 book), so it must never be reachable as `/pdf/:page`. */}
              <Route path="/pdf/playbook" element={<PDFReader />} />
              <Route path="/pdf/playbook/:page" element={<PDFReader />} />
              <Route path="/playbook" element={<PlaybookPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/final" element={<FinalAssessment />} />
              <Route path="/ai" element={<AILab />} />
              <Route path="/rag" element={<RagLab />} />
              <Route path="/agentic" element={<AgenticLab />} />
              <Route path="/numpy-pandas" element={<NumPyPandasLab />} />
              <Route path="/resume" element={<ResumeLabs />} />
              <Route path="*" element={<Dashboard />} />
            </Routes>
            </Suspense>
          </div>
        </ErrorBoundary>

        {!onFocus && (
          /*
           * The status bar — desktop only (it is hidden where the bottom navigation exists, see
           * the 780px block in styles.css). Every cell is `nowrap` (`.sb-item`) and the least
           * useful ones drop out at a width, in order.
           *
           * There is no connectivity cell any more: it was the widest thing on the row and it said
           * the same thing on every screen, while the app itself never needs the network. On a phone
           * the whole bar is replaced by the bottom navigation, where the assistant is a nav item.
           */
          <footer className="statusbar">
            <span className="sb-item sb-py">Python 3.12 (Pyodide)</span>
            <span className="spacer" />
            <span className="sb-item sb-kbd small muted">{scrolled ? '' : `Ctrl + K — ${t('top.search')}`}</span>
            <span className="sb-item sb-xp small muted" title="Level progress"><Star size={12} style={{ verticalAlign: -2 }} /> {xp} XP · Lv {level}</span>
            <button
              className={`sb-ai${aiOpen ? ' on' : ''}`}
              onClick={() => setAiOpen((v) => !v)}
              aria-expanded={aiOpen}
              aria-label={aiOpen ? 'AI assistant band karo' : 'AI assistant kholo'}
              title="AI — is app ke bare me poocho"
            >
              <Bot size={12} /> AI
            </button>
            <span className="sb-item sb-brand">BroCode</span>
          </footer>
        )}

        {/* The footer's AI, as a panel above it — see components/AiDock.tsx. */}
        <AiDock open={aiOpen && !onFocus} onClose={() => setAiOpen(false)} />

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
                <NavLink to={n.to} end={n.to === '/'} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
                  <n.icon size={18} />
                  <span>{n.label.split(' ')[0]}</span>
                  {n.badge && badges[n.badge] > 0 && <i className="bn-dot" />}
                </NavLink>
                {i === 1 && (
                  <button
                    className={`bn-ai${aiOpen ? ' on' : ''}`}
                    onClick={() => setAiOpen((v) => !v)}
                    aria-expanded={aiOpen}
                    aria-label={aiOpen ? 'AI assistant band karo' : 'AI assistant kholo'}
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
      className="icon-btn"
      onClick={() => setUi({ theme: to })}
      title={to === 'light' ? t('top.themeLight') : t('top.themeDark')}
      aria-label={to === 'light' ? t('top.themeLight') : t('top.themeDark')}
      aria-pressed={prefs.theme === 'light'}
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

const initials = (name: string) =>
  name.trim().split(/\s+/).map((p) => p[0]?.toUpperCase() ?? '').slice(0, 2).join('') || 'AI';

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

/** Tiny local Link alias so the sidebar footer button doesn't collide with imports. */
function Link2({ to, className, children, title }: { to: string; className?: string; children: ReactNode; title?: string }) {
  const nav = useNavigate();
  return <button type="button" className={className} onClick={() => nav(to)} title={title}>{children}</button>;
}
