import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Compass, Play, Target } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { ProgressRing } from '../../components/ui/ui';
import { useCourseIndex, useSectionPct } from '../../core/data/courses';
import { useCurriculum } from '../../core/data/curriculum';
import { LEVEL_KEY } from '../../core/learning/courses';
import { workspaceTarget } from '../../core/learning/workspace';
import { STEPS } from '../../core/learning/roadmap';
import { isMastered } from '../../core/learning/progress';
import { studyStreak } from '../../core/learning/study';
import { today, useStore } from '../../core/storage/store';

/**
 * /workspace — the screen a learner opens when they are not sure where they are.
 *
 * It answers exactly three questions: which course am I in, how far have I got, and what do I open
 * next. The dashboard owns the overall picture and /progress owns the analytics; this page is the
 * focused one, so it deliberately does not repeat their charts.
 *
 * Every figure is a real record:
 *   · the course comes from `workspaceTarget` (activeCourse → first course for a fresh learner),
 *   · mastery is section mastery, the same measure every other courses surface prints,
 *   · the step is `nextStep` over CARD-ONLY measures — no course file is fetched here (python.json
 *     alone is 1.5 MB). When the card cannot prove a step, the copy says so and links the course.
 */
export default function Workspace() {
  const { t } = useI18n();
  const index = useCourseIndex();
  const pctOf = useSectionPct();
  const { sections } = useCurriculum();
  const state = useStore();

  /** Stable identity for the memo: `index?.courses ?? []` is a new array on every render. */
  const cards = useMemo(() => index?.courses ?? [], [index]);
  const target = useMemo(() => workspaceTarget(cards, pctOf), [cards, pctOf]);
  const card = target.card;

  /** Courses named by the prerequisites, so the card prints names instead of slugs. */
  const nameOf = useMemo(() => new Map(cards.map((c) => [c.slug, c.name] as const)), [cards]);
  const needs = card ? card.meta.prerequisites.map((slug) => nameOf.get(slug) ?? slug) : [];
  const hours = card ? Math.max(1, Math.round(card.meta.minutes / 60)) : 0;

  const mastered = sections.filter((s) => isMastered(s, state)).length;
  const streak = studyStreak(state.study ?? {}, today());

  const step = card ? STEPS.find((s) => s.no === target.step) ?? null : null;
  const stepHref = card ? `/course/${card.slug}/${target.step}?tab=lesson` : '/courses';

  return (
    <div>
      <div className="card glow fadeup">
        <div className="chip" style={{ marginBottom: 6 }}>
          <Compass size={12} /> {t('workspace.chip')}
        </div>
        <h1 style={{ margin: 0 }}>{t('workspace.title')}</h1>
        <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 720 }}>{t('workspace.subtitle')}</p>
        {index && (
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            <span className="chip">{mastered}/{sections.length} {t('workspace.sectionsMastered')}</span>
            <span className="chip">{state.xp} XP</span>
            <span className="chip">{streak} {t('workspace.dayStreak')}</span>
          </div>
        )}
      </div>

      {!index && <div className="skeleton" style={{ height: 180, marginTop: 12 }} />}

      {index && !card && <p className="muted small">{t('workspace.empty')}</p>}

      {card && (
        <div className="ws-grid">
          {/* Which course, and how far into it. */}
          <div className={`card ws-course tone-${card.tone}`}>
            <div className="row spread" style={{ alignItems: 'flex-start', gap: 10 }}>
              <span className="row" style={{ gap: 10, minWidth: 0 }}>
                <CourseLogo logo={card.logo} name={card.name} size={44} />
                <span style={{ minWidth: 0 }}>
                  <span className="small muted">
                    {target.started ? t('workspace.currentCourse') : t('workspace.startHere')}
                  </span>
                  <h2 style={{ margin: '2px 0 0' }}>{card.name}</h2>
                </span>
              </span>
              {target.pct !== null && (
                <ProgressRing pct={target.pct} size={54} label={`${t('workspace.progress')} — ${target.pct}%`} />
              )}
            </div>

            <div className="row small muted ws-facts" style={{ gap: 6, flexWrap: 'wrap' }}>
              <span className="cc-level">{t(LEVEL_KEY[card.meta.level])}</span>
              <span>{hours}h</span>
              {target.stepsTotal > 0 && (
                <span>{target.stepsClear}/{target.stepsTotal} {t('workspace.stepsClear')}</span>
              )}
              {target.sectionsTotal > 0 && (
                <span>{target.sectionsCleared}/{target.sectionsTotal} {t('courses.sectionsUnit')}</span>
              )}
            </div>

            {!!needs.length && (
              <p className="small muted ws-needs">{t('courses.needs')}: {needs.join(', ')}</p>
            )}

            <Link className="btn small" to={`/course/${card.slug}`} style={{ marginTop: 10, alignSelf: 'flex-start' }}>
              {t('workspace.openCourse')} <ChevronRight size={13} />
            </Link>
          </div>

          {/* The one thing to open next. */}
          <div className="card ws-next">
            <div className="chip" style={{ marginBottom: 6, alignSelf: 'flex-start' }}>
              <Target size={12} /> {t('workspace.nextStep')}
            </div>
            <div className="row" style={{ gap: 12, alignItems: 'center' }}>
              <span className="ws-stepno">{String(target.step).padStart(2, '0')}</span>
              <span style={{ minWidth: 0 }}>
                <b>{step?.title ?? `${t('courses.step')} ${target.step}`}</b>
                {step?.goal && (
                  <span className="small muted" style={{ display: 'block' }}>{step.goal}</span>
                )}
              </span>
            </div>
            {!!step?.topics.length && (
              <p className="small muted" style={{ margin: 0 }}>{step.topics.slice(0, 4).join(' · ')}</p>
            )}
            <p className="small muted" style={{ margin: 0 }}>
              {target.certain ? t('workspace.nextHint') : t('workspace.noMeasure')}
            </p>
            <Link
              className="btn small primary ws-go"
              to={stepHref}
              data-agent-action={`workspace:continue:${card.slug}`}
              data-agent-label={t('workspace.nextStep')}
            >
              <Play size={13} /> {target.certain ? t('courses.continue') : t('workspace.openCourse')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
