import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Briefcase, CircleHelp, FileText, ListChecks, ShieldCheck, Target, X,
} from 'lucide-react';
import { TRACK_DEFS } from '../../app/App';
import { useI18n } from '../../app/i18n';
import type { LocaleKey } from '../../app/i18n/locales';
import { useCurriculum } from '../../core/data/curriculum';
import { usePathCtx } from '../../core/data/paths';
import { useStore } from '../../core/storage/store';
import { stageAttempt } from '../../core/platform/keys';
import { sectionProgress } from '../../core/learning/progress';
import { bestRole, roleSkills, trackMastery } from '../../core/learning/career';
import { careerWorkspace } from '../../core/learning/career-workspace';
import { RESUME_ANSWER_TOTAL } from '../../core/assessment/defense';
import { Bar, ProgressRing } from '../../components/ui/ui';

/**
 * /career/workspace — the CV view of the Career pillar.
 *
 * `/career` answers "am I job-ready?" across the whole flow and `/job-prep` renders the checklist;
 * this page answers the narrower, more actionable question a learner asks the week they start
 * applying: how complete is my resume material, which ATS-style checks does it fail, and what is the
 * very next tick?
 *
 * Every figure comes from `careerWorkspace()` in `core/learning/career-workspace.ts`, which is pure
 * and tested. The page only decides where each input comes from: pitch answers and checklist ticks
 * from the store, build/defense gates from the path context (the same records Project Lab and Career
 * read), and role skills from the track registry measured against real section mastery. No number is
 * computed here, and nothing is fetched.
 */
export default function CareerWorkspace() {
  const { t } = useI18n();
  const { sections } = useCurriculum();
  const state = useStore();
  const ctx = usePathCtx();

  /** Per-section mastery — the same figure the lesson tiles, Progress and Career print. */
  const mastery = useMemo(
    () => sections.map((s) => ({ id: s.id, no: s.no, masterPct: sectionProgress(s, state).masterPct })),
    [sections, state],
  );

  /** Skills are the track registry measured against that mastery; roles are authored choices. */
  const role = useMemo(() => {
    const defs = TRACK_DEFS.map((d) => ({ id: d.id, label: t(d.nameKey as LocaleKey), from: d.from, to: d.to }));
    const skills = trackMastery(mastery, defs);
    return roleSkills(bestRole(skills), skills);
  }, [mastery, t]);

  /**
   * Builds, with a denominator that exists: sections that actually author a mini project, and
   * sections that actually author a Project Lab build. A section with no build is not a gap.
   */
  const builds = useMemo(() => {
    const minis = sections.filter((s) => s.mini?.what);
    const labs = sections.filter((s) => s.projectLab.length > 0);
    return {
      done: minis.filter((s) => !!state.attempts[stageAttempt(s.id, 'mini')]).length
        + labs.filter((s) => !!state.attempts[stageAttempt(s.id, 'project')]).length,
      total: minis.length + labs.length,
    };
  }, [sections, state.attempts]);

  const space = useMemo(() => careerWorkspace({
    answers: state.defenseAnswers,
    checklist: state.jobPrep,
    builds,
    defenses: { done: ctx.defenseGates, total: sections.length },
    role: role.role.label,
    skills: role.skills,
    answerTotal: RESUME_ANSWER_TOTAL,
  }), [state.defenseAnswers, state.jobPrep, builds, ctx.defenseGates, sections.length, role]);

  return (
    <div>
      {/* ---------------------------- hero: the CV view ---------------------------- */}
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}><Briefcase size={12} /> CAREER WORKSPACE</div>
            <h1 style={{ margin: 0 }}>Your resume, checked before a recruiter sees it.</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 640 }}>
              Resume readiness, local ATS checks and the next job-prep tick — in one place. Every figure
              comes from records you already have: your pitch answers, builds, defenses and checklist.
            </p>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <span className="chip"><Target size={12} /> Target role: {role.role.label}</span>
              <span className="chip"><ShieldCheck size={12} /> {space.ats.score === null ? 'ATS checks not measured yet' : `${space.ats.score}% local ATS checks`}</span>
              <span className="chip"><ListChecks size={12} /> {space.next.remaining} checklist items open</span>
            </div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <ProgressRing pct={space.resume.pct} size={76} label="Resume readiness" />
            <div className="small muted" style={{ maxWidth: 200 }}>
              <div><b>{space.resume.done}</b> / {space.resume.total} resume records</div>
              <div>Across pitches, builds, defenses and profile</div>
              <Link className="btn small" to="/career" style={{ marginTop: 8 }}>
                Full career view <ArrowRight size={12} />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* --------------------------- resume readiness --------------------------- */}
      <div className="sec-head"><h2><FileText size={16} color="var(--cyan)" /> Resume readiness</h2><span className="line" /></div>
      <div className="card fadeup">
        {space.cold ? (
          <p className="small muted" style={{ margin: 0 }}>
            No resume record yet. Write your first pitch answer in the Project Defense lab, and this
            page will start measuring instead of showing zeros.
          </p>
        ) : (
          space.resume.parts.map((part) => (
            <div key={part.id} className="cw-part">
              <div className="row spread small">
                <span>{part.label}</span>
                <span className="muted">{part.done} / {part.total} · {part.pct}%</span>
              </div>
              <Bar pct={part.pct} />
              {part.done < part.total && (
                <Link className="cw-fix" to={part.to}>Fix this <ArrowRight size={11} /></Link>
              )}
            </div>
          ))
        )}
      </div>

      {/* ------------------------------ ATS checks ------------------------------ */}
      <div className="sec-head"><h2><ShieldCheck size={16} color="var(--green)" /> Local ATS checks</h2><span className="line" /></div>
      <div className="card fadeup">
        <p className="small muted" style={{ marginTop: 0 }}>
          These checks run on the answers stored on this device — not a job-board scanner, and no resume
          file is uploaded. A check with no denominator says so and is left out of the score.
        </p>
        <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <b style={{ fontSize: '1.1rem' }}>
            {space.ats.score === null ? 'Not measured yet' : `${space.ats.score}%`}
          </b>
          <span className="small muted">
            {space.ats.score === null
              ? 'Write a pitch answer or ship a build to create a denominator.'
              : `${space.ats.passed} of ${space.ats.measurable} measured checks pass`}
          </span>
        </div>
        {space.ats.checks.map((check) => (
          <div key={check.id} className="cw-check">
            <span className={`cw-mark ${check.pass === null ? 'idle' : check.pass ? 'pass' : 'fail'}`}>
              {check.pass === null ? <CircleHelp size={12} /> : check.pass ? <BadgeCheck size={12} /> : <X size={12} />}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <b className="small">{check.label}</b>
              <div className="small muted">{check.detail}</div>
            </div>
            {check.pass === false && (
              <Link className="cw-fix" to={check.to}>Fix <ArrowRight size={11} /></Link>
            )}
          </div>
        ))}
        {space.ats.missing.length > 0 && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            Fix first: <b>{space.ats.missing[0].label}</b> — {space.ats.missing[0].detail}.
          </p>
        )}
      </div>

      {/* -------------------------- next job-prep action -------------------------- */}
      <div className="sec-head"><h2><ListChecks size={16} color="var(--amber)" /> Next job-prep action</h2><span className="line" /></div>
      <div className="card fadeup">
        {space.next.item ? (
          <div className="row spread" style={{ gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 240, flex: 1 }}>
              <b style={{ fontSize: '1.02rem' }}>{space.next.item.label}</b>
              <p className="muted small" style={{ margin: '4px 0 8px' }}>{space.next.item.hint}</p>
              <Link className="btn small primary" to={space.next.item.to}>
                Do it now <ArrowRight size={13} />
              </Link>
              <Link className="btn small" to="/job-prep" style={{ marginLeft: 6 }}>
                All job prep
              </Link>
            </div>
            <span className="chip">{space.next.remaining} left</span>
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            Every job-prep item is ticked. Keep the portfolio deployed and practise the defense —{' '}
            <Link to="/defense">open the Project Defense lab</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
