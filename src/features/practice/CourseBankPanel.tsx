import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, GraduationCap, X } from 'lucide-react';
import type { SqlDebug, SqlLab, SqlMasterclassFile, SqlModule, SqlQA, SqlQuiz } from '../../core/data/sqlmasterclass';
import { useSqlMasterclass } from '../../core/data/sqlmasterclass';
import { useMysqlMasterclass } from '../../core/data/mysqlmasterclass';
import { useSqliteMasterclass } from '../../core/data/sqlitemasterclass';
import { useHtmlCourse } from '../../core/data/htmlcourse';
import { useCssCourse } from '../../core/data/csscourse';
import { useCppCourse } from '../../core/data/cppcourse';
import {
  N_BANK_CATEGORY_LABEL,
  N_BANK_CATEGORY_ORDER,
  N_SECTIONS,
  N_SECTION_LABEL,
  bankCategoryMatch,
  type NEntry,
  type NModule,
  type NCourseFile,
  type NSectionKey,
} from '../../core/learning/ncourse';
import { useSavedAnswer } from '../../core/storage/store';

type BankKey = 'learn' | 'interview' | 'labs' | 'logic' | 'debug' | 'revision';
type PanelProps = { title: string; href: string; onClose: () => void };

const BANKS: { key: BankKey; label: string }[] = [
  { key: 'learn', label: 'Learn' },
  { key: 'interview', label: 'Interview' },
  { key: 'labs', label: 'Coding Lab' },
  { key: 'logic', label: 'Logic' },
  { key: 'debug', label: 'Debug' },
  { key: 'revision', label: 'Revision' },
];

/** A draft key for a course-owned question. It is deliberately separate from every course's own
 *  progress family: answering here must never mark a lesson or module complete in another view. */
const answerKey = (courseId: string, moduleId: string, section: string, id: string) =>
  `cbank:${courseId}:${moduleId}:${section}:${id}`;

function PanelHeader({ title, href, onClose, children }: PanelProps & { children?: React.ReactNode }) {
  return (
    <div className="row spread" style={{ gap: 10, flexWrap: 'wrap' }}>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <span className="chip"><GraduationCap size={12} /> COURSE QUESTION BANK</span>
        <b>{title}</b>
        {children}
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Link className="btn small ghost" to={href}>Full course <ChevronRight size={12} /></Link>
        <button type="button" className="btn small" onClick={onClose}>Close bank</button>
      </div>
    </div>
  );
}

function LoadingBank({ title, href, onClose }: PanelProps) {
  return (
    <div className="card">
      <PanelHeader title={title} href={href} onClose={onClose} />
      <div className="skeleton" style={{ height: 120, marginTop: 10 }} />
      <p className="small muted" style={{ margin: '8px 0 0' }}>Loading this course's question bank only now that you opened it…</p>
    </div>
  );
}

/* ---------------------------- SQL / MySQL / SQLite --------------------------- */

function SqlBank({ title, href, onClose }: PanelProps) {
  const file = useSqlMasterclass();
  if (!file) return <LoadingBank title={title} href={href} onClose={onClose} />;
  return <MasterclassBank file={file} title={title} href={href} onClose={onClose} />;
}

function MysqlBank({ title, href, onClose }: PanelProps) {
  const file = useMysqlMasterclass();
  if (!file) return <LoadingBank title={title} href={href} onClose={onClose} />;
  return <MasterclassBank file={file} title={title} href={href} onClose={onClose} />;
}

function SqliteBank({ title, href, onClose }: PanelProps) {
  const file = useSqliteMasterclass();
  if (!file) return <LoadingBank title={title} href={href} onClose={onClose} />;
  return <MasterclassBank file={file} title={title} href={href} onClose={onClose} />;
}

function MasterclassBank({ file, title, href, onClose }: PanelProps & { file: SqlMasterclassFile }) {
  const modules = file.modules;
  const [moduleId, setModuleId] = useState<string | null>(null);
  const [bank, setBank] = useState<BankKey>('learn');
  const module = modules.find((m) => m.id === moduleId) ?? modules[0] ?? null;

  if (!module) {
    return (
      <div className="card">
        <PanelHeader title={title} href={href} onClose={onClose} />
        <p className="small muted" style={{ margin: '8px 0 0' }}>No module is published in this course bank yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <PanelHeader title={title} href={href} onClose={onClose}>
        <span className="chip">{modules.length} modules</span>
        <span className="chip">{file.stats.learn + file.stats.interview + file.stats.labs + file.stats.logic + file.stats.debug + file.stats.revision} items</span>
      </PanelHeader>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Pick a module, then a bank. Answers are saved here; opening this bank does not mark the course's
        topic checklists or module progress.
      </p>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="Choose a module">
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`chip ${m.id === module.id ? 'easy' : ''}`}
            onClick={() => { setModuleId(m.id); setBank('learn'); }}
            aria-pressed={m.id === module.id}
            style={{ cursor: 'pointer' }}
          >
            Module {String(m.no).padStart(2, '0')} · {m.title}
          </button>
        ))}
      </div>

      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <div style={{ minWidth: 0 }}>
          <b className="small">Module {String(module.no).padStart(2, '0')} — {module.title}</b>
          <p className="small muted" style={{ margin: '4px 0 0' }}>{module.goal}</p>
        </div>
        <span className="chip">{module.hours}h</span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="Choose a question bank">
        {BANKS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`chip ${bank === entry.key ? 'easy' : ''}`}
            onClick={() => setBank(entry.key)}
            aria-pressed={bank === entry.key}
            style={{ cursor: 'pointer' }}
          >
            {entry.label} · {module.banks[entry.key].length}
          </button>
        ))}
      </div>

      {!module.banks[bank].length ? (
        <p className="small muted" style={{ marginTop: 10 }}>This bank has no published item in this module.</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(460px, 100%), 1fr))', gap: 10, marginTop: 10 }}>
          {module.banks[bank].map((item, index) => (
            <MasterclassQuestion
              key={`${bank}:${index}`}
              courseId={file.course.id}
              module={module}
              bank={bank}
              index={index}
              item={item}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type MasterclassItem = SqlQuiz | SqlQA | SqlLab | SqlDebug;

function MasterclassQuestion({
  courseId, module, bank, index, item,
}: {
  courseId: string; module: SqlModule; bank: BankKey; index: number; item: MasterclassItem;
}) {
  if (bank === 'learn') return <SqlQuizCard courseId={courseId} module={module} item={item as SqlQuiz} index={index} />;
  if (bank === 'labs') return <SqlLabCard courseId={courseId} module={module} item={item as SqlLab} index={index} />;
  if (bank === 'debug') return <SqlDebugCard courseId={courseId} module={module} item={item as SqlDebug} index={index} />;
  return <SqlQaCard courseId={courseId} module={module} bank={bank} item={item as SqlQA} index={index} />;
}

function SqlQuizCard({ courseId, module, item, index }: { courseId: string; module: SqlModule; item: SqlQuiz; index: number }) {
  const [picked, save] = useSavedAnswer(answerKey(courseId, module.id, 'learn', String(index)));
  return (
    <div className="card" style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
      <div className="row spread" style={{ gap: 6 }}>
        <span className="chip">Learn · quiz</span>
        <span className="chip small">Module {module.id.toUpperCase()}</span>
      </div>
      <b className="small" style={{ display: 'block', margin: '8px 0 0' }}>{index + 1}. {item.q}</b>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {item.options.map((option) => {
          const chosen = picked === option;
          const right = option === item.answer;
          const tone = picked ? (right ? 'easy' : chosen ? 'hard' : '') : '';
          return (
            <button
              key={option}
              type="button"
              className={`chip ${tone}`}
              onClick={() => save(option)}
              aria-pressed={chosen}
              style={{ cursor: 'pointer', height: 'auto', whiteSpace: 'normal', textAlign: 'left', padding: '4px 8px' }}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked && (
        <p className="small" style={{ margin: '8px 0 0' }}>
          {picked === item.answer ? 'Correct. ' : 'Not yet. '}
          <span className="muted">{item.why}</span>
        </p>
      )}
    </div>
  );
}

function SqlQaCard({ courseId, module, bank, item, index }: { courseId: string; module: SqlModule; bank: BankKey; item: SqlQA; index: number }) {
  const [draft, save] = useSavedAnswer(answerKey(courseId, module.id, bank, String(index)));
  return (
    <div className="card" style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
      <div className="row spread" style={{ gap: 6 }}>
        <span className="chip">{BANKS.find((b) => b.key === bank)?.label ?? bank}</span>
        <span className="chip small">Module {module.id.toUpperCase()}</span>
      </div>
      <b className="small" style={{ display: 'block', margin: '8px 0 0' }}>{index + 1}. {item.q}</b>
      <textarea
        className="console"
        rows={3}
        value={draft}
        onChange={(e) => save(e.target.value)}
        placeholder="Write your answer… (it saves automatically)"
        aria-label={`Answer for ${item.q}`}
        style={{ marginTop: 8, width: '100%' }}
      />
      <details style={{ marginTop: 8 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>Show model answer</summary>
        <p className="small muted" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{item.answer}</p>
      </details>
    </div>
  );
}

function SqlLabCard({ courseId, module, item, index }: { courseId: string; module: SqlModule; item: SqlLab; index: number }) {
  const [draft, save] = useSavedAnswer(answerKey(courseId, module.id, 'labs', String(index)));
  return (
    <div className="card" style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
      <div className="row spread" style={{ gap: 6 }}>
        <span className="chip">Coding Lab</span>
        <span className="chip small">Module {module.id.toUpperCase()}</span>
      </div>
      <b className="small" style={{ display: 'block', margin: '8px 0 0' }}>{item.title}</b>
      <p className="small" style={{ margin: '6px 0 0' }}>{item.task}</p>
      <textarea
        className="console"
        rows={4}
        value={draft}
        onChange={(e) => save(e.target.value)}
        placeholder="Write your SQL here… (it saves automatically)"
        aria-label={`SQL answer for ${item.title}`}
        style={{ marginTop: 8, width: '100%' }}
      />
      <details style={{ marginTop: 8 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>Reference solution and expected output</summary>
        <pre className="codeblock" style={{ margin: '4px 0 0' }}>{item.solution}</pre>
        <p className="small muted" style={{ margin: '6px 0 0' }}><b>Expected:</b> {item.expected}</p>
      </details>
    </div>
  );
}

function SqlDebugCard({ courseId, module, item, index }: { courseId: string; module: SqlModule; item: SqlDebug; index: number }) {
  const [draft, save] = useSavedAnswer(answerKey(courseId, module.id, 'debug', String(index)));
  return (
    <div className="card" style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
      <div className="row spread" style={{ gap: 6 }}>
        <span className="chip">Debug</span>
        <span className="chip small">Module {module.id.toUpperCase()}</span>
      </div>
      <b className="small" style={{ display: 'block', margin: '8px 0 0' }}>{item.title}</b>
      <pre className="codeblock" style={{ margin: '6px 0 0' }}>{item.broken}</pre>
      <p className="small" style={{ margin: '6px 0 0' }}><b>Why it fails · </b><span className="muted">{item.error}</span></p>
      <textarea
        className="console"
        rows={4}
        value={draft}
        onChange={(e) => save(e.target.value)}
        placeholder="Write the fix… (it saves automatically)"
        aria-label={`Fix for ${item.title}`}
        style={{ marginTop: 8, width: '100%' }}
      />
      <details style={{ marginTop: 8 }}>
        <summary className="small" style={{ cursor: 'pointer' }}>Show fix and expected output</summary>
        <pre className="codeblock" style={{ margin: '4px 0 0' }}>{item.fix}</pre>
        <p className="small muted" style={{ margin: '6px 0 0' }}><b>Expected:</b> {item.expected}</p>
      </details>
    </div>
  );
}

/* ----------------------------- HTML / CSS / C++ ------------------------------ */

function HtmlBank({ title, href, onClose }: PanelProps) {
  const file = useHtmlCourse();
  if (!file) return <LoadingBank title={title} href={href} onClose={onClose} />;
  return <NCourseBank file={file} title={title} href={href} onClose={onClose} />;
}

function CssBank({ title, href, onClose }: PanelProps) {
  const file = useCssCourse();
  if (!file) return <LoadingBank title={title} href={href} onClose={onClose} />;
  return <NCourseBank file={file} title={title} href={href} onClose={onClose} />;
}

function CppBank({ title, href, onClose }: PanelProps) {
  const file = useCppCourse();
  if (!file) return <LoadingBank title={title} href={href} onClose={onClose} />;
  return <NCourseBank file={file} title={title} href={href} onClose={onClose} />;
}

type NCourseQuestion = { section: NSectionKey; index: number; entry: NEntry };
const PAGE_SIZE = 12;

function NCourseBank({ file, title, href, onClose }: PanelProps & { file: NCourseFile }) {
  const modules = file.modules;
  const [moduleId, setModuleId] = useState<string | null>(null);
  const module = modules.find((m) => m.id === moduleId) ?? modules[0] ?? null;
  const [category, setCategory] = useState('all');
  const [shown, setShown] = useState(PAGE_SIZE);

  const questions = useMemo<NCourseQuestion[]>(() => {
    if (!module) return [];
    const seen = new Set<string>();
    const out: NCourseQuestion[] = [];
    for (const { key } of N_SECTIONS) {
      const entries = module.sections[key] ?? [];
      for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const isQuestion = N_BANK_CATEGORY_ORDER.some((cat) => bankCategoryMatch(key, entry, cat));
        if (!isQuestion) continue;
        const id = `${key}:${entry.id}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ section: key, index, entry });
      }
    }
    return out;
  }, [module]);

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const q of questions) {
      for (const cat of N_BANK_CATEGORY_ORDER) {
        if (bankCategoryMatch(q.section, q.entry, cat)) out[cat] = (out[cat] ?? 0) + 1;
      }
    }
    return out;
  }, [questions]);

  const visible = category === 'all'
    ? questions
    : questions.filter((q) => bankCategoryMatch(q.section, q.entry, category));

  useEffect(() => { setShown(PAGE_SIZE); }, [module?.id, category]);

  if (!module) {
    return (
      <div className="card">
        <PanelHeader title={title} href={href} onClose={onClose} />
        <p className="small muted" style={{ margin: '8px 0 0' }}>No module is published in this course bank yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <PanelHeader title={title} href={href} onClose={onClose}>
        <span className="chip">{modules.length} modules</span>
        <span className="chip">{file.stats.bank.total} bank items</span>
      </PanelHeader>
      <p className="small muted" style={{ margin: '6px 0 0' }}>
        Pick a module. Its interview, output, coding, debugging, quiz, written, project and scenario
        questions open right here — write an answer or choose an option, then reveal the model answer.
      </p>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="Choose a module">
        {modules.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`chip ${m.id === module.id ? 'easy' : ''}`}
            onClick={() => { setModuleId(m.id); setCategory('all'); }}
            aria-pressed={m.id === module.id}
            style={{ cursor: 'pointer' }}
          >
            Module {String(m.no).padStart(2, '0')} · {m.title}
          </button>
        ))}
      </div>

      <div className="row spread" style={{ gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        <div style={{ minWidth: 0 }}>
          <b className="small">Module {String(module.no).padStart(2, '0')} — {module.title}</b>
          <p className="small muted" style={{ margin: '4px 0 0' }}>{module.goal}</p>
        </div>
        <span className="chip">{questions.length} questions</span>
      </div>

      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 10 }} role="group" aria-label="Choose a question category">
        <button
          type="button"
          className={`chip ${category === 'all' ? 'easy' : ''}`}
          onClick={() => setCategory('all')}
          aria-pressed={category === 'all'}
          style={{ cursor: 'pointer' }}
        >
          All · {questions.length}
        </button>
        {N_BANK_CATEGORY_ORDER.filter((key) => counts[key]).map((key) => (
          <button
            key={key}
            type="button"
            className={`chip ${category === key ? 'easy' : ''}`}
            onClick={() => setCategory(key)}
            aria-pressed={category === key}
            style={{ cursor: 'pointer' }}
          >
            {N_BANK_CATEGORY_LABEL[key] ?? key} · {counts[key]}
          </button>
        ))}
      </div>

      {!visible.length ? (
        <p className="small muted" style={{ marginTop: 10 }}>No question in this module matches that category.</p>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(460px, 100%), 1fr))', gap: 10, marginTop: 10 }}>
            {visible.slice(0, shown).map((q) => (
              <NCourseQuestionCard
                key={`${q.section}:${q.entry.id}`}
                courseId={file.course.id}
                module={module}
                section={q.section}
                entry={q.entry}
              />
            ))}
          </div>
          {visible.length > shown && (
            <button type="button" className="btn small" style={{ marginTop: 8 }} onClick={() => setShown((n) => n + PAGE_SIZE)}>
              Show more ({visible.length - shown} left)
            </button>
          )}
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            {visible.length} of {questions.length} questions in this module · answers here stay separate
            from the course's lesson-completion records.
          </p>
        </>
      )}
    </div>
  );
}

function NCourseQuestionCard({
  courseId, module, section, entry,
}: { courseId: string; module: NModule; section: NSectionKey; entry: NEntry }) {
  const [draft, save] = useSavedAnswer(answerKey(courseId, module.id, section, entry.id));
  const heading = entry.title || entry.q || `Item ${entry.id}`;
  const model = entry.answer || entry.solution || entry.fix || entry.expected;
  return (
    <div className="card" style={{ margin: 0, padding: '10px 12px', minWidth: 0 }}>
      <div className="row spread" style={{ gap: 6, flexWrap: 'wrap' }}>
        <span className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
          <span className="chip">{N_SECTION_LABEL[section]}</span>
          <span className="chip">{entry.difficulty}</span>
        </span>
        <span className="chip small">Module {module.id.toUpperCase()}</span>
      </div>
      <b className="small" style={{ display: 'block', margin: '8px 0 0' }}>{heading}</b>

      {entry.body && <p className="small" style={{ margin: '6px 0 0' }}>{entry.body}</p>}
      {entry.statement && <p className="small" style={{ margin: '6px 0 0' }}>{entry.statement}</p>}
      {entry.task && <p className="small" style={{ margin: '6px 0 0' }}>{entry.task}</p>}
      {entry.error && <p className="small" style={{ margin: '6px 0 0' }}><b>Why it fails · </b><span className="muted">{entry.error}</span></p>}
      {entry.steps && (
        <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {entry.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      )}
      {entry.code && <pre className="codeblock" style={{ margin: '8px 0 0' }}>{entry.code}</pre>}

      {entry.options?.length ? (
        <NCourseQuiz courseId={courseId} module={module} section={section} entry={entry} />
      ) : (
        <textarea
          className="console"
          rows={3}
          value={draft}
          onChange={(e) => save(e.target.value)}
          placeholder="Write your answer… (it saves automatically)"
          aria-label={`Answer for ${heading}`}
          style={{ marginTop: 8, width: '100%' }}
        />
      )}

      {entry.rubric?.length ? (
        <ul className="small muted" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {entry.rubric.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : null}

      {model && (
        <details style={{ marginTop: 8 }}>
          <summary className="small" style={{ cursor: 'pointer' }}>Show model answer</summary>
          <pre className="codeblock" style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{model}</pre>
          {entry.expected && entry.expected !== model && (
            <p className="small muted" style={{ margin: '6px 0 0' }}><b>Expected:</b> {entry.expected}</p>
          )}
          {entry.followUps?.map((followUp) => (
            <div key={followUp.q} style={{ marginTop: 6 }}>
              <b className="small">{followUp.q}</b>
              <p className="small muted" style={{ margin: '2px 0 0' }}>{followUp.answer}</p>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}

function NCourseQuiz({
  courseId, module, section, entry,
}: { courseId: string; module: NModule; section: NSectionKey; entry: NEntry }) {
  const [picked, save] = useSavedAnswer(answerKey(courseId, module.id, `${section}:quiz`, entry.id));
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
              onClick={() => save(option)}
              aria-pressed={chosen}
              style={{ cursor: 'pointer', maxWidth: '100%', whiteSpace: 'pre-wrap', textAlign: 'left', height: 'auto', padding: '4px 8px' }}
            >
              {option}
            </button>
          );
        })}
      </div>
      {picked && (
        <p className="small" style={{ margin: '6px 0 0' }}>
          {picked === entry.answer ? <><Check size={12} /> Correct.</> : <><X size={12} /> Not yet.</>}{' '}
          <span className="muted">Recorded output: {entry.answer}</span>
        </p>
      )}
      {!picked && <p className="small muted" style={{ margin: '6px 0 0' }}>Choose an option to check it.</p>}
    </div>
  );
}

/* ------------------------------- dispatcher -------------------------------- */

export default function CourseBankPanel({
  course, title, href, onClose,
}: PanelProps & { course: string }) {
  if (course === 'sql-masterclass') return <SqlBank title={title} href={href} onClose={onClose} />;
  if (course === 'mysql-masterclass') return <MysqlBank title={title} href={href} onClose={onClose} />;
  if (course === 'sqlite-masterclass') return <SqliteBank title={title} href={href} onClose={onClose} />;
  if (course === 'html-mastery') return <HtmlBank title={title} href={href} onClose={onClose} />;
  if (course === 'css-mastery') return <CssBank title={title} href={href} onClose={onClose} />;
  if (course === 'cpp-mastery') return <CppBank title={title} href={href} onClose={onClose} />;
  return (
    <div className="card">
      <p className="small muted">This course bank is not available yet.</p>
      <button type="button" className="btn small" onClick={onClose}>Close</button>
    </div>
  );
}
