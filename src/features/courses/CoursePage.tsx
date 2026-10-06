import { Link, useParams } from 'react-router-dom';
import { ChevronRight, Play, Target } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { ProgressRing } from '../../components/ui/ui';
import { useCourse, useCourseIndex, useCourseMeasures } from '../../core/data/courses';
import { courseProgressFrom, nextStep, sectionsOfStep, stepsOf } from '../../core/learning/courses';
import { STEPS, phaseOf } from '../../core/learning/roadmap';
import type { LocaleKey } from '../../app/i18n/locales';

/**
 * /course/:slug — one course, line by line.
 *
 * Only THIS course's steps appear (the plan's rule: no other course's practice, interview or
 * resume content here), each with its stage tag, its real measure and its topics. The measure is
 * computed by `useCourseMeasures`: a section-backed step reports its sections' mastery, a step
 * with no sections reports its items' coverage, and a reading-only step reports nothing rather
 * than a 0%. "Continue" goes to the first step that still has a denominator and is not clear.
 */
export default function CoursePage() {
  const { slug = '' } = useParams();
  const { t } = useI18n();
  const index = useCourseIndex();
  const course = useCourse(slug);
  const measures = useCourseMeasures(course);

  const knownSlug = index ? index.courses.some((c) => c.slug === slug) : true;
  if (!knownSlug) {
    return (
      <div className="card glow fadeup">
        <h2 className="h1-look" style={{ marginTop: 0 }}>{t('courses.notFound')}</h2>
        <p className="muted small">{t('courses.notFoundSub')}</p>
        <Link className="btn small primary" to="/courses">{t('courses.backToCourses')}</Link>
      </div>
    );
  }

  if (!course) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 96 }} />
        <div className="skeleton" style={{ height: 260, marginTop: 12 }} />
      </div>
    );
  }

  const steps = stepsOf(course);
  const progress = courseProgressFrom(measures);
  const target = nextStep(course, measures);

  return (
    <div>
      <div className="course-head card glow fadeup tone-cyan">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14, minWidth: 280 }}>
            <CourseLogo logo={course.logo} name={course.name} size={64} />
            <div>
              <div className="chip" style={{ marginBottom: 6 }}>{t('courses.courseChip')}</div>
              <h1 style={{ margin: 0 }}>{course.name}</h1>
              <div className="row small muted" style={{ gap: 8, marginTop: 6 }}>
                <span>{course.steps.length} {t('courses.stepsUnit')}</span>
                <span>·</span>
                <span>{course.counts.total} {t('courses.itemsUnit')}</span>
                {!!Object.keys(course.sections).length && (
                  <>
                    <span>·</span>
                    <span>{Object.keys(course.sections).length} {t('courses.sectionsUnit')}</span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="row" style={{ gap: 12, alignItems: 'center' }}>
            {progress.pct !== null && (
              <ProgressRing pct={progress.pct} size={64} label={`${t('courses.progress')} — ${progress.pct}%`} />
            )}
            <div className="small muted" style={{ lineHeight: 1.7 }}>
              <div><b>{progress.steps.clear}</b> / {progress.steps.total} {t('courses.stepsClear')}</div>
              <div><b>{progress.items.touched}</b> / {progress.items.total} {t('courses.itemsStarted')}</div>
            </div>
            <Link className="btn primary small" to={`/course/${course.slug}/${target}?tab=lesson`}>
              <Play size={13} /> {t('courses.continue')}
            </Link>
          </div>
        </div>
      </div>

      <div className="sec-head"><h2><Target size={16} color="var(--accent)" /> {t('courses.stepsIndex')}</h2><span className="line" /></div>

      <div className="course-steps">
        {steps.map((no) => {
          const meta = STEPS.find((s) => s.no === no);
          const m = measures.get(no);
          const phase = phaseOf(no);
          const own = sectionsOfStep(course, no);
          return (
            <Link
              key={no}
              to={`/course/${course.slug}/${no}?tab=lesson`}
              className={`course-step tone-${phase.tone} ${m?.status ?? ''}`}
              title={meta?.goal}
            >
              <span className="cs-no">{String(no).padStart(2, '0')}</span>
              <span className="cs-main">
                <b>{meta?.title ?? `${t('courses.step')} ${no}`}</b>
                {!!meta?.topics.length && <span className="small muted">{meta.topics.slice(0, 3).join(' · ')}</span>}
              </span>
              <span className="cs-tag chip">{t(phase.key as LocaleKey)}</span>
              <span className="cs-status">
                {m && m.pct !== null ? (
                  <>
                    <ProgressRing pct={m.pct} size={34} />
                    <span className="small muted">{m.pct}%</span>
                  </>
                ) : (
                  <span className="small muted">{t('courses.readingStep')}</span>
                )}
              </span>
              <span className={`chip cs-state ${m?.status ?? 'new'}`}>
                {t(`courses.status.${m?.status ?? 'new'}` as LocaleKey)}
              </span>
              <ChevronRight size={15} className="muted" />
            </Link>
          );
        })}
      </div>

      <p className="small muted" style={{ marginTop: 12 }}>{t('courses.measureNote')}</p>
    </div>
  );
}
