import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FolderGit2, Check, ArrowRight, Boxes, Hammer, ListChecks } from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useStore, recordAttempt, addXp, setState, today } from '../offline/store';
import { stageAttempt, codeSlot } from '../engine/keys';
import { sectionProgress } from '../engine/progress';
import { Bar, ProgressRing } from '../components/ui';
import { toast } from '../components/Toast';

interface Proj {
  key: string;
  sid: string;
  no: number;
  section: string;
  tier: string;
  name: string;
  what: string;
  architecture: string;
  files: string;
  buildTarget: string;
  code: string;
  output: string;
  explanation: string;
  defense: string;
  edgeCases: string[];
  route: string;
  done: boolean;
  stageKey: string;
}

export default function ProjectLab() {
  const { sections } = useCurriculum();
  const state = useStore();
  const [tier, setTier] = useState<'all' | 'mini' | 'real'>('all');
  const [open, setOpen] = useState<string | null>(null);
  // 116 project cards at once is needless DOM — page them instead.
  const [limit, setLimit] = useState(36);

  const projects: Proj[] = useMemo(() => {
    const out: Proj[] = [];
    for (const s of sections) {
      if (s.mini?.what) {
        const stageKey = stageAttempt(s.id, 'mini');
        out.push({
          key: `mini:${s.id}`, sid: s.id, no: s.no, section: s.title, tier: 'Mini Project',
          name: s.mini.name || `Mini project · ${s.title}`,
          what: s.mini.what, architecture: s.mini.architecture, files: s.mini.files,
          buildTarget: s.mini.buildTarget, code: s.mini.code, output: s.mini.output,
          explanation: s.mini.explanation, defense: s.mini.interview, edgeCases: s.mini.edgeCases ?? [],
          route: `/lesson/${s.id}/mini`, done: !!state.attempts[stageKey]?.done, stageKey,
        });
      }
      s.projectLab.forEach((p, i) => {
        const stageKey = stageAttempt(s.id, 'project');
        out.push({
          key: `lab:${s.id}:${i}`, sid: s.id, no: s.no, section: s.title, tier: p.tier || 'Project Lab',
          name: p.name, what: p.what, architecture: p.architecture, files: p.files,
          buildTarget: p.buildTarget, code: p.code, output: '', explanation: p.followUp,
          defense: p.defense, edgeCases: p.debugCue ? [p.debugCue] : [],
          route: `/lesson/${s.id}/project`, done: !!state.attempts[stageKey]?.done, stageKey,
        });
      });
    }
    return out;
  }, [sections, state.attempts]);

  const filtered = useMemo(
    () => projects.filter((p) => tier === 'all' || (tier === 'mini' ? p.tier === 'Mini Project' : p.tier !== 'Mini Project')),
    [projects, tier],
  );

  const total = projects.length;
  const done = projects.filter((p) => p.done).length;
  const pct = Math.round((done / Math.max(1, total)) * 100);

  /** Only 3 projects can be "portfolio ready" at a time — pick the most advanced ones. */
  const portfolio = useMemo(
    () => projects
      .map((p) => ({ p, s: sectionProgress(sections.find((x) => x.id === p.sid)!, state).masterPct }))
      .sort((a, b) => (b.p.done ? 1 : 0) - (a.p.done ? 1 : 0) || b.s - a.s)
      .slice(0, 3),
    [projects, sections, state],
  );

  const complete = (p: Proj) => {
    if (p.done) { toast('Ye project pehle complete mark hai.', 'info'); return; }
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
            Curriculum ke saare <b>{total} project briefs</b> — mini projects aur real builds. Har card
            me problem, architecture, files, build target aur defense questions hain. Complete karke
            portfolio-ready banao.
          </p>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <ProgressRing pct={pct} size={72} label="Projects complete" />
          <div className="small muted">
            <div><b>{done}</b> / {total} complete</div>
            <div><b>{done * 50}</b> XP earned from projects</div>
            <div>{Math.max(0, 3 - done)} more for a full portfolio</div>
          </div>
        </div>
      </div>

      <div className="row" style={{ gap: 6, margin: '14px 0', flexWrap: 'wrap' }}>
        <button className={`tabbtn ${tier === 'all' ? 'active' : ''}`} onClick={() => setTier('all')}>Sab ({projects.length})</button>
        <button className={`tabbtn ${tier === 'mini' ? 'active' : ''}`} onClick={() => setTier('mini')}>Mini Projects ({projects.filter((p) => p.tier === 'Mini Project').length})</button>
        <button className={`tabbtn ${tier === 'real' ? 'active' : ''}`} onClick={() => setTier('real')}>Real / AI Projects ({projects.filter((p) => p.tier !== 'Mini Project').length})</button>
      </div>

      <div className="path-grid" style={{ gridTemplateColumns: '1fr 300px' }}>
        <div>
          {!filtered.length && (
            <div className="empty-state">
              <span className="big">📦</span>
              <b>Is filter me koi project nahi</b>
              <span className="small">Doosra category chuno.</span>
            </div>
          )}
          <div className="grid2" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', alignItems: 'start' }}>
            {filtered.slice(0, limit).map((p) => {
              const isOpen = open === p.key;
              const s = sections.find((x) => x.id === p.sid)!;
              const sp = sectionProgress(s, state);
              return (
                <div key={p.key} className={`card ${p.done ? 'wb-active' : ''}`}>
                  <div className="row spread">
                    <span className="chip">s{String(p.no).padStart(2, '0')} · {p.tier}</span>
                    {p.done && <span className="chip easy"><Check size={11} /> Complete</span>}
                  </div>
                  <h3 style={{ margin: '8px 0 4px' }}>{p.name}</h3>
                  <p className="muted small" style={{ minHeight: 34 }}>{p.what}</p>
                  <div className="row small muted" style={{ gap: 10, flexWrap: 'wrap' }}>
                    <span><Boxes size={12} /> {p.files || 'files not listed'}</span>
                  </div>
                  <div style={{ marginTop: 6 }}>
                    <div className="row spread small"><span className="muted">Section mastery</span><span>{sp.masterPct}%</span></div>
                    <Bar pct={sp.masterPct} />
                  </div>

                  {isOpen && (
                    <div className="fadeup" style={{ marginTop: 10 }}>
                      <div className="card" style={{ background: 'var(--panel)' }}>
                        <b className="small">Architecture</b>
                        <p className="small muted">{p.architecture || 'Curriculum me architecture notes nahi hain — apna design likho.'}</p>
                        <b className="small">Build target</b>
                        <p className="small muted">{p.buildTarget || 'Build target lesson stage me diya gaya hai.'}</p>
                        {p.edgeCases.length > 0 && (
                          <>
                            <b className="small">Edge cases / debug cue</b>
                            <ul className="small muted" style={{ margin: '4px 0 0 16px' }}>{p.edgeCases.map((e, i) => <li key={i}>{e}</li>)}</ul>
                          </>
                        )}
                      </div>
                      {p.code && <pre className="codeblock">{p.code.slice(0, 900)}{p.code.length > 900 ? '\n# …' : ''}</pre>}
                      {p.output && <div className="small muted"><b>Expected output:</b> {p.output.slice(0, 120)}</div>}
                      {p.explanation && <p className="small muted">{p.explanation}</p>}
                      {p.defense && (
                        <div className="bubble"><b>Defense question:</b> {p.defense}</div>
                      )}
                    </div>
                  )}

                  <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                    <button className="btn small" onClick={() => setOpen(isOpen ? null : p.key)}>{isOpen ? 'Band karo' : 'Details kholo'}</button>
                    <Link className="btn small" to={p.route}><Hammer size={12} /> Lesson stage</Link>
                    {!p.done && <button className="btn small primary" onClick={() => complete(p)}><Check size={12} /> Complete mark karo</button>}
                    {p.done && <Link className="btn small" to="/resume">Resume me daalo <ArrowRight size={12} /></Link>}
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length > limit && (
            <div style={{ textAlign: 'center', marginTop: 14 }}>
              <button className="btn" onClick={() => setLimit((l) => l + 36)}>
                Aur {Math.min(36, filtered.length - limit)} dikhao ({filtered.length - limit} baaki)
              </button>
            </div>
          )}
        </div>

        <div className="path-rail">
          <div className="card">
            <h3 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} color="var(--cyan)" /> Portfolio ready</h3>
            <p className="muted small">Sabse aage wale 3 projects — inhe resume me daalo.</p>
            {portfolio.map(({ p, s }) => (
              <div key={p.key} className="row spread small" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.done ? '✓ ' : '○ '}{p.name}
                </span>
                <span className="chip">{s}%</span>
              </div>
            ))}
          </div>
          <div className="card">
            <h3>Project progression</h3>
            <div className="timeline">
              {['Idea', 'Planning', 'Building', 'Testing', 'Debugging', 'Completed', 'Defense', 'Portfolio Ready'].map((step, i) => (
                <div key={step} className={`tl-item ${done > 0 && i <= Math.min(5, Math.floor(pct / 17)) ? 'on' : ''}`}>
                  <b className="small">{step}</b>
                </div>
              ))}
            </div>
            <Link className="btn small" to="/defense" style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
              Defense practice karo <ArrowRight size={12} />
            </Link>
          </div>
          <div className="card" style={{ borderLeft: '3px solid var(--green)' }}>
            <p className="small" style={{ margin: 0, fontStyle: 'italic' }}>
              “Ek project jo deploy hua, 5 projects se better hai jo local me pade hain.”
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
