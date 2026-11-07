import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderGit2, Check, ArrowRight, Boxes, Hammer, ListChecks, ListOrdered, ShieldCheck, Sparkles,
} from 'lucide-react';
import { useCurriculum } from '../../core/data/curriculum';
import { TRACK_DEFS } from '../../app/App';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { SubjectLogo } from '../../components/shared/SubjectLogo';
import { useStore, recordAttempt, addXp, setState, today } from '../../core/storage/store';
import { codeSlot } from '../../core/platform/keys';
import { sectionProgress } from '../../core/learning/progress';
import { portfolioTrio } from '../../core/learning/career';
import { nextBuild, projectBriefs, projectSummary } from '../../core/learning/project-workspace';
import type { ProjectBrief } from '../../core/learning/project-workspace';
import { buildBriefing, buildTutorContext, buildTutorPrompts, type BuildScope } from '../../core/ai/step-tutor';
import { ScopeTutor } from '../../components/shared/ScopeTutor';
import { usePublishTutorScope } from '../../components/shared/tutorScope';
import { Bar, ProgressRing } from '../../components/ui/ui';
import { toast } from '../../components/ui/Toast';

/**
 * The authored fields of one brief, in the shape the scoped tutor takes.
 *
 * ONE builder for the page block and for the scope this page publishes to the footer dock, so the
 * two surfaces can never describe different builds. `sectionId` is the curriculum id, which biases
 * retrieval toward the section that actually teaches the build.
 */
function buildScope(p: ProjectBrief): BuildScope {
  return {
    name: p.name,
    sectionId: p.sid,
    sectionTitle: p.section,
    tier: p.tier,
    what: p.what,
    files: p.files,
    architecture: p.architecture,
    buildTarget: p.buildTarget,
    edgeCases: p.edgeCases,
    steps: p.steps,
    defenseQuestion: p.defenseQuestion,
    route: p.route,
  };
}

export default function ProjectLab() {
  const { sections } = useCurriculum();
  const { t } = useI18n();
  const state = useStore();
  const [tier, setTier] = useState<'all' | 'mini' | 'real'>('all');
  const [open, setOpen] = useState<string | null>(null);
  // 116 project cards at once is needless DOM — page them instead.
  const [limit, setLimit] = useState(36);

  /** Every brief, its real gate and its section's defense status — one pure model, one source. */
  const projects = useMemo(() => projectBriefs(sections, state.attempts), [sections, state.attempts]);
  const summary = useMemo(() => projectSummary(projects), [projects]);

  const filtered = useMemo(
    () => projects.filter((p) => tier === 'all' || (tier === 'mini' ? p.tier === 'Mini Project' : p.tier !== 'Mini Project')),
    [projects, tier],
  );

  /** Section mastery, for the "you have started this chapter" preference in the next build pick. */
  const masteryOf = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of sections) map.set(s.id, sectionProgress(s, state).masterPct);
    return (sid: string) => map.get(sid) ?? 0;
  }, [sections, state]);

  const next = useMemo(() => nextBuild(projects, masteryOf), [projects, masteryOf]);

  /** The build the learner is actually looking at: the open card, else the recommended one. */
  const activeBuild = useMemo(
    () => projects.find((p) => p.key === open) ?? next,
    [projects, open, next],
  );

  /** The same scope the block below renders, published to the footer dock — so the tutor entry is
      reachable from the top of the page instead of only from an expanded card. */
  usePublishTutorScope(activeBuild ? {
    kind: 'build',
    title: activeBuild.name,
    context: buildTutorContext(buildScope(activeBuild)),
    prompts: buildTutorPrompts(buildScope(activeBuild)),
    briefing: buildBriefing(buildScope(activeBuild)),
  } : null);

  /** Only 3 projects can be "portfolio ready" at a time. The rule lives in the career engine and
      is shared with the Career hub, so both screens can only ever name the SAME three builds. */
  const portfolio = useMemo(
    () => portfolioTrio(projects.map((p) => ({
      key: p.key,
      name: p.name,
      done: p.built,
      pct: masteryOf(p.sid),
    }))),
    [projects, masteryOf],
  );

  const complete = (p: ProjectBrief) => {
    if (p.built) { toast('This project is already marked complete.', 'info'); return; }
    recordAttempt(p.stageKey, { done: true, tries: (state.attempts[p.stageKey]?.tries ?? 0) + 1 });
    if (p.code) setState((s) => ({ ...s, savedCode: { ...s.savedCode, [codeSlot.lesson(p.sid, 'project', 0)]: p.code } }));
    addXp(50, 'project', p.name.slice(0, 40));
    setState((s) => ({ ...s, activity: { ...s.activity, [today()]: (s.activity[today()] ?? 0) } }));
    toast(`Project complete! +50 XP — ${p.name.slice(0, 34)}`, 'success', 4000);
  };

  return (
    <div>
      <div className="row spread" style={{ flexWrap: 'wrap' }}>
        <div>
          <h1 className="row" style={{ gap: 10 }}><FolderGit2 size={24} color="var(--green)" /> PROJECT LAB</h1>
          <p className="muted small" style={{ maxWidth: 720 }}>
            All <b>{summary.total} project briefs</b> in the curriculum — mini projects and real builds. Every card
            has an ordered build path and its defense status, so you can pick one, build it in order and see
            whether you have defended it.
          </p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <ProgressRing pct={summary.pct} size={72} label="Builds complete" />
          <div className="small muted">
            <div><b>{summary.built}</b> / {summary.total} builds complete</div>
            <div><b>{summary.defended}</b> defended</div>
            <div><b>{summary.built * 50}</b> XP earned from projects</div>
            <div>{Math.max(0, 3 - summary.built)} more for a full portfolio</div>
          </div>
        </div>
      </div>

      {next ? (
        <div className="card pw-next">
          <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <span className="chip"><Sparkles size={11} /> Next build</span>
              <h2 style={{ margin: '6px 0 2px' }}>{next.name}</h2>
              <p className="small muted" style={{ margin: 0 }}>
                s{String(next.no).padStart(2, '0')} · {next.section} · {next.tier} · {next.steps.length} build steps
                {next.defended ? ' · already defended' : ''}
              </p>
            </div>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
              <button
                className="btn small primary"
                onClick={() => {
                  setOpen(next.key);
                  document.getElementById(`proj-${next.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                Follow build path <ArrowRight size={12} />
              </button>
              <Link className="btn small" to={next.route}><Hammer size={12} /> Lesson stage</Link>
            </div>
          </div>
        </div>
      ) : (
        !!projects.length && (
          <div className="card pw-next">
            <b>Every build is complete.</b>{' '}
            <span className="small muted">
              Defend them on the{' '}
              <Link to="/defense">Defense page</Link>{' '}
              to make them portfolio-ready.
            </span>
          </div>
        )
      )}

      <div className="row" style={{ gap: 6, margin: '14px 0', flexWrap: 'wrap' }}>
        <button className={`tabbtn ${tier === 'all' ? 'active' : ''}`} onClick={() => setTier('all')}>All ({projects.length})</button>
        <button className={`tabbtn ${tier === 'mini' ? 'active' : ''}`} onClick={() => setTier('mini')}>Mini Projects ({projects.filter((p) => p.tier === 'Mini Project').length})</button>
        <button className={`tabbtn ${tier === 'real' ? 'active' : ''}`} onClick={() => setTier('real')}>Real / AI Projects ({projects.filter((p) => p.tier !== 'Mini Project').length})</button>
      </div>

      <div className="path-grid" style={{ gridTemplateColumns: '1fr 300px' }}>
        <div>
          {!filtered.length && (
            <div className="empty-state">
              <span className="big">📦</span>
              <b>No projects in this filter</b>
              <span className="small">Choose another category.</span>
            </div>
          )}
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
            {filtered.slice(0, limit).map((p) => {
              const isOpen = open === p.key;
              const sp = sectionProgress(sections.find((x) => x.id === p.sid)!, state);
              const tech = TRACK_DEFS.find((d) => p.no >= d.from && p.no <= d.to) ?? null;
              return (
                <div key={p.key} id={`proj-${p.key}`} className={`card ${p.built ? 'wb-active' : ''}`}>
                  <div className="row spread" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <span className="chip row" style={{ gap: 6 }}>
                      {tech && <span className="proj-logo"><SubjectLogo id={tech.id} name={t(tech.nameKey as LocaleKey)} size={16} /></span>}
                      s{String(p.no).padStart(2, '0')} · {p.tier}
                    </span>
                    <span className="row" style={{ gap: 6 }}>
                      {p.built && <span className="chip easy"><Check size={11} /> Complete</span>}
                      {p.defended
                        ? <span className="chip easy"><ShieldCheck size={11} /> Defended{p.defenseScore !== null ? ` · ${p.defenseScore}%` : ''}</span>
                        : <span className="chip"><ShieldCheck size={11} /> Defense pending</span>}
                    </span>
                  </div>
                  <h2 style={{ margin: '8px 0 4px' }}>{p.name}</h2>
                  <p className="muted small" style={{ minHeight: 34 }}>{p.what}</p>
                  <div className="row small muted" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span><Boxes size={12} /> {p.files || 'files not listed'}</span>
                    <span><ListOrdered size={12} /> {p.steps.length} build steps</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div className="row spread small"><span className="muted">Section mastery</span><span>{sp.masterPct}%</span></div>
                    <Bar pct={sp.masterPct} />
                  </div>

                  {isOpen && (
                    <div className="fadeup" style={{ marginTop: 10 }}>
                      <b className="small">Build path</b>
                      <div className="pw-steps">
                        {p.steps.map((step) => (
                          <div key={step.no} className="pw-step">
                            <span className="pw-no">{step.no}</span>
                            <div style={{ minWidth: 0 }}>
                              <b className="small">{step.label}</b>
                              <p className="small muted" style={{ margin: 0 }}>{step.detail}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                      {p.code && <pre className="codeblock">{p.code.slice(0, 900)}{p.code.length > 900 ? '\n# …' : ''}</pre>}
                      {p.output && <div className="small muted"><b>Expected output:</b> {p.output.slice(0, 120)}</div>}
                      {p.explanation && <p className="small muted">{p.explanation}</p>}

                      {/* The same tutor as the step page, told which build is open: the files, the
                          architecture, the done-when and the defense question all come from the
                          brief above — nothing is summarised or invented. */}
                      <ScopeTutor
                        kind="build"
                        context={buildTutorContext(buildScope(p))}
                        prompts={buildTutorPrompts(buildScope(p))}
                        briefing={buildBriefing(buildScope(p))}
                      />
                    </div>
                  )}

                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <button className="btn small" onClick={() => setOpen(isOpen ? null : p.key)}>{isOpen ? 'Close' : 'Build path'}</button>
                    <Link className="btn small" to={p.route}><Hammer size={12} /> Lesson stage</Link>
                    {!p.built && <button className="btn small primary" onClick={() => complete(p)}><Check size={12} /> Mark complete</button>}
                    {p.built && (
                      <Link className="btn small" to={`/lesson/${p.sid}/defense`}>
                        {p.defended ? 'Re-practice defense' : 'Practice defense'} <ArrowRight size={12} />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > limit && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button className="btn" onClick={() => setLimit((l) => l + 36)}>
                Show {Math.min(36, filtered.length - limit)} more ({filtered.length - limit} left)
              </button>
            </div>
          )}
        </div>

        <div className="path-rail">
          <div className="card">
            <h2 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} color="var(--cyan)" /> Portfolio ready</h2>
            <p className="muted small">The three strongest projects — put these in your portfolio.</p>
            {portfolio.map((p) => (
              <div key={p.key} className="row spread small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.done ? '✓ ' : '○ '}{p.name}
                </span>
                <span className="chip">{p.pct}%</span>
              </div>
            ))}
          </div>
          <div className="card">
            <h2>Project progression</h2>
            <div className="timeline">
              {['Idea', 'Planning', 'Building', 'Testing', 'Debugging', 'Completed', 'Defense', 'Portfolio Ready'].map((step, i) => (
                <div key={step} className={`tl-item ${summary.built > 0 && i <= Math.min(5, Math.floor(summary.pct / 17)) ? 'on' : ''}`}>
                  <b className="small">{step}</b>
                </div>
              ))}
            </div>
            <Link className="btn small" to="/defense" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
              Practice defense <ArrowRight size={12} />
            </Link>
          </div>
          <div className="card" style={{ borderLeft: '3px solid var(--green)' }}>
            <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>
              “One deployed project beats five that sit on your laptop.”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
