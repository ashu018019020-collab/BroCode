import { useEffect, useState } from 'react';
import { HashRouter, Routes, Route, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { CurriculumProvider, useCurriculum } from './data/curriculum';
import { useStore } from './offline/store';
import { levelForXp, levelProgress, LEVEL_NAMES } from './engine/keys';
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


const NAV: { to: string; icon: string; label: string; group: string }[] = [
  { to: '/', icon: '🏠', label: 'Dashboard', group: 'Learn' },
  { to: '/path', icon: '🗺️', label: 'Learning Path', group: 'Learn' },
  { to: '/review', icon: '🔁', label: 'Review Queue', group: 'Learn' },
  { to: '/mistakes', icon: '🐞', label: 'Mistake Tracker', group: 'Learn' },
  { to: '/interview', icon: '🎤', label: 'Interview Mode', group: 'Practice' },
  { to: '/defense', icon: '🛡️', label: 'Project Defense', group: 'Practice' },
  { to: '/playground', icon: '🧪', label: 'Code Playground', group: 'Practice' },
  { to: '/numpy-pandas', icon: '🔢', label: 'NumPy + Pandas Lab', group: 'Practice' },
  { to: '/sql', icon: '🗄️', label: 'SQL Lab', group: 'Practice' },
  { to: '/ai', icon: '🤖', label: 'AI / GenAI Lab', group: 'AI' },
  { to: '/agentic', icon: '🕸️', label: 'Agentic AI Lab', group: 'AI' },
  { to: '/final', icon: '🏁', label: 'Final Assessment', group: 'AI' },
  { to: '/resume', icon: '💼', label: 'Resume Labs', group: 'You' },
  { to: '/progress', icon: '📊', label: 'Progress', group: 'You' },
  { to: '/pdf', icon: '📄', label: 'PDF Reader', group: 'You' },
  { to: '/settings', icon: '⚙️', label: 'Settings', group: 'You' },
];

export default function App() {
  return (
    <CurriculumProvider>
      <HashRouter>
        <Shell />
      </HashRouter>
    </CurriculumProvider>
  );
}

function Shell() {
  const { sections, extras } = useCurriculum();
  const state = useStore();
  const nav = useNavigate();
  const loc = useLocation();
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
  // Re-asserts on every route change so Back/stray links cannot skip onboarding.
  useEffect(() => {
    if (!state.profile.onboarded && loc.pathname !== '/onboarding') nav('/onboarding');
  }, [state.profile.onboarded, loc.pathname]);

  const xp = state.xp;
  const level = levelForXp(xp);
  const levelName = LEVEL_NAMES[Math.min(LEVEL_NAMES.length - 1, level - 1)];

  const searchItems = () => searchAll(sections, extras);

  return (
    <div className="shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="logo">🧠</div>
            <div>
              <b>AI ENGINEER MASTER LAB</b>
              <span className="sub">Learn → Code → Master (offline)</span>
            </div>
          </div>
          <nav>
            {['Learn', 'Practice', 'AI', 'You'].map((g) => (
              <div key={g}>
                <div className="navsep">{g}</div>
                {NAV.filter((n) => n.group === g).map((n) => (
                  <NavLink key={n.to} to={n.to} className={({ isActive }) => `navlink ${isActive ? 'active' : ''}`}>
                    <span className="ico">{n.icon}</span> {n.label}
                  </NavLink>
                ))}
            </div>
            ))}
          </nav>
          <div style={{ padding: '12px 10px' }} className="small muted">
            <div className="row spread"><span>Level {level}</span><span>{xp} XP</span></div>
            <div className="bar" style={{ marginTop: 6 }}><div style={{ width: `${Math.min(100, levelProgress(xp) * 100)}%` }} /></div>
            <div className="row spread" style={{ marginTop: 8 }}>
              <span>🔥 {state.streak.current}d streak</span>
              <span>Lv {levelName}</span>
            </div>
          </div>
        </aside>
        <main className="main">
          <div className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/path" element={<LearningPath />} />
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
        </main>
        {paletteOpen && sections && <CommandPalette items={searchItems()} onClose={() => setPaletteOpen(false)} />}
      </div>
  );
}
