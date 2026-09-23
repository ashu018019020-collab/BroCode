import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Map, Layers, Repeat, Bug, Mic2, Shield, FlaskConical,
  Sigma, Database, Sparkles, Bot, Briefcase, BarChart3, FileText, Settings as SettingsIcon,
  Search, Wifi, Sun, Star, Flame, Target, Trophy, Code2, GraduationCap,
} from 'lucide-react';
import { CurriculumProvider, useCurriculum } from './data/curriculum';
import ConceptHub from './pages/ConceptHub';
import { useStore, bumpStreak } from './offline/store';
import { levelForXp, levelProgress } from './engine/keys';
import { I18nProvider, useI18n, setLang } from './i18n';
import Dashboard from './pages/Dashboard';
import LearningPath from './pages/LearningPath';
import Lesson from './pages/Lesson';
import Playground from './pages/Playground';
import SQLLab from './pages/SQLLab';
import InterviewMode from './pages/InterviewMode';
import MistakesPage from './pages/Mistakes';
import ReviewPage from './pages/Review';
import ProgressPage from './pages/Progress';
import PDFReader from './pages/PDFReader';
import SettingsPage from './pages/Settings';
import Onboarding from './pages/Onboarding';
import FinalAssessment from './pages/FinalAssessment';
import AILab from './pages/AILab';
import AgenticLab from './pages/AgenticLab';
import NumPyPandasLab from './pages/NumPyPandasLab';
import DefensePage from './pages/DefensePage';
import ResumeLabs from './pages/ResumeLabs';
import { searchAll } from './engine/search';
import { CommandPalette } from './components/CommandPalette';
import TrackOverview from './pages/TrackOverview';

const NAV: { to: string; icon: typeof LayoutDashboard; key: 'learn' | 'practice' | 'build' | 'you'; fallback: string; group: string }[] = [
  { to: '/', icon: LayoutDashboard, key: 'learn', fallback: 'Dashboard', group: 'nav.learn' },
  { to: '/path', icon: Map, key: 'learn', fallback: 'Learning Path', group: 'nav.learn' },
  { to: '/concepts', icon: Layers, key: 'learn', fallback: 'Concepts', group: 'nav.learn' },
  { to: '/review', icon: Repeat, key: 'learn', fallback: 'Review Queue', group: 'nav.learn' },
  { to: '/mistakes', icon: Bug, key: 'learn', fallback: 'Mistake Tracker', group: 'nav.learn' },
  { to: '/interview', icon: Mic2, key: 'practice', fallback: 'Interview Mode', group: 'nav.practice' },
  { to: '/defense', icon: Shield, key: 'practice', fallback: 'Project Defense', group: 'nav.practice' },
  { to: '/playground', icon: FlaskConical, key: 'practice', fallback: 'Code Playground', group: 'nav.practice' },
  { to: '/numpy-pandas', icon: Sigma, key: 'practice', fallback: 'NumPy + Pandas Lab', group: 'nav.practice' },
  { to: '/sql', icon: Database, key: 'practice', fallback: 'SQL Lab', group: 'nav.practice' },
  { to: '/ai', icon: Sparkles, key: 'build', fallback: 'AI / GenAI Lab', group: 'nav.build' },
  { to: '/agentic', icon: Bot, key: 'build', fallback: 'Agentic AI Lab', group: 'nav.build' },
  { to: '/final', icon: Target, key: 'build', fallback: 'Final Assessment', group: 'nav.build' },
  { to: '/resume', icon: Briefcase, key: 'you', fallback: 'Resume Labs', group: 'nav.you' },
  { to: '/progress', icon: BarChart3, key: 'you', fallback: 'Progress', group: 'nav.you' },
  { to: '/pdf', icon: FileText, key: 'you', fallback: 'PDF Reader', group: 'nav.you' },
  { to: '/settings', icon: SettingsIcon, key: 'you', fallback: 'Settings', group: 'nav.you' },
];

/** The 8 reference tracks mapped onto the 29 PDF-derived sections (1-indexed). */
export const TRACK_DEFS = [
  { id: 'python', icon: Code2, color: 'var(--green)', from: 1, to: 16, hours: 8, desc: 'Basics, Variables, Loops, Functions, OOP, File Handling', nameKey: 'track.python' as const },
  { id: 'data', icon: Sigma, color: 'var(--blue)', from: 17, to: 18, hours: 12, desc: 'Arrays, DataFrames, Data Analysis, Visualization', nameKey: 'track.data' as const },
  { id: 'sql', icon: Database, color: 'var(--violet)', from: 19, to: 19, hours: 8, desc: 'Databases, Queries, Joins, Real-world Data', nameKey: 'track.sql' as const },
  { id: 'ml', icon: BrainIcon, color: 'var(--pink)', from: 20, to: 21, hours: 15, desc: 'Supervised/Unsupervised, NLP, Model Evaluation', nameKey: 'track.ml' as const, prereq: ['data'] },
  { id: 'genai', icon: Sparkles, color: 'var(--amber)', from: 22, to: 22, hours: 15, desc: 'LLMs, Prompt Engineering, RAG, Fine-tuning (Basics)', nameKey: 'track.genai' as const, prereq: ['ml'] },
  { id: 'agentic', icon: Bot, color: 'var(--cyan)', from: 23, to: 23, hours: 12, desc: 'AI Agents, Tool Use, Workflows, n8n, LangChain', nameKey: 'track.agentic' as const, prereq: ['genai'] },
  { id: 'apis', icon: ServerIcon, color: 'var(--green)', from: 24, to: 26, hours: 10, desc: 'FastAPI, REST APIs, Deployment, Docker, CI/CD', nameKey: 'track.apis' as const, prereq: ['agentic'] },
  { id: 'interview', icon: Briefcase, color: 'var(--amber)', from: 27, to: 29, hours: 10, desc: 'Mock Interviews, System Design, Real Projects', nameKey: 'track.interview' as const, prereq: ['apis'] },
];

function BrainIcon({ size = 16 }: { size?: number }) { return <GraduationCap size={size} />; }
function ServerIcon({ size = 16 }: { size?: number }) { return <Layers size={size} />; }

export default function App() {
  return (
    <I18nProvider>
      <CurriculumProvider>
        <HashRouter>
          <Shell />
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

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(true); }
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('reduce-motion', state.settings.reduceMotion);
  }, [state.settings.reduceMotion]);

  // First-run gate: send new users through onboarding before anything else.
  useEffect(() => {
    if (!state.profile.onboarded && loc.pathname !== '/onboarding') nav('/onboarding');
  }, [state.profile.onboarded, loc.pathname]);

  const xp = state.xp;
  const level = levelForXp(xp);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">🧠</div>
          <div>
            <b>AI ENGINEER<br />MASTER LAB</b>
            <span className="sub">{t('app.tagline')} {t('app.offlineNote')}</span>
          </div>
        </div>
        <nav>
          {['nav.learn', 'nav.practice', 'nav.build', 'nav.you'].map((g) => (
            <div key={g}>
              <div className="navsep">{t(g as 'nav.learn')}</div>
              {NAV.filter((n) => n.group === g).map((n) => (
                <NavLink key={n.to} to={n.to} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
                  <span className="ico"><n.icon size={16} /></span> {n.fallback}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div style={{ padding: '12px 10px' }} className="small muted">
          <div className="row spread"><span>{t('top.level')} {level}</span><span>{xp} XP</span></div>
          <div className="bar" style={{ marginTop: 6 }}><div style={{ width: `${Math.min(100, levelProgress(xp) * 100)}%` }} /></div>
          <div className="row spread" style={{ marginTop: 8 }}>
            <span className="row" style={{ gap: 4 }}><Flame size={13} /> {state.streak.current}d</span>
            <span className="row" style={{ gap: 4 }}><Star size={13} /> Lv {level}</span>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <button className="searchbox" onClick={() => setPaletteOpen(true)} aria-label={t('top.search')}>
            <Search size={15} />
            <span>{t('top.search')}</span>
            <span className="kbd">Ctrl + K</span>
          </button>
          <div className="row" style={{ gap: 8 }}>
            <div className="lang-toggle" role="group" aria-label="Language">
              {locales.map((l) => (
                <button key={l.code} className={lang === l.code ? 'on' : ''} onClick={() => setLang(l.code)}>{l.name}</button>
              ))}
            </div>
            <div className="offline-pill" title={t('top.offlineSub')}>
              <Wifi size={13} />
              <div><b>{t('top.offline')}</b><span>{t('top.offlineSub')}</span></div>
            </div>
            <button className="icon-btn" title={t('dash.motivation')}><Sun size={17} /></button>
            <div className="avatar">{state.profile.name.slice(0, 2).toUpperCase()}</div>
          </div>
        </header>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/path" element={<LearningPath />} />
            <Route path="/track/:trackSlug" element={<TrackOverview />} />
            <Route path="/concepts" element={<ConceptHub />} />
            <Route path="/lesson/:sid/:stage" element={<Lesson />} />
            <Route path="/lesson/:sid" element={<Lesson />} />
            <Route path="/playground" element={<Playground />} />
            <Route path="/sql" element={<SQLLab />} />
            <Route path="/interview" element={<InterviewMode />} />
            <Route path="/defense" element={<DefensePage />} />
            <Route path="/mistakes" element={<MistakesPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/pdf" element={<PDFReader />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/final" element={<FinalAssessment />} />
            <Route path="/ai" element={<AILab />} />
            <Route path="/agentic" element={<AgenticLab />} />
            <Route path="/numpy-pandas" element={<NumPyPandasLab />} />
            <Route path="/resume" element={<ResumeLabs />} />
            <Route path="*" element={<Dashboard />} />
          </Routes>
        </div>
        <footer className="statusbar">
          <span className="row" style={{ gap: 6 }}><span className="dot" /> {t('status.ready')} · {t('status.noNet')}</span>
          <span>Python 3.12 (Pyodide)</span>
          <span className="spacer" />
          <span>UTF-8</span>
          <span>AI Engineer Master Lab</span>
        </footer>
      </main>
      {paletteOpen && sections && <CommandPalette items={searchAll(sections, extras)} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
