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
import { LEVEL_KEY, courseHours, sectionAvg, activeCourse } from '../../core/learning/courses';
import {
  ALL_PLACEMENTS, nextCourse, placementOf, sortByCourseOrder, withoutHidden,
} from '../../core/learning/course-levels';
import type { CourseCard } from '../../core/learning/courses';
import { useCIndex } from '../../core/data/ccourse';
import { useNumpyCourse } from '../../core/data/ncourse';
import { usePandasCourse } from '../../core/data/pcourse';
import { useCppCourse } from '../../core/data/cppcourse';
import { useHtmlCourse } from '../../core/data/htmlcourse';
import { useCssCourse } from '../../core/data/csscourse';
import { CLogo } from '../c-programming/CLogo';
import { JLogo } from '../java-programming/JLogo';
import { NLogo } from '../numpy-mastery/NLogo';
import { PLogo } from '../pandas-mastery/PLogo';
import { CppLogo } from '../cpp-mastery/CppLogo';
import { HtmlLogo } from '../html-mastery/HtmlLogo';
import { CssLogo } from '../css-mastery/CssLogo';

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
 * C Programming and Java Programming are their own course pages, not catalog records. Both are
 * drawn with the same card design: C from the registry's third position, Java as the language
 * course beside it, each reading its own module progress.
 */
export default function CoursesHome() {
  const { t } = useI18n();
  const index = useCourseIndex();
  const cIndex = useCIndex();
  const nCourse = useNumpyCourse();
  const pCourse = usePandasCourse();
  const cppCourse = useCppCourse();
  const htmlCourse = useHtmlCourse();
  const cssCourse = useCssCourse();
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
  /**
   * The course the learner is ACTUALLY in beats catalog order — the same `activeCourse` rule the
   * Dashboard's continue card uses, so the two surfaces cannot send a learner to different courses.
   * `nextCourse` stays the fallback for a learner who has not started anything yet.
   */
  const started = activeCourse(visible, pctOf);
  const continueCourse = started ?? next;
  const continuePct = continueCourse ? pctFor(continueCourse) : null;

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
    // A card is a chooser, not the course page: two names keep the line readable inside a narrow
    // column, and the course page still prints the whole list. `+N` is language-neutral, and the
    // full clause rides in `title` so nothing is actually unreachable.
    const shownNeeds = needs.slice(0, 2);
    const extraNeeds = needs.length - shownNeeds.length;
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
          <span>{courseHours(card.meta.minutes)}h</span>
          {!!needs.length && (
            <span className="cc-needs" title={`${t('courses.needs')}: ${needs.join(', ')}`}>
              {t('courses.needs')}: {shownNeeds.join(', ')}
              {extraNeeds > 0 && <span className="cc-more"> +{extraNeeds}</span>}
            </span>
          )}
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

  /**
   * NumPy Mastery is its own course page like C and Java: a real card in the same grid, drawn with
   * its own mark, and present only once its published artifact has loaded.
   */
  /**
   * Pandas Mastery is its own course page like NumPy: a real card in the same grid, its own panda
   * mark, and present only once its published artifact has loaded.
   */
  const renderP = () => {
    if (!pCourse) return null;
    return (
      <Link
        to="/pandas"
        className="course-card cc-simple tone-green"
        data-agent-action="course:pandas-mastery"
        data-agent-label="Pandas Mastery"
        title="Pandas Mastery"
      >
        <span className="cc-logo"><PLogo size={88} /></span>
        <b className="cc-name">Pandas Mastery</b>
      </Link>
    );
  };

  /**
   * C++ Mastery is its own course page like NumPy and Pandas: a real card in the same grid, its own
   * mark, and present only once its published artifact has loaded.
   */
  /**
   * HTML Mastery is the frontend sequence's FIRST course: it renders before the catalog's CSS and
   * JavaScript cards, so a beginner meets structure before styling or behaviour.
   */
  const renderHtml = () => {
    if (!htmlCourse) return null;
    return (
      <Link
        to="/html"
        className="course-card cc-simple tone-orange"
        data-agent-action="course:html-mastery"
        data-agent-label="HTML Mastery"
        title="HTML Mastery"
      >
        <span className="cc-logo"><HtmlLogo size={88} /></span>
        <b className="cc-name">HTML Mastery</b>
      </Link>
    );
  };

  /**
   * CSS Mastery follows HTML: a learner styles what they already know how to structure.
   */
  const renderCss = () => {
    if (!cssCourse) return null;
    return (
      <Link
        to="/css"
        className="course-card cc-simple tone-blue"
        data-agent-action="course:css-mastery"
        data-agent-label="CSS Mastery"
        title="CSS Mastery"
      >
        <span className="cc-logo"><CssLogo size={88} /></span>
        <b className="cc-name">CSS Mastery</b>
      </Link>
    );
  };

  const renderCpp = () => {
    if (!cppCourse) return null;
    return (
      <Link
        to="/cpp"
        className="course-card cc-simple tone-blue"
        data-agent-action="course:cpp-mastery"
        data-agent-label="C++ Mastery"
        title="C++ Mastery"
      >
        <span className="cc-logo"><CppLogo size={88} /></span>
        <b className="cc-name">C++ Mastery</b>
      </Link>
    );
  };

  const renderN = () => {
    if (!nCourse) return null;
    return (
      <Link
        to="/numpy"
        className="course-card cc-simple tone-blue"
        data-agent-action="course:numpy-mastery"
        data-agent-label="NumPy Mastery"
        title="NumPy Mastery"
      >
        <span className="cc-logo"><NLogo size={88} /></span>
        <b className="cc-name">NumPy Mastery</b>
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
              {/* Java is a real card in the grid below, so it is counted here too — the header may
                  never say 12 while 13 cards are on screen. */}
              <span className="chip">{visible.length + (cHidden ? 0 : 1) + 1 + (nCourse ? 1 : 0) + (pCourse ? 1 : 0) + (cppCourse ? 1 : 0) + (htmlCourse ? 1 : 0) + (cssCourse ? 1 : 0) + ownerVisible.length} {t('courses.coursesUnit')}</span>
              <span className="chip">{steps} {t('courses.stepsUnit')}</span>
              <span className="chip">{index.totals.items} {t('courses.itemsUnit')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Continue: the course the learner is in, else the first one on the critical path. */}
      {index && continueCourse && (
        <Link
          to={`/course/${continueCourse.slug}`}
          className="continue-card"
          data-agent-action={`continue:${continueCourse.slug}`}
        >
          <span className="continue-ic"><Play size={16} /></span>
          <span style={{ minWidth: 0 }}>
            <b>{started ? t('courses.continueTitle') : t('courses.startTitle')}</b>
            <span className="small muted" style={{ display: 'block' }}>
              {continueCourse.name}
              {continuePct !== null ? ` · ${t('courses.pctComplete', { n: continuePct })}` : ''}
            </span>
          </span>
          <span className="continue-go"><Route size={15} /> {t('courses.open')} <ChevronRight size={14} /></span>
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
          {renderHtml()}
          {renderCss()}
          {renderN()}
          {renderP()}
          {renderCpp()}
          <Link
            to="/java"
            className="course-card cc-simple tone-amber"
            data-agent-action="course:java-programming"
            data-agent-label="Java Programming"
            title="Java Programming"
          >
            <span className="cc-logo"><JLogo size={88} /></span>
            <b className="cc-name">Java Programming</b>
          </Link>
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
