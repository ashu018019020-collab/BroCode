import { Link } from 'react-router-dom';
import { ArrowRight, ChevronRight, GraduationCap, Lock, Play, Route } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { ProgressRing } from '../../components/ui/ui';
import { useCourseIndex, useSectionPct } from '../../core/data/courses';
import { useCoursePlacements } from '../../core/data/course-placement';
import { sectionAvg } from '../../core/learning/courses';
import {
  C_COMPLEMENT, COURSE_LEVELS, groupByLevel, levelOf, nextCourse, placementOf, prerequisiteNames,
} from '../../core/learning/course-levels';
import type { CourseCard } from '../../core/learning/courses';
import { useCIndex } from '../../core/data/ccourse';
import { checkpointKey } from '../../core/learning/ccourse';
import { useStore } from '../../core/storage/store';
import { CLogo } from '../c-programming/CLogo';

/**
 * /courses — the learning journey, level by level.
 *
 * The order is NOT the catalog's authoring order and NOT alphabetical: `core/learning/course-levels.ts`
 * owns the sequence (orientation → Python → foundations → pipelines → models → LLMs → agents →
 * shipping → interviews) and this page renders it. A card's ring is the mastery of its curriculum
 * sections, the same measure the course page prints; a course with no sections (Data Engineering)
 * shows its real counts instead of an invented percentage.
 *
 * C Programming is the twelfth card and the only optional one: it is its own course page, not a
 * catalog record, so it is placed from the same registry and reads its own module progress.
 */
export default function CoursesHome() {
  const { t } = useI18n();
  const index = useCourseIndex();
  const cIndex = useCIndex();
  const store = useStore();
  const pctOf = useSectionPct();
  /** Owner overrides when the database has them; the code-authored journey otherwise. */
  const { placements } = useCoursePlacements();
  const courses = index?.courses ?? [];
  const steps = courses.reduce((a, c) => a + (c.steps?.length ?? 0), 0);

  /** Section-mastery ring for a catalog course; null when it has no honest denominator. */
  const pctFor = (card: CourseCard) => sectionAvg(card, pctOf);
  const names: Record<string, string> = Object.fromEntries([
    ...courses.map((c) => [c.slug, c.name] as const),
    ['c-programming', 'C Programming'] as const,
  ]);

  const cTotal = cIndex?.modules.length ?? 0;
  const cDone = (cIndex?.modules ?? []).filter((m) => store.attempts[checkpointKey(m.id)]?.done).length;
  const cPct = cTotal ? Math.round((cDone / cTotal) * 100) : null;
  const cItems = cIndex
    ? cIndex.stats.topics + cIndex.stats.examples + cIndex.stats.practice
      + cIndex.stats.mcqs + cIndex.stats.interview + cIndex.stats.labs + cIndex.stats.projects
    : 0;

  const groups = groupByLevel(courses, placements);
  const next = nextCourse(courses, pctFor, placements);
  const nextPct = next ? pctFor(next) : null;

  /**
   * Aggregate completion of a level, from the same rings the cards draw. Level 02 also carries the
   * optional C course, so its ring and its real module/item counts join that level's average.
   */
  const levelPct = (cards: CourseCard[], withC: boolean): number | null => {
    const values = cards.map(pctFor).filter((v): v is number => v !== null);
    if (withC && cPct !== null) values.push(cPct);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  };

  const renderCard = (card: CourseCard) => {
    const pct = pctFor(card);
    const sectionIds = Object.keys(card.sections ?? {});
    const placement = placementOf(card.slug, placements);
    const level = placement ? levelOf(placement.level) : COURSE_LEVELS[COURSE_LEVELS.length - 1];
    const prereqs = prerequisiteNames(card.slug, names, placements);
    return (
      <Link
        key={card.slug}
        to={`/course/${card.slug}`}
        className={`course-card tone-${card.tone}`}
        data-agent-action={`course:${card.slug}`}
        data-agent-label={card.name}
        title={pct !== null ? `${card.name} — ${pct}% ${t('courses.progress')}` : card.name}
      >
        <span className="cc-top">
          <span className="cc-logo"><CourseLogo logo={card.logo} name={card.name} size={52} /></span>
          <span className="cc-level">LEVEL {String(level.no).padStart(2, '0')} · {level.difficulty}</span>
        </span>
        <b className="cc-name">{card.name}</b>
        <span className="cc-meta small muted">
          {card.steps.length} {t('courses.stepsUnit')} · {card.counts.total} {t('courses.itemsUnit')}
        </span>
        {placement?.blurb && <span className="cc-desc small muted">{placement.blurb}</span>}
        {prereqs.length > 0 && (
          <span className="cc-prereq small">
            <Lock size={11} /> After {prereqs.join(' · ')}
          </span>
        )}
        <span className="cc-foot">
          {pct !== null ? (
            <>
              <ProgressRing pct={pct} size={42} label={`${t('courses.progress')} — ${pct}%`} />
              <span className="small muted">
                {Math.round((pct / 100) * sectionIds.length)}/{sectionIds.length} {t('courses.sectionsUnit')}
              </span>
            </>
          ) : (
            <span className="small muted">{t('courses.noSections')}</span>
          )}
          <ChevronRight size={15} className="cc-go" />
        </span>
      </Link>
    );
  };

  const renderC = () => {
    if (!cIndex) return null;
    return (
      <Link
        to="/c-programming"
        className="course-card tone-cyan"
        data-agent-action="course:c-programming"
        data-agent-label="C Programming"
        title={`C Programming — ${cDone}/${cTotal} modules`}
      >
        <span className="cc-top">
          <span className="cc-logo"><CLogo size={52} /></span>
          <span className="cc-level optional">LEVEL 02 · OPTIONAL</span>
        </span>
        <b className="cc-name">C Programming <span className="cc-opt small">complementary</span></b>
        <span className="cc-meta small muted">{cTotal} modules · {cItems} items</span>
        <span className="cc-desc small muted">{C_COMPLEMENT.blurb}</span>
        <span className="cc-prereq small"><Lock size={11} /> After Python · never blocks the AI path</span>
        <span className="cc-foot">
          {cPct !== null && (
            <>
              <ProgressRing pct={cPct} size={42} label={`Progress — ${cDone}/${cTotal}`} />
              <span className="small muted">{cDone}/{cTotal} modules</span>
            </>
          )}
          <ChevronRight size={15} className="cc-go" />
        </span>
      </Link>
    );
  };

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 260 }}>
            <div className="chip" style={{ marginBottom: 6 }}>
              <GraduationCap size={12} /> {t('courses.chip')}
            </div>
            <h1 style={{ margin: 0 }}>{t('courses.title')}</h1>
            <p className="muted small" style={{ margin: '8px 0 0', maxWidth: 640 }}>{t('courses.subtitle')}</p>
          </div>
          {index && (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="chip">{courses.length + 1} {t('courses.coursesUnit')}</span>
              <span className="chip">{steps} {t('courses.stepsUnit')}</span>
              <span className="chip">{index.totals.items} {t('courses.itemsUnit')}</span>
              <span className="chip">{COURSE_LEVELS.length} levels</span>
            </div>
          )}
        </div>
      </div>

      {/* The journey at a glance: six stages, in the order they are walked. */}
      <div className="journey" aria-label="Learning journey">
        {COURSE_LEVELS.map((level, i) => (
          <span key={level.id} className="journey-node">
            <span className={`journey-num tone-${level.tone}`}>{String(level.no).padStart(2, '0')}</span>
            <span className="journey-name">{level.title}</span>
            {i < COURSE_LEVELS.length - 1 && <ArrowRight size={13} className="journey-arrow" aria-hidden="true" />}
          </span>
        ))}
      </div>

      {/* Continue: the first course on the critical path that is not finished. */}
      {index && next && (
        <Link
          to={`/course/${next.slug}`}
          className="continue-card"
          data-agent-action={`continue:${next.slug}`}
        >
          <span className="continue-ic"><Play size={16} /></span>
          <span style={{ minWidth: 0 }}>
            <b>Continue learning</b>
            <span className="small muted" style={{ display: 'block' }}>
              {next.name} · Level {String(levelOf(placementOf(next.slug, placements)?.level ?? 'beginner').no).padStart(2, '0')}
              {nextPct !== null ? ` · ${nextPct}% complete` : ''}
            </span>
          </span>
          <span className="continue-go"><Route size={15} /> Open <ChevronRight size={14} /></span>
        </Link>
      )}

      {!index && (
        <div className="course-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 200 }} />)}
        </div>
      )}

      {index && (
        <div className="level-stack">
          {groups.map(({ level, cards }) => {
            const withC = level.id === 'foundations' && Boolean(cIndex);
            const pct = levelPct(cards, withC);
            const levelSteps = cards.reduce((a, c) => a + c.steps.length, 0) + (withC ? cTotal : 0);
            const levelItems = cards.reduce((a, c) => a + c.counts.total, 0) + (withC ? cItems : 0);
            const done = cards.filter((c) => pctFor(c) === 100).length + (withC && cPct === 100 ? 1 : 0);
            const total = cards.length + (withC ? 1 : 0);
            const complete = total > 0 && done === total;
            return (
              <section key={level.id} className={`level-block tone-${level.tone}`}>
                <div className="level-head">
                  <span className="level-no">LEVEL {String(level.no).padStart(2, '0')}</span>
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <h2 style={{ margin: 0 }}>{level.title}</h2>
                    <span className="small muted">{level.blurb}</span>
                  </div>
                  <div className="level-stats small">
                    <span>{total} courses</span>
                    <span>{levelSteps} steps</span>
                    <span>{levelItems} items</span>
                    {pct !== null && (
                      <span className={`level-pct${complete ? ' done' : ''}`}>
                        {complete ? 'Level complete ✓' : `${pct}% complete`}
                      </span>
                    )}
                  </div>
                  {pct !== null && (
                    <span className="level-bar" role="img" aria-label={`${level.title} ${pct}% complete`}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                  )}
                </div>
                <div className="course-grid">
                  {level.id === 'foundations' && renderC()}
                  {cards.map(renderCard)}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {/* Nothing else belongs on this page: each card opens the course, and the course page owns its
          steps and tabs. `sectionAvg`/`groupByLevel` are the same measures the rest of the app reads. */}
    </div>
  );
}
