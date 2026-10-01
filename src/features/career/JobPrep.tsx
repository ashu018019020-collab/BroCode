import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Check, ArrowRight, Briefcase, Target, TrendingUp } from 'lucide-react';
import { useStore, toggleJobPrep } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import { sectionProgress, isMastered } from '../../core/learning/progress';
import { mockPassed } from '../../core/learning/coverage';
import { Bar, ProgressRing } from '../../components/ui/ui';
import { toast } from '../../components/ui/Toast';

interface Item { id: string; label: string; hint: string; to: string; weight: number }
interface Group { title: string; icon: typeof Briefcase; items: Item[] }

/** The checklist is authored, but every tick is persisted learner state. */
const GROUPS: Group[] = [
  {
    title: 'Profile & Resume', icon: Briefcase, items: [
      { id: 'resume-bullets', label: 'Resume me 3 project bullets likhe', hint: 'Problem → action → result format, numbers ke saath.', to: '/resume', weight: 3 },
      { id: 'resume-defense', label: 'Har project ka 60-second pitch ready', hint: 'Project Defense lab me practice karo.', to: '/defense', weight: 3 },
      { id: 'github', label: 'GitHub profile me pinned projects', hint: 'README me problem, stack, run steps.', to: '/projects', weight: 2 },
      { id: 'linkedin', label: 'LinkedIn headline + skills update', hint: 'Python, SQL, ML, GenAI, FastAPI keywords.', to: '/progress', weight: 1 },
    ],
  },
  {
    title: 'Technical Depth', icon: Target, items: [
      { id: 'python-core', label: 'Python Core 100% mastered', hint: 's01–s16 ka mastery pura karo.', to: '/path', weight: 4 },
      { id: 'data-stack', label: 'NumPy + Pandas + SQL comfortable', hint: 'Data track ke saare labs complete karo.', to: '/numpy-pandas', weight: 3 },
      { id: 'ml-nlp', label: 'ML + NLP ke core concepts clear', hint: 'Model evaluation aur NLP basics.', to: '/path', weight: 3 },
      { id: 'genai-agentic', label: 'GenAI + RAG + Agentic hands-on', hint: 'RAG Lab me retrieval khud build karo.', to: '/rag', weight: 4 },
      { id: 'apis', label: 'Ek API deploy kiya hua', hint: 'FastAPI + Docker + CI/CD.', to: '/path', weight: 3 },
    ],
  },
  {
    title: 'Interview Readiness', icon: TrendingUp, items: [
      { id: 'mock-round-1', label: 'Kam se kam 2 mock rounds complete', hint: '60%+ score ke saath.', to: '/mock', weight: 3 },
      { id: 'aloud', label: '20 questions zor se bolke practice', hint: 'Aloud bolna fluency build karta hai.', to: '/interview', weight: 2 },
      { id: 'mistakes-clear', label: 'Saare open mistakes close', hint: 'Mistake Tracker me fix mark karo.', to: '/mistakes', weight: 3 },
      { id: 'final', label: 'Final Assessment pass', hint: 'Poora curriculum ka final gate.', to: '/final', weight: 4 },
    ],
  },
  {
    title: 'Application Engine', icon: ClipboardList, items: [
      { id: 'target-list', label: '20 target companies ki list', hint: 'Role, stack aur referral track karo.', to: '/jobprep', weight: 2 },
      { id: 'apply-5', label: 'Is hafte 5 applications bheje', hint: 'Tailored resume ke saath.', to: '/jobprep', weight: 3 },
      { id: 'referral', label: '2 referral ya cold DM', hint: 'Short, specific message likho.', to: '/jobprep', weight: 2 },
      { id: 'portfolio', label: 'Portfolio me 3 projects live', hint: 'Deployed link ke saath.', to: '/projects', weight: 3 },
    ],
  },
];

export default function JobPrep() {
  const state = useStore();
  const { sections } = useCurriculum();

  const done = (id: string) => !!state.jobPrep[id];
  const all = GROUPS.flatMap((g) => g.items);
  const totalW = all.reduce((a, it) => a + it.weight, 0);
  const doneW = all.filter((it) => done(it.id)).reduce((a, it) => a + it.weight, 0);
  const readiness = Math.round((doneW / totalW) * 100);

  /** Mastery signals shown next to the checklist so nothing is guesswork. */
  const signals = useMemo(() => {
    const mastered = sections.filter((s) => isMastered(s, state)).length;
    const overall = Math.round(sections.reduce((a, s) => a + sectionProgress(s, state).masterPct, 0) / Math.max(1, sections.length));
    const openMistakes = state.mistakes.filter((m) => !m.fixed).length;
    const mockDone = mockPassed(state.attempts);
    return { mastered, overall, openMistakes, mockDone };
  }, [sections, state]);

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><ClipboardList size={24} color="var(--cyan)" /> JOB PREP</h1>
          <p className="muted small" style={{ maxWidth: 720 }}>
            Job-ready banne ka tracker. Har tick tumhare browser me save hota hai, aur readiness
            score real signals (<b>{signals.mastered} mastered sections</b>, mock rounds, open mistakes) se banta hai.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <ProgressRing pct={readiness} size={72} label="Job readiness" />
          <div className="small muted">
            <div><b>{all.filter((it) => done(it.id)).length}/{all.length}</b> checklist items</div>
            <div>Weighted readiness <b>{readiness}%</b></div>
          </div>
        </div>
      </div>

      <div className="statgrid" style={{ marginTop: 14 }}>
        <div className="stat"><div className="n">{signals.overall}%</div><div className="l">Curriculum mastery</div></div>
        <div className="stat"><div className="n">{signals.mastered}</div><div className="l">Sections mastered</div></div>
        <div className="stat"><div className="n">{signals.mockDone}</div><div className="l">Mock Qs passed</div></div>
        <div className="stat"><div className="n">{signals.openMistakes}</div><div className="l">Open mistakes</div></div>
      </div>

      <div className="grid2" style={{ marginTop: 14, gridTemplateColumns: '1.3fr 1fr', alignItems: 'start' }}>
        <div>
          {GROUPS.map((g) => {
            const gd = g.items.filter((it) => done(it.id)).length;
            return (
              <div key={g.title} className="card" style={{ marginBottom: 12 }}>
                <div className="row spread">
                  <h3 className="row" style={{ gap: 8, margin: 0 }}><g.icon size={16} color="var(--violet)" /> {g.title}</h3>
                  <span className="chip">{gd}/{g.items.length}</span>
                </div>
                <Bar pct={(gd / g.items.length) * 100} />
                <div style={{ marginTop: 8 }}>
                  {g.items.map((it) => {
                    const on = done(it.id);
                    return (
                      <div key={it.id} className="row" style={{ gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', alignItems: 'flex-start' }}>
                        <button
                          className={`btn small ${on ? 'primary' : ''}`}
                          style={{ padding: 4, width: 26, height: 26, justifyContent: 'center', flex: 'none' }}
                          aria-pressed={on}
                          aria-label={it.label}
                          onClick={() => { toggleJobPrep(it.id); toast(on ? 'Unticked — dobara kar lo.' : '✓ Tick ho gaya!', on ? 'info' : 'success', 1800); }}
                        >
                          {/* The (hidden) icon keeps the button a real 26px tap target when unticked. */}
                          <Check size={13} style={{ opacity: on ? 1 : 0 }} />
                        </button>
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <b className="small" style={{ textDecoration: on ? 'line-through' : 'none', opacity: on ? .7 : 1 }}>{it.label}</b>
                          <div className="small muted">{it.hint}</div>
                        </span>
                        <span className="chip">w{it.weight}</span>
                        <Link className="btn small ghost" to={it.to} aria-label={`Open ${it.label}`}><ArrowRight size={12} /></Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="path-rail">
          <div className="card">
            <h3>Readiness breakdown</h3>
            {GROUPS.map((g) => {
              const gd = g.items.filter((it) => done(it.id)).length;
              const w = g.items.reduce((a, it) => a + it.weight, 0);
              const dw = g.items.filter((it) => done(it.id)).reduce((a, it) => a + it.weight, 0);
              return (
                <div key={g.title} style={{ margin: '8px 0' }}>
                  <div className="row spread small"><span>{g.title}</span><span>{Math.round((dw / w) * 100)}%</span></div>
                  <Bar pct={(gd / g.items.length) * 100} />
                </div>
              );
            })}
          </div>

          <div className="card">
            <h3>Next best career step</h3>
            {(() => {
              const next = all.filter((it) => !done(it.id)).sort((a, b) => b.weight - a.weight)[0];
              if (!next) return <p className="muted small">Sab tick ho gaya — applications bhejo aur interviews crack karo. 🚀</p>;
              return (
                <>
                  <b className="small">{next.label}</b>
                  <p className="muted small" style={{ margin: '4px 0 8px' }}>{next.hint}</p>
                  <Link className="btn small primary" to={next.to}>Abhi karo <ArrowRight size={12} /></Link>
                </>
              );
            })()}
          </div>

          <div className="card" style={{ borderLeft: '3px solid var(--pink)' }}>
            <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>
              “Portfolio &gt; certificate. Ek deployed project, 10 certifications se zyada bolta hai.”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
