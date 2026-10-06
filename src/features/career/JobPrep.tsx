import { useMemo } from 'react';
import { HubCrumb } from '../../components/learning/SectionChrome';
import { Link } from 'react-router-dom';
import { ClipboardList, Check, ArrowRight, Briefcase, Target, TrendingUp } from 'lucide-react';
import { useStore, toggleJobPrep } from '../../core/storage/store';
import { useCurriculum } from '../../core/data/curriculum';
import { sectionProgress, isMastered } from '../../core/learning/progress';
import { mockPassed } from '../../core/learning/coverage';
import { Bar, ProgressRing } from '../../components/ui/ui';
import { toast } from '../../components/ui/Toast';
import { CAREER_CHECKLIST, CHECKLIST_PHASES, checklistReadiness } from '../../core/learning/career';

/**
 * The checklist's items, phases and weights are authored in the career engine
 * (core/learning/career.ts — CAREER_CHECKLIST + CHECKLIST_PHASES), so this page and the Career
 * hub can never hold two copies of the list. Every tick here is persisted learner state.
 */
const ICONS: Record<string, typeof Briefcase> = { Briefcase, Target, TrendingUp, ClipboardList };

export default function JobPrep() {
  const state = useStore();
  const { sections } = useCurriculum();

  const done = (id: string) => !!state.jobPrep[id];
  const all = CAREER_CHECKLIST;
  const readiness = checklistReadiness(state.jobPrep);

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
      <HubCrumb hub="/career" hubLabel="Career" page="Job Prep" />
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><ClipboardList size={24} color="var(--cyan)" /> JOB PREP</h1>
          <p className="muted small" style={{ maxWidth: 720 }}>
            Job-ready banne ka tracker. Har tick tumhare browser me save hota hai, aur readiness
            score real signals (<b>{signals.mastered} mastered sections</b>, mock rounds, open mistakes) se banta hai.
          </p>
        </div>
        <div className="row" style={{ gap: 10 }}>
          <ProgressRing pct={readiness.pct} size={72} label="Job readiness" />
          <div className="small muted">
            <div><b>{all.filter((it) => done(it.id)).length}/{all.length}</b> checklist items</div>
            <div>Weighted readiness <b>{readiness.pct}%</b></div>
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
          {CHECKLIST_PHASES.map((phase) => {
            const items = CAREER_CHECKLIST.filter((it) => it.phase === phase.id);
            const gd = items.filter((it) => done(it.id)).length;
            const GIcon = ICONS[phase.icon] ?? Briefcase;
            return (
              <div key={phase.id} className="card" style={{ marginBottom: 12 }}>
                <div className="row spread">
                  <h2 className="row" style={{ gap: 8, margin: 0 }}><GIcon size={16} color="var(--violet)" /> {phase.label}</h2>
                  <span className="chip">{gd}/{items.length}</span>
                </div>
                <Bar pct={(gd / items.length) * 100} />
                <div style={{ marginTop: 8 }}>
                  {items.map((it) => {
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
            <h2>Readiness breakdown</h2>
            {readiness.byPhase.map((p) => (
              <div key={p.id} style={{ margin: '8px 0' }}>
                <div className="row spread small"><span>{p.label}</span><span>{p.pct}%</span></div>
                <Bar pct={p.pct} />
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Next best career step</h2>
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
