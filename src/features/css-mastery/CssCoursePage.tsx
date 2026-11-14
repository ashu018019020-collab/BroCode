import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookOpen, Check, ChevronLeft, ChevronRight, GraduationCap, Play, Target, Trophy } from 'lucide-react';
import { useCssCourse } from '../../core/data/csscourse';
import { recordAttempt, useSavedAnswer, useStore } from '../../core/storage/store';
import { N_SECTIONS, N_SECTION_LABEL, type NEntry, type NModule, type NSectionKey } from '../../core/learning/ncourse';
import {
  H_LAST_KEY, hNextSection, hProgress, hReport, hSearch, hSectionKey, hWrittenKey, hIsModuleComplete,
} from '../../core/learning/csscourse';
import { Bar } from '../../components/ui/ui';
import { CssLogo } from './CssLogo';
import { CssPlayground } from './CssPlayground';

/**
 * The CSS Mastery course.
 *
 * One course, twenty-four modules, ten learning sections inside EVERY module — the same shape as
 * the C++ course, reading its own generated artifact (`public/generated/css-course/index.json`)
 * and its own pure rules (`core/learning/csscourse.ts`), with its own `cssmod:` progress family so
 * no other course can mark a CSS module complete.
 *
 * The module list comes first, then the live playground, then the course-level material; every module
 * also carries its own playground because writing markup and seeing it render is the point.
 */
export default function CssCoursePage() {
  const file = useCssCourse();
  const state = useStore();
  const [params, setParams] = useSearchParams();
  const modules = file?.modules ?? [];
  const open = modules.find((m) => m.id === params.get('module')) ?? null;

  /* A module (or the module list) opens at the top: the list is long, and keeping the old scroll
     position made a freshly opened module start halfway down. */
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [open?.id]);
  const progress = useMemo(() => hProgress(modules, state.attempts), [modules, state.attempts]);
  const [lastPlace, saveLast] = useSavedAnswer(H_LAST_KEY);
  const report = useMemo(() => hReport(modules, state.attempts, lastPlace), [modules, state.attempts, lastPlace]);
  const [query, setQuery] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'beginner' | 'intermediate' | 'advanced'>('all');
  const hits = useMemo(() => hSearch(modules, query), [modules, query]);
  const visibleModules = useMemo(
    () => (levelFilter === 'all' ? modules : modules.filter((m) => m.level === levelFilter)),
    [modules, levelFilter],
  );
  const foundationModules = useMemo(() => modules.filter((m) => Number(m.id.slice(3)) <= 8), [modules]);

  const openPlace = (moduleId: string, section?: string) => {
    const next = new URLSearchParams(params);
    next.set('module', moduleId);
    if (section) next.set('section', section);
    else next.delete('section');
    saveLast(`${moduleId}:${section ?? hNextSection(moduleId, state.attempts)}`);
    setParams(next);
  };

  if (!file) {
    return (
      <div className="card">
        <div className="skeleton" style={{ height: 90 }} />
        <div className="skeleton" style={{ height: 320, marginTop: 12 }} />
      </div>
    );
  }

  const { course, stats } = file;

  if (open) {
    return (
      <PModule
        key={open.id}
        module={open}
        initialSection={params.get('section')}
        onBack={() => {
          const next = new URLSearchParams(params);
          next.delete('module');
          next.delete('section');
          setParams(next);
        }}
        onSection={(section) => openPlace(open.id, section)}
      />
    );
  }

  return (
    <div>
      <div className="card glow fadeup">
        <div className="row spread" style={{ gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="row" style={{ gap: 12, minWidth: 'min(260px, 100%)' }}>
            <span className="cc-logo"><CssLogo size={56} /></span>
            <div style={{ minWidth: 0 }}>
              <div className="chip" style={{ marginBottom: 6 }}>
                <GraduationCap size={12} /> CSS MASTERY
              </div>
              <h1 style={{ margin: 0 }}>{course.title}</h1>
              <p className="muted small" style={{ margin: '6px 0 0', maxWidth: 620 }}>{course.tagline}</p>
            </div>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip"><BookOpen size={12} /> {stats.modules} modules</span>
            <span className="chip"><Target size={12} /> {stats.entries.toLocaleString()} records</span>
            <span className="chip">24 modules · 50 interview items each</span>
            <span className="chip">{modules.reduce((a, m) => a + (m.hours || 0), 0)}h total</span>
          </div>
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          {report.next && (
            <button type="button" className="btn primary" onClick={() => openPlace(report.next!.moduleId, report.next!.section)}>
              <Play size={14} /> {progress.sectionsDone ? 'Continue' : 'Start'} learning
            </button>
          )}
          <span className="chip"><Trophy size={12} /> {progress.pct}% complete</span>
          <span className="chip">{progress.modulesDone}/{progress.modulesTotal} modules done</span>
          {report.next && (
            <span className="small muted">
              Next: {modules.find((m) => m.id === report.next!.moduleId)?.title} · {N_SECTION_LABEL[report.next.section]}
            </span>
          )}
        </div>
        <div style={{ marginTop: 10, maxWidth: 520 }}><Bar pct={progress.pct} /></div>
      </div>

      <div className="sec-head" style={{ marginTop: 14 }}>
        <h2><BookOpen size={16} color="var(--blue, #2563eb)" /> Modules</h2><span className="line" />
        <span className="small muted">{modules.length} modules · ten sections each</span>
      </div>

      <div className="card" style={{ marginBottom: 10 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${stats.entries.toLocaleString()} records — try: selector, box model, flexbox, grid, clamp`}
          aria-label="Search the CSS course"
          style={{ width: '100%' }}
        />
        {query.trim().length >= 2 && (
          hits.length ? (
            <div style={{ marginTop: 8 }}>
              {hits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => openPlace(hit.moduleId, hit.section)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 0, borderTop: '1px solid var(--line, #e6e8ee)', padding: '6px 0', cursor: 'pointer', color: 'inherit' }}
                >
                  <span className="small"><b>{hit.title}</b> <span className="muted">· {hit.label} · {hit.moduleTitle}</span></span>
                  <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hit.snippet}</span>
                </button>
              ))}
              <p className="small muted" style={{ margin: '6px 0 0' }}>
                {hits.length} result{hits.length === 1 ? '' : 's'} shown, ranked with title matches first.
              </p>
            </div>
          ) : <p className="small muted" style={{ margin: '8px 0 0' }}>No record matches “{query.trim()}”. Try a shorter word.</p>
        )}
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
        {(['all', 'beginner', 'intermediate', 'advanced'] as const).map((level) => (
          <button
            key={level}
            type="button"
            className={`chip ${levelFilter === level ? 'easy' : ''}`}
            onClick={() => setLevelFilter(level)}
            style={{ cursor: 'pointer', border: levelFilter === level ? '1px solid var(--blue, #2563eb)' : undefined }}
          >
            {level === 'all' ? 'All levels' : level.charAt(0).toUpperCase() + level.slice(1)}
          </button>
        ))}
        <span className="small muted" style={{ alignSelf: 'center' }}>
          {visibleModules.length} of {modules.length} modules
        </span>
      </div>

      <div className="tile-grid tile-grid-lg">
        {visibleModules.map((m) => {
          const done = hIsModuleComplete(m.id, state.attempts);
          const sectionsDone = N_SECTIONS.filter((s) => state.attempts[hSectionKey(m.id, s.key)]).length;
          const bank = stats.bank.modules[m.id];
          return (
            <Link
              key={m.id}
              to={`/css?module=${m.id}`}
              className={`tile tech${done ? ' on' : ''}`}
              data-agent-action={`css:module:${m.id}`}
            >
              <span className="ic" style={{ fontWeight: 700, fontSize: 17, color: done ? 'var(--blue, #2563eb)' : 'var(--muted)' }}>
                {String(m.no).padStart(2, '0')}
              </span>
              <span className="t" style={{ flex: 1, minWidth: 0 }}>
                <b>{m.title}</b>
                {Number(m.id.slice(3)) <= 8 && (
                  <span className="chip" style={{ marginLeft: 6, fontSize: 10 }}>Foundation</span>
                )}
                <span>{m.entries} entries · {m.hours}h · {sectionsDone}/10 sections{done ? ' · complete' : ''}</span>
                {bank && (
                  <span className="muted" style={{ display: 'block', marginTop: 3, fontSize: 11, lineHeight: 1.4 }}>
                    Bank {bank.total} · concept {bank.categories.concept} · output {bank.categories.output}
                    {' · '}coding {bank.categories.coding} · debug {bank.categories.debugging}
                  </span>
                )}
              </span>
              <ChevronRight size={14} className="muted" />
            </Link>
          );
        })}
      </div>

      <div className="sec-head" style={{ marginTop: 14 }}>
        <h2><Play size={16} color="var(--blue, #2563eb)" /> CSS Playground</h2><span className="line" />
        <span className="small muted">write markup · see the browser output</span>
      </div>
      <CssPlayground />

      <div className="card" style={{ marginTop: 10 }}>
        <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b className="small">Question bank — counted, not claimed</b>
          <span className="chip">{stats.bank.total} unique items</span>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          All {modules.length} modules now carry 50 unique interview items each ({stats.bank.total} total),
          and all {stats.bank.total} interview answers are distinct. Counts come from the records that
          shipped; the ledger in `CSS_COURSE_PROGRESS.md` states what is still open.
        </p>
      </div>

      <div className="sec-head"><h2><Trophy size={16} color="var(--blue, #2563eb)" /> Your progress</h2><span className="line" /></div>
      <div className="card">
        <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            <span className="chip">{report.pct}% of the course</span>
            <span className="chip">{report.sectionsDone}/{report.sectionsTotal} sections</span>
            <span className="chip">{report.modulesDone}/{report.modulesTotal} modules</span>
          </div>
          {report.resume && (
            <button type="button" className="btn small primary" onClick={() => openPlace(report.resume!.moduleId, report.resume!.section)}>
              <Play size={12} /> Resume · {N_SECTION_LABEL[report.resume.section]}
            </button>
          )}
        </div>
        <div style={{ marginTop: 10, maxWidth: 520 }}><Bar pct={report.pct} /></div>
      </div>

      <details className="card" style={{ marginTop: 10 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>
          <b>About this course</b> — description, standard and prerequisites
        </summary>
        <p className="small muted" style={{ margin: '8px 0 0', maxWidth: 820 }}>{course.description}</p>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <span className="chip">{course.standard}</span>
          {course.prerequisites.map((p) => <span key={p} className="chip">{p}</span>)}
          <span className="chip">{course.level}</span>
        </div>
      </details>

      <div className="sec-head"><h2><BookOpen size={16} color="var(--blue, #2563eb)" /> Learning outcomes</h2><span className="line" /></div>
      <div className="card">
        <ol className="small muted" style={{ margin: 0, paddingLeft: 18, columns: 2, columnGap: 24 }}>
          {course.outcomes.map((o) => <li key={o} style={{ marginBottom: 6 }}>{o}</li>)}
        </ol>
      </div>

      <p className="small muted" style={{ marginTop: 10 }}>
        Every module holds all ten sections — Learn, Interview, Coding Lab, Logic, Debug, Practice
        Solutions, Mini Project, Project Lab, Defense and Checkpoint. Every sample here is authored
        against modern CSS and paired with the result the browser paints for it; those results are
        reviewed rendering descriptions, not the output of a browser run in this build.
      </p>
    </div>
  );
}

/* ------------------------------ one module -------------------------------- */

function PModule({
  module, initialSection, onBack, onSection,
}: {
  module: NModule;
  initialSection: string | null;
  onBack: () => void;
  onSection: (section: NSectionKey) => void;
}) {
  const state = useStore();
  const start = N_SECTIONS.find((s) => s.key === initialSection)?.key ?? hNextSection(module.id, state.attempts);
  const [section, setSection] = useState<NSectionKey>(start);
  const entries = module.sections[section] ?? [];
  const recorded = Boolean(state.attempts[hSectionKey(module.id, section)]);
  const doneCount = N_SECTIONS.filter((s) => state.attempts[hSectionKey(module.id, s.key)]).length;

  const pick = (key: NSectionKey) => {
    setSection(key);
    onSection(key);
  };

  return (
    <div>
      <div className="row spread" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" className="btn small" onClick={onBack}>
          <ChevronLeft size={13} /> All modules
        </button>
        <span className="small muted">
          Module {String(module.no).padStart(2, '0')} · {doneCount}/10 sections · {module.entries} entries
        </span>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 10, alignItems: 'center' }}>
          <span className="cc-logo"><CssLogo size={44} /></span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0 }}>{module.title}</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>{module.goal}</p>
          </div>
        </div>
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {N_SECTIONS.map((s) => {
            const on = state.attempts[hSectionKey(module.id, s.key)];
            return (
              <button
                key={s.key}
                type="button"
                className={`chip ${section === s.key ? 'easy' : ''}`}
                onClick={() => pick(s.key)}
                title={s.blurb}
                style={{ cursor: 'pointer', border: section === s.key ? '1px solid var(--blue, #2563eb)' : undefined }}
              >
                {on && <Check size={11} />} {s.label}
                <span className="muted"> · {module.counts[s.key]}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="card" style={{ marginTop: 10 }}>
        <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
          <b>{N_SECTION_LABEL[section]}</b>
          <button
            type="button"
            className={`btn small ${recorded ? '' : 'primary'}`}
            onClick={() => recordAttempt(hSectionKey(module.id, section), { done: true, tries: 1 })}
          >
            <Check size={12} /> {recorded ? 'Recorded' : `Mark ${N_SECTION_LABEL[section]} done`}
          </button>
        </div>
        <p className="small muted" style={{ margin: '6px 0 0' }}>
          {entries.length} record{entries.length === 1 ? '' : 's'} in this section. A module is complete only when all
          ten sections have a record.
        </p>
      </div>

      <div style={{ marginTop: 10 }}>
        {entries.map((entry, i) => (
          <EntryCard key={entry.id} section={section} entry={entry} index={i} />
        ))}
      </div>

      {/* The playground travels with the module, below its records, so the lesson reads first. */}
      <div style={{ marginTop: 10 }}>
        <CssPlayground moduleId={module.id} compact />
      </div>
    </div>
  );
}

/* ------------------------------ one record -------------------------------- */

function EntryCard({ section, entry, index }: { section: NSectionKey; entry: NEntry; index: number }) {
  const heading = entry.title || entry.q || `Item ${index + 1}`;
  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap' }}>
        <b className="small" style={{ maxWidth: 760 }}>{heading}</b>
        <span className="row" style={{ gap: 4 }}>
          <span className="chip">{section}</span>
          <span className="chip">{entry.difficulty}</span>
        </span>
      </div>

      {entry.body && <p className="small" style={{ margin: '6px 0 0' }}>{entry.body}</p>}
      {entry.statement && <p className="small" style={{ margin: '6px 0 0' }}>{entry.statement}</p>}
      {entry.task && <p className="small" style={{ margin: '6px 0 0' }}>{entry.task}</p>}
      {entry.error && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          <b>Why it fails · </b><span className="muted">{entry.error}</span>
        </p>
      )}
      {entry.steps && (
        <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {entry.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      )}

      {entry.code && <pre className="codeblock" style={{ margin: '8px 0 0' }}>{entry.code}</pre>}
      {entry.options && <Quiz entry={entry} />}

      {section === 'debug' && entry.fix && (
        <>
          <b className="small" style={{ display: 'block', marginTop: 8 }}>Fix</b>
          <pre className="codeblock" style={{ margin: '4px 0 0' }}>{entry.fix}</pre>
        </>
      )}

      {(entry.output || entry.expected) && (
        <>
          <b className="small" style={{ display: 'block', marginTop: 8 }}>Output</b>
          <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{entry.output ?? entry.expected}</pre>
        </>
      )}

      {section === 'interview' || section === 'logic' ? (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Answer</summary>
          <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{entry.answer}</pre>
          {entry.followUps?.map((f) => (
            <div key={f.q} style={{ marginTop: 6 }}>
              <b className="small">{f.q}</b>
              <p className="small muted" style={{ margin: '2px 0 0' }}>{f.answer}</p>
            </div>
          ))}
        </details>
      ) : null}

      {section === 'defense' && entry.answer && (
        <p className="small" style={{ margin: '6px 0 0' }}>{entry.answer}</p>
      )}
      {section === 'coding' && entry.solution && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Reference solution</summary>
          <pre className="codeblock" style={{ margin: '4px 0 0' }}>{entry.solution}</pre>
        </details>
      )}
      {section === 'practice' && entry.solution && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Show the solution</summary>
          <pre className="codeblock" style={{ margin: '4px 0 0' }}>{entry.solution}</pre>
        </details>
      )}
      {entry.rubric && <Written entry={entry} />}
    </div>
  );
}

/** A checkpoint MCQ: the answer appears only after a choice is submitted. */
function Quiz({ entry }: { entry: NEntry }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        {(entry.options ?? []).map((option) => {
          const chosen = picked === option;
          const right = option === entry.answer;
          const tone = picked ? (right ? 'easy' : chosen ? 'hard' : '') : '';
          return (
            <button
              key={option}
              type="button"
              className={`chip ${tone}`}
              onClick={() => setPicked(option)}
              style={{ cursor: 'pointer', maxWidth: '100%', whiteSpace: 'pre-wrap', textAlign: 'left', height: 'auto', padding: '4px 8px' }}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          {picked === entry.answer ? 'Correct.' : 'Not yet.'}{' '}
          <span className="muted">The recorded output is {entry.answer}</span>
        </p>
      )}
    </div>
  );
}

/** A written checkpoint: the draft is stored per entry, the rubric is self-assessed. */
function Written({ entry }: { entry: NEntry }) {
  const [draft, save] = useSavedAnswer(hWrittenKey(entry.id));
  return (
    <div style={{ marginTop: 8 }}>
      <textarea
        value={draft}
        onChange={(e) => save(e.target.value)}
        placeholder="Write your answer in your own words, then check it against the criteria."
        rows={3}
        style={{ width: '100%' }}
        aria-label={`Written answer for ${entry.title ?? entry.q ?? entry.id}`}
      />
      <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
        {(entry.rubric ?? []).map((line) => <li key={line}>{line}</li>)}
      </ul>
    </div>
  );
}
