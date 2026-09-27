import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, BookOpen, Code2, FileText, ListChecks, Mic2, Package } from 'lucide-react';
import { useCurriculum } from '../data/curriculum';
import { useBankManifest, manifestStageCount } from '../data/questions';
import { StageQnA } from '../components/StageQnA';
import { useStore, setState, addXp, recordAttempt, addMistake, useSavedAnswer } from '../offline/store';
import { STAGES, STAGE_META, sectionProgress, missingForMastery, nextBestAction, stagePassed, stageApplies, codingTasks, debugTasks, type Stage } from '../engine/progress';
import { planNextStep, planAhead, nextItemIndex, type NextStep, type RoadmapStep } from '../engine/advance';
import { stageAttempt, itemAttempt, debugDone, learnView, lessonDefenseAnswer, interviewAnswer, codeSlot } from '../engine/keys';
import { JupyterNotebook } from '../components/JupyterNotebook';
import { AssistantCard } from '../components/AssistantCard';
import { Chip, ScoreBreakdown } from '../components/ui';
import { LessonCoach, SectionHero, StageGrid, UtilityStrip, type HeroStat } from '../components/SectionChrome';
import { useI18n } from '../i18n';
import { TRACK_DEFS } from '../App';
import type { LocaleKey } from '../i18n/locales';
import { ConceptVisual, visualFor } from '../components/ConceptVisual';
import { TopicGuide } from '../components/TopicGuide';
import { TopicWorkspace } from '../components/TopicWorkspace';
import { keywordScore, questionRubric, defenseScore, DEFENSE_QUESTIONS } from '../engine/evaluate';
import { outputCheck } from '../engine/evaluate';
import type { Section, Concept } from '../types';

/**
 * The difficulty chip for an extracted task. Tolerant on purpose: 371 of the extracted bucket items
 * carry no difficulty at all and 42 carry an empty string, so the old `d.toUpperCase()` threw on a
 * real lesson and printed an empty chip otherwise. An unlabelled task is labelled honestly instead
 * of being assumed to be hard.
 */
const chipFor = (d?: string) => {
  const label = String(d ?? '').trim();
  return <Chip kind={label === 'easy' ? 'easy' : label === 'medium' ? 'medium' : 'hard'}>{label ? label.toUpperCase() : 'TASK'}</Chip>;
};

/**
 * Pill label for a coding task: difficulty initial + task number.
 *
 * The old inline `tt.difficulty.slice(0, 1)` printed a bare number whenever the extracted difficulty
 * was missing or empty (s01 tasks 1 and 7 render as just `1` and `7`), which reads as a task with no
 * difficulty, and `'interview code'` rendered as a misleading `I`. Shared so the Coding Lab and the
 * Logic pills cannot disagree about how a difficulty is abbreviated.
 */
const difficultyCode = (d: string | undefined, i: number) => {
  const t = String(d ?? '').trim();
  const letter = t.includes('interview') ? 'I' : t ? t.slice(0, 1).toUpperCase() : 'T';
  return `${letter}${i + 1}`;
};

export default function Lesson() {
  const { sid, stage } = useParams();
  const { sections } = useCurriculum();
  const state = useStore();
  const nav = useNavigate();
  const [search] = useSearchParams();
  const { t } = useI18n();
  // The bank index, so the stage rail can show how many questions each stage holds without
  // pulling the section's ~400 KB bank on every lesson visit.
  const bankManifest = useBankManifest();
  const sec = sections.find((s) => s.id === sid);
  if (!sec) return <div className="loading">Section not found.</div>;
  const active: Stage = (STAGES.includes(stage as Stage) ? stage : 'learn') as Stage;
  const { masterPct, scores, tasks } = sectionProgress(sec, state);
  const nba = nextBestAction(sec, state);
  const idx = STAGES.indexOf(active);

  /** A stage counts as done only when its real completion gate is satisfied. */
  const stageDone = (st: Stage): boolean => stagePassed(sec, state, st);

  /** Per-stage fill for the rail: booleans become 0/100 so the bar never lies. */
  const stagePct = (st: Stage): number => {
    const v = tasks[st];
    return typeof v === 'number' ? v : v ? 100 : 0;
  };

  /* ------------------------------------------------------------------ *
   * Auto-advance: the lesson watches the gate of whatever is on screen. The *moment* it flips
   * to done, it works out the next thing (engine/advance.ts) and offers to go there — with a
   * countdown, because finishing task 4 and being left staring at task 4 is how a learner
   * stalls. Nothing moves without a gate flipping, and "Stay here" always wins.
   * ------------------------------------------------------------------ */
  // The Learn stage opens on the first concept that has runnable code, so the notebook never
  // shows a placeholder while real code sits further down the page. `?task=` / `?card=` let the
  // dashboard, the mission list and the coach deep-link straight to one item instead of leaving
  // the learner to find it again.
  const firstCodeConcept = Math.max(0, sec.learn.concepts.findIndex((c) => c.code?.trim()));
  const clamp = (raw: string | null, max: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n < max ? Math.floor(n) : 0;
  };
  const taskParam = search.get('task');
  const cardParam = search.get('card');
  /**
   * Which item a lab opens on. A `?task=` / `?card=` link (dashboard, mission row, coach) always
   * wins; with no link it resumes at the next item that is still open, so returning to a
   * half-finished stage continues instead of restarting at task 1.
   */
  const seed = (): { coding: number; logic: number; learn: number } => ({
    coding: taskParam !== null ? clamp(taskParam, codingTasks(sec).length) : nextItemIndex(sec, state, 'coding', -1) ?? 0,
    logic: cardParam !== null ? clamp(cardParam, sec.logic.length) : nextItemIndex(sec, state, 'logic', -1) ?? 0,
    learn: firstCodeConcept,
  });
  const [sel, setSel] = useState(seed);
  /**
   * The selection is a position inside THIS section's lists, and the query string is a link into
   * them, so both are re-derived when they change. Seeded only once it went stale instead: jumping
   * to the next topic kept the old index and dropped the learner halfway down a list they had
   * never opened — or past the end of a shorter one — while a new `?task=` link on the same page
   * was ignored completely.
   */
  useEffect(() => { setSel(seed()); }, [sec.id, taskParam, cardParam]);
  const [advance, setAdvance] = useState<NextStep | null>(null);
  const seen = useRef<Record<string, boolean>>({});
  const autoOn = state.settings.autoAdvance !== false;

  /** The index of the item the active stage is showing, when that stage shows one at a time. */
  const focusIndex = active === 'coding' ? sel.coding : active === 'logic' ? sel.logic : active === 'learn' ? sel.learn : 0;
  /**
   * Stages that are graded as a whole rather than item by item. For these the card waits for the
   * real gate (`stagePassed`), not for the attempt to exist: a defense answered at 40% records an
   * attempt but does not unlock the section, so it must not sweep the learner onward.
   */
  const scoredStage: Stage | null = active === 'interview' || active === 'defense' || active === 'checkpoint' ? active : null;
  /** The persisted gate of exactly what is on screen (null = a stage with no per-item gate). */
  const focusKey: string | null =
    scoredStage ? stageAttempt(sec.id, scoredStage)
      : active === 'coding' || active === 'logic' || active === 'learn' ? itemAttempt(sec.id, active, focusIndex)
        : active === 'debug' ? debugDone(sec.id)
          : active === 'mini' || active === 'project' ? stageAttempt(sec.id, active)
            : null;
  const focusDone = scoredStage ? stagePassed(sec, state, scoredStage) : !!focusKey && !!state.attempts[focusKey];

  /**
   * The plan, worked out before anything is finished. It re-derives from the same gates as the
   * card, so the two can never disagree about what is next — the preview simply says it earlier.
   */
  const ahead = useMemo(
    () => planAhead(sections, sec, state, active, focusIndex),
    [sections, sec, state, active, focusIndex],
  );

  useEffect(() => { setAdvance(null); }, [active, sec.id, focusIndex]);

  useEffect(() => {
    if (!focusKey) return;
    const was = seen.current[focusKey];
    seen.current[focusKey] = focusDone;
    if (was === undefined || !focusDone || was) return;   // only a real false → true counts
    setAdvance(planNextStep(sections, sec, state, active, focusIndex));
  }, [focusKey, focusDone]);

  const go = (step: NextStep) => {
    setAdvance(null);
    if (step.kind === 'item' && step.index !== undefined) {
      if (active === 'coding') setSel((s) => ({ ...s, coding: step.index! }));
      else if (active === 'logic') setSel((s) => ({ ...s, logic: step.index! }));
      else if (active === 'learn') setSel((s) => ({ ...s, learn: step.index! }));
      return;
    }
    if (step.route) nav(step.route);
  };

  const pdfPage = sec.pages.learn[0] ?? sec.pages.mini[0];
  const track = TRACK_DEFS.find((d) => sec.no >= d.from && sec.no <= d.to);
  const trackLabel = track ? t(track.nameKey as LocaleKey) : 'Python Core';
  /**
   * The hero numbers are what a learner actually chooses by: how much there is to practise in
   * each stage. They come from the bank (imported PDF Q&A + seeded + authored), not from the
   * taxonomy, so a section carrying 400+ questions no longer reads as "8 concepts". The
   * curriculum count is the fallback until the manifest arrives.
   */
  const bankCount = (st: Stage) => manifestStageCount(bankManifest, sec.id, st);
  const panelHint = 'Is stage ke Q&A panel me dikhne wale questions';
  const heroStats: HeroStat[] = [
    { n: bankCount('learn') ?? sec.learn.concepts.length, l: 'Learn Q&A', tone: 'cyan', Icon: BookOpen, hint: panelHint },
    { n: bankCount('interview') ?? sec.interview.length, l: 'Interview Qs', tone: 'green', Icon: Mic2, hint: panelHint },
    { n: bankCount('coding') ?? sec.coding.length, l: 'Coding Lab', tone: 'violet', Icon: Code2, hint: panelHint },
    { n: bankCount('solved') ?? sec.solved.length, l: 'Practice', tone: 'amber', Icon: Package, hint: panelHint },
  ];
  const bankTotal = bankManifest?.sections.find((s) => s.sectionId === sec.id)?.published;
  if (bankTotal !== undefined) {
    // The one number that counts everything: every published item is reachable, either in a stage
    // panel or by the stage itself (the interactive interview cards, coding tasks and drills are
    // not repeated in the panel). That is why the tiles do not add up to this — the hint says so
    // rather than leaving a learner to distrust both numbers.
    heroStats.push({
      n: bankTotal, l: 'Q&A Total', tone: 'blue', Icon: ListChecks,
      hint: 'Section ke saare published questions — stage ke apne questions bhi isme hain, isliye ye stage tiles ke jod se zyada ho sakta hai',
    });
  }
  if (pdfPage) heroStats.push({ n: `p.${pdfPage}`, l: 'PDF Reference', tone: 'fuchsia', Icon: FileText, to: `/pdf/${pdfPage}` });

  const heroStatus: 'done' | 'progress' | 'new' =
    STAGES.every(stageDone) ? 'done' : masterPct > 0 ? 'progress' : 'new';

  return (
    <div>
      <SectionHero
        no={String(sec.no).padStart(2, '0')}
        title={sec.title}
        subtitle={
          sec.learn.concepts.some((c) => c.level === 'advanced')
            ? 'Foundation se advanced tak — theory, practice, build aur defend.'
            : 'Yeh topic confidently use karna seekho: theory, practice, build, defend.'
        }
        pct={masterPct}
        minutes={45 + sec.coding.length * 4}
        status={heroStatus}
        stats={heroStats}
        backLabel={trackLabel}
        onBack={() => nav('/path')}
        glyph={track?.icon ?? BookOpen}
      />

      {/* Learning stages — done / current / upcoming, each independently gated */}
      <StageGrid
        active={active}
        isDone={stageDone}
        pctOf={stagePct}
        isApplicable={(st) => stageApplies(sec, st)}
        countOf={(st) => manifestStageCount(bankManifest, sec.id, st)}
        onPick={(st) => nav(`/lesson/${sec.id}/${st}`)}
      />

      <PlanAhead
        rows={ahead}
        onGo={(r) => go({ kind: r.kind, index: r.index, label: r.label, hint: r.hint, route: r.route })}
      />

      {advance && <AdvanceCard step={advance} auto={autoOn} onGo={() => go(advance)} onStay={() => setAdvance(null)} />}

      <div className="row" style={{ marginBottom: 12 }}>
        {idx > 0 && <button className="btn small" onClick={() => nav(`/lesson/${sec.id}/${STAGES[idx - 1]}`)}>← {STAGE_META[STAGES[idx - 1]].label}</button>}
        {idx < STAGES.length - 1 && <button className="btn small" onClick={() => nav(`/lesson/${sec.id}/${STAGES[idx + 1]}`)}>Next: {STAGE_META[STAGES[idx + 1]].label} →</button>}
      </div>

      <UtilityStrip />

      <LessonCoach
        sectionId={sec.id}
        sectionTitle={sec.title}
        nba={nba}
        onStart={(route) => nav(route)}
      />

      <ScoreBreakdown scores={scores} />

      {active === 'learn' && <LearnStage sec={sec} sel={sel.learn} onSel={(i) => setSel((s) => ({ ...s, learn: i }))} />}
      {active === 'interview' && <InterviewStage sec={sec} />}
      {active === 'coding' && <CodingStage sec={sec} sel={sel.coding} onSel={(i) => setSel((s) => ({ ...s, coding: i }))} />}
      {active === 'logic' && <LogicStage sec={sec} idx={sel.logic} onIdx={(i) => setSel((s) => ({ ...s, logic: i }))} />}
      {active === 'debug' && <DebugStage sec={sec} />}
      {active === 'solved' && <SolvedStage sec={sec} />}
      {active === 'mini' && <MiniStage sec={sec} />}
      {active === 'project' && <ProjectStage sec={sec} />}
      {active === 'defense' && <DefenseStage sec={sec} />}
      {active === 'checkpoint' && <CheckpointStage sec={sec} />}
    </div>
  );
}

/* ============================ ROAD AHEAD ============================ */

/**
 * "Aage ka plan" — the next few steps laid out in advance, so the ladder reads as a plan instead
 * of arriving as a surprise after every completion. Row 0 is what to do right now and is clickable
 * where it stands; the rows after it are the stages that still block this section, and the last
 * row hands over to the next topic. Every row comes from `planAhead`, which reads the same gates
 * as the completion card, so nothing listed here is already done or impossible for this topic.
 */
function PlanAhead({ rows, onGo }: { rows: RoadmapStep[]; onGo: (r: RoadmapStep) => void }) {
  if (!rows.length) return null;
  const last = rows.length - 1;
  return (
    <div className="plan" role="region" aria-label="Aage ka plan">
      <div className="row spread">
        <span className="row" style={{ gap: 7 }}>
          <b className="small">🧭 Aage ka plan</b>
          <span className="small muted">— agla kadam dhoondhna nahi padega</span>
        </span>
        <span className="small muted">{rows.length} kadam</span>
      </div>
      <div className="plan-rows">
        {rows.map((r, i) => (
          <button
            key={r.key}
            className={`plan-row${r.now ? ' now' : ''}${r.kind === 'section' || r.kind === 'review' ? ' exit' : ''}`}
            onClick={() => onGo(r)}
            title={`${r.label} — ${r.hint}`}
            aria-label={`${r.now ? 'Abhi' : i + 1}: ${r.label}. ${r.hint}`}
          >
            <span className="plan-no">{r.kind === 'section' || r.kind === 'review' ? '➜' : r.now ? 'NOW' : i + 1}</span>
            <span className="plan-glyph" aria-hidden="true">{r.icon}</span>
            <span className="plan-body">
              <b>{r.label}</b>
              {/* The middle rows stay a glance; NOW and the hand-off carry the why. */}
              {(r.now || i === last) && <span className="plan-hint">{r.hint}</span>}
            </span>
            <span className="plan-min muted small">{r.minutes}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ============================ AUTO-ADVANCE ============================ */

/**
 * "✓ Done — next: X" card with a countdown. It appears only after a real gate flips, it names
 * exactly what is next and why, and it can always be refused. When auto-advance is switched off
 * in Settings the card still tells the learner what is next — it just waits for the click.
 */
function AdvanceCard({ step, auto, seconds = 7, onGo, onStay }: {
  step: NextStep; auto: boolean; seconds?: number; onGo: () => void; onStay: () => void;
}) {
  const [left, setLeft] = useState(auto ? seconds : 0);
  const goRef = useRef(onGo);
  goRef.current = onGo;
  const fired = useRef(false);

  useEffect(() => {
    if (!auto) { setLeft(0); return; }
    setLeft(seconds);
    fired.current = false;
    const t = setInterval(() => setLeft((n) => (n > 0 ? n - 1 : 0)), 1000);
    return () => clearInterval(t);
  }, [auto, seconds, step.label, step.index]);

  // Move on exactly once when the countdown runs out. "Yahin ruko" unmounts this card,
  // which cancels the pending timer with it.
  useEffect(() => {
    if (!auto || left > 0) return;
    if (fired.current) return;
    fired.current = true;
    goRef.current();
  }, [auto, left]);

  const kindWord = step.kind === 'item' ? 'Agla item' : step.kind === 'stage' ? 'Agla stage' : step.kind === 'section' ? 'Agla topic' : 'Review';

  return (
    <div className="adv-card fadeup" role="status" aria-live="polite">
      <div className="row spread">
        <span className="row">
          <span className="adv-check">✓</span>
          <b className="small">Complete</b>
          <span className="chip easy">{kindWord}: {step.label}</span>
        </span>
        <span className="row">
          {auto && left > 0 && <span className="small muted">auto {left}s</span>}
          <button className="btn small primary" onClick={onGo}>
            {step.kind === 'item' ? 'Kholo' : 'Chalo'} <ArrowRight size={12} />
          </button>
          <button className="btn small" onClick={onStay}>Yahin ruko</button>
        </span>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>{step.hint}</p>
      {auto && (
        <div className="bar adv-bar" aria-hidden="true">
          <div style={{ width: `${(left / seconds) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/* ============================ STAGES ============================ */

function LearnStage({ sec, sel, onSel }: { sec: Section; sel: number; onSel: (i: number) => void }) {
  const state = useStore();
  const viewed = !!state.attempts[learnView(sec.id)];
  const concepts = sec.learn.concepts;
  const setSel = onSel;
  const kind = visualFor(sec.id);
  // The authored 16-part workspace is the topic's spine; keep it in reach but collapsible,
  // so learners who only want the PDF concepts are not forced through 16 blocks.
  const [showPack, setShowPack] = useState(true);
  const triedKey = (i: number) => itemAttempt(sec.id, 'learn', i);
  const tried = concepts.filter((_, i) => state.attempts[triedKey(i)]).length;

  useEffect(() => { if (!viewed) { recordAttempt(learnView(sec.id), { done: true }); addXp(2, 'read', 'Concept read'); } }, [sec.id]);

  if (!concepts.length && !sec.topic) return <div className="card muted">Is section me concepts nahi mile.</div>;
  const cur = concepts[Math.min(sel, concepts.length - 1)];

  return (
    <div className="workbench">
      <div className="wb-main">
        {sec.topic && (
          <div className="card">
            <div className="row spread">
              <div>
                <h3 style={{ margin: 0 }}>📚 {sec.title} — complete topic workspace</h3>
                <p className="small muted" style={{ margin: '4px 0 0' }}>
                  16 parts: intro → theory → syntax → examples → real-world → interview → practice → coding →
                  debugging → challenges → projects → improvements → interview tasks → revision.
                </p>
              </div>
              <button className="btn small" onClick={() => setShowPack((v) => !v)}>
                {showPack ? 'Hide workspace' : 'Open workspace'}
              </button>
            </div>
          </div>
        )}
        {sec.topic && showPack && <TopicWorkspace sec={sec} />}
        {concepts.map((c: Concept, i: number) => (
          <div key={i} className={`card fadeup ${i === sel ? 'wb-active' : ''}`}>
            <div className="row spread">
              <h3>{i + 1}. {c.title}</h3>
              <span className="row">
                {state.attempts[triedKey(i)] && (
                  <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ ran</span>
                )}
                <Chip kind={c.level === 'advanced' ? 'hard' : 'easy'}>{c.level === 'advanced' ? 'ADVANCED' : c.level === 'notes' ? 'NOTES' : 'CORE'}</Chip>
              </span>
            </div>
            {c.body && <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>}
            {c.code && (
              <>
                <div className="small muted">CODE</div>
                <pre className="codeblock"><code>{c.code}</code></pre>
              </>
            )}
            {c.output && <p className="small"><b>OUTPUT:</b> <code>{c.output}</code></p>}
            {c.tip && <p className="small muted">💡 {c.tip}</p>}
            <ConceptVisual kind={kind} concept={c} section={sec} activeIndex={i} />
            <TopicGuide concept={c} />
            {c.code && (
              <button className="btn small" style={{ marginTop: 8 }} onClick={() => setSel(i)}>
                ▶ Try this in the notebook →
              </button>
            )}
          </div>
        ))}
        {!concepts.length && <div className="card muted">Is section me PDF concepts nahi mile — upar ka authored workspace hi topic hai.</div>}
        {sec.learn.recap && (
          <div className="card">
            <h3>🧾 Quick Recap</h3>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{sec.learn.recap}</p>
          </div>
        )}
        {sec.learn.remember.map((r, i) => r && (
          <div key={i} className="card" style={{ borderLeft: '3px solid var(--purple)' }}>
            <b className="small">YAAD RAKHO:</b> <span className="small">{r}</span>
          </div>
        ))}
        {sec.learn.practice.length > 0 && (
          <div className="card">
            <h3>✍️ Practice Time</h3>
            {sec.learn.practice.map((p, i) => (
              <p key={i} className="small">{chipFor(p.difficulty)} {p.text}</p>
            ))}
          </div>
        )}
        <StageQnA section={sec} stage="learn" />
      </div>

      <aside className="wb-side">
        <div className="card">
          <div className="row spread">
            <b className="small">📓 NOTEBOOK</b>
            <span className="small muted">{tried}/{concepts.length} tried</span>
          </div>
          <p className="small muted" style={{ margin: '6px 0' }}>{sel + 1}. {cur.title}</p>
          <JupyterNotebook
            storageKey={codeSlot.lesson(sec.id, 'learn', sel)}
            starter={cur.code || undefined}
            title={cur.title}
            taskText={cur.tip ? `💡 ${cur.tip}` : undefined}
            sectionId={sec.id}
            compact
            onComplete={() => recordAttempt(triedKey(sel), { done: true })}
          />
          <p className="small muted" style={{ marginTop: 8 }}>
            Padho → cell chalao → output dekho. Error aaye to Errors / AI Explanation tab me reason milega.
          </p>
        </div>
      </aside>
    </div>
  );
}

function InterviewStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [idx, setIdx] = useState(0);
  const [answer, setAnswer] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<{ pct: number; missing: string[] } | null>(null);
  const qs = sec.interview;
  const key = interviewAnswer(sec.id, idx);

  useEffect(() => { setAnswer(state.interviewAnswers[key] ?? ''); setRevealed(false); setGraded(null); }, [key]);

  if (!qs.length) return <div className="card muted">No interview questions extracted for this section.</div>;
  const q = qs[idx];
  const prevScore = state.attempts[stageAttempt(sec.id, 'interview')]?.score ?? 0;

  const grade = () => {
    const kws = questionRubric(q.a);
    const g = keywordScore(answer, kws);
    setGraded(g);
    recordAttempt(stageAttempt(sec.id, 'interview'), { score: Math.max(prevScore, g.pct) });
    if (g.pct >= 70) addXp(8, 'interview', 'Interview answer');
    else addMistake({ section: sec.id, topic: sec.title, question: q.q, myAnswer: answer, correct: q.a, type: 'interview', source: 'lesson' });
  };

  return (
    <>
    <div className="card">
      <div className="row spread">
        <span className="small muted">Question {idx + 1} of {qs.length}</span>
        <div className="row">
          <button className="btn small" disabled={idx === 0} onClick={() => setIdx(idx - 1)} aria-label="Previous question">←</button>
          <button className="btn small" disabled={idx === qs.length - 1} onClick={() => setIdx(idx + 1)} aria-label="Next question">→</button>
        </div>
      </div>
      <h2 style={{ margin: '10px 0' }}>{q.q}</h2>
      <p className="small muted">Think first. Answer out loud or type it, then reveal the model answer.</p>
      <textarea
        rows={4}
        value={answer}
        placeholder="Your answer (speak it aloud too)…"
        onChange={(e) => { setAnswer(e.target.value); setState((s) => ({ ...s, interviewAnswers: { ...s.interviewAnswers, [key]: e.target.value } })); }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <button className="btn primary" onClick={grade} disabled={!answer.trim()}>Check answer</button>
        <button className="btn" onClick={() => setRevealed(!revealed)}>{revealed ? 'Hide' : 'Reveal model answer'}</button>
        {q.tip && <span className="chip">TIP: {q.tip.slice(0, 60)}</span>}
      </div>
      {graded && (
        <div className="card fadeup" style={{ marginTop: 10, borderColor: graded.pct >= 70 ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
          <b>{graded.pct >= 70 ? '✅' : '⚠️'} Keyword rubric: {graded.pct}%</b>
          {graded.missing.length > 0 && <p className="small muted">Missing: {graded.missing.join(', ')}</p>}
        </div>
      )}
      {revealed && (
        <div className="fadeup" style={{ marginTop: 10 }}>
          <b className="small">MODEL ANSWER:</b>
          <p className="small">{q.a}</p>
          {q.fu && <p className="small muted"><b>FOLLOW-UP:</b> {q.fu}</p>}
          {q.tip && <p className="small muted"><b>TIP:</b> {q.tip}</p>}
        </div>
      )}
      <AssistantCard context={{ sectionId: sec.id, where: `${sec.id} · Interview` }} />
    </div>
    <StageQnA section={sec} stage="interview" />
    </>
  );
}

function CodingStage({ sec, sel, onSel }: { sec: Section; sel: number; onSel: (i: number) => void }) {
  const state = useStore();
  const tasks = codingTasks(sec);
  const setSel = onSel;
  if (!tasks.length) return <div className="card muted">No coding tasks for this section.</div>;
  const t = tasks[Math.min(sel, tasks.length - 1)];
  const done = !!state.attempts[itemAttempt(sec.id, 'coding', sel)];
  const starter = `# Task: ${t.text}\n\n`;
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {tasks.map((tt, i) => (
          <button
            key={i}
            className={`stagepill ${i === sel ? 'active' : ''} ${state.attempts[itemAttempt(sec.id, 'coding', i)] ? 'done' : ''}`}
            onClick={() => setSel(i)}
            title={tt.difficulty ? `${tt.difficulty} difficulty` : 'difficulty recorded nahi hai'}
          >
            {difficultyCode(tt.difficulty, i)}{state.attempts[itemAttempt(sec.id, 'coding', i)] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row spread">
          <h3>{chipFor(t.difficulty)} Task {sel + 1}</h3>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
        <p className="small">{t.text}</p>
        {t.check && <p className="small muted">CHECK: {t.check}</p>}
      </div>
      <JupyterNotebook
        storageKey={codeSlot.lesson(sec.id, 'coding', sel)}
        starter={starter}
        solution={t.solution || undefined}
        title={`Task ${sel + 1}`}
        taskText={[t.text, t.check ? `**CHECK:** ${t.check}` : ''].filter(Boolean).join('\n\n')}
        label={t.difficulty}
        sectionId={sec.id}
        onComplete={() => recordAttempt(itemAttempt(sec.id, 'coding', sel), { done: true })}
      />
      <StageQnA section={sec} stage="coding" />
    </div>
  );
}

function LogicStage({ sec, idx, onIdx }: { sec: Section; idx: number; onIdx: (i: number) => void }) {
  const state = useStore();
  const setIdx = onIdx;
  const [res, setRes] = useState<{ ok: boolean; pct: number } | null>(null);
  const cards = sec.logic;
  const safeIdx = Math.min(idx, Math.max(0, cards.length - 1));
  /**
   * The answer the learner typed, keyed to THIS card, so switching cards (or reloading the page)
   * brings back what was written. It used to be `useState('')`: the text vanished on the next card
   * and on every refresh, and a wrong answer was only remembered as a mistake record.
   */
  const [ans, setAns] = useSavedAnswer(itemAttempt(sec.id, 'logic', safeIdx));
  if (!cards.length) return <div className="card muted">No logic cards for this section.</div>;
  const c = cards[safeIdx];
  const doneKey = itemAttempt(sec.id, 'logic', safeIdx);
  const done = !!state.attempts[doneKey];

  const check = () => {
    const g = outputCheck(ans, c.answer);
    const ok = g.ok;
    setRes({ ok, pct: g.pct });
    recordAttempt(doneKey, { done: ok, answer: ans });
    if (ok) addXp(6, 'logic', 'Logic card');
    else addMistake({ section: sec.id, topic: `${sec.title} — logic`, question: c.text, myAnswer: ans, correct: c.answer, type: 'logic', source: 'lesson' });
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {cards.map((cd, i) => (
          <button key={i} className={`stagepill ${i === idx ? 'active' : ''} ${state.attempts[itemAttempt(sec.id, 'logic', i)] ? 'done' : ''}`} onClick={() => setIdx(i)}>
            {cd.kind}{state.attempts[itemAttempt(sec.id, 'logic', i)] ? ' ✓' : ''}
          </button>
        ))}
      </div>
      <div className="card">
        <span className="chip">{c.kind.toUpperCase()}</span>
        <h3 style={{ marginTop: 8 }}>{c.text}</h3>
        <p className="small muted">Predict the output / decide your answer BEFORE revealing.</p>
        <textarea rows={3} value={ans} placeholder="My answer…" onChange={(e) => setAns(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={check} disabled={!ans.trim()}>Check</button>
          <button className="btn" onClick={() => setRes({ ok: true, pct: 100 })}>Reveal answer</button>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ done</span>}
        </div>
        {res && (
          <div className="fadeup card" style={{ marginTop: 10, borderColor: res.ok ? 'rgba(52,211,153,.5)' : 'rgba(248,113,113,.5)' }}>
            <b>{res.ok ? '✅ Correct' : '❌ Not quite'}</b>
            <p className="small"><b>ANSWER:</b> {c.answer}</p>
          </div>
        )}
      </div>
      <AssistantCard context={{ sectionId: sec.id, where: `${sec.id} · Logic` }} />
      <StageQnA section={sec} stage="logic" />
    </div>
  );
}

function DebugStage({ sec }: { sec: Section }) {
  const state = useStore();
  const bugs = debugTasks(sec);
  /** The written explanation, saved with the stage record so a reload does not lose the reasoning. */
  const [explanation, setExplanation] = useSavedAnswer(debugDone(sec.id));
  if (!bugs.length) return <div className="card muted">No debug tasks for this section — the DEBUG chips live in the Coding Lab.</div>;
  const b = bugs[0];
  const done = !!state.attempts[debugDone(sec.id)];

  const submit = () => {
    const g = keywordScore(explanation, ['error', 'convert|cast|type|int|float|input', 'valid|fix|check']);
    recordAttempt(debugDone(sec.id), { done: true, score: g.pct, answer: explanation });
    if (g.pct >= 50) addXp(10, 'debug', 'Debug exercise');
    else addMistake({ section: sec.id, topic: `${sec.title} — debug`, question: b.text, myAnswer: explanation, correct: b.solution || 'Fix the conversion', type: 'debug', source: 'lesson' });
  };

  return (
    <div>
      <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
        <div className="row spread"><h3>🐞 Broken code</h3>{chipFor('hard')}</div>
        <p className="small">{b.text}</p>
        <p className="small muted"><b>1. RUN it</b> in the lab below. <b>2. Explain the problem</b>. <b>3. Fix it</b>.</p>
        <textarea rows={3} placeholder="What is the problem? Why?" value={explanation} onChange={(e) => setExplanation(e.target.value)} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={submit} disabled={!explanation.trim()}>Submit explanation</button>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
      </div>
      <JupyterNotebook
        storageKey={codeSlot.lesson(sec.id, 'debug', '')}
        starter={`# Broken code — run it and watch it fail:\n# ${b.text}\n\n# Fix it below:\n\n`}
        solution={b.solution || undefined}
        title="Debug lab"
        taskText={`**Broken code:** ${b.text}\n\nPehle cell ko jaisa hai waisa Run karo — error ka poora traceback dekho, phir fix karo.`}
        label="debug"
        sectionId={sec.id}
        onComplete={() => recordAttempt(debugDone(sec.id), { done: true })}
      />
      <StageQnA section={sec} stage="debug" />
    </div>
  );
}

function SolvedStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [open, setOpen] = useState<number | null>(null);
  const items = sec.solved;
  if (!items.length) return <div className="card muted">No solved practice extracted for this section.</div>;
  return (
    <div>
      <div className="card">
        <p className="small muted">Practice rule: solve first, compare second, then change one input. Mark only after you can explain why the output changes.</p>
      </div>
      {items.map((it, i) => (
        <div key={i} className="card">
          <div className="row spread">
            <span>{chipFor(it.difficulty)} <b className="small">{it.text.slice(0, 110)}</b></span>
            <div className="row">
              {state.attempts[itemAttempt(sec.id, 'solved', i)] && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓</span>}
              <button className="btn small" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'Hide' : 'Show solution'}</button>
              <button className="btn small" onClick={() => recordAttempt(itemAttempt(sec.id, 'solved', i), { done: true })}>Mark done</button>
            </div>
          </div>
          {open === i && (
            <div className="fadeup">
              <div className="small muted" style={{ marginTop: 8 }}>SOLUTION CODE</div>
              <pre className="codeblock"><code>{it.solution || '(see coding lab)'}</code></pre>
              {it.result && <p className="small"><b>EXPECTED RESULT:</b> <code>{it.result}</code></p>}
            </div>
          )}
        </div>
      ))}
      <AssistantCard context={{ sectionId: sec.id, where: `${sec.id} · Practice` }} />
      <StageQnA section={sec} stage="solved" />
    </div>
  );
}

function MiniStage({ sec }: { sec: Section }) {
  const state = useStore();
  const m = sec.mini;
  const done = !!state.attempts[stageAttempt(sec.id, 'mini')];
  return (
    <div>
      <div className="card glow">
        <div className="row spread">
          <h3>🏗️ Mini Project — {m.name || sec.title}</h3>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
        <div className="grid2">
          <div>
            <p className="small"><b>WHAT DOES IT DO?</b><br />{m.what || '—'}</p>
            <p className="small"><b>WHY IS IT USEFUL?</b><br />{m.use || '—'}</p>
            <p className="small"><b>ARCHITECTURE:</b> {m.architecture || '—'}</p>
            <p className="small"><b>FILES:</b> {m.files || 'main.py'} · <b>BUILD TARGET:</b> {m.buildTarget || '—'}</p>
          </div>
          <div>
            <p className="small"><b>EXPECTED OUTPUT:</b><br /><code>{m.output || '(run to see)'}</code></p>
            {m.edgeCases.length > 0 && <p className="small"><b>EDGE CASES:</b> {m.edgeCases.join(' · ')}</p>}
          </div>
        </div>
        <p className="small muted"><b>PROJECT EXPLANATION:</b> {m.explanation || 'Explain: what it does, how data flows, one bug you fixed, what you would improve.'}</p>
      </div>
      <JupyterNotebook
        storageKey={codeSlot.lesson(sec.id, 'mini', '')}
        starter={`# Mini Project: ${m.name || sec.title}\n# ${m.what}\n# Build target: ${m.buildTarget || 'working program with clean output'}\n\n`}
        solution={m.code || undefined}
        title={`Mini Project — ${m.name || sec.title}`}
        taskText={[m.what, m.output ? `**EXPECTED OUTPUT:**\n\`\`\`\n${m.output}\n\`\`\`` : ''].filter(Boolean).join('\n\n')}
        notes={m.edgeCases.length ? `**EDGE CASES:** ${m.edgeCases.join(' · ')}` : undefined}
        sectionId={sec.id}
        onComplete={() => { recordAttempt(stageAttempt(sec.id, 'mini'), { done: true }); addXp(25, 'mini', 'Mini project'); }}
      />
      <div className="card">
        <b className="small">🎤 INTERVIEW QUESTION: "Explain this project."</b>
        <p className="small muted">{m.interview || 'Use: problem → stack → architecture → your contribution → result → limitation → next step.'}</p>
      </div>
      <StageQnA section={sec} stage="mini" />
    </div>
  );
}

function ProjectStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [tier, setTier] = useState<'simple' | 'medium' | 'hard'>('simple');
  const p = sec.projectLab.find((x) => x.tier === tier) ?? sec.projectLab[0];
  if (!p) return <div className="card muted">No project lab extracted for this section.</div>;
  const done = !!state.attempts[stageAttempt(sec.id, 'project')];
  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        {(['simple', 'medium', 'hard'] as const).map((t2) => (
          <button key={t2} className={`stagepill ${tier === t2 ? 'active' : ''} ${state.attempts[stageAttempt(sec.id, 'project')]?.answer === t2 ? 'done' : ''}`} onClick={() => setTier(t2)}>
            {t2.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="card">
        <div className="row spread">
          <h3>🚀 {p.name}</h3>
          {done && <span className="chip" style={{ color: 'var(--green)', borderColor: 'rgba(52,211,153,.4)' }}>✓ COMPLETE</span>}
        </div>
        <div className="grid2">
          <div>
            <p className="small"><b>WHAT:</b> {p.what || '—'}</p>
            <p className="small"><b>USE:</b> {p.use || '—'}</p>
            <p className="small"><b>ARCHITECTURE:</b> {p.architecture || '—'}</p>
            <p className="small"><b>FILES:</b> {p.files || 'app.py'} · <b>BUILD TARGET:</b> {p.buildTarget || '—'}</p>
          </div>
          <div>
            <p className="small"><b>DEBUG CUE:</b> {p.debugCue || '—'}</p>
            <p className="small"><b>FOLLOW-UP:</b> {p.followUp || '—'}</p>
          </div>
        </div>
        {p.code && <pre className="codeblock"><code>{p.code}</code></pre>}
        <p className="small muted"><b>INTERVIEW DEFENSE:</b> {p.defense || '—'}</p>
      </div>
      <JupyterNotebook
        storageKey={codeSlot.lesson(sec.id, 'project', tier)}
        starter={`# ${p.name}\n# ${p.what}\n# Build target: ${p.buildTarget || ''}\n\n`}
        solution={p.code || undefined}
        title={`${p.name} — ${tier}`}
        taskText={[p.what, p.buildTarget ? `**BUILD TARGET:** ${p.buildTarget}` : '', p.debugCue ? `**DEBUG CUE:** ${p.debugCue}` : ''].filter(Boolean).join('\n\n')}
        notes={p.followUp ? `**INTERVIEW FOLLOW-UP:** ${p.followUp}` : undefined}
        label={tier}
        sectionId={sec.id}
        onComplete={() => { recordAttempt(stageAttempt(sec.id, 'project'), { done: true, answer: tier }); addXp(30, 'project', 'Project lab build'); }}
      />
    </div>
  );
}

function DefenseStage({ sec }: { sec: Section }) {
  const state = useStore();
  const [answers, setAnswers] = useState<string[]>(() => DEFENSE_QUESTIONS.map((_, i) => state.defenseAnswers[lessonDefenseAnswer(sec.id, i)] ?? ''));
  const [score, setScore] = useState<{ total: number; per: { pct: number; missing: string[] }[] } | null>(null);

  const submit = () => {
    const sc = defenseScore(answers);
    setScore(sc);
    recordAttempt(stageAttempt(sec.id, 'defense'), { done: true, score: sc.total });
    answers.forEach((a, i) => setState((s) => ({ ...s, defenseAnswers: { ...s.defenseAnswers, [lessonDefenseAnswer(sec.id, i)]: a } })));
    if (sc.total >= 60) addXp(20, 'defense', 'Project defense');
  };

  return (
    <>
    <div className="card">
      <h3>🛡️ Project Defense — {sec.mini.name || sec.title}</h3>
      <p className="small muted">Answer all 10. Keyword-rubric scoring — deterministic, offline, no fake AI.</p>
      {DEFENSE_QUESTIONS.map((dq, i) => (
        <div key={i} style={{ margin: '10px 0' }}>
          <label className="small"><b>{i + 1}. {dq.q}</b></label>
          <textarea rows={2} value={answers[i]} onChange={(e) => setAnswers((a) => a.map((x, j) => (j === i ? e.target.value : x)))} />
          {score && (
            <div className="small" style={{ color: score.per[i].pct >= 60 ? 'var(--green)' : 'var(--red)' }}>
              {score.per[i].pct}%{score.per[i].missing.length ? ` — missing: ${score.per[i].missing.join(', ')}` : ''}
            </div>
          )}
        </div>
      ))}
      <button className="btn primary" onClick={submit}>Score my defense</button>
      {score && <p className="small">TOTAL: <b>{score.total}/100</b> {score.total >= 60 ? '✅ pass' : '⚠️ keep practicing'}</p>}
      <AssistantCard context={{ sectionId: sec.id, where: `${sec.id} · Defense` }} />
    </div>
    <StageQnA section={sec} stage="defense" />
    </>
  );
}

function CheckpointStage({ sec }: { sec: Section }) {
  const state = useStore();
  const missing = missingForMastery(sec, state);
  const { tasks } = sectionProgress(sec, state);

  const recordSelfCheckpoint = () => {
    // Self-graded: average of interview/coding/logic/debug/defense gates
    const pct = Math.round((tasks.interview + tasks.coding + tasks.logic + tasks.debug + tasks.solved + tasks.defense) / 6);
    recordAttempt(stageAttempt(sec.id, 'checkpoint'), { done: true, score: pct });
    if (pct >= 70) addXp(30, 'checkpoint', 'Checkpoint passed');
  };

  return (
    <>
    <div className="card">
      <h3>🏆 Checkpoint — Section {String(sec.no).padStart(2, '0')}</h3>
      <p className="small muted">"Mastered" unlocks only when every gate below passes.</p>
      {([
        ['Theory viewed', tasks.learn],
        ['Interview ≥ 70%', tasks.interview >= 70],
        ['Coding ≥ 70%', tasks.coding >= 70],
        ['Logic ≥ 70%', tasks.logic >= 70],
        ['Debug ≥ 70%', tasks.debug >= 70],
        ['Practice solutions ≥ 70%', tasks.solved >= 70],
        ['Mini project', tasks.mini],
        ['Project Lab build', tasks.project],
        ['Defense ≥ 60', tasks.defense >= 60],
        ['Checkpoint ≥ 70%', tasks.checkpoint >= 70],
      ] as [string, boolean][]).map(([label, ok]) => (
        <div key={label} className="row spread small" style={{ padding: '3px 0' }}>
          <span>{ok ? '✅' : '❌'} {label}</span>
          <span className="muted">{ok ? 'PASS' : 'FAIL'}</span>
        </div>
      ))}
      {missing.length > 0 && (
        <div className="card" style={{ borderColor: 'rgba(248,113,113,.4)' }}>
          <b className="small">Keep practicing — missing:</b>
          <ul className="small" style={{ margin: '6px 0 0 18px' }}>{missing.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {missing.length === 0 && (
        <div className="card" style={{ borderColor: 'rgba(52,211,153,.5)' }}>
          <b>✅ ALL GATES PASS — section MASTERED! It now enters the spaced-repetition review queue.</b>
        </div>
      )}
      {sec.checkpoint.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <b className="small">PDF 20-Question Checkpoint (self-graded):</b>
          {sec.checkpoint.slice(0, 6).map((c, i) => (
            <details key={i} style={{ margin: '6px 0' }}>
              <summary className="small">{i + 1}. {c.q}</summary>
              <p className="small muted">KEY: {c.key}</p>
            </details>
          ))}
        </div>
      )}
      <button className="btn primary" style={{ marginTop: 10 }} onClick={recordSelfCheckpoint}>
        Record checkpoint (avg of gate scores)
      </button>
      <AssistantCard context={{ sectionId: sec.id, where: `${sec.id} · Checkpoint` }} />
    </div>
    <StageQnA section={sec} stage="checkpoint" />
    </>
  );
}
