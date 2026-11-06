import { useMemo, useState } from 'react';
import { ListChecks, Search } from 'lucide-react';
import { CourseLogo } from '../../components/shared/CourseLogo';
import { CLogo } from '../c-programming/CLogo';

/** Which course a section row belongs to — the two boxes below are the whole point of this index. */
export type CourseKey = 'python' | 'c';

export interface PythonSectionRow {
  sectionId: string; no: number; title: string; published: number; flags: string[];
}
export interface CModuleRow {
  id: string; no: number; title: string; level: string; brief: string; questions: number;
}

/**
 * The Question Bank's section index, split by course.
 *
 * It used to be one 29-row list, which quietly claimed every question in the app was Python/AI
 * curriculum. C Programming has its own modules and its own MCQs, so the index now keeps one box
 * per course — each with the course's own mark and label — and a row only ever opens questions from
 * its own course. The search covers both boxes so a topic is still one query away.
 */
export default function CourseSections({ baseline, python, cModules, selected, course, onPick }: {
  baseline: number;
  python: PythonSectionRow[];
  cModules: CModuleRow[];
  selected: string | null;
  course: CourseKey;
  onPick: (course: CourseKey, id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();

  const pythonRows = useMemo(
    () => (needle ? python.filter((s) => `${s.no} ${s.title}`.toLowerCase().includes(needle)) : python),
    [python, needle],
  );
  const cRows = useMemo(
    () => (needle ? cModules.filter((m) => `${m.id} ${m.title} ${m.level}`.toLowerCase().includes(needle)) : cModules),
    [cModules, needle],
  );

  return (
    <div className="card">
      <div className="row spread">
        <h2 className="row" style={{ gap: 8, margin: 0 }}><ListChecks size={16} /> Sections</h2>
        <span className="small muted">{pythonRows.length + cRows.length} shown · 2 courses</span>
      </div>
      <div className="row" style={{ margin: '10px 0', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px', background: 'rgba(0,0,0,.3)' }}>
        <Search size={14} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Python sections or C modules…"
          aria-label="Search sections and modules"
          style={{ border: 'none', background: 'transparent', flex: 1, padding: '6px 4px', minWidth: 0 }}
        />
      </div>
      <p className="muted small" style={{ margin: '0 0 10px' }}>
        Two courses, two boxes: Python &amp; AI sections open the Python question bank, C Programming
        modules open their own MCQs. Nothing is mixed into the other course's box.
      </p>

      <div className="qb-course-grid">
        <section className="qb-course" aria-label="Python and AI sections">
          <header className="qb-course-head">
            <CourseLogo logo="python" name="Python" size={26} />
            <span className="who">
              <b>Python &amp; AI</b>
              <span className="small muted" style={{ display: 'block' }}>{pythonRows.length} of {python.length} sections</span>
            </span>
            <span className="chip small">Python</span>
          </header>
          <div className="qb-course-rows">
            {pythonRows.map((s) => {
              const incomplete = s.flags.includes('CONTENT_INCOMPLETE');
              const pct = Math.min(100, Math.round((s.published / baseline) * 100));
              return (
                <button
                  key={s.sectionId}
                  className={`file-row ${course === 'python' && s.sectionId === selected ? 'on' : ''}`}
                  data-agent-action={`qb:section:${s.sectionId}`}
                  onClick={() => onPick('python', s.sectionId)}
                  style={{ width: '100%', textAlign: 'left', background: course === 'python' && s.sectionId === selected ? undefined : 'transparent' }}
                >
                  <span className="mono small muted" style={{ flex: 'none' }}>{String(s.no).padStart(2, '0')}</span>
                  <span className="sec-name">{s.title}</span>
                  <span className={`chip ${incomplete ? 'medium' : 'easy'}`} title={incomplete ? 'CONTENT_INCOMPLETE — baseline not authored yet' : 'complete'}>
                    {pct}%
                  </span>
                </button>
              );
            })}
            {!pythonRows.length && <p className="muted small">No Python section matches “{search}”.</p>}
          </div>
        </section>

        <section className="qb-course" aria-label="C Programming modules">
          <header className="qb-course-head">
            <CLogo size={26} />
            <span className="who">
              <b>C Programming</b>
              <span className="small muted" style={{ display: 'block' }}>{cRows.length} of {cModules.length} modules</span>
            </span>
            <span className="chip small">C</span>
          </header>
          <div className="qb-course-rows">
            {cRows.map((m) => (
              <button
                key={m.id}
                className={`file-row ${course === 'c' && m.id === selected ? 'on' : ''}`}
                data-agent-action={`qb:module:${m.id}`}
                onClick={() => onPick('c', m.id)}
                style={{ width: '100%', textAlign: 'left', background: course === 'c' && m.id === selected ? undefined : 'transparent' }}
              >
                <span className="mono small muted" style={{ flex: 'none' }}>{String(m.no).padStart(2, '0')}</span>
                <span className="sec-name">{m.title}</span>
                <span className="chip small">{m.questions} Qs</span>
              </button>
            ))}
            {!cRows.length && <p className="muted small">No C module matches “{search}”.</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
