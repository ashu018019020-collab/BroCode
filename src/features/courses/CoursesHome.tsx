import { Link } from 'react-router-dom';
import { ChevronRight, GraduationCap, Play, Route } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { useCourseIndex, useSectionPct } from '../../core/data/courses';
import { useCoursePlacements } from '../../core/data/course-placement';
import { useOwnerCourses } from '../../core/data/owner-courses';
import {
  ownerCourseCards, ownerCoursePlacements, visibleOwnerCards, type OwnerCourseCard,
} from '../../core/learning/owner-courses';
import { LEVEL_KEY, sectionAvg } from '../../core/learning/courses';
import {
  ALL_PLACEMENTS, nextCourse, placementOf, sortByCourseOrder, withoutHidden,
} from '../../core/learning/course-levels';
import type { CourseCard } from '../../core/learning/courses';
import { useCIndex } from '../../core/data/ccourse';
import { CLogo } from '../c-programming/CLogo';

/**
 * /courses — ONE grid of course cards, in the learning sequence.
 *
 * The order is NOT the catalog's authoring order and NOT alphabetical: `core/learning/course-levels.ts`
 * owns the sequence and this page renders it as a single flat grid — no level containers, no
 * section wrappers, nothing between the cards. Moving a course changes its position and nothing
 * else, because the card markup, the grid and the header are untouched by ordering.
 * A card's ring is the mastery of its curriculum sections, the same measure the course page prints;
 * a course with no sections (Data Engineering) shows its real counts instead of an invented
 * percentage.
 *
 * C Programming is the twelfth card: it is its own course page, not a catalog record, so it is
 * drawn from the same registry (third position) and reads its own module progress.
 */
/** Study time reads in hours on a card — `minutes` is exact, a card needs it scannable. */
const hoursOf = (minutes: number) => `${Math.max(1, Math.round(minutes / 60))}h`;

export default function CoursesHome() {
  const { t } = useI18n();
  const index = useCourseIndex();
  const cIndex = useCIndex();
  const pctOf = useSectionPct();
  /** Owner overrides when the database has them; the code-authored journey otherwise. */
  const { placements } = useCoursePlacements();
  /** The owner's OWN cards, plus their placements, so both kinds share one journey order. */
  const { rows: ownerRows } = useOwnerCourses();
  const ownerCards = ownerCourseCards(ownerRows);
  const ownerPlacements = ownerCoursePlacements(ownerCards);
  const ownerVisible = visibleOwnerCards(ownerCards);
  const journey = [...placements, ...ownerPlacements];
  const ownerBySlug = new Map(ownerCards.map((card) => [card.slug, card] as const));
  const courses = index?.courses ?? [];
  const steps = courses.reduce((a, c) => a + (c.steps?.length ?? 0), 0);
  /**
   * The journey the owner has published: a course they stood down leaves the page, but its course
   * page, route and the learner's stored progress are untouched. The header totals stay catalog
   * totals, because the pack itself did not change.
   */
  const visible = withoutHidden(courses, placements);
  const cHidden = Boolean(placementOf('c-programming', placements)?.hidden);

  /** Section mastery, used only to pick the next course the Continue strip offers. */
  const pctFor = (card: CourseCard) => sectionAvg(card, pctOf);

  const next = nextCourse(visible, pctFor, placements);
  const nextPct = next ? pctFor(next) : null;

  /**
   * The grid's sequence, from the ONE ordering registry. Cards are looked up by slug, so a course
   * is never re-created or re-fetched to move it; a course the pack publishes but the registry has
   * not placed yet still renders (at the end) rather than disappearing.
   */
  const sequence = sortByCourseOrder(
    withoutHidden([...ALL_PLACEMENTS, ...ownerPlacements], journey), journey);
  const bySlug = new Map(visible.map((card) => [card.slug, card] as const));
  /** Course names by slug, so a card can name the course it needs instead of printing a slug. */
  const nameBySlug = new Map(courses.map((card) => [card.slug, card.name] as const));
  const placed = new Set(sequence.map((p) => p.slug));
  const unplaced = visible.filter((card) => !placed.has(card.slug));

  /**
   * One card: the course's mark, its name, and — by explicit request — one line of plan metadata:
   * level, estimated time, and the courses you should have finished first.
   *
   * Step/item counts, descriptions and the progress ring stay OFF the card: the grid is a chooser,
   * and the course page is where the counts and progress live. The metadata is one compact line so
   * the mark is still what the card is read by, and a course with no prerequisites prints no
   * "Needs" clause at all rather than an empty one.
   */
  const renderCard = (card: CourseCard) => {
    const needs = card.meta.prerequisites.map((slug) => nameBySlug.get(slug) ?? slug);
    return (
      <Link
        key={card.slug}
        to={`/course/${card.slug}`}
        className={`course-card cc-simple tone-${card.tone}`}
        data-agent-action={`course:${card.slug}`}
        data-agent-label={card.name}
        title={card.name}
      >
        <span className="cc-logo"><CourseLogo logo={card.logo} name={card.name} size={88} /></span>
        <b className="cc-name">{card.name}</b>
        <span className="cc-meta">
          <span className="cc-level">{t(LEVEL_KEY[card.meta.level])}</span>
          <span>{hoursOf(card.meta.minutes)}</span>
          {!!needs.length && <span className="cc-needs">{t('courses.needs')}: {needs.join(', ')}</span>}
        </span>
      </Link>
    );
  };

  /**
   * An owner-created card. It owns no generated content, so it is a plain link to the internal page
   * the owner chose — the card design is the catalog card's, so a custom course never looks foreign.
   */
  const renderOwnerCard = (card: OwnerCourseCard) => (
    <Link
      key={card.slug}
      to={card.href}
      className={`course-card cc-simple tone-${card.tone}`}
      data-agent-action={`owner-course:${card.slug}`}
      data-agent-label={card.name}
      title={card.summary || card.name}
    >
      <span className="cc-logo"><CourseLogo logo={card.logo} name={card.name} size={88} /></span>
      <b className="cc-name">{card.name}</b>
    </Link>
  );

  const renderC = () => {
    if (!cIndex || cHidden) return null;
    return (
      <Link
        to="/c-programming"
        className="course-card cc-simple tone-cyan"
        data-agent-action="course:c-programming"
        data-agent-label="C Programming"
        title="C Programming"
      >
        <span className="cc-logo"><CLogo size={88} /></span>
        <b className="cc-name">C Programming</b>
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
              <span className="chip">{visible.length + (cHidden ? 0 : 1) + ownerVisible.length} {t('courses.coursesUnit')}</span>
              <span className="chip">{steps} {t('courses.stepsUnit')}</span>
              <span className="chip">{index.totals.items} {t('courses.itemsUnit')}</span>
            </div>
          )}
        </div>
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
              {next.name}
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

      {/* One grid, in the registry's order. The card design, the grid, the header and the
          Continue strip are untouched by ordering — only the cards' positions change. */}
      {index && (
        <div className="course-grid">
          {sequence.map(({ slug }) => {
            if (slug === 'c-programming') return renderC();
            const card = bySlug.get(slug);
            if (card) return renderCard(card);
            const own = ownerBySlug.get(slug);
            return own ? renderOwnerCard(own) : null;
          })}
          {unplaced.map(renderCard)}
        </div>
      )}

      {/* Nothing else belongs on this page: each card opens the course, and the course page owns its
          steps and tabs. `sectionAvg`/`sortByCourseOrder` are the same measures the rest of the app reads. */}
    </div>
  );
}
