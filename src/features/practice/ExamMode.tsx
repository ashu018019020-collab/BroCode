import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Timer, Play, Flag, ChevronLeft, ChevronRight, Check, X, AlertTriangle,
  RotateCcw, Shuffle, Trophy, BookOpen, ListChecks, Bug, Save, Clock, Layers,
} from 'lucide-react';
import { useBankManifest, useAllBanks, TYPE_LABEL, stageForQuestion } from '../../core/data/questions';
import type { QuestionType, Difficulty } from '../../core/data/schema';
import { useStore, applyExamWrites, bumpStreak } from '../../core/storage/store';
import {
  useExam, startExam, retakeExam, setAnswer, toggleFlag, gotoIndex,
  gradeQuestion, submitExam, markSaved, clearExam,
} from '../../core/storage/exam';
import { toast } from '../../components/ui/Toast';
import { Bar } from '../../components/ui/ui';
import {
  DEFAULT_BLUEPRINT, EXAM_FOCUS_LABEL, EXAM_FOCUS_ORDER, EXAM_MINUTES, EXAM_SIZES,
  DIFFICULTY_CHOICES, availableCount, selectExamQuestions, buildExamWrites,
  summariseExam, readiness, remainingMs, formatClock, minutesUsed, defaultMinutes,
  type ExamBlueprint, type ExamFocus, type ExamPool, type ExamScope, type ExamSession,
} from '../../core/assessment/exam';

/**
 * Exam Mode — an offline, timed mock interview assembled from the real question
 * banks.
 *
 * The honesty rules this page is built around:
 *  · It never invents a question: the paper is drawn from PUBLISHED bank
 *    questions only, and if the filters cannot fill it the paper is simply short
 *    (never padded with duplicates).
 *  · It never invents a score: after the clock stops you self-grade against the
 *    model answer, and only your own sahi/galat marks produce a number.
 *  · It never files a guess: ungraded questions are reported as neutral and are
 *    NOT written as wrong answers.
 * Wrong answers become real mistake entries and reset that section's
 * spaced-repetition level — which is what puts the section back in the Review
 * Queue. All of it lands in ONE atomic store write.
 *
 * The four screens are separate components on purpose: declaring them inside
 * ExamMode would hand React a brand-new component type on every keystroke and
 * remount the answer textarea mid-typing.
 */

/**
 * How much a usable answer is, per question type.
 *
 * The exam never scores the wording — the learner self-grades (see `buildExamWrites`) — but a blank
 * box with no instruction is where a mock exam stops feeling like one: "samajh nahi aata kitna
 * likhun". One line per type, not a rubric.
 */
const WRITE_HINT: Record<string, string> = {
  theory: '2-4 line: concept kya hai, phir ek chhota example.',
  interview: 'Pehle definition, phir ek real use case — jaise interview me bolte.',
  logic: 'Steps ya pseudo-code likho, phir expected output.',
  coding: 'Poora code likho; approach ek line me.',
  solved: 'Solution code + ek line me approach.',
  debug: 'Kya galat tha aur kaise fix kiya — dono likho.',
  defense: 'Decision, uska reason, aur tumne kya measure kiya.',
  checkpoint: 'Document ka method follow karke apne shabdon me likho.',
};
const DEFAULT_HINT = 'Apne shabdon me likho — 2-4 line kaafi hai.';

interface SetupProps {
  bp: ExamBlueprint;
  setBp: (fn: (b: ExamBlueprint) => ExamBlueprint) => void;
  pools: ExamPool[];
  avail: number;
  paperSize: number;
  banksReady: boolean;
  manifestReady: boolean;
  manifestSections: { sectionId: string; no: number; title: string; published: number }[];
  begin: () => void;
}

/** Sections whose bank already clears the baseline — the "complete sections" scope. */
function scopePools(pools: ExamPool[], complete: Set<string>, bp: ExamBlueprint): ExamPool[] {
  if (bp.scope === 'all') return pools;
  if (bp.scope === 'complete') return pools.filter((p) => complete.has(p.sectionId));
  return pools.filter((p) => p.sectionId === bp.sectionId);
}

export default function ExamMode() {
  const manifest = useBankManifest();
  const banks = useAllBanks(manifest);
  const state = useStore();
  const session = useExam();

  const [bp, setBp] = useState<ExamBlueprint>(DEFAULT_BLUEPRINT);
  const [now, setNow] = useState(() => Date.now());
  const warned = useRef(false);
  const expired = useRef(false);

  const complete = useMemo(() => {
    const set = new Set<string>();
    if (!manifest) return set;
    for (const s of manifest.sections) if (s.published >= manifest.baseline) set.add(s.sectionId);
    return set;
  }, [manifest]);

  const pools: ExamPool[] = useMemo(
    () => (banks ?? []).map((b) => ({ sectionId: b.sectionId, sectionTitle: b.title, questions: b.questions })),
    [banks],
  );

  const scoped = useMemo(() => scopePools(pools, complete, bp), [pools, complete, bp]);
  const avail = useMemo(() => availableCount(scoped, bp), [scoped, bp]);
  const paperSize = Math.min(bp.size, avail);

  /* -------------------------------- clock -------------------------------- */
  useEffect(() => {
    if (session?.phase !== 'running') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [session?.phase, session?.id]);

  useEffect(() => {
    warned.current = false;
    expired.current = false;
  }, [session?.id]);

  useEffect(() => {
    if (session?.phase !== 'running') return;
    const left = remainingMs(session, now);
    if (left <= 0 && !expired.current) {
      expired.current = true;
      submitExam(true);
      toast('Time up — paper submit ho gaya. Ab self-grade karo.', 'warning');
    } else if (left <= 60000 && left > 0 && !warned.current) {
      warned.current = true;
      toast('Last 1 minute — answers final karo.', 'warning');
    }
  }, [session, now]);

  /* -------------------------------- actions ------------------------------- */
  const begin = () => {
    if (!paperSize) { toast('In filters me koi question nahi mila.', 'warning'); return; }
    const paper = selectExamQuestions(scoped, { ...bp, size: paperSize }, state.attempts, Date.now() >>> 0);
    if (!paper.length) { toast('Paper assemble nahi ho paya.', 'warning'); return; }
    startExam({ ...bp, size: paper.length }, paper);
    setNow(Date.now());
  };

  const doSave = () => {
    if (!session) return;
    const writes = buildExamWrites(session, state.attempts);
    if (!writes.entries.length) { toast('Pehle kuch questions grade karo.', 'warning'); return; }
    applyExamWrites(writes.entries, writes.xp);
    bumpStreak();
    markSaved(writes.xp, writes.wrong);
    toast(
      `${writes.correct} sahi · ${writes.wrong} galat filed${writes.xp ? ` · +${writes.xp} XP` : ''}`,
      writes.wrong ? 'info' : 'success',
    );
  };

  const resetTo = (patch: Partial<ExamBlueprint>) => {
    setBp((b) => ({ ...b, ...patch }));
    clearExam();
    setNow(Date.now());
  };

  if (session && session.phase === 'running') {
    return <RunningScreen session={session} now={now} />;
  }
  if (session && session.phase === 'grading') {
    return <GradingScreen session={session} onSave={doSave} />;
  }
  if (session) {
    return (
      <ReportScreen
        session={session}
        onRetake={() => { retakeExam(session.questions); setNow(Date.now()); toast('Same paper, naya clock — ab dikhao.', 'info'); }}
        onNew={(patch) => resetTo(patch ?? {})}
      />
    );
  }

  return (
    <SetupScreen
      bp={bp}
      setBp={setBp}
      pools={pools}
      avail={avail}
      paperSize={paperSize}
      banksReady={!!banks}
      manifestReady={!!manifest}
      manifestSections={manifest?.sections ?? []}
      begin={begin}
    />
  );
}

/* ------------------------------ setup screen ------------------------------ */

function SetupScreen(props: SetupProps) {
  const { bp, setBp, pools, avail, paperSize, banksReady, manifestReady, manifestSections, begin } = props;
  const published = pools.reduce((n, p) => n + p.questions.filter((q) => q.status === 'PUBLISHED').length, 0);

  return (
    <div>
      <div className="row spread" style={{ marginBottom: 4 }}>
        <h1 className="row" style={{ gap: 10 }}><Timer size={22} /> Timed Exam Mode</h1>
        {banksReady && <span className="chip">{published} published questions in the pool</span>}
      </div>
      <p className="muted small" style={{ maxWidth: 780 }}>
        Ek asli interview jaisa timed paper — poore question bank se assemble hota hai. App tumhara score
        guess <b>nahi</b> karega: clock rukne ke baad tum khud sahi/galat mark karo, aur wahi tumhara score hai.
        Galat question seedha Mistake Tracker aur Review Queue me chala jata hai.
      </p>

      <div className="card glow">
        <h3 style={{ marginTop: 0 }}>Paper banao</h3>

        <div className="row small muted" style={{ margin: '6px 0 12px' }}>
          <span className="chip"><Layers size={12} /> {EXAM_FOCUS_LABEL[bp.focus]}</span>
          <span className="chip">{paperSize} questions</span>
          <span className="chip"><Clock size={12} /> {bp.minutes} min</span>
          <span className="chip">{bp.difficulty === 'all' ? 'any difficulty' : bp.difficulty}</span>
        </div>

        <div className="small muted" style={{ marginBottom: 4 }}>Focus</div>
        <div className="row" style={{ marginBottom: 12 }}>
          {EXAM_FOCUS_ORDER.map((f) => (
            <button
              key={f}
              className={`stagepill ${bp.focus === f ? 'active' : ''}`}
              onClick={() => setBp((b) => ({ ...b, focus: f as ExamFocus }))}
            >
              {EXAM_FOCUS_LABEL[f]}
            </button>
          ))}
        </div>

        <div className="grid2">
          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>Questions</div>
            <div className="row" style={{ marginBottom: 12 }}>
              {EXAM_SIZES.map((n) => (
                <button
                  key={n}
                  className={`stagepill ${bp.size === n ? 'active' : ''}`}
                  onClick={() => setBp((b) => ({ ...b, size: n, minutes: defaultMinutes(n) }))}
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="small muted" style={{ marginBottom: 4 }}>Time limit</div>
            <div className="row" style={{ marginBottom: 12 }}>
              {EXAM_MINUTES.map((m) => (
                <button
                  key={m}
                  className={`stagepill ${bp.minutes === m ? 'active' : ''}`}
                  onClick={() => setBp((b) => ({ ...b, minutes: m }))}
                >
                  {m}m
                </button>
              ))}
              <button className="btn small" onClick={() => setBp((b) => ({ ...b, minutes: defaultMinutes(b.size) }))}>
                Auto ({defaultMinutes(bp.size)}m)
              </button>
            </div>

            <div className="small muted" style={{ marginBottom: 4 }}>Difficulty</div>
            <div className="row">
              {DIFFICULTY_CHOICES.map((d) => (
                <button
                  key={d}
                  className={`stagepill ${bp.difficulty === d ? 'active' : ''}`}
                  onClick={() => setBp((b) => ({ ...b, difficulty: d as Difficulty | 'all' }))}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="small muted" style={{ marginBottom: 4 }}>Syllabus scope</div>
            <div className="row" style={{ marginBottom: 12 }}>
              {([['all', 'Poora syllabus'], ['complete', 'Sirf complete sections'], ['one', 'Ek section']] as [ExamScope, string][]).map(([v, label]) => (
                <button
                  key={v}
                  className={`stagepill ${bp.scope === v ? 'active' : ''}`}
                  onClick={() => setBp((b) => ({
                    ...b,
                    scope: v,
                    sectionId: v === 'one' ? (b.sectionId ?? manifestSections[0]?.sectionId) : b.sectionId,
                  }))}
                >
                  {label}
                </button>
              ))}
            </div>

            {bp.scope === 'one' && (
              <select
                value={bp.sectionId ?? ''}
                onChange={(e) => setBp((b) => ({ ...b, sectionId: e.target.value }))}
                style={{ width: '100%', marginBottom: 12 }}
                aria-label="Section"
              >
                {manifestSections.map((s) => (
                  <option key={s.sectionId} value={s.sectionId}>
                    {String(s.no).padStart(2, '0')} — {s.title} ({s.published} published)
                  </option>
                ))}
              </select>
            )}

            <label className="row small" style={{ gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={bp.unseenFirst}
                onChange={(e) => setBp((b) => ({ ...b, unseenFirst: e.target.checked }))}
              />
              Pehle wo questions jo maine pehle nahi dekhe (asli measure, guess nahi)
            </label>
          </div>
        </div>

        <div className="row spread" style={{ marginTop: 16 }}>
          <div className="small muted">
            {!manifestReady || !banksReady
              ? 'Banks load ho rahe hain…'
              : avail === 0
                ? <span style={{ color: 'var(--red)' }}>In filters me ek bhi eligible question nahi hai.</span>
                : <>Pool me <b>{avail}</b> eligible questions hain{avail < bp.size ? <> — itne hi milenge, paper chhota rahega (duplicate banane ke bajaye)</> : null}.</>}
          </div>
          <div className="row">
            <Link className="btn" to="/questions"><ListChecks size={14} /> Question Bank</Link>
            <button className="btn primary" disabled={!paperSize} onClick={begin}>
              <Play size={14} /> Exam shuru karo
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Rules</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Timer chalta hai — session save rehta hai, reload ya tab band karne par wahin se resume hoga.</li>
          <li>Simple text likho; coding questions me code paste karo (formatting ka score nahi milta).</li>
          <li>End me model answer dikhega — tum khud <b>Sahi</b> ya <b>Galat</b> mark karo. Blank chhoda question neutral rehta hai, galat nahi gina jata.</li>
          <li>Galat mark karne par mistake entry banti hai aur us section ka review level reset hota hai.</li>
          <li>XP sirf pehli baar sahi karne par milta hai — Question Bank ke saath double pay nahi hota.</li>
        </ul>
      </div>
    </div>
  );
}

/* ----------------------------- running screen ----------------------------- */

function RunningScreen({ session, now }: { session: ExamSession; now: number }) {
  const s = session;
  const left = remainingMs(s, now);
  const q = s.questions[s.index];
  const answered = s.questions.filter((x) => (s.answers[x.id] ?? '').trim()).length;
  const urgent = left <= 30000 ? 'var(--red)' : left <= 120000 ? 'var(--amber)' : 'var(--text)';
  const isCode = q.type === 'coding' || q.type === 'solved';
  const typed = s.answers[q.id] ?? '';
  const words = typed.trim() ? typed.trim().split(/\s+/).length : 0;
  const hint = WRITE_HINT[q.type] ?? DEFAULT_HINT;
  /** This paper's even pace per question, shown so one question cannot quietly eat the clock. */
  const pace = Math.max(0.1, Math.round((s.blueprint.minutes / Math.max(1, s.questions.length)) * 10) / 10);

  return (
    <div>
      {/* Sticky UNDER the app topbar, like every other rail in the app (`top: 74px`). At `top: 0`
          with z-index 5 the clock slid behind the header (z 30) and vanished while scrolling — the
          one number a timed paper must never hide. */}
      <div className="card glow" style={{ position: 'sticky', top: 74, zIndex: 20 }}>
        <div className="row spread">
          <div className="row" style={{ gap: 14 }}>
            <span className="row" style={{ gap: 6, fontSize: '1.35rem', fontWeight: 700, color: urgent, fontFamily: 'var(--mono)' }}>
              <Timer size={20} /> {formatClock(left)}
            </span>
            <span className="chip">Q {s.index + 1} / {s.questions.length}</span>
            <span className="chip">{answered} answered</span>
            <span className="chip" title="Har question par itna hi time — ek sawaal par atakna hi paper ka sabse bada time sink hai">
              <Clock size={12} /> ~{pace} min / question
            </span>
            {s.flags.length > 0 && (
              <span className="chip" style={{ color: 'var(--amber)', borderColor: 'rgba(251,191,36,.35)' }}>
                <Flag size={12} /> {s.flags.length} flagged
              </span>
            )}
          </div>
          <div className="row">
            <button className="btn small" onClick={() => toggleFlag(q.id)}>
              <Flag size={13} /> {s.flags.includes(q.id) ? 'Flag hatao' : 'Review ke liye flag'}
            </button>
            <button className="btn primary small" onClick={() => submitExam(false)}>
              <Check size={13} /> Submit + self-grade
            </button>
          </div>
        </div>
        <div style={{ marginTop: 8 }}><Bar pct={((s.index + 1) / s.questions.length) * 100} /></div>

        {/* The paper in one strip. This navigator already existed but sat BELOW the answer box, so on
            a 20-question paper you had to scroll past the box to find out what was left and what you
            had skipped. Rides with the clock instead. */}
        <div className="row" style={{ marginTop: 8, gap: 6 }}>
          {s.questions.map((x, i) => {
            const isAnswered = !!(s.answers[x.id] ?? '').trim();
            const isFlagged = s.flags.includes(x.id);
            return (
              <button
                key={x.id}
                className={`stagepill ${i === s.index ? 'active' : ''} ${isFlagged ? 'done' : ''}`}
                style={isAnswered && i !== s.index ? { color: 'var(--cyan)', borderColor: 'rgba(56,189,248,.45)' } : undefined}
                title={`Q${i + 1} · ${String(x.sectionId).toUpperCase()} · ${TYPE_LABEL[x.type]}${isAnswered ? ' · answered' : ' · blank'}${isFlagged ? ' · flagged' : ''}`}
                aria-label={`Question ${i + 1}${isAnswered ? ', answered' : ''}${isFlagged ? ', flagged' : ''}`}
                onClick={() => gotoIndex(i)}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          Filled = abhi ka question · <span style={{ color: 'var(--cyan)' }}>cyan = answered</span> ·{' '}
          <span style={{ color: 'var(--amber)' }}>amber = flagged</span> · baaki blank
        </div>
      </div>

      <div className="card">
        <div className="row small" style={{ marginBottom: 8 }}>
          <span className="chip">{String(q.sectionId).toUpperCase()}</span>
          <span className="chip">{TYPE_LABEL[q.type]}</span>
          <span className={`chip ${q.difficulty}`}>{q.difficulty}</span>
          {q.tags.slice(0, 3).map((t) => <span key={t} className="chip">#{t}</span>)}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.65, marginBottom: 12 }}>{q.question}</div>
        {/* A working answer needs room — 7 rows was a tweet box, and the first thing a learner does
            is scroll inside it. 12 rows of prose (18 of code) fits a real answer at a glance. */}
        <textarea
          className={isCode ? 'editor console' : 'console'}
          rows={isCode ? 18 : 12}
          style={{ minHeight: isCode ? 340 : 240, resize: 'vertical' }}
          placeholder={isCode ? '# yahan code likho / paste karo' : 'Answer yahan likho… (wording ka score nahi milta, apne shabdon me likho)'}
          value={s.answers[q.id] ?? ''}
          onChange={(e) => setAnswer(q.id, e.target.value)}
          spellCheck={false}
        />
        <div className="small muted" style={{ marginTop: 6 }}>{hint}</div>
        <div className="row spread" style={{ marginTop: 10 }}>
          <div className="row">
            <button className="btn small" disabled={s.index === 0} onClick={() => gotoIndex(s.index - 1)}>
              <ChevronLeft size={13} /> Pichla
            </button>
            <button className="btn small" disabled={s.index >= s.questions.length - 1} onClick={() => gotoIndex(s.index + 1)}>
              Agla <ChevronRight size={13} />
            </button>
          </div>
          <span className="small muted">{typed.trim() ? `${words} words` : 'khaali chhoda'}</span>
        </div>
      </div>

    </div>
  );
}

/* ----------------------------- grading screen ----------------------------- */

function GradingScreen({ session, onSave }: { session: ExamSession; onSave: () => void }) {
  const s = session;
  const summary = summariseExam(s);
  const ready = readiness(summary);

  return (
    <div>
      <div className="card glow">
        <h2 className="row" style={{ gap: 10, marginTop: 0 }}><Check size={20} /> Self-grade</h2>
        <p className="small muted" style={{ maxWidth: 780, marginBottom: 8 }}>
          {s.timedOut ? 'Time up tha — clock ne paper submit kar diya. ' : ''}
          Neeche model answer hai. Apna answer padho, phir <b>Sahi</b> ya <b>Galat</b> mark karo.
          App khud se score nahi banata, aur jo tum grade nahi karte wo neutral rehta hai.
        </p>
        <div className="row spread">
          <div className="row small">
            <span className="chip" style={{ color: 'var(--green)' }}><Check size={12} /> {summary.correct} sahi</span>
            <span className="chip" style={{ color: 'var(--red)' }}><X size={12} /> {summary.wrong} galat</span>
            <span className="chip">{summary.ungraded} bina grade</span>
          </div>
          <span className="small muted">{ready.label}</span>
        </div>
      </div>

      {s.questions.map((q, i) => {
        const grade = s.grades[q.id];
        const my = (s.answers[q.id] ?? '').trim();
        const border = grade === false ? 'rgba(248,113,113,.35)' : grade === true ? 'rgba(52,211,153,.35)' : undefined;
        return (
          <div key={q.id} className="card" style={border ? { borderColor: border } : undefined}>
            <div className="row spread" style={{ marginBottom: 8 }}>
              <div className="row small">
                <span className="chip">Q{i + 1}</span>
                <span className="chip">{String(q.sectionId).toUpperCase()}</span>
                <span className="chip">{TYPE_LABEL[q.type]}</span>
                <span className={`chip ${q.difficulty}`}>{q.difficulty}</span>
              </div>
              <div className="row">
                <button
                  className={`btn small ${grade === true ? 'primary' : ''}`}
                  aria-pressed={grade === true}
                  onClick={() => gradeQuestion(q.id, grade === true ? undefined : true)}
                >
                  <Check size={13} /> Sahi
                </button>
                <button
                  className={`btn small ${grade === false ? 'primary' : ''}`}
                  aria-pressed={grade === false}
                  onClick={() => gradeQuestion(q.id, grade === false ? undefined : false)}
                  style={grade === false ? { borderColor: 'rgba(248,113,113,.6)' } : undefined}
                >
                  <X size={13} /> Galat
                </button>
              </div>
            </div>

            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, marginBottom: 10 }}>{q.question}</div>

            <div className="small muted" style={{ marginBottom: 4 }}>Tumhara answer</div>
            {my
              ? <pre className="codeblock" style={{ marginBottom: 10 }}>{my}</pre>
              : <div className="small muted" style={{ marginBottom: 10 }}>— khaali chhoda (neutral rahega, galat nahi gina jayega)</div>}

            <details>
              <summary className="small" style={{ cursor: 'pointer', color: 'var(--cyan)' }}>Model answer dekho</summary>
              <pre className="codeblock" style={{ marginTop: 8 }}>{q.answer}</pre>
              {q.explanation && <p className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{q.explanation}</p>}
            </details>
          </div>
        );
      })}

      <div className="card glow">
        <div className="row spread">
          <span className="small muted">
            {summary.graded} / {summary.total} graded · {summary.ungraded} neutral
          </span>
          <div className="row">
            <button className="btn" onClick={() => { if (confirm('Paper discard karna hai? Answers chale jayenge.')) clearExam(); }}>
              Discard
            </button>
            <button className="btn primary" disabled={!ready.ready} onClick={onSave}>
              <Save size={14} /> Results file karo
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ report screen ----------------------------- */

function ReportScreen({
  session, onRetake, onNew,
}: {
  session: ExamSession;
  onRetake: () => void;
  onNew: (patch?: Partial<ExamBlueprint>) => void;
}) {
  const s = session;
  const summary = summariseExam(s);
  const used = minutesUsed(s);
  const wrong = s.questions.filter((q) => s.grades[q.id] === false);
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? wrong : wrong.slice(0, 6);
  const typeKeys = Object.keys(summary.byType);
  const wrongSections = new Set(wrong.map((q) => q.sectionId)).size;

  return (
    <div>
      <div className="card glow">
        <div className="row spread">
          <div>
            <div className="chip" style={{ marginBottom: 6 }}>EXAM REPORT</div>
            <h1 style={{ margin: 0 }}>{summary.pct === null ? '—' : `${summary.pct}%`}</h1>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {summary.correct} sahi / {summary.graded} graded · {summary.ungraded} neutral (bina grade){' '}
              · {used} min of {s.blueprint.minutes} min
            </p>
          </div>
          <div className="row" style={{ gap: 18 }}>
            <div className="stat"><div className="n" style={{ color: 'var(--green)' }}>{summary.correct}</div><div className="l">sahi</div></div>
            <div className="stat"><div className="n" style={{ color: 'var(--red)' }}>{summary.wrong}</div><div className="l">galat</div></div>
            <div className="stat"><div className="n">{summary.answered}</div><div className="l">attempted</div></div>
            <div className="stat"><div className="n">{summary.flagged}</div><div className="l">flagged</div></div>
          </div>
        </div>
        <div style={{ marginTop: 12 }}>
          <Bar pct={summary.pct ?? 0} />
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}><Trophy size={16} /> Kya file hua</h3>
        <ul className="small muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            {summary.graded} attempt likhe gaye (bank ki same keys par — Question Bank me bhi dikhenge)
            {summary.ungraded > 0 ? `; ${summary.ungraded} neutral question ka koi record nahi bana.` : '.'}
          </li>
          <li>{s.savedMistakes ?? 0} galat answer Mistake Tracker me gaye aur {wrongSections} section(s) ka review level reset hua.</li>
          <li>{s.savedXp ? `${s.savedXp} XP mila (sirf pehli baar sahi karne par).` : 'Naya XP nahi mila — ye questions pehle bhi sahi ho chuke the.'}</li>
          <li>{summary.ungraded > 0 ? `${summary.ungraded} question neutral rahe — un par koi attempt ya mistake nahi bani.` : 'Saare questions grade ho gaye the.'}</li>
          <li className="muted">Seed <code>{s.seed}</code> — isi seed se same paper dobara mil sakta hai.</li>
        </ul>
      </div>

      {summary.bySection.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}><Layers size={16} /> Section-wise</h3>
          {summary.bySection.map((sec) => (
            <div key={sec.sectionId} className="row spread" style={{ padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              <Link className="small" to={`/lesson/${sec.sectionId}/learn`}>{String(sec.sectionId).toUpperCase()} — {sec.title}</Link>
              <div className="row small" style={{ gap: 10 }}>
                <span className="muted">{sec.total} Q</span>
                <span style={{ color: 'var(--green)' }}>{sec.correct} ✓</span>
                <span style={{ color: 'var(--red)' }}>{sec.wrong} ✗</span>
                {sec.ungraded > 0 && <span className="muted">{sec.ungraded} neutral</span>}
                <button className="btn small" onClick={() => onNew({ scope: 'one', sectionId: sec.sectionId })}>
                  <RotateCcw size={12} /> Isi section ki nayi exam
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {typeKeys.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Type-wise accuracy</h3>
          {typeKeys.map((t) => {
            const row = summary.byType[t];
            const graded = row.correct + row.wrong;
            const pct = graded ? Math.round((row.correct / graded) * 100) : 0;
            return (
              <div key={t} style={{ marginBottom: 10 }}>
                <div className="row spread small">
                  <span>{TYPE_LABEL[t as QuestionType] ?? t}</span>
                  <span className="muted">{graded ? `${pct}% (${row.correct}/${graded})` : 'bina grade'}</span>
                </div>
                <Bar pct={pct} />
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="row spread">
          <h3 style={{ marginTop: 0 }}><AlertTriangle size={16} /> Galat answers ({wrong.length})</h3>
          {wrong.length > 6 && (
            <button className="btn small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Kam dikhao' : `Sab ${wrong.length} dikhao`}
            </button>
          )}
        </div>
        {wrong.length === 0 ? (
          <p className="small muted" style={{ margin: 0 }}>Koi galat answer nahi — clean paper. 🎯</p>
        ) : (
          shown.map((q, i) => (
            <div key={q.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div className="row small" style={{ marginBottom: 4 }}>
                <span className="chip">{String(q.sectionId).toUpperCase()}</span>
                <span className="chip">{TYPE_LABEL[q.type]}</span>
                <Link className="small" to={`/lesson/${q.sectionId}/${stageForQuestion(q)}`}>Lesson kholo →</Link>
              </div>
              <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{i + 1}. {q.question.slice(0, 200)}</div>
            </div>
          ))
        )}
      </div>

      <div className="card">
        <div className="row">
          <button className="btn primary" onClick={onRetake}>
            <RotateCcw size={14} /> Same paper dobara (same seed)
          </button>
          <button className="btn" onClick={() => onNew()}>
            <Shuffle size={14} /> Nayi exam banao
          </button>
          <Link className="btn" to="/mistakes"><Bug size={14} /> Mistake Tracker</Link>
          <Link className="btn" to="/review"><BookOpen size={14} /> Review Queue</Link>
          <Link className="btn" to="/questions"><ListChecks size={14} /> Question Bank</Link>
        </div>
      </div>
    </div>
  );
}
