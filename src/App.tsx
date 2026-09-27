import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Routes, Route, NavLink, Link, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Map, Layers, Repeat, Bug, Mic2, Shield, FlaskConical,
  Sigma, Database, Sparkles, Bot, Briefcase, BarChart3, FileText, Settings as SettingsIcon,
  Search, Wifi, Star, Flame, Target, Trophy, Code2, GraduationCap, ListChecks,
  Bell, FolderGit2, Network, ClipboardList, StickyNote, BookMarked, Moon, Library,
  Menu, PanelLeftClose, PanelLeftOpen, X, LogOut, ChevronRight, Award,
  Plus, Download, WifiOff, Languages, Timer, BookOpen,
} from 'lucide-react';
import { CurriculumProvider, useCurriculum } from './data/curriculum';
import { useStore, bumpStreak, markNotifsRead, clearNotifs, exportProgress } from './offline/store';
import { toast } from './components/Toast';
import { levelForXp, levelProgress, XP_PER_LEVEL } from './engine/keys';
import { I18nProvider, useI18n, setLang } from './i18n';
import { buildNotifications, unreadCount } from './engine/notify';
import { dueReview, openMistakes } from './engine/review';
// Eager: the landing route, so the first paint has real content.
import Dashboard from './pages/Dashboard';
// Lazy: every other route is code-split, keeping the initial bundle small.
const ConceptHub = lazy(() => import('./pages/ConceptHub'));
const LearningPath = lazy(() => import('./pages/LearningPath'));
const Lesson = lazy(() => import('./pages/Lesson'));
const Playground = lazy(() => import('./pages/Playground'));
const SQLLab = lazy(() => import('./pages/SQLLab'));
const NotebookLab = lazy(() => import('./pages/NotebookLab'));
const InterviewMode = lazy(() => import('./pages/InterviewMode'));
const MistakesPage = lazy(() => import('./pages/Mistakes'));
const ReviewPage = lazy(() => import('./pages/Review'));
const ProgressPage = lazy(() => import('./pages/Progress'));
const PDFReader = lazy(() => import('./pages/PDFReader'));
const SettingsPage = lazy(() => import('./pages/Settings'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const FinalAssessment = lazy(() => import('./pages/FinalAssessment'));
const AILab = lazy(() => import('./pages/AILab'));
const AgenticLab = lazy(() => import('./pages/AgenticLab'));
const NumPyPandasLab = lazy(() => import('./pages/NumPyPandasLab'));
const DefensePage = lazy(() => import('./pages/DefensePage'));
const ResumeLabs = lazy(() => import('./pages/ResumeLabs'));
const PlaybookPage = lazy(() => import('./pages/Playbook'));
const TrackOverview = lazy(() => import('./pages/TrackOverview'));
const QuestionBank = lazy(() => import('./pages/QuestionBank'));
const ProjectLab = lazy(() => import('./pages/ProjectLab'));
const RagLab = lazy(() => import('./pages/RagLab'));
const MockInterviews = lazy(() => import('./pages/MockInterviews'));
const JobPrep = lazy(() => import('./pages/JobPrep'));
const NotesPage = lazy(() => import('./pages/Notes'));
const CheatSheets = lazy(() => import('./pages/CheatSheets'));
const ExamMode = lazy(() => import('./pages/ExamMode'));
import { searchAll } from './engine/search';
import { CommandPalette } from './components/CommandPalette';
import { useQuestionIndex } from './data/searchindex';
import { useUi, setUi } from './offline/ui';
import { STAGE_META, type Stage } from './engine/progress';
import { nextTask } from './engine/tutor';
import { PAGES } from './engine/search';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastHost } from './components/Toast';

type GroupKey = 'nav.learn' | 'nav.practice' | 'nav.agents' | 'nav.career' | 'nav.tools';

interface NavItem {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  group: GroupKey;
  badge?: 'review' | 'mistakes';
}

/** The five sidebar sections from the product spec. */
const GROUPS: GroupKey[] = ['nav.learn', 'nav.practice', 'nav.agents', 'nav.career', 'nav.tools'];

/**
 * The sidebar is also the label/icon owner for the Learning Path's extra path cards
 * (see engine/paths.ts + components/PathGrid.tsx), so it is exported on purpose: a page cannot be
 * described two different ways if both surfaces read the same list.
 */
export const NAV: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', group: 'nav.learn' },
  { to: '/path', icon: Map, label: 'Learning Path', group: 'nav.learn' },
  { to: '/concepts', icon: Layers, label: 'Concepts', group: 'nav.learn' },
  { to: '/review', icon: Repeat, label: 'Review Queue', group: 'nav.learn', badge: 'review' },
  { to: '/mistakes', icon: Bug, label: 'Mistake Tracker', group: 'nav.learn', badge: 'mistakes' },

  { to: '/interview', icon: Mic2, label: 'Interview Mode', group: 'nav.practice' },
  { to: '/defense', icon: Shield, label: 'Project Defense', group: 'nav.practice' },
  { to: '/playground', icon: FlaskConical, label: 'Code Playground', group: 'nav.practice' },
  { to: '/projects', icon: FolderGit2, label: 'Project Lab', group: 'nav.practice' },
  { to: '/questions', icon: ListChecks, label: 'Question Bank', group: 'nav.practice' },
  { to: '/playbook', icon: Library, label: 'Playbook V15', group: 'nav.practice' },
  { to: '/exam', icon: Timer, label: 'Timed Exam', group: 'nav.practice' },
  { to: '/numpy-pandas', icon: Sigma, label: 'NumPy + Pandas Lab', group: 'nav.practice' },
  { to: '/notebooks', icon: BookOpen, label: 'Notebook Lab', group: 'nav.practice' },
  { to: '/sql', icon: Database, label: 'SQL Lab', group: 'nav.practice' },

  { to: '/ai', icon: Sparkles, label: 'AI / GenAI Lab', group: 'nav.agents' },
  { to: '/agentic', icon: Bot, label: 'Agentic AI Lab', group: 'nav.agents' },
  { to: '/rag', icon: Network, label: 'RAG Lab', group: 'nav.agents' },
  { to: '/final', icon: Target, label: 'Final Assessment', group: 'nav.agents' },

  { to: '/resume', icon: Briefcase, label: 'Resume Labs', group: 'nav.career' },
  { to: '/mock', icon: Mic2, label: 'Mock Interviews', group: 'nav.career' },
  { to: '/jobprep', icon: ClipboardList, label: 'Job Prep', group: 'nav.career' },
  { to: '/progress', icon: BarChart3, label: 'Progress', group: 'nav.career' },

  { to: '/notes', icon: StickyNote, label: 'Notes', group: 'nav.tools' },
  { to: '/cheats', icon: BookMarked, label: 'Cheat Sheets', group: 'nav.tools' },
  { to: '/pdf', icon: FileText, label: 'PDF Reader', group: 'nav.tools' },
  { to: '/settings', icon: SettingsIcon, label: 'Settings', group: 'nav.tools' },
];

/** Mobile bottom navigation — the five highest-frequency destinations. */
const BOTTOM = ['/', '/path', '/playground', '/review', '/notes'];

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
  const [scrolled, setScrolled] = useState(false);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') { setPaletteOpen(false); setDrawer(false); setNotifOpen(false); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
  }, [state.settings.reduceMotion]);

  // Close transient panels whenever the route changes.
  useEffect(() => { setDrawer(false); setNotifOpen(false); setQuickOpen(false); }, [loc.pathname]);

  // Honest connectivity: the app works offline, but we still report reality.
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  // First-run gate: send new users through onboarding before anything else.
  useEffect(() => {
    if (!state.profile.onboarded && loc.pathname !== '/onboarding') nav('/onboarding');
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
        <aside className={`sidebar glass ${collapsed ? 'collapsed' : ''}`} aria-label="Primary">
          <div className="brand">
            <div className="logo">🧠</div>
            <div>
              <b>AI ENGINEER<br />MASTER LAB</b>
              <span className="sub">{t('app.tagline')} {t('app.offlineNote')}</span>
            </div>
            {/* The desktop collapse/expand toggle has moved to the header (see the topbar), so the
                only button left inside the panel is the drawer's own close button. */}
            <button className="side-toggle mobile-only" onClick={() => setDrawer(false)} aria-label="Close menu"><X size={14} /></button>
          </div>

          <nav>
            {GROUPS.map((g) => (
              <div key={g}>
                <div className="navsep">{t(g)}</div>
                {NAV.filter((n) => n.group === g).map((n) => {
                  const count = n.badge ? badges[n.badge] : 0;
                  return (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === '/'}
                      data-tip={n.label}
                      title={collapsed ? n.label : undefined}
                      className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}
                    >
                      <span className="ico"><n.icon size={16} /></span>
                      <span className="lbl">{n.label}</span>
                      {count > 0 && <span className="navbadge">{count > 99 ? '99+' : count}</span>}
                    </NavLink>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="side-foot" style={{ padding: '12px 10px' }}>
            <div className="row spread small muted">
              <span className="row" style={{ gap: 5 }}><Star size={12} /> {t('top.level')} {level}</span>
              <span>{xp} / {level * XP_PER_LEVEL} XP</span>
            </div>
            <div className="bar" style={{ marginTop: 6 }}><div style={{ width: `${Math.min(100, levelProgress(xp) * 100)}%` }} /></div>
            <div className="row spread small muted" style={{ marginTop: 8 }}>
              <span className="row" style={{ gap: 4 }}><Flame size={13} color="var(--pink)" /> {state.streak.current} {t('top.streak')}</span>
              <span className="row" style={{ gap: 4 }}><Trophy size={13} color="var(--amber)" /> {toNext} {t('top.xpTo')}</span>
            </div>
            <Link2 to="/settings" className="side-keep">
              <Sparkles size={13} /> Keep Going — Better You Today 🚀
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
          {!onFocus && (
            <button
              className="side-btn-desk"
              onClick={() => setUi({ navCollapsed: !prefs.navCollapsed })}
              title={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}
              aria-expanded={!collapsed}
            >
              {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
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
              <button className="btn small" onClick={() => setUi({ focus: false })}>
                <LogOut size={13} /> {t('top.focus')} band karo
              </button>
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
                        { icon: Moon, label: prefs.focus ? 'Focus Mode band karo' : 'Focus Mode chalao', sub: 'Distraction free', run: () => setUi({ focus: !prefs.focus }) },
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

                <button
                  className="icon-btn hide-xs"
                  onClick={() => setUi({ focus: true })}
                  title={t('top.focus')}
                  aria-label={t('top.focus')}
                >
                  <Moon size={16} />
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
              <span className="avatar">{initials(state.profile.name)}</span>
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
          <footer className="statusbar">
            <span
              className="row"
              style={{ gap: 6 }}
              title={online
                ? 'Internet available — content packs network-first revalidate karte hain.'
                : 'Poori tarah local: Pyodide, curriculum aur progress sab device par.'}
            >
              <span className="dot" style={{ background: online ? 'var(--cyan)' : 'var(--green)', boxShadow: `0 0 8px ${online ? 'rgba(34,211,238,.6)' : 'rgba(52,211,153,.6)'}` }} aria-hidden="true" />
              {online ? <Wifi size={12} /> : <WifiOff size={12} />}
              {online ? 'Online · content update check' : `${t('status.ready')} · ${t('status.noNet')}`}
            </span>
            <span>Python 3.12 (Pyodide)</span>
            <span className="spacer" />
            <span className="small muted hide-sm">{scrolled ? '' : `Ctrl + K — ${t('top.search')}`}</span>
            <span className="small muted" title="Level progress"><Star size={12} style={{ verticalAlign: -2 }} /> {xp} XP · Lv {level}</span>
            <span>AI Engineer Master Lab</span>
          </footer>
        )}

        {/* mobile bottom navigation */}
        {!onFocus && (
          <nav className="bottomnav" aria-label="Quick navigation">
            {NAV.filter((n) => BOTTOM.includes(n.to)).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => `bn-item ${isActive ? 'active' : ''}`}>
                <n.icon size={18} />
                <span>{n.label.split(' ')[0]}</span>
                {n.badge && badges[n.badge] > 0 && <i className="bn-dot" />}
              </NavLink>
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
function Link2({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const nav = useNavigate();
  return <button className={`side-keep ${className ?? ''}`} onClick={() => nav(to)}>{children}</button>;
}
