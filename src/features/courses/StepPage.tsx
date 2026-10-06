import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  BookOpen, ChevronLeft, ChevronRight, FileText, FlaskConical, Layers, ListChecks,
  Mic2, NotebookPen, Shield, Target, Timer, Bot,
} from 'lucide-react';
import { useI18n } from '../../app/i18n';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { ProgressRing } from '../../components/ui/ui';
import { useCurriculum } from '../../core/data/curriculum';
import { useCourse, useCourseIndex, useCourseMeasures } from '../../core/data/courses';
import { useNotebooks } from '../../core/data/notebooks';
import { notebookCellsRunFor } from '../../core/learning/coverage';
import { newNote, upsertNote, useStore } from '../../core/storage/store';
import {
  COURSE_TABS, TAB_KEY, hasStep, isCourseTab, itemsOfStep, sectionsOfStep, stepsOf, tabCounts, tabItems,
  type CourseItem, type CourseTab, type PdfSource, pdfPages, pdfSourceOf,
} from '../../core/learning/courses';
import { STEPS, phaseOf } from '../../core/learning/roadmap';
import { NAV } from '../../app/App';
import type { LocaleKey } from '../../app/i18n/locales';

/** Items grouped by subtype (interview/defense/mock/intensive, theory/coding/…), biggest first. */
function bySubtype(items: CourseItem[]): { key: string; items: CourseItem[] }[] {
  const map = new Map<string, CourseItem[]>();
  for (const item of items) {
    const key = item.subtype ?? 'all';
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key, list]) => ({ key, items: list }));
}

/** Tabs whose counters mean something a learner can act on; PDF/Notes counts do not. */
const TAB_COUNTED = new Set<CourseTab>(['lesson', 'practice', 'questions', 'interview', 'lab']);

/** Locale labels for the subtypes the pack emits; an unknown subtype prints as-is. */
const SUBTYPE_KEY: Record<string, LocaleKey> = {
  theory: 'courses.qtype.theory',
  coding: 'courses.qtype.coding',
  logic: 'courses.qtype.logic',
  debug: 'courses.qtype.debug',
  solved: 'courses.qtype.solved',
  checkpoint: 'courses.qtype.checkpoint',
  interview: 'courses.itype.interview',
  defense: 'courses.itype.defense',
  mock: 'courses.itype.mock',
  intensive: 'courses.itype.intensive',
};

/** Distinct PDF pages of one book, with how many of the step's items point at each. */
function pageRows(items: CourseItem[], source: PdfSource): [number, number][] {
  const map = new Map<number, number>();
  for (const item of items) {
    if (pdfSourceOf(item) !== source) continue;
    const page = item.pdf_page as number;
    map.set(page, (map.get(page) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * /course/:slug/:step — one step of one course, seven tabs deep.
 *
 * The tab is a real URL (`?tab=practice`), so a step can be shared, bookmarked and opened by the
 * back button. Every tab is a FILTER over the course's own tagged items — nothing is copied into
 * this page: the Lesson tab links to the section lessons, Practice and Questions link to the
 * surfaces that own those items, Lab lists only shortcuts, PDF opens the right book at the right
 * page, and Notes reads the learner's own note store. The footer states the step's exit condition
 * ("Step clear jab: …") and moves to the previous or next step of the SAME course.
 */
export default function StepPage() {
  const { slug = '', step = '' } = useParams();
  const no = Number(step);
  const { t } = useI18n();
  const nav = useNavigate();
  const state = useStore();
  const { sections } = useCurriculum();
  const index = useCourseIndex();
  const course = useCourse(slug);
  const measures = useCourseMeasures(course);
  const notebooks = useNotebooks();
  const [params] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: CourseTab = isCourseTab(rawTab) ? rawTab : 'lesson';

  const validStep = Number.isInteger(no) && no >= 1 && no <= STEPS.length;
  const knownSlug = index ? index.courses.some((c) => c.slug === slug) : true;

  /** One card for either wrong URL: the real reason, and the two sensible ways out. */
  const notFoundCard = (title: string, sub: string, courseHref?: string) => (
    <div className="card glow fadeup">
      <h2 className="h1-look" style={{ marginTop: 0 }}>{title}</h2>
      <p className="muted small">{sub}</p>
      <div className="row" style={{ gap: 8 }}>
        {courseHref && <Link className="btn small primary" to={courseHref}>{t('courses.openCourse')}</Link>}
        <Link className={`btn small${courseHref ? '' : ' primary'}`} to="/courses">{t('courses.backToCourses')}</Link>
      </div>
    </div>
  );

  if (!knownSlug) return notFoundCard(t('courses.notFound'), t('courses.notFoundSub'));

  // A step number is checked twice: 1…36 first (a number no course owns), then against THIS
  // course's own steps — the second check needs the course file, so it sits after the skeleton.
  if (!validStep) {
    return notFoundCard(t('courses.stepNotFound'), t('courses.stepNotFoundSub'), `/course/${slug}`);
  }

  if (!course) {
    return (
      <div aria-busy="true">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 260, marginTop: 12 }} />
      </div>
    );
  }

  // Step 30 is a real roadmap step — of Build, Production & System Design. Without this check
  // `/course/python/30` printed another course's step under Python's header, with no items.
  if (!hasStep(course, no)) {
    return notFoundCard(t('courses.stepNotFound'), t('courses.stepNotFoundSub'), `/course/${course.slug}`);
  }

  const meta = STEPS.find((s) => s.no === no) ?? null;
  const phase = phaseOf(no);
  const measure = measures.get(no) ?? null;
  const allItems = itemsOfStep(course.items, no);
  const items = tabItems(allItems, tab);
  const labRoutes = course.lab_routes?.[no] ?? [];
  const counts = tabCounts(allItems);
  const ordered = stepsOf(course);
  const at = ordered.indexOf(no);
  const prev = at > 0 ? ordered[at - 1] : null;
  const next = at >= 0 && at < ordered.length - 1 ? ordered[at + 1] : null;
  const ownSections = sectionsOfStep(course, no).map((sid) => sections.find((s) => s.id === sid)).filter(Boolean);
  const sectionSet = new Set(ownSections.map((s) => s!.id));
  const guidePages = pdfPages(allItems, 'guide');
  const guideSections = allItems.filter(
    (i) => i.type === 'lesson' && i.ref.kind === 'section' && typeof i.pdf_page === 'number',
  );

  /** The learner's notes that belong to this step: written under one of its sections, or tagged with the course. */
  const notes = state.notes.filter((n) => (n.section && sectionSet.has(n.section)) || n.tags.includes(slug));

  const createNote = () => {
    upsertNote(newNote({
      title: meta?.title ?? `${t('courses.step')} ${no}`,
      section: ownSections[0]?.id,
      tags: [slug],
    }));
    nav('/notes');
  };

  const tabLink = (id: CourseTab, stepNo: number = no) => `/course/${course.slug}/${stepNo}?tab=${id}`;
  const subLabel = (key: string) => (SUBTYPE_KEY[key] ? t(SUBTYPE_KEY[key]) : key);

  return (
    <div>
      <div className={`course-head card glow fadeup tone-${phase.tone}`}>
        <div className="row spread" style={{ flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          <div className="row" style={{ gap: 14, minWidth: 280 }}>
            <CourseLogo logo={course.logo} name={course.name} size={52} />
            <div>
              <div className="row small muted" style={{ gap: 6 }}>
                <Link to={`/course/${course.slug}`}>{course.name}</Link>
                <span>·</span>
                <span>{t('courses.step')} {String(no).padStart(2, '0')} / {STEPS.length}</span>
                <span>·</span>
                <span>{t(phase.key as LocaleKey)}</span>
              </div>
              <h1 style={{ margin: '4px 0 0' }}>{meta?.title ?? `${t('courses.step')} ${no}`}</h1>
            </div>
          </div>
          <div className="row" style={{ gap: 10 }}>
            {measure && measure.pct !== null ? (
              <>
                <ProgressRing pct={measure.pct} size={52} />
                <span className="small muted">
                  {measure.source === 'items'
                    ? `${measure.touched}/${measure.items} ${t('courses.itemsStarted')}`
                    : `${ownSections.length} ${t('courses.sectionsUnit')} · ${t('courses.bySections')}`}
                </span>
              </>
            ) : (
              <span className="small muted">{t('courses.readingStep')}</span>
            )}
          </div>
        </div>

        <div className="course-tabs" role="tablist" aria-label={t('courses.tabList')}>
          {COURSE_TABS.map((id) => (
            <Link
              key={id}
              role="tab"
              aria-selected={tab === id}
              className={`ctab tabbtn ${tab === id ? 'active' : ''}`}
              to={tabLink(id)}
            >
              {t(TAB_KEY[id] as LocaleKey)}
              {TAB_COUNTED.has(id) && counts[id] > 0 && <span className="ctab-n">{counts[id]}</span>}
            </Link>
          ))}
        </div>
      </div>

      {/* ------------------------------- lesson ------------------------------ */}
      {tab === 'lesson' && (
        <>
          {!!meta?.topics.length && (
            <div className="card fadeup">
              <b className="small">{t('courses.topics')}</b>
              <ul className="course-topics">
                {meta.topics.map((topic) => <li key={topic}>{topic}</li>)}
              </ul>
            </div>
          )}
          {ownSections.length > 0 && (
            <>
              <div className="sec-head"><h2><BookOpen size={16} /> {t('courses.sectionsToRead')}</h2><span className="line" /></div>
              <div className="card fadeup">
                {ownSections.map((sec) => (
                  <div key={sec!.id}>
                    <Link className="q-row tone-blue" to={`/lesson/${sec!.id}/learn`}>
                      <span className="ic"><BookOpen size={14} /></span>
                      <span className="t">{String(sec!.no).padStart(2, '0')} · {sec!.title}</span>
                      <span className="small muted">{t('courses.openLesson')}</span>
                      <ChevronRight size={14} />
                    </Link>
                    <div className="row" style={{ gap: 6, padding: '4px 0 10px 36px' }}>
                      <Link className="btn small ghost" to={`/concepts?section=${sec!.id}`}>{t('courses.openConcepts')}</Link>
                      <Link className="btn small ghost" to={`/cheat-sheets?section=${sec!.id}`}>{t('courses.openCheatSheet')}</Link>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
          {!meta?.topics.length && !ownSections.length && <p className="muted small">{t('courses.empty.lesson')}</p>}
          {!!meta?.chapters.length && (
            <p className="small muted" style={{ marginTop: 12 }}>
              {t('courses.chapters')}: {meta.chapters.join(', ')}
            </p>
          )}
        </>
      )}

      {/* ------------------------------ practice ----------------------------- */}
      {tab === 'practice' && (
        <>
          {items.length === 0 && <p className="muted small">{t('courses.empty.practice')}</p>}
          {items.length > 0 && (
            <div className="card fadeup">
              {bySubtype(items).map((group) => (
                <Link key={group.key} className="q-row tone-violet" to="/playbook">
                  <span className="ic"><FlaskConical size={14} /></span>
                  <span className="t">{group.key} · {group.items.length} {t('courses.itemsUnit')}</span>
                  <span className="small muted">{t('courses.openArchive')}</span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <Link className="btn small primary" to="/playbook"><FlaskConical size={13} /> {t('courses.openArchive')}</Link>
            {!!meta?.chapters.length && (
              <Link className="btn small" to={`/questions?chapter=${meta.chapters[0]}`}>
                <ListChecks size={13} /> {t('courses.openChapter')}
              </Link>
            )}
          </div>
        </>
      )}

      {/* ----------------------------- questions ----------------------------- */}
      {tab === 'questions' && (
        <>
          {items.length === 0 && <p className="muted small">{t('courses.empty.questions')}</p>}
          {items.length > 0 && (
            <div className="card fadeup">
              {bySubtype(items).map((group) => (
                <div key={group.key} className="q-row tone-cyan">
                  <span className="ic"><ListChecks size={14} /></span>
                  <span className="t">{subLabel(group.key)} · {group.items.length}</span>
                </div>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: 'wrap' }}>
            {ownSections.map((sec) => (
              <Link key={sec!.id} className="btn small" to={`/questions?section=${sec!.id}`}>
                {String(sec!.no).padStart(2, '0')} · {sec!.title}
              </Link>
            ))}
            <Link className="btn small primary" to="/questions"><ListChecks size={13} /> {t('courses.openBank')}</Link>
          </div>
        </>
      )}

      {/* ----------------------------- interview ----------------------------- */}
      {tab === 'interview' && (
        <>
          {items.length === 0 && <p className="muted small">{t('courses.empty.interview')}</p>}
          {items.length > 0 && (
            <div className="card fadeup">
              {bySubtype(items).map((group) => {
                const route = group.key === 'defense' ? '/defense'
                  : group.key === 'mock' || group.key === 'intensive' ? '/mock-interviews'
                    : '/interview-mode';
                const Icon = group.key === 'defense' ? Shield : group.key === 'mock' || group.key === 'intensive' ? Timer : Mic2;
                return (
                  <Link key={group.key} className="q-row tone-purple" to={route}>
                    <span className="ic"><Icon size={14} /></span>
                    <span className="t">
                      {subLabel(group.key)} · {group.items.length} {t('courses.itemsUnit')}
                      {group.key === 'mock' && group.items[0]?.title ? ` — ${group.items[0].title.slice(0, 48)}` : ''}
                    </span>
                    <ChevronRight size={14} />
                  </Link>
                );
              })}
            </div>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <Link className="btn small primary" to="/interview-mode"><Mic2 size={13} /> {t('courses.openInterview')}</Link>
            <Link className="btn small" to="/mock-interviews"><Timer size={13} /> {t('courses.openMock')}</Link>
            <Link className="btn small" to="/defense"><Shield size={13} /> {t('courses.openDefense')}</Link>
          </div>
        </>
      )}

      {/* --------------------------------- lab ------------------------------- */}
      {tab === 'lab' && (
        <>
          {labRoutes.length === 0 && items.length === 0 && <p className="muted small">{t('courses.empty.lab')}</p>}
          {labRoutes.length > 0 && (
            <>
              <div className="sec-head"><h2><FlaskConical size={16} /> {t('courses.labShortcuts')}</h2><span className="line" /></div>
              <div className="card fadeup">
                {labRoutes.map((route) => {
                  const entry = NAV.find((n) => n.to === route);
                  const Icon = entry?.icon ?? FlaskConical;
                  return (
                    <Link key={route} className="q-row tone-blue" to={route}>
                      <span className="ic"><Icon size={14} /></span>
                      <span className="t">{entry?.label ?? route}</span>
                      <span className="small muted">{t('courses.openLab')}</span>
                      <ChevronRight size={14} />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
          {items.length > 0 && (
            <>
              <div className="sec-head"><h2><NotebookPen size={16} /> {t('courses.labItems')}</h2><span className="line" /></div>
              <div className="card fadeup">
                {items.map((item) => {
                  if (item.ref.kind === 'notebook') {
                    // The course OWNS this notebook (the plan tagged it here from the manifest's own
                    // section mapping), so its row opens the file directly — the same deep link the
                    // Learning Path chips use — and prints the REAL per-notebook progress the
                    // Notebook Lab itself shows. `nb:` attempt keys are keyed by file, so the
                    // progress follows the notebook, not the page it was opened from.
                    const file = item.ref.id;
                    const meta = (notebooks ?? []).find((m) => m.file === file);
                    const done = notebookCellsRunFor(state.attempts, file);
                    const total = meta?.codeCells ?? 0;
                    return (
                      <Link key={item.id} className="q-row tone-green" to={`/notebooks?nb=${file}`}>
                        <span className="ic"><NotebookPen size={14} /></span>
                        <span className="t">{item.title ?? meta?.title ?? file}</span>
                        <span className="small muted">{done}/{total} cells · {t('courses.openNotebook')}</span>
                        <ChevronRight size={14} />
                      </Link>
                    );
                  }
                  const sid = item.ref.id.split(':')[0];
                  return (
                    <Link key={item.id} className="q-row tone-amber" to={`/lesson/${sid}/project`}>
                      <span className="ic"><Layers size={14} /></span>
                      <span className="t">{item.title ?? item.ref.id} {item.subtype ? `· ${item.subtype}` : ''}</span>
                      <span className="small muted">{t('courses.openBuild')}</span>
                      <ChevronRight size={14} />
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* --------------------------------- pdf ------------------------------- */}
      {tab === 'pdf' && (
        <>
          {pageRows(allItems, 'playbook').length === 0 && guidePages.length === 0 && (
            <p className="muted small">{t('courses.empty.pdf')}</p>
          )}
          {pageRows(allItems, 'playbook').length > 0 && (
            <>
              <div className="sec-head"><h2><FileText size={16} /> {t('courses.pdfPlaybook')}</h2><span className="line" /></div>
              <div className="card fadeup">
                {pageRows(allItems, 'playbook').map(([page, n]) => (
                  <Link key={page} className="q-row tone-violet" to={`/pdf/playbook/${page}`}>
                    <span className="ic"><FileText size={14} /></span>
                    <span className="t">p.{page}</span>
                    <span className="small muted">{n} {t('courses.itemsUnit')}</span>
                    <ChevronRight size={14} />
                  </Link>
                ))}
              </div>
            </>
          )}
          {/* The guide has one page per QUESTION — a 600-page question bank would print 600 rows.
              So this book opens at its SECTION's first page, plus the range the bank covers. */}
          {guidePages.length > 0 && (
            <>
              <div className="sec-head"><h2><FileText size={16} /> {t('courses.pdfGuide')}</h2><span className="line" /></div>
              <div className="card fadeup">
                {guideSections.map((item) => {
                  const sec = sections.find((s) => s.id === item.ref.id);
                  return (
                    <Link key={item.id} className="q-row tone-blue" to={`/pdf/${item.pdf_page}`}>
                      <span className="ic"><FileText size={14} /></span>
                      <span className="t">
                        {sec ? `${String(sec.no).padStart(2, '0')} · ${sec.title} — ` : ''}p.{item.pdf_page}
                      </span>
                      <span className="small muted">{t('courses.openPage')}</span>
                      <ChevronRight size={14} />
                    </Link>
                  );
                })}
                <Link className="q-row tone-cyan" to={`/pdf/${guidePages[0]}`}>
                  <span className="ic"><FileText size={14} /></span>
                  <span className="t">{t('courses.pdfRange')}: p.{guidePages[0]}–p.{guidePages[guidePages.length - 1]}</span>
                  <span className="small muted">{guidePages.length} {t('courses.pdfPagesUnit')}</span>
                  <ChevronRight size={14} />
                </Link>
              </div>
            </>
          )}
        </>
      )}

      {/* -------------------------------- notes ------------------------------ */}
      {tab === 'notes' && (
        <>
          {notes.length === 0 && <p className="muted small">{t('courses.empty.notes')}</p>}
          {notes.length > 0 && (
            <div className="card fadeup">
              {notes.map((note) => (
                <Link key={note.id} className="q-row tone-green" to="/notes">
                  <span className="ic"><NotebookPen size={14} /></span>
                  <span className="t">{note.title || t('courses.untitled')}</span>
                  <span className="small muted">{new Date(note.updated).toLocaleDateString()}</span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          )}
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn small primary" onClick={createNote}>
              <NotebookPen size={13} /> {t('courses.notesNew')}
            </button>
            <Link className="btn small" to="/notes"><BookOpen size={13} /> {t('courses.notesAll')}</Link>
          </div>
        </>
      )}

      {/* ------------------------------- footer ------------------------------ */}
      <div className={`card glow fadeup tone-${phase.tone}`} style={{ marginTop: 16 }}>
        <div className="row" style={{ gap: 8 }}>
          <Target size={15} color="var(--accent)" />
          <b className="small">{t('courses.goal')}</b>
          <span className="small">{meta?.goal}</span>
        </div>
        <div className="row spread" style={{ marginTop: 12 }}>
          {prev !== null
            ? <Link className="btn small" to={tabLink(tab, prev)}><ChevronLeft size={13} /> {t('courses.prev')} {String(prev).padStart(2, '0')}</Link>
            : <span />}
          <Link className="btn small ghost" to={`/course/${course.slug}`}>{t('courses.backToCourses')}</Link>
          {next !== null
            ? <Link className="btn small primary" to={tabLink(tab, next)}>{t('courses.next')} {String(next).padStart(2, '0')} <ChevronRight size={13} /></Link>
            : <span><Bot size={14} className="muted" /> {t('courses.lastStep')}</span>}
        </div>
      </div>
    </div>
  );
}
