import { Link } from 'react-router-dom';
import { ChevronRight, GraduationCap } from 'lucide-react';
import { useI18n } from '../../app/i18n';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { ProgressRing } from '../../components/ui/ui';
import { useCourseIndex, useSectionPct } from '../../core/data/courses';
import { sectionAvg, sectionsClear } from '../../core/learning/courses';

/**
 * /courses — the eleven course cards.
 *
 * A card is the course's real identity: its bundled logo, its name, how many steps and items it
 * owns, and the ring of its curriculum sections' mastery. That ring is the ONLY figure this page
 * can print honestly without fetching the course's item file — python.json alone is 1.5 MB, and a
 * home screen that parses the whole pack to draw eleven rings would make the app heavy for a
 * number nobody reads there. The course's own page (which fetches its file) prints the full
 * step-by-step measures.
 *
 * A course with no curriculum sections (Data Engineering teaches playbook chapters) shows its real
 * counts instead of a ring: no honest denominator, no invented percentage.
 */
export default function CoursesHome() {
  const { t } = useI18n();
  const index = useCourseIndex();
  const pctOf = useSectionPct();
  const courses = index?.courses ?? [];
  const steps = courses.reduce((a, c) => a + (c.steps?.length ?? 0), 0);

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
              <span className="chip">{index.courses.length} {t('courses.coursesUnit')}</span>
              <span className="chip">{steps} {t('courses.stepsUnit')}</span>
              <span className="chip">{index.totals.items} {t('courses.itemsUnit')}</span>
            </div>
          )}
        </div>
      </div>

      {!index && (
        <div className="course-grid" aria-busy="true">
          {Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 168 }} />)}
        </div>
      )}

      {index && (
        <div className="course-grid">
          {courses.map((card) => {
            const pct = sectionAvg(card, pctOf);
            const sectionIds = Object.keys(card.sections ?? {});
            const clear = sectionsClear(card, pctOf);
            return (
              <Link
                key={card.slug}
                to={`/course/${card.slug}`}
                className={`course-card tone-${card.tone}`}
                data-agent-action={`course:${card.slug}`}
                data-agent-label={card.name}
                title={pct !== null
                  ? `${card.name} — ${clear}/${sectionIds.length} ${t('courses.sectionsUnit')}`
                  : card.name}
              >
                <span className="cc-logo"><CourseLogo logo={card.logo} name={card.name} size={56} /></span>
                <b className="cc-name">{card.name}</b>
                <span className="cc-meta small muted">
                  {card.steps.length} {t('courses.stepsUnit')} · {card.counts.total} {t('courses.itemsUnit')}
                </span>
                <span className="cc-foot">
                  {pct !== null ? (
                    <>
                      <ProgressRing pct={pct} size={44} label={`${t('courses.progress')} — ${clear}/${sectionIds.length}`} />
                      <span className="small muted">{clear}/{sectionIds.length} {t('courses.sectionsUnit')}</span>
                    </>
                  ) : (
                    <span className="small muted">{t('courses.noSections')}</span>
                  )}
                  <ChevronRight size={15} className="cc-go" />
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {/* The first page is the eleven cards and nothing else. The support-path band and the practice
          archive's per-track coverage used to sit below them; they were taken off this page, and this
          page mounts neither (their components are kept, not deleted — see the guard in
          `scripts/tests/layout.test.mjs`). What a learner needs under a course is on the course's own
          page: its steps, and the seven tabs of the step they are on. */}
    </div>
  );
}
