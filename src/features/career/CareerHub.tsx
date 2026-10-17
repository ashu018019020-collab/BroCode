import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookMarked, FlaskConical, FolderGit2, Mic2, Rocket } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { TRACK_DEFS } from '../../app/App';
import { usePathCtx } from '../../core/data/paths';
import { useCurriculum } from '../../core/data/curriculum';
import { useBankManifest } from '../../core/data/questions';
import { EXTRA_PATHS } from '../../core/learning/paths';
import { useStore } from '../../core/storage/store';
import { sectionProgress, isMastered } from '../../core/learning/progress';
import { stageAttempt, resumeDefenseAnswer } from '../../core/platform/keys';
import { DEFENSE_PROJECTS, RESUME_ANSWER_TOTAL } from '../../core/assessment/defense';
import { careerAchievements } from '../../core/platform/achievements';
import {
  bestRole, careerFlow, careerProgress, careerRoadmap, checklistReadiness, jobReadiness,
  nextCareerAction, portfolioTrio, roleSkills, TARGET_ROLES, trackMastery,
  type CareerCounts, type PortfolioCard, type ReadinessState,
} from '../../core/learning/career';
import { HubGrid } from '../../components/shared/HubGrid';
import { Bar } from '../../components/ui/ui';

/**
 * The Career pillar: a career operating system, not a list of tools.
 *
 * LEARN → BUILD → PROVE → PRESENT → PREPARE → APPLY → INTERVIEW → GET HIRED. Every tile, bar and
 * badge on this page is DERIVED — from the lesson gates, the project/defense stage records, the
 * `resume:` pitch answers, the job-prep checklist and the published manifests — by the pure rules
 * in `core/learning/career.ts` (this page only decides where each number comes from). Nothing is
 * authored here except the choice the learner makes: which target role to aim at.
 *
 * The three cards the pillar OWNS (/defense, /job-prep, /progress) are the HubGrid below; the
 * work that lives outside the pillar (builds, question banks, the answer archive) links out with
 * counts from the same registries those pages read.
 */
const ROUTES = ['/defense', '/job-prep', '/progress'];

/** The lab family, read from the registry — the same list the Labs hub indexes. */
const LAB_ROUTES = EXTRA_PATHS.filter((p) => p.group === 'lab').map((p) => p.route);

/** The `resume:` family, derived from the key builder — the page never re-types a key shape. */
const RESUME_FAMILY = `${resumeDefenseAnswer('', 0).split(':')[0]}:`;

/** A readiness row's chip — the engine owns the word, the page owns the colour. */
const stateClass: Record<ReadinessState, string> = {
  ready: 'chip easy', building: 'chip medium', started: 'chip', empty: 'chip hard',
};
const stateLabel: Record<ReadinessState, string> = {
  ready: 'ready', building: 'building', started: 'started', empty: 'empty',
};

export default function CareerHub() {
  const { t } = useI18n();
  const { sections } = useCurriculum();
  const state = useStore();
  const ctx = usePathCtx();
  const banks = useBankManifest();
  const [params, setParams] = useSearchParams();

  /** The interview/HR questions the readiness row drills from — the bank's own manifest. */
  const interviewQs = banks
    ? banks.sections.reduce((a, s) => a + (s.byType.interview ?? 0), 0)
    : null;

  /** Per-section mastery — the same figure the lesson tiles and the Progress page print. */
  const mastery = useMemo(
    () => sections.map((s) => ({ id: s.id, no: s.no, masterPct: sectionProgress(s, state).masterPct })),
    [sections, state],
  );

  /**
   * The one bag the career engine reads. Every field points at the record that owns it: stage
   * gates from the path context (which reads them from `core/platform/keys.ts` shapes), the
   * manifest totals from the published registries, the checklist from the stored job-prep record.
   */
  const counts: CareerCounts = useMemo(() => {
    // The curriculum's own gate predicate (`stagePassed`): the gate RECORD exists. Lesson.tsx and
    // the Project Lab both write these keys with `done: true`, so this and the Project Lab's card
    // flag agree — while a scored record can never be missed by asking for `.done` alone.
    const miniDone = sections.filter((s) => !!state.attempts[stageAttempt(s.id, 'mini')]).length;
    return {
      sections: sections.length,
      learningPct: mastery.length ? Math.round(mastery.reduce((a, s) => a + s.masterPct, 0) / mastery.length) : 0,
      mastered: sections.filter((s) => isMastered(s, state)).length,
      miniDone,
      projectGates: ctx.projectGates,
      buildsDone: miniDone + ctx.projectGates,
      defenseGates: ctx.defenseGates,
      resumeAnswers: ctx.counts.resumeAnswers,
      resumeTotal: RESUME_ANSWER_TOTAL,
      mockDone: ctx.counts.mockDone,
      mockTotal: ctx.mockTotal,
      bankPractised: ctx.counts.bankPractised,
      bankTotal: ctx.published?.total ?? null,
      notebookCells: ctx.counts.notebookCells,
      notebookCellsTotal: ctx.notebooks?.cells ?? null,
      interviewAnswers: ctx.counts.interviewAnswers,
      checklist: state.jobPrep,
    };
  }, [sections, state, ctx, mastery]);

  const next = nextCareerAction(counts);
  const flow = careerFlow(counts);
  const ready = checklistReadiness(state.jobPrep);
  const roadmap = careerRoadmap(counts);
  const readiness = jobReadiness(counts);
  const progress = careerProgress(counts);

  /** Pitch answers per defense project — the resume card's per-project breakdown. */
  const resumeByProject = useMemo(() => {
    const out: Record<string, number> = {};
    for (const k of Object.keys(state.defenseAnswers)) {
      if (!k.startsWith(RESUME_FAMILY)) continue;
      const id = k.slice(RESUME_FAMILY.length, k.lastIndexOf(':'));
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }, [state.defenseAnswers]);

  /** Skills are the track registry measured against the real section mastery. */
  const trackDefs = useMemo(
    () => TRACK_DEFS.map((d) => ({ id: d.id, label: t(d.nameKey as LocaleKey), from: d.from, to: d.to })),
    [t],
  );
  const skills = useMemo(() => trackMastery(mastery, trackDefs), [mastery, trackDefs]);

  // The target role: the URL's ?role= if it names a real role, else the closest one.
  const best = useMemo(() => bestRole(skills), [skills]);
  const role = TARGET_ROLES.find((r) => r.id === params.get('role')) ?? best;
  const view = roleSkills(role, skills);
  const pickRole = (id: string) => setParams(id === best.id ? {} : { role: id });

  /**
   * The portfolio trio — the SAME card list the Project Lab builds (a section's mini project plus
   * one card per real-build tier, sharing that section's gate), so both screens agree on which
   * three projects are portfolio-ready. The rule lives in the engine, not here.
   */
  const trio = useMemo(() => {
    const pctOf = new Map(mastery.map((m) => [m.id, m.masterPct]));
    const cards: PortfolioCard[] = [];
    for (const s of sections) {
      if (s.mini?.what) {
        cards.push({
          key: `mini:${s.id}`,
          name: s.mini.name || `Mini project · ${s.title}`,
          done: !!state.attempts[stageAttempt(s.id, 'mini')],
          pct: pctOf.get(s.id) ?? 0,
          kind: 'Mini project',
        });
      }
      for (const p of s.projectLab) {
        cards.push({
          // A display key, not a persisted one — deliberately NOT the `lab:` attempt family.
          key: `build:${s.id}:${p.tier}`,
          name: p.name,
          done: !!state.attempts[stageAttempt(s.id, 'project')],
          pct: pctOf.get(s.id) ?? 0,
          kind: p.tier || 'Project build',
        });
      }
    }
    return portfolioTrio(cards);
  }, [sections, state, mastery]);

  /** The career subset of the ONE achievements list (Dashboard renders the full set). */
  const badges = useMemo(() => careerAchievements(state, sections), [state, sections]);
  const badgesEarned = badges.filter((b) => b.earned).length;

  return (
    <div>
      {/* ---------- hero: where the career stands, in real figures ---------- */}
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>🎯 CAREER</div>
            <h1 style={{ margin: 0 }}>Learn. Build. Get job-ready.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 620 }}>
              One system: what to learn next, what to build, how to present it — every
              number comes from your own records, no guesswork.
            </p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip"><Rocket size={12} /> {ready.pct}% job-prep readiness</span>
            <span className="chip">Next step: {next.phase}</span>
            <span className="chip">Level {ctx.counts.level} · {ctx.counts.xp} XP</span>
          </div>
        </div>
      </div>

      {/* ---------- 🚀 next best action: the first gate that fails, in flow order ---------- */}
      <div className="sec-head"><h2><Rocket size={16} color="var(--amber)" /> Next best action</h2><span className="line" /></div>
      <div className="card fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260, flex: 1 }}>
            <b style={{ fontSize: '1.05rem' }}>{next.title}</b>
            <p className="muted small" style={{ margin: '4px 0 10px' }}>{next.reason}</p>
            <Link className="btn small primary" to={next.to}>Do it now <ArrowRight size={13} /></Link>
          </div>
          {/* The flow strip: green = walked, lit = where you stand, dim = ahead. */}
          <div className="row" style={{ gap: 5, flexWrap: 'wrap', maxWidth: 420 }}>
            {flow.map((f) => (
              <span
                key={f.phase}
                className={`chip${f.state === 'current' ? ' on' : f.state === 'done' ? ' easy' : ''}`}
                title={f.state === 'done' ? 'done' : f.state === 'current' ? 'you are here' : 'ahead'}
              >
                {f.state === 'done' ? '✓ ' : ''}{f.phase}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ---------- 🧭 the roadmap: six phases, each with its own real denominator ---------- */}
      <div className="sec-head"><h2>Career roadmap</h2><span className="line" /></div>
      <div className="tile-grid">
        {roadmap.map((tile) => (
          <Link key={tile.id} to={tile.to} className="tile">
            <span className="ic" style={{ fontSize: 17 }} aria-hidden>{tile.emoji}</span>
            <span className="t" style={{ flex: 1, minWidth: 0 }}>
              <b>{tile.label}{tile.pct !== null ? ` — ${tile.pct}%` : ''}</b>
              <span>{tile.hint}</span>
              {tile.pct !== null && <span className="bar" style={{ marginTop: 6 }}><div style={{ width: `${tile.pct}%` }} /></span>}
            </span>
          </Link>
        ))}
      </div>

      {/* ---------- 💼 job readiness: the six things an application needs ---------- */}
      <div className="sec-head"><h2>Job readiness</h2><span className="line" /></div>
      <div className="card">
        {readiness.map((r) => (
          <Link key={r.id} className="q-row" to={r.to} title={r.hint}>
            <span className="ic" aria-hidden>{r.emoji}</span>
            <span className="t">
              {r.label}
              <span className="small muted" style={{ display: 'block' }}>
                {r.total > 0 ? `${r.done} / ${r.total} ${r.hint}` : `${r.done} ${r.hint}`}
              </span>
            </span>
            {r.pct !== null && <span className="bar" style={{ width: 110 }}><div style={{ width: `${r.pct}%` }} /></span>}
            <b>{r.pct !== null ? `${r.pct}%` : '—'}</b>
            <span className={stateClass[r.state]}>{stateLabel[r.state]}</span>
          </Link>
        ))}
      </div>

      {/* ---------- 🎯 target role: authored catalog, measured skills ---------- */}
      <div className="sec-head"><h2>Target role</h2><span className="line" /></div>
      <div className="card fadeup">
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          {TARGET_ROLES.map((r) => {
            const v = roleSkills(r, skills);
            const on = r.id === role.id;
            return (
              <button key={r.id} className={`chip${on ? ' on' : ''}`} style={{ cursor: 'pointer' }} onClick={() => pickRole(r.id)}>
                {r.emoji} {r.label} · {v.pct}%
              </button>
            );
          })}
        </div>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ minWidth: 220 }}>
            <b>{role.emoji} {role.label}</b>
            <p className="muted small" style={{ margin: '2px 0 0' }}>{role.blurb}</p>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <span className="chip">{view.ready} / {view.skills.length} skills ready</span>
            {view.weakest && view.weakest.status !== 'ready' && (
              <Link className="btn small primary" to={`/practice?subject=${view.weakest.id}`}>
                Fix skill gaps <ArrowRight size={13} />
              </Link>
            )}
          </div>
        </div>
        {view.skills.map((s) => (
          <div key={s.id} style={{ margin: '8px 0' }}>
            <div className="row spread small">
              <span>
                {s.status === 'ready' ? '✅' : s.status === 'building' ? '⚠️' : '✗'} {s.label}
                <span className="muted" style={{ marginLeft: 6 }}>{s.pct}% mastery</span>
              </span>
              <span className="small muted">{s.status === 'ready' ? 'interview-ready' : s.status === 'building' ? 'building' : 'get started'}</span>
            </div>
            <Bar pct={s.pct} />
          </div>
        ))}
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Ready = mastery ≥ 75% · building = 40–74%. Mastery is the same lesson-gate number every
          section tile prints — the role simply combines them into one target.
        </p>
      </div>

      {/* ---------- 💻 portfolio projects: the three the Project Lab's own rule picks ---------- */}
      <div className="sec-head"><h2>Portfolio projects</h2><span className="line" /></div>
      <div className="card">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 10, marginBottom: 8 }}>
          <span className="small muted">
            {ctx.playbook ? `${ctx.playbook.miniProjects} mini projects + real builds` : '…'} — the three
            that should go into your portfolio now:
          </span>
          <Link to="/projects" className="btn small primary"><FolderGit2 size={13} /> View projects</Link>
        </div>
        {trio.map((p) => (
          <div key={p.key} className="q-row">
            <span className="ic">{p.done ? '✓' : '○'}</span>
            <span className="t">
              {p.name}
              <span className="small muted" style={{ display: 'block' }}>
                {p.kind ? `${p.kind} · ` : ''}section mastery {p.pct}%{p.done ? ' · build complete' : ''}
              </span>
            </span>
            <span className={`chip${p.done ? ' easy' : ''}`}>{p.done ? 'ready' : 'build pending'}</span>
          </div>
        ))}
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Resume pitches are below — pitch answers are written for {Object.keys(resumeByProject).length} / {DEFENSE_PROJECTS.length} projects
          ({counts.resumeAnswers} / {counts.resumeTotal} total).
        </p>
      </div>

      {/* ---------- 📊 career progress: one bar per pillar, all from real records ---------- */}
      <div className="sec-head"><h2>Career progress</h2><span className="line" /></div>
      <div className="card">
        {progress.map((p) => (
          <div key={p.id} style={{ margin: '9px 0' }}>
            <div className="row spread small">
              <span>{p.label} <span className="muted">{p.note}</span></span>
              <span>{p.pct !== null ? `${p.pct}%` : '—'}</span>
            </div>
            {/* A line with no denominator yet shows the count, never an invented percentage. */}
            <Bar pct={p.pct ?? 0} />
          </div>
        ))}
      </div>

      {/* ---------- 🏆 achievements: the career subset of the one badge engine ---------- */}
      <div className="sec-head"><h2>Achievements</h2><span className="line" /></div>
      <div className="card">
        <div className="row spread" style={{ marginBottom: 8 }}>
          <span className="small muted">{badgesEarned} / {badges.length} unlocked — every badge is built from a real record.</span>
          {/* The full 18-badge panel lives on the Dashboard — this card is the career slice. */}
          <Link className="btn small ghost" to="/">All badges <ArrowRight size={12} /></Link>
        </div>
        <div className="achv-grid">
          {badges.map((a) => (
            <div key={a.id} className={`achv${a.earned ? ' earned' : ''}`} title={`${a.label} — ${a.hint}`}>
              <span className="achv-em" aria-hidden>{a.icon}</span>
              <div className="achv-top">
                <b>{a.label}</b>
                <span className="achv-tag">{a.got} / {a.need}</span>
              </div>
              {!a.earned && <span className="achv-bar"><i style={{ width: `${Math.min(100, (a.got / Math.max(1, a.need)) * 100)}%` }} /></span>}
            </div>
          ))}
        </div>
      </div>

      {/* ---------- the pillar's own three tools + the surfaces the work lives on ---------- */}
      <div className="sec-head"><h2>All career tools</h2><span className="line" /></div>
      <HubGrid routes={ROUTES} />

      {/* The pillars this one is built ON: the labs that build the hands-on skill a role asks for,
          the interview/HR bank the readiness row drills from, and the archive of answer templates.
          Every count comes from the registry the linked page itself loads. */}
      <div className="tile-grid" style={{ marginTop: 8 }}>
        <Link to="/labs" className="tile">
          <span className="ic"><FlaskConical size={18} /></span>
          <span className="t" style={{ flex: 1, minWidth: 0 }}>
            <b>Hands-on labs</b>
            <span>{LAB_ROUTES.length} labs · {ctx.counts.notebookCells} notebook cells run</span>
          </span>
        </Link>
        <Link to="/questions?type=interview" className="tile">
          <span className="ic"><Mic2 size={18} /></span>
          <span className="t" style={{ flex: 1, minWidth: 0 }}>
            <b>Interview + HR questions</b>
            <span>{interviewQs === null ? 'bank pending' : `${interviewQs} curated questions`} · every section</span>
          </span>
        </Link>
        <Link to="/playbook" className="tile">
          <span className="ic"><BookMarked size={18} /></span>
          <span className="t" style={{ flex: 1, minWidth: 0 }}>
            <b>Practice Archive</b>
            <span>{ctx.playbook ? `${ctx.playbook.methodAnswers} method answers` : '…'} · answer templates</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
