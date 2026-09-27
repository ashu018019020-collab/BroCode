/**
 * TopicWorkspace — the 16-part structure that turns a section into one complete topic.
 *
 * Renders `section.topic` (authored by `npm run packs:write`) in the fixed learner order:
 * introduction → theory → syntax → simple examples → real-world → interview → practice →
 * coding → debugging → challenges → simple/medium/hard projects → improvement tasks →
 * interview-based practical tasks → revision checklist. Everything inside belongs to THIS
 * section's topic, because the pack is authored per section and the CLI rejects a pack whose
 * questions repeat or whose snippets do not actually run.
 *
 * Honesty in the UI:
 *   · answers stay behind a reveal, so the learner attempts first (the spec asks for both);
 *   · a snippet the local machine could not run is marked "output documented", never faked;
 *   · a debugging task shows the real error kind captured while authoring and the fixed code
 *     runs in the same lab as everything else;
 *   · a missing part simply does not render — no empty placeholder cards.
 */
import { useEffect, useMemo, useState } from 'react';
import type {
  Section, TopicPack, PracticeItem, PracticeLevel, TopicCodingTask, TopicDebugTask,
  TopicChallenge, TopicProject,
} from '../types';
import { JupyterNotebook } from './JupyterNotebook';
import { Chip } from './ui';
import { addXp, recordAttempt, useStore } from '../offline/store';
import { packItem, packPart } from '../engine/keys';

/** The 16 rows, in walk order. `key` matches the pipeline's coverage keys exactly. */
const PARTS = [
  { key: 'intro', label: 'Topic Introduction' },
  { key: 'theory', label: 'Concepts / Theory' },
  { key: 'syntax', label: 'Syntax' },
  { key: 'examples', label: 'Simple Examples' },
  { key: 'realWorld', label: 'Real-World Examples' },
  { key: 'interview', label: 'Interview Questions' },
  { key: 'practice', label: 'Practice Questions' },
  { key: 'coding', label: 'Coding Practice' },
  { key: 'debugging', label: 'Debugging Questions' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'project-simple', label: 'Simple Project' },
  { key: 'project-medium', label: 'Medium Project' },
  { key: 'project-hard', label: 'Hard / Advanced Project' },
  { key: 'improvements', label: 'Project Improvement Tasks' },
  { key: 'interviewTasks', label: 'Interview-Based Practical Tasks' },
  { key: 'revision', label: 'Revision Checklist' },
] as const;

const PRACTICE_LEVELS: PracticeLevel[] = ['beginner', 'intermediate', 'advanced', 'interview', 'realworld'];
const LEVEL_LABEL: Record<PracticeLevel, string> = {
  beginner: 'Level 1 · Beginner', intermediate: 'Level 2 · Intermediate', advanced: 'Level 3 · Advanced',
  interview: 'Level 4 · Interview', realworld: 'Level 5 · Real-World',
};
const LEVEL_CHIP: Record<PracticeLevel, string> = {
  beginner: 'easy', intermediate: 'medium', advanced: 'hard', interview: 'interview', realworld: 'debug',
};
const CHALLENGE_LABEL: Record<TopicChallenge['kind'], string> = {
  quick: '⚡ Quick Challenge', coding: '🔥 Coding Challenge', advanced: '🚀 Advanced Challenge',
  interview: '🧠 Interview Challenge', build: '🏗️ Build Challenge',
};
const PROJECT_LABEL: Record<TopicProject['level'], string> = {
  simple: 'Simple Project', medium: 'Medium Project', advanced: 'Hard / Advanced Project',
};
/**
 * A project's level → its PARTS key.
 *
 * The authored pack calls the third project `advanced` while the 16-part outline calls that part
 * `project-hard`. The accordion matches a section by the PARTS key in its id, so naming the
 * section after the raw level left the rule pointing at an id that does not exist — which hid
 * EVERY part rather than none, the moment that button was pressed.
 */
const PROJECT_PART: Record<TopicProject['level'], string> = {
  simple: 'project-simple', medium: 'project-medium', advanced: 'project-hard',
};

/** Code with the output it really produced while authoring. */
function Snippet({ code, output, verified, title }: { code: string; output?: string; verified?: boolean; title?: string }) {
  return (
    <div>
      {title && <p className="small muted" style={{ marginBottom: 2 }}>{title}</p>}
      <pre className="codeblock"><code>{code}</code></pre>
      {output !== undefined && (
        <>
          <p className="small muted" style={{ marginBottom: 2 }}>
            Output {verified === false ? '(documented — local module missing)' : '(real run)'}
          </p>
          <pre className="codeblock"><code className="out">{output || '(no output)'}</code></pre>
        </>
      )}
    </div>
  );
}

/** Answer/explanation kept behind a click so the learner attempts the question first. */
function Reveal({ label = 'Show answer', children }: { label?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return open ? <div className="reveal">{children}</div>
    : <button className="btn small" onClick={() => setOpen(true)}>{label}</button>;
}

/** A checkable row — the unit of topic progress. */
function CheckRow({ done, onToggle, children }: { done: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className={`pack-item${done ? ' done' : ''}`}>
      <label className="pack-check">
        <input type="checkbox" checked={done} onChange={onToggle} />
      </label>
      <div className="pack-body">{children}</div>
    </div>
  );
}

function Part({ n, label, count, done }: { n: number; label: string; count?: number; done?: number }) {
  return (
    <h3 className="pack-h">
      <span className="pack-no">{n}</span> {label}
      {count !== undefined && <span className="small muted"> · {done ?? 0}/{count} done</span>}
    </h3>
  );
}

export function TopicWorkspace({ sec }: { sec: Section }) {
  const t = sec.topic;
  const state = useStore();
  const [tier, setTier] = useState<PracticeLevel>('beginner');
  const [showAll, setShowAll] = useState(false);
  /**
   * Which of the 16 parts is expanded; `null` shows the whole workspace.
   *
   * Every part is authored in full and several of them carry a notebook, so rendering all sixteen
   * open at once buried the part you were on under fifteen you were not — the page could only be
   * read by scrolling. One part at a time (the part buttons above pick it), and one more click on
   * the active part opens everything back up for anyone who wants the whole thing at once.
   */
  const [openPart, setOpenPart] = useState<string | null>('intro');

  // The part that was just picked replaces the previous one, so bring it to the top of the view
  // instead of leaving the learner looking at whatever the old part had scrolled to.
  useEffect(() => {
    if (!openPart) return;
    document.getElementById(`pack-${sec.id}-${openPart}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openPart, sec.id]);

  /** Every checkable item in the pack, so one percentage covers the whole workspace. */
  const items = useMemo(() => {
    if (!t) return [] as { key: string; part: string }[];
    const out: { key: string; part: string }[] = [];
    const add = (part: string, i: number | string) => out.push({ key: packItem(sec.id, part, i), part });
    t.examples.forEach((_, i) => add('examples', i));
    t.interview.forEach((_, i) => add('interview', i));
    PRACTICE_LEVELS.forEach((l) => (t.practice[l] ?? []).forEach((_, i) => add('practice', `${l}:${i}`)));
    t.coding.forEach((_, i) => add('coding', i));
    t.debugging.forEach((_, i) => add('debugging', i));
    t.challenges.forEach((_, i) => add('challenges', i));
    t.projects.forEach((p, i) => add(`project-${p.level}`, 0));
    t.projects.forEach((_, i) => add('improvements', i));
    t.interviewTasks.forEach((_, i) => add('interviewTasks', i));
    t.revision.forEach((_, i) => add('revision', i));
    return out;
  }, [t, sec.id]);

  const doneCount = items.filter((x) => state.attempts[x.key]?.done).length;
  const pct = items.length ? Math.round((doneCount / items.length) * 100) : 0;

  if (!t) return null;

  const done = (key: string) => !!state.attempts[key]?.done;
  const toggle = (key: string) => {
    const now = done(key);
    recordAttempt(key, { done: !now });
    if (!now) addXp(2, 'topic', `${sec.title} — ${key.split(':').slice(2).join(':')}`);
  };
  const partDone = (part: string) => items.filter((x) => x.part === part && state.attempts[x.key]?.done).length;
  const partTotal = (part: string) => items.filter((x) => x.part === part).length;

  const finishTopic = () => {
    recordAttempt(packPart(sec.id, 'all'), { done: true, score: pct });
    addXp(30, 'topic', `${sec.title} workspace complete`);
  };

  return (
    <div className="pack" data-open={openPart ?? undefined}>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row spread">
          <div>
            <h2 style={{ margin: 0 }}>{sec.title} — complete topic workspace</h2>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              Learn → Understand → Practice → Code → Debug → Challenge → Build → Improve → Interview.
              Everything below belongs to this topic only. Ek baar me ek part khula hai — neeche ke
              part button se switch karo, ya active part dobara dabao poora workspace dekhne ke liye.
            </p>
          </div>
          <div className="row">
            <Chip kind="interview">{pct}% done</Chip>
            <Chip kind="easy">{doneCount}/{items.length} items</Chip>
          </div>
        </div>
        <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${pct}%` }} /></div>
        <div className="row" style={{ marginTop: 8 }}>
          {PARTS.map((p, i) => (
            <button
              key={p.key}
              className={`btn small${openPart === p.key ? ' primary' : ''}`}
              aria-pressed={openPart === p.key}
              title={openPart === p.key ? 'Poora workspace dikhao' : `Sirf yeh part kholo`}
              onClick={() => setOpenPart((cur) => (cur === p.key ? null : p.key))}
            >
              {i + 1}. {p.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn primary" onClick={finishTopic} disabled={pct < 100}>Mark topic complete</button>
          {pct < 100 && <span className="small muted">Finish every item to close the topic.</span>}
        </div>
      </div>

      {/* 1 · intro */}
      <section id={`pack-${sec.id}-intro`}>
        <Part n={1} label="Topic Introduction" />
        <div className="card"><p>{t.intro}</p></div>
      </section>

      {/* 2 · theory */}
      <section id={`pack-${sec.id}-theory`}>
        <Part n={2} label="Concepts / Theory" />
        <div className="card">
          <ul className="pack-list">{t.theory.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      </section>

      {/* 3 · syntax */}
      <section id={`pack-${sec.id}-syntax`}>
        <Part n={3} label="Syntax" />
        <div className="card">
          {t.syntax.map((s, i) => <Snippet key={i} code={s} />)}
        </div>
      </section>

      {/* 4 · examples */}
      <section id={`pack-${sec.id}-examples`}>
        <Part n={4} label="Simple Examples" count={partTotal('examples')} done={partDone('examples')} />
        {t.examples.map((ex, i) => (
          <CheckRow key={i} done={done(packItem(sec.id, 'examples', i))} onToggle={() => toggle(packItem(sec.id, 'examples', i))}>
            <div className="row" style={{ marginBottom: 6 }}>
              <Chip kind={ex.level === 'basic' ? 'easy' : ex.level === 'intermediate' ? 'medium' : 'hard'}>{ex.level}</Chip>
              <span className="small muted">Example {i + 1}</span>
            </div>
            <Snippet code={ex.code} output={ex.output} verified={ex.verified} />
            <ul className="pack-list small">{ex.explain.map((l, j) => <li key={j}>{l}</li>)}</ul>
          </CheckRow>
        ))}
      </section>

      {/* 5 · real world */}
      <section id={`pack-${sec.id}-realWorld`}>
        <Part n={5} label="Real-World Examples" />
        <div className="card">
          <ul className="pack-list">{t.realWorld.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      </section>

      {/* 6 · interview */}
      <section id={`pack-${sec.id}-interview`}>
        <Part n={6} label="Interview Questions" count={partTotal('interview')} done={partDone('interview')} />
        {t.interview.map((q, i) => (
          <CheckRow key={i} done={done(packItem(sec.id, 'interview', i))} onToggle={() => toggle(packItem(sec.id, 'interview', i))}>
            <p className="pack-q">Q{i + 1}. {q.q}</p>
            <Reveal>
              <p>{q.a}</p>
              {q.tip && <p className="small muted">Interview tip: {q.tip}</p>}
            </Reveal>
          </CheckRow>
        ))}
      </section>

      {/* 7 · practice, five levels */}
      <section id={`pack-${sec.id}-practice`}>
        <Part n={7} label="Practice Questions" count={partTotal('practice')} done={partDone('practice')} />
        <div className="row" style={{ marginBottom: 8 }}>
          {PRACTICE_LEVELS.map((l) => (
            <button key={l} className={`btn small${tier === l ? ' primary' : ''}`} onClick={() => setTier(l)}>
              {LEVEL_LABEL[l]} ({(t.practice[l] ?? []).length})
            </button>
          ))}
        </div>
        {(t.practice[tier] ?? []).map((item: PracticeItem, i) => {
          const key = packItem(sec.id, 'practice', `${tier}:${i}`);
          return (
            <CheckRow key={key} done={done(key)} onToggle={() => toggle(key)}>
              <div className="row" style={{ marginBottom: 4 }}>
                <Chip kind={LEVEL_CHIP[tier]}>{tier}</Chip>
              </div>
              <p className="pack-q">{item.q}</p>
              <Reveal>
                <p>{item.a}</p>
                {item.explain && <p className="small muted">{item.explain}</p>}
                {item.code && <Snippet code={item.code} output={item.output} verified={item.verified} />}
                {item.commonMistake && <p className="small" style={{ color: 'var(--amber)' }}>Common mistake: {item.commonMistake}</p>}
                {item.tip && <p className="small muted">Tip: {item.tip}</p>}
              </Reveal>
            </CheckRow>
          );
        })}
      </section>

      {/* 8 · coding, the fixed 12-field format */}
      <section id={`pack-${sec.id}-coding`}>
        <Part n={8} label="Coding Practice" count={partTotal('coding')} done={partDone('coding')} />
        {t.coding.map((task: TopicCodingTask, i) => {
          const key = packItem(sec.id, 'coding', i);
          return (
            <div className="card" key={i}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Chip kind={task.difficulty === 'easy' ? 'easy' : task.difficulty === 'medium' ? 'medium' : 'hard'}>{task.difficulty}</Chip>
                <strong>{task.question}</strong>
                <button className="btn small" onClick={() => toggle(key)}>{done(key) ? '✓ done' : 'Mark done'}</button>
              </div>
              <div className="guide-grid">
                <div><p className="small muted">What you need to build</p><p className="small">{task.build}</p></div>
                <div><p className="small muted">Input</p><p className="small">{task.input}</p></div>
                <div><p className="small muted">Expected output</p><p className="small">{task.expected}</p></div>
                <div><p className="small muted">Concept used</p><p className="small">{task.concept}</p></div>
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>Hint: {task.hint}</p>
              <JupyterNotebook
                storageKey={`pack:${sec.id}:coding:${i}`}
                compact
                starter={`# ${task.question}\n# ${task.build}\n\n`}
                solution={task.solution}
                title={task.question}
                taskText={[
                  `**What you need to build:** ${task.build}`,
                  `**Input:** ${task.input}`,
                  `**Expected output:**\n\`\`\`\n${task.expected}\n\`\`\``,
                  `**Hint:** ${task.hint}`,
                ].join('\n\n')}
                label={task.difficulty}
                sectionId={sec.id}
                onComplete={() => toggle(key)}
              />
              <Reveal label="Show solution, explanation & complexity">
                <Snippet code={task.solution} output={task.output} verified={task.verified} />
                <p className="small">{task.explanation}</p>
                <p className="small muted">Time: {task.time} · Space: {task.space}</p>
                <p className="small">Better approach: {task.better}</p>
                <p className="small">Interview follow-up: {task.followUp}</p>
              </Reveal>
            </div>
          );
        })}
      </section>

      {/* 9 · debugging */}
      <section id={`pack-${sec.id}-debugging`}>
        <Part n={9} label="Debugging Questions" count={partTotal('debugging')} done={partDone('debugging')} />
        {t.debugging.map((d: TopicDebugTask, i) => {
          const key = packItem(sec.id, 'debugging', i);
          return (
            <div className="card" key={i}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Chip kind={d.difficulty === 'easy' ? 'easy' : d.difficulty === 'medium' ? 'medium' : 'hard'}>{d.difficulty}</Chip>
                <Chip kind="debug">{d.error}</Chip>
                <button className="btn small" onClick={() => toggle(key)}>{done(key) ? '✓ done' : 'Mark done'}</button>
              </div>
              <p className="small muted">Broken code — run it and watch it fail</p>
              <JupyterNotebook
                storageKey={`pack:${sec.id}:debug:${i}`}
                compact
                starter={d.broken}
                solution={d.correct}
                title={`Debug: ${d.error}`}
                taskText="Broken cell ko waise hi Run karo — jo error aaye wahi asli seekhne wali cheez hai. Phir fix karke dobara chalao."
                label={d.difficulty}
                sectionId={sec.id}
                onComplete={() => toggle(key)}
              />
              <Reveal label="Show why it breaks & the fix">
                <p className="small"><strong>Why:</strong> {d.why}</p>
                <p className="small"><strong>Fix:</strong> {d.fix}</p>
                <Snippet code={d.correct} output={d.output} verified={d.verified} title="Correct code" />
                <p className="small muted">Lesson: {d.lesson}</p>
              </Reveal>
            </div>
          );
        })}
      </section>

      {/* 10 · challenges */}
      <section id={`pack-${sec.id}-challenges`}>
        <Part n={10} label="Challenges" count={partTotal('challenges')} done={partDone('challenges')} />
        <div className="grid2">
          {t.challenges.map((c, i) => (
            <CheckRow key={i} done={done(packItem(sec.id, 'challenges', i))} onToggle={() => toggle(packItem(sec.id, 'challenges', i))}>
              <p className="pack-q">{CHALLENGE_LABEL[c.kind]} · {c.minutes} min</p>
              <p className="small">{c.prompt}</p>
              {c.hint && <p className="small muted">Hint: {c.hint}</p>}
              {c.deliverable && <p className="small muted">Deliverable: {c.deliverable}</p>}
            </CheckRow>
          ))}
        </div>
      </section>

      {/* 11-13 · projects */}
      {t.projects.map((p: TopicProject, i) => {
        const key = packItem(sec.id, `project-${p.level}`, 0);
        return (
          <section id={`pack-${sec.id}-${PROJECT_PART[p.level]}`} key={i}>
            <Part n={11 + i} label={PROJECT_LABEL[p.level]} />
            <div className={`card${done(key) ? ' glow' : ''}`}>
              <div className="row" style={{ marginBottom: 6 }}>
                <strong>{p.name}</strong>
                <button className="btn small" onClick={() => toggle(key)}>{done(key) ? '✓ built' : 'Mark built'}</button>
              </div>
              <div className="guide-grid">
                <div><p className="small muted">Problem statement</p><p className="small">{p.problem}</p></div>
                <div><p className="small muted">Objective</p><p className="small">{p.objective}</p></div>
              </div>
              <p className="small muted" style={{ marginTop: 6 }}>Features</p>
              <ul className="pack-list small">{p.features.map((f, j) => <li key={j}>{f}</li>)}</ul>
              <p className="small muted">Concepts used: {p.concepts.join(', ')}</p>
              <p className="small muted" style={{ marginTop: 6 }}>Folder structure</p>
              <pre className="codeblock"><code>{p.structure}</code></pre>
              <p className="small muted">Implementation steps</p>
              <ol className="pack-list small">{p.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
              <Snippet code={p.code} output={p.output} verified={p.verified} title="Complete code" />
              <p className="small">{p.explanation}</p>
              <p className="small"><strong>Testing:</strong> {p.testing}</p>
              <p className="small"><strong>Error handling:</strong> {p.errors}</p>
              <p className="small muted" style={{ marginTop: 6 }}>Improvements (next versions)</p>
              <ul className="pack-list small">{p.improvements.map((x, j) => <li key={j}>{x}</li>)}</ul>
              <p className="small muted">Industry-ready additions</p>
              <ul className="pack-list small">{p.advanced.map((x, j) => <li key={j}>{x}</li>)}</ul>
              <p className="small"><strong>Real-world use case:</strong> {p.realWorld}</p>
              <Reveal label={`Show ${p.interview.length} project interview questions`}>
                {p.interview.map((q, j) => (
                  <div key={j} style={{ marginBottom: 6 }}>
                    <p className="small pack-q">{q.q}</p>
                    <p className="small muted">{q.a}</p>
                  </div>
                ))}
              </Reveal>
              <p className="small" style={{ marginTop: 6 }}><strong>Resume line:</strong> {p.resume}</p>
              <p className="small muted">README points</p>
              <ul className="pack-list small">{p.readme.map((x, j) => <li key={j}>{x}</li>)}</ul>
            </div>
          </section>
        );
      })}

      {/* 14 · improvements */}
      <section id={`pack-${sec.id}-improvements`}>
        <Part n={14} label="Project Improvement Tasks" count={partTotal('improvements')} done={partDone('improvements')} />
        {t.projects.map((p, i) => (
          <CheckRow key={i} done={done(packItem(sec.id, 'improvements', i))} onToggle={() => toggle(packItem(sec.id, 'improvements', i))}>
            <p className="pack-q">{p.name}: Version 1 → Version 4</p>
            <p className="small">V1 (this pack): {p.objective}</p>
            <ul className="pack-list small">{p.improvements.map((x, j) => <li key={j}>V{2 + j}: {x}</li>)}</ul>
            <ul className="pack-list small">{p.advanced.map((x, j) => <li key={j}>V4 (industry): {x}</li>)}</ul>
          </CheckRow>
        ))}
      </section>

      {/* 15 · interview tasks */}
      <section id={`pack-${sec.id}-interviewTasks`}>
        <Part n={15} label="Interview-Based Practical Tasks" count={partTotal('interviewTasks')} done={partDone('interviewTasks')} />
        {t.interviewTasks.map((x, i) => (
          <CheckRow key={i} done={done(packItem(sec.id, 'interviewTasks', i))} onToggle={() => toggle(packItem(sec.id, 'interviewTasks', i))}>
            <p className="pack-q">{x.q}</p>
            {x.deliverable && <p className="small muted">Deliverable: {x.deliverable}</p>}
            <Reveal label="Show model answer">
              <p>{x.a}</p>
            </Reveal>
          </CheckRow>
        ))}
      </section>

      {/* 16 · revision */}
      <section id={`pack-${sec.id}-revision`}>
        <Part n={16} label="Revision Checklist" count={partTotal('revision')} done={partDone('revision')} />
        <div className="card">
          <ul className="pack-list">
            {t.revision.map((r, i) => {
              const key = packItem(sec.id, 'revision', i);
              return (
                <li key={i}>
                  <label className="row" style={{ gap: 8 }}>
                    <input type="checkbox" checked={done(key)} onChange={() => toggle(key)} />
                    <span className={done(key) ? 'muted' : ''}>{r}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* project questions — outside the 16, so the accordion never hides it */}
      <section id={`pack-${sec.id}-projectQuestions`} className="pack-always">
        <h3 className="pack-h"><span className="pack-no">+</span> Project Questions</h3>
        <div className="grid2">
          {(['understanding', 'coding', 'advanced', 'interview'] as const).map((g) => (
            <div className="card" key={g}>
              <p className="small muted">{g}</p>
              <ul className="pack-list small">{t.projectQuestions[g].map((q, i) => <li key={i}>{q}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <div className="row" style={{ margin: '14px 0' }}>
        <button className="btn ghost" onClick={() => setShowAll((v) => !v)}>{showAll ? 'Hide' : 'Show'} pack summary</button>
        <span className="small muted">{t.authored ? 'authored practice pack · every snippet executed while authoring' : ''}</span>
      </div>
      {showAll && (
        <div className="card">
          <p className="small">
            {items.length} checkable items · {t.coding.length} coding tasks · {t.debugging.length} debugging tasks ·
            {' '}{PRACTICE_LEVELS.reduce((n, l) => n + (t.practice[l] ?? []).length, 0)} practice questions ·
            {' '}{t.projects.length} projects · {t.interviewTasks.length} interview tasks · {t.revision.length} revision checks.
          </p>
        </div>
      )}
    </div>
  );
}

export default TopicWorkspace;
