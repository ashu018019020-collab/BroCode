/**
 * Offline assistant.
 *
 * There is no network and no hosted model here — and this module never pretends
 * otherwise. It answers by *retrieving* the matching part of the bundled
 * curriculum (the same engine the RAG Lab teaches) and by calling the
 * deterministic tutor / progress engines for its quick actions.
 *
 * If nothing matches, it says so honestly instead of inventing an answer.
 *
 * Questions about this PROJECT (not about Python) are answered by `engine/project.ts` first — a
 * retrieval index over lesson text can explain `lambda` but not where to add a question.
 */
import type { AppState, Section } from '../../types';
import { buildChunks, buildIndex, retrieve, answerFrom, tokenize, type Index, type Scored } from './rag';
import { coachFor, coachSectionFor, nextTask, debugSteps, hintLadder, explainTraceback } from './tutor';
import { currentSection, nextBestAction, sectionProgress, weakTopic } from '../learning/progress';
import { openBySection, mistakeRoute, sourceLabel, isBankMistake, bankRedo } from './coach';
import { reviewInfo, reviewLabel } from '../learning/review';
import { questionRubric } from '../assessment/evaluate';
import { bankAccuracy, bankAccuracyBySection, isAnswer, pctText, rubricFor } from '../assessment/accuracy';
import { askProject } from './project';
import { retrieveKnowledge, type KnowledgeIndex } from './knowledge';

export interface Answer {
  /** Plain-English answer text. Always sourced from real content or real state. */
  text: string;
  /** Where the answer came from, so the learner can read the full lesson. */
  sources: { title: string; route: string; reference?: string }[];
  /** 0–1 lexical similarity of the best hit (0 when nothing matched). */
  confidence: number;
  /**
   * `project` is the one kind that is not about Python: it answers questions about this app itself
   * (setup, where content lives, how to test). See `engine/project.ts`.
   */
  kind: 'curriculum' | 'coach' | 'hint' | 'next' | 'debug' | 'state' | 'project' | 'fallback';
}

/**
 * Where the assistant is embedded and what the learner has in front of them.
 *
 * Every field is optional on purpose: the Dashboard instance passes nothing and must keep behaving
 * exactly as it did. A notebook instance passes its section and, when a cell just failed, the real
 * traceback — that is what turns a general tutor into one that can answer about the mistake on the
 * screen.
 */
export interface AssistantContext {
  /** The section the learner is inside right now — used to bias retrieval toward this lesson. */
  sectionId?: string;
  route?: string;
  pageTitle?: string;
  courseSlug?: string;
  courseTitle?: string;
  chapterTitle?: string;
  lessonTitle?: string;
  topic?: string;
  questionType?: string;
  learningLevel?: string;
  learningGoal?: string;
  progressSummary?: string;
  /** Human label of the embedding surface, e.g. "Task 4 · coding". */
  where?: string;
  /** The code of the cell that produced the error below. */
  code?: string;
  /** The last error the notebook really raised. Absent means "nothing is broken right now". */
  error?: string;
  /**
   * The question the learner has in front of them.
   *
   * This is what lets the assistant answer, hint and SCORE one exact item instead of the topic in
   * general: the Question Bank, every in-lesson stage panel and Interview Mode pass the question,
   * the model answer and whatever the learner has written so far. Without it those requests fall
   * back to retrieval, which can only say something about the subject, never about this answer.
   */
  question?: QuestionContext;
}

/** The item on screen, as the assistant needs it. Every field comes from real content or state. */
export interface QuestionContext {
  /** The question text. */
  text: string;
  /** The model answer — or, for the V15 document's checkpoint prompts, its own method line. */
  model: string;
  /** What the learner has written so far ('' when nothing yet). */
  mine?: string;
  sectionId?: string;
  /** Question type (`interview`, `coding`, …) — decides the wording and the structure hint. */
  type?: string;
  /** Provenance line, e.g. "Playbook V15 · ch.18" or "Curriculum PDF". */
  source?: string;
  /** True when the document gave a method instead of a model answer (never rubric-scored). */
  methodOnly?: boolean;
}

interface Doc { text: string; source: string; route: string }

/** Built once per curriculum instance and reused across questions. */
let cached: { key: unknown; index: Index; meta: { route: string; title: string }[] } | null = null;

function buildDocs(sections: Section[]): Doc[] {
  const docs: Doc[] = [];
  for (const s of sections) {
    for (const c of s.learn.concepts) {
      const body = `${c.title}. ${c.body} ${c.tip}`.trim();
      if (body.length > 40) docs.push({ text: body, source: `${s.title} → ${c.title}`, route: `/lesson/${s.id}/learn` });
      if (c.code) docs.push({ text: `${c.title} code example: ${c.code} ${c.output}`, source: `${s.title} → ${c.title} (code)`, route: `/lesson/${s.id}/learn` });
    }
    if (s.learn.recap) docs.push({ text: `${s.title} recap: ${s.learn.recap}`, source: `${s.title} → recap`, route: `/lesson/${s.id}/learn` });
    for (const r of s.learn.remember ?? []) docs.push({ text: `${s.title}: ${r}`, source: `${s.title} → remember`, route: `/lesson/${s.id}/learn` });
    s.interview.forEach((q) => {
      if (q.a) docs.push({ text: `Q: ${q.q} A: ${q.a}`, source: `${s.title} → interview`, route: `/lesson/${s.id}/interview` });
    });
    s.coding.forEach((t, i) => {
      if (t.solution) docs.push({ text: `Task: ${t.text} Solution: ${t.solution}`, source: `${s.title} → coding task ${i + 1}`, route: `/lesson/${s.id}/coding` });
    });
    s.logic.forEach((l) => { if (l.answer) docs.push({ text: `Logic: ${l.text} Answer: ${l.answer}`, source: `${s.title} → logic`, route: `/lesson/${s.id}/logic` }); });
  }
  return docs;
}

function getIndex(sections: Section[]) {
  if (cached && cached.key === sections) return cached;
  const docs = buildDocs(sections);
  const chunks = buildChunks(docs, 45, 8);
  const meta = chunks.map((c) => ({ route: docs.find((d) => c.source.startsWith(d.source))?.route ?? '/courses', title: c.source }));
  cached = { key: sections, index: buildIndex(chunks), meta };
  return cached;
}

/**
 * Below this, the module calls a match weak (see the "thoda weak hai" note the answer carries).
 * A passage this poor must not be promoted on sectional loyalty alone.
 */
const WEAK_MATCH = 0.12;

/**
 * How close an in-section passage must come to the global winner before we cite it instead.
 *
 * A flat score bonus (± 0.08) was tried first and cannot work in either direction: it is too small
 * to lift a real passage over a real match ("Accessing Values" in s12 scores below s06's 0.44, and
 * 0.30 + 0.08 still loses), and raising the constant makes it blind to match quality — a 0.05
 * in-section passage would start beating a 0.20 global one. Hence a *relative* rule.
 *
 * Tuned against the real index, on two questions at once:
 *
 *   when the learner asks about the lesson they are IN  → we want to cite that lesson;
 *   when they ask about something else entirely        → we must NOT, or they read the wrong page.
 *
 * Sweeping every concept title in the curriculum covers both (180 on-topic probes, 180 probes asked
 * from a deliberately mismatched section), measured through `askLocal`, which is what a learner hits:
 *
 *   ratio    on-topic citation    cross-topic leak
 *   0.4      98%                  45%
 *   0.5      100%                 25%
 *   0.6      99%                  16%   ← chosen
 *   0.7      87%*                 9%*
 *   0.8      81%*                 5%*
 *
 * (*) those two were measured on the ranking alone. 0.5 looks better on the headline number, but a
 * leak hands the learner content from an unrelated lesson — a worse failure than a citation that
 * points at a sibling stage of the lesson they are reading. 0.6 costs one on-topic probe out of 144
 * and removes a third of the leaks, so the tuning stops there.
 */
const SECTION_PREFER_RATIO = 0.6;

/**
 * How many candidates the preference rule gets to look at.
 *
 * This has to be wide, and that is the point of the number. A heading of the page you are reading
 * can rank 9th globally — "Accessing Values" is a Dictionaries heading that lost to s06's prose at
 * 0.44 on a cold ask. With a top-8 net the section's own passage was never even a candidate, so no
 * rule could promote it and the assistant cited the wrong lesson while the learner looked at the
 * right one.
 */
const RERANK_POOL = 60;

/**
 * Take the best `k` hits, preferring passages from the section the learner is actually sitting in.
 *
 * Retrieval here is lexical only, so a question asked inside s07 could be answered from s22's prose
 * on a marginally higher score — technically the best match, practically the wrong lesson.
 *
 * An earlier version added a flat +0.08 to in-section scores, which is not enough to lift a real
 * passage over a real match: "Accessing Values" in s12 scores below s06's 0.44, and 0.30 + 0.08
 * still loses. It cannot be fixed by raising the constant either, because a flat bonus is blind to
 * how good the match was — a 0.05 in-section passage would start beating a 0.20 global one. The
 * honest rule is relative: cite this lesson when its own passage is *comparable* to the global
 * winner, and step aside when the global winner is genuinely better.
 *
 * With no section in context the ranking is left exactly as retrieval returned it.
 */
function rankForSection(
  hits: Scored[],
  meta: { route: string; title: string }[],
  sectionId: string | undefined,
  k = 3,
): Scored[] {
  if (!sectionId || !hits.length) return hits.slice(0, k);
  const inSection = (h: Scored) => (meta[h.id]?.route ?? '').startsWith(`/lesson/${sectionId}/`);

  const top = hits[0];
  const best = hits.filter(inSection).reduce<Scored | undefined>((a, b) => (b.score > (a?.score ?? -1) ? b : a), undefined);
  const prefer = !!best && best.score >= WEAK_MATCH && best.score >= SECTION_PREFER_RATIO * top.score;
  if (!prefer) return hits.slice(0, k);

  // Promote the lesson's own passage, and leave the remaining order as retrieval had it.
  return [best!, ...hits.filter((h) => h !== best)].slice(0, k);
}

/** Free-text question → best retrieved curriculum passage, biased to the lesson in view. */
export function askLocal(
  question: string,
  sections: Section[],
  state: AppState,
  context?: AssistantContext,
  asked = 0,
  knowledge?: KnowledgeIndex,
): Answer {
  const q = question.trim();
  if (!q) return { text: '', sources: [], confidence: 0, kind: 'fallback' };

  // "next task" style requests are answered from real progress state, not retrieval.
  if (/\b(next|agla|aage|kya karun|what should i|what should i learn)\b/i.test(q)) {
    return quickNext(state, sections, context, q, knowledge);
  }
  // A typed "hint" is the same request as the Give Hint button, so it gets the same context and
  // the same rung — otherwise the two routes answer differently about the same page.
  if (/\b(hint|hint do|clue|madad)\b/i.test(q)) return quickHint(state, sections, context, asked);
  // The two things a learner asks about ONE item: "give me the answer" and "how right was mine?".
  // Both are answered from the question in context plus the same keyword rubric every other surface
  // scores with — never from retrieval, which can only talk about the subject.
  if (/\b(poora (answer|jawab)|answer (do|dedo|batao|chahiye|kya hai)|jawab (do|batao)|solution (do|batao)|full answer|model answer|show (the )?answer|give (me )?(the )?answer|what is the answer)\b/i.test(q)) {
    return quickAnswer(state, sections, context);
  }
  if (/\b(kitna sahi|kitne sahi|kitna score|score (karo|do|kitna)|mera answer|accuracy|how (correct|right|wrong|good) is my answer|score my answer|grade my answer)\b/i.test(q)) {
    return quickScoreAnswer(state, sections, context);
  }

  // Is the question about THIS APP rather than about Python? "naya question kaha add karun" and
  // "test kaise chalaun" are real questions with real answers that no curriculum index contains.
  // `askProject` is strict on purpose and returns null for anything it is not sure about, which is
  // what keeps curriculum retrieval unchanged for every lesson question.
  const project = askProject(q);
  if (project) return project;

  if (knowledge) {
    const indexed = answerFromKnowledge(q, knowledge, context);
    if (indexed) return indexed;
  }

  // Retrieve wide, then apply the preference rule — it can only promote a passage that is actually
  // a candidate, so the pool must be big enough to contain the section's own content.
  const { index, meta } = getIndex(sections);
  const hits = rankForSection(retrieve(index, q, RERANK_POOL), meta, context?.sectionId);
  const { text } = answerFrom(q, hits);
  const top = hits[0];

  if (!text || !top) {
    // Nothing matched. If an error is on screen, answer THAT: "curriculum me nahi mila" is a
    // useless reply to a traceback the learner is staring at right now.
    if (context?.error) return quickFix(state, sections, context);
    const cur = currentSection(sections, state);
    return {
      text:
        `This question was not found in the bundled curriculum — I will not invent a wrong answer. ` +
        `Try: open the "${cur.title}" lesson, or ask using the concept name ` +
        `(for example "list vs tuple", "lambda", "try except").`,
      sources: [{ title: `${cur.title} lesson`, route: `/lesson/${cur.id}/learn` }],
      confidence: 0,
      kind: 'fallback',
    };
  }

  function answerFromKnowledge(
    question: string,
    index: KnowledgeIndex,
    context?: AssistantContext,
  ): Answer | null {
    const hits = retrieveKnowledge(index, question, {
      sectionId: context?.sectionId,
      course: context?.courseSlug,
      type: context?.questionType,
      topic: context?.topic,
      learningLevel: context?.learningLevel,
      learningGoal: context?.learningGoal,
    });
    if (!hits.length) {
      if (/\b(interview|project|portfolio|build idea)\b/i.test(question)) {
        return {
          text: 'No matching published content was found in this category — I will not invent project or interview material. Ask the question with a specific topic, course, or section.',
          sources: context?.route ? [{ title: context.pageTitle ?? 'Current page', route: context.route.split('?')[0] }] : [],
          confidence: 0,
          kind: 'fallback',
        };
      }
      return null;
    }

    const { document, score } = hits[0];
    const answer = document.answer?.trim();
    const explanation = document.explanation?.trim();
    const body = document.body?.trim();
    let text: string;
    if (document.kind === 'interview' || document.kind === 'question' || document.kind === 'defense-question') {
      text = `Question: **${document.title}**`;
      if (answer) text += `\n\nAnswer: ${answer}`;
      if (explanation) text += `\n\nWhy: ${explanation}`;
    } else if (document.kind === 'project') {
      text = `**${document.title}**${body ? `\n\n${body}` : answer ? `\n\n${answer}` : ''}`;
    } else {
      text = `**${document.title}**${body ? `\n\n${body}` : answer ? `\n\n${answer}` : ''}`;
      if (explanation) text += `\n\n${explanation}`;
    }
    if (context?.progressSummary) text += `\n\nCurrent section progress: ${context.progressSummary}.`;
    if (context?.learningLevel) text += ` Learner level: ${context.learningLevel}.`;

    const sources = hits.slice(0, 3).map(({ document: hit }) => ({
      title: [hit.sectionTitle ?? hit.courseTitle ?? hit.source, hit.title].filter(Boolean).join(' · '),
      route: hit.route,
      reference: `${hit.source} — ${hit.sourceRef}`,
    }));
    return {
      text,
      sources,
      confidence: Math.min(1, Number((score / 3).toFixed(3))),
      kind: document.kind === 'project' ? 'project' : 'curriculum',
    };
  }

  const sources = hits.map((h, i) => ({ title: meta[h.id]?.title ?? h.source, route: meta[h.id]?.route ?? '/courses' })).slice(0, 3);
  const extra = top.score < 0.12
    ? '\n\n(This match is a little weak — open the source below to confirm.)'
    : '';
  return { text: text + extra, sources, confidence: Number(top.score.toFixed(3)), kind: 'curriculum' };
}

/** Quick action: explain the concept the coach would teach right now. */
export function quickExplain(state: AppState, sections: Section[], context?: AssistantContext): Answer {
  const activeSection = context?.sectionId ? sections.find((item) => item.id === context.sectionId) : null;
  const { section: coachedSection, why: coachWhy, schedule } = coachSectionFor(state, sections);
  const section = activeSection ?? coachedSection;
  const why = activeSection ? `Current lesson: ${activeSection.title}.` : coachWhy;
  const coach = coachFor(section, state, why);
  if (!coach?.concept) return { text: 'There is no concept ready to explain right now.', sources: [], confidence: 0, kind: 'fallback' };
  const c = coach.concept;
  // Reasoning comes from EVERY surface the learner failed on, not just the lab.
  const retake = coach.mistakes[0];
  const retakeBlock = retake
    ? `\n\nRetry (${retake.label}):\n${retake.question.slice(0, 220)}` +
      (retake.myAnswer ? `\nYou wrote: ${retake.myAnswer.slice(0, 160)}` : '') +
      `\nCorrect answer: ${retake.correct.slice(0, 200)}`
    : '';
  const schedBlock = schedule ? `\n\nSchedule: ${schedule.text}` : '';
  return {
    text:
      `${why}\n\n**${c.title}**\n${c.body.slice(0, 420)}${c.body.length > 420 ? '…' : ''}` +
      `${c.code ? `\n\nExample:\n${c.code.slice(0, 240)}` : ''}${retakeBlock}${schedBlock}`,
    sources: [
      { title: `${section?.title} → ${c.title}`, route: section ? `/lesson/${section.id}/learn` : '/courses' },
      ...(retake ? [{ title: retake.routeLabel, route: retake.route }] : []),
    ],
    confidence: 1,
    kind: 'coach',
  };
}

/**
 * Quick action: what the learner actually got wrong, grouped by the surface it
 * came from, with the real retry route for each. Question-bank and exam failures
 * are listed alongside coding-lab bugs because they are all real failures.
 */
export function quickMistakes(state: AppState, sections: Section[]): Answer {
  const open = state.mistakes.filter((m) => !m.fixed);
  if (!open.length) {
    return {
      text: 'There are no open mistakes right now — the Mistake Tracker is clear. Next step: test yourself in the Timed Exam or Question Bank.',
      sources: [{ title: 'Question Bank', route: '/questions' }, { title: 'Timed Exam', route: '/exam' }],
      confidence: 0,
      kind: 'state',
    };
  }

  const bankish = open.filter(isBankMistake);
  const bySource = new Map<string, number>();
  for (const m of open) bySource.set(sourceLabel(m), (bySource.get(sourceLabel(m)) ?? 0) + 1);

  // Repeated topics first, then whatever is most recent.
  const byTopic = new Map<string, { n: number; m: typeof open[number] }>();
  for (const m of open) {
    const cur = byTopic.get(m.topic);
    byTopic.set(m.topic, { n: (cur?.n ?? 0) + 1, m });
  }
  const ranked = [...byTopic.values()]
    .sort((a, b) => b.n - a.n || String(b.m.date).localeCompare(String(a.m.date)))
    .slice(0, 3);

  const lines = ranked.map(({ n, m }) => {
    const { route, label } = mistakeRoute(m);
    return `• ${m.topic}${n > 1 ? ` (${n}×)` : ''} — ${sourceLabel(m)}\n  Q: ${m.question.slice(0, 130)}\n  Retry: ${label}`;
  });

  // Schedule the re-teach from the real review levels of the sections involved.
  const grouped = openBySection(state, sections);
  const schedLines: string[] = [];
  for (const sectionId of grouped.keys()) {
    const info = reviewInfo(state, sectionId);
    if (info) schedLines.push(`• ${sectionId.toUpperCase()}: ${reviewLabel(info)}`);
  }

  return {
    text:
      `Open mistakes: ${open.length}` +
      (bankish.length ? ` (${bankish.length} from the Question Bank / Timed Exam — beyond the coding lab)` : '') +
      `\n${[...bySource.entries()].map(([k, v]) => `${k}: ${v}`).join(' · ')}` +
      `\n\nMost important:\n${lines.join('\n')}` +
      (schedLines.length ? `\n\nRe-teach schedule (spaced repetition):\n${schedLines.join('\n')}` : ''),
    sources: [
      { title: 'Mistake Tracker', route: '/mistakes' },
      ...(bankish.length ? [{ title: 'Question Bank', route: '/questions' }] : []),
    ],
    confidence: 1,
    kind: 'state',
  };
}

/**
 * Quick action: explain the error that is on screen RIGHT NOW, in the learner's own code.
 *
 * This is the difference between an assistant that is merely present and one that is useful while
 * coding: it reads the real traceback the cell produced, says what that error means, points at the
 * offending line inside the code the learner actually wrote, and gives the debug plan for that
 * error kind. `input()` gets a dedicated note, because a missing PROGRAM INPUT line is the single
 * most common cause of a failure in this app and the raw traceback never explains it.
 *
 * With no error on screen it refuses to invent one — it says so plainly and offers the hint ladder
 * for the current task instead. An assistant that fabricates a plausible-looking error would be
 * worse than no assistant at all.
 */
export function quickFix(state: AppState, sections: Section[], context?: AssistantContext): Answer {
  const cur = (context?.sectionId ? sections.find((s) => s.id === context.sectionId) : undefined) ?? currentSection(sections, state);
  const err = context?.error?.trim();

  if (!err) {
    const t = nextTask(state, sections);
    const ladder = hintLadder(explainTraceback(''), 1, false);
    return {
      text:
        'There is no error in this cell right now — I will not invent one.\n\n' +
        'Run the cell (Ctrl+↵). If it fails, the full traceback will appear and I will explain the fix at that line.\n\n' +
        `Meanwhile, a hint for **${t.label}**:\n${ladder.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
      sources: [{ title: t.label, route: t.route }],
      confidence: 1,
      kind: 'hint',
    };
  }

  const expl = explainTraceback(err);
  const code = context?.code ?? '';
  const inputCalls = (code.match(/\binput\s*\(/g) ?? []).length;
  const lineText = expl?.line ? (code.split('\n')[expl.line - 1] ?? '').trim() : '';
  const lastLine = err.split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? err;

  const body = expl
    ? `**${expl.kind}** — ${expl.headline}\n` +
      `What happened: ${expl.what}\n` +
      `Why: ${expl.cause}\n` +
      `Fix: ${expl.fix}` +
      (lineText ? `\n\nYour line ${expl.line}:  ${lineText}` : '') +
      (expl.example ? `\nExample: ${expl.example}` : '')
    : `Last line of the traceback: ${lastLine}`;

  const steps = debugSteps(expl, inputCalls > 0).slice(0, 5);
  const inputNote = inputCalls > 0
    ? `\n\nThis cell has input() ${inputCalls}× — provide ${inputCalls} lines in the PROGRAM INPUT box (one value per line), then Run again.`
    : '';

  return {
    text:
      `Error in this cell${context?.where ? ` (${context.where})` : ''}:\n\n${body}` +
      `\n\nDebug plan:\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}${inputNote}`,
    sources: [
      { title: `${cur.title} → ${expl?.topic ?? 'debug'}`, route: `/lesson/${cur.id}/debug` },
      { title: 'Mistake Tracker', route: '/mistakes' },
    ],
    confidence: 1,
    kind: 'debug',
  };
}

/**
 * Quick action: a hint for the surface the learner is actually on, escalating as they ask again.
 *
 * This used to ignore the page completely. It took `nextTask()` — the globally *next* task from
 * progress state — and asked the ladder about an empty traceback, so every section, every stage and
 * every repeat produced the same three generic lines. Measured live before this fix: `s01/coding`,
 * `s05/coding` and `s09/learn` returned byte-identical text, and the Learn stage was told to "Solve
 * a coding task". The counter it read (`st:<sid>:hint`) has no writer anywhere, so the ladder could
 * never escalate either — hence no memory of previous asks lives in this engine any more. The
 * caller passes how many hints it has already shown on this surface (`asked`), which keeps this
 * function pure and keeps a read-out of progress out of `state.attempts`.
 */
export function quickHint(state: AppState, sections: Section[], context?: AssistantContext, asked = 0): Answer {
  // The lesson on screen — the whole point of the context. Falls back to the learner's current
  // section so the Dashboard instance (which passes nothing) keeps working.
  const cur = (context?.sectionId ? sections.find((s) => s.id === context.sectionId) : undefined) ?? currentSection(sections, state);
  const err = context?.error?.trim();
  const rung = Math.max(1, asked + 1);

  // A real traceback lets the ladder name the failing line and, from the third ask on, the fix
  // itself. With nothing broken, "read the error pane" is wrong advice — point at this section's
  // own open gate instead, and reveal one rung per ask so the same click never repeats.
  const expl = err ? explainTraceback(err) : null;
  const hasInput = /\binput\s*\(/.test(context?.code ?? '');
  const qc = context?.question;

  // A question in context outranks the section ladder — but never the traceback: a broken cell is a
  // fact about the code in front of the learner, while the question is what they are reading.
  if (qc && !expl) {
    const qRungs = questionRungs(qc, rung);
    return {
      text:
        `**${context?.where ?? qc.source ?? 'This question'}**\n${qRungs.map((h, i) => `${i + 1}. ${h}`).join('\n')}` +
        (rung > 1 ? '' : `\n\nQ: ${clip(qc.text, 180)}`),
      sources: [{
        title: qc.source ?? 'Question Bank',
        route: qc.sectionId ? `/lesson/${qc.sectionId}/${STAGE_FOR_TYPE[qc.type ?? ''] ?? 'interview'}` : '/questions',
      }],
      confidence: 1,
      kind: 'hint',
    };
  }

  const rungs = expl ? hintLadder(expl, rung, hasInput) : sectionRungs(cur, state);
  const shown = expl ? rungs : rungs.slice(0, Math.min(rungs.length, rung));

  return {
    text: `**${context?.where ?? cur.title}**\n${shown.map((h, i) => `${i + 1}. ${h}`).join('\n')}`,
    sources: [{ title: `${cur.title} lesson`, route: `/lesson/${cur.id}/learn` }],
    confidence: 1,
    kind: 'hint',
  };
}

/**
 * The rungs for a hint when nothing is broken: where this section actually stands. The generic
 * ladder is all about tracebacks, so it is useless — and misleading — when the code runs fine.
 */
function sectionRungs(sec: Section, state: AppState): string[] {
  const nba = nextBestAction(sec, state);
  const rungs = [`Right now in this section: ${nba.label} — ${nba.reason}`];
  const coach = coachFor(sec, state, nba.reason);
  if (coach?.concept) rungs.push(`${coach.concept.title}: ${coach.concept.body.slice(0, 170)}`);
  rungs.push('Predict the output in your head first, then Run — the difference is the real signal.');
  return rungs;
}

/* --------------------- one question, answered properly --------------------- */

/** Which lesson stage practises each question type — the retry route for an item. */
const STAGE_FOR_TYPE: Record<string, string> = {
  interview: 'interview', theory: 'learn', coding: 'coding', solved: 'solved',
  debug: 'debug', logic: 'logic', checkpoint: 'checkpoint', defense: 'defense',
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).trimEnd()}…` : s);

/** How each type wants its answer shaped. */
function structureFor(type?: string): string {
  switch (type) {
    case 'coding': case 'solved': case 'debug': return 'input → step-by-step logic → output → one edge case';
    case 'logic': return 'predict → why (reason) → how to verify';
    case 'checkpoint': case 'theory': return 'short definition → one example → why it matters';
    default: return 'definition → short example → practical use → edge case';
  }
}

/**
 * Hint rungs for ONE question, escalating per ask.
 *
 * The section ladder answers "what should I do in this lesson"; this answers "how do I answer THIS".
 * The middle rungs are the model answer's own rubric groups (`questionRubric`), so the hints push the
 * learner toward the exact points their answer will be scored against — and the model answer itself
 * is only handed over when they ask for it explicitly (the "Poora answer" action).
 */
function questionRungs(q: QuestionContext, rung: number): string[] {
  const keys = questionRubric(q.model).map((group) => group.split('|').slice(0, 3).join(' / '));
  const mine = (q.mine ?? '').trim();
  const all = [
    mine
      ? `You wrote: "${clip(mine, 120)}" — tighten this to 2 lines.`
      : 'First write 2 lines in your own words: what it is + one short example.',
    keys.length ? `Cover these key points: ${keys.slice(0, 3).join(' · ')}` : "Note the model answer's keywords and use them in your answer.",
    `Structure: ${structureFor(q.type)}`,
    keys.length > 3 ? `Other points: ${keys.slice(3).join(' · ')}` : 'If you are stuck, press "Full answer" — I will show the model answer.',
  ];
  return all.slice(0, Math.max(1, Math.min(all.length, rung)));
}

/** The retry route and label for one question in context. */
function questionRoute(q?: QuestionContext): { route: string; title: string } {
  if (!q?.sectionId) return { route: '/questions', title: 'Question Bank' };
  const stage = STAGE_FOR_TYPE[q.type ?? ''] ?? 'interview';
  return { route: `/lesson/${q.sectionId}/${stage}`, title: q.source ?? `${q.sectionId} → ${stage}` };
}

/**
 * Quick action: the answer for the item on screen.
 *
 * Two honest cases, never one blurry one: a question with a model answer returns that answer (and
 * the rubric points it will be judged on); a V15 checkpoint prompt returns the document's own METHOD
 * line, clearly labelled, because scoring a method as if it were an answer would be a lie.
 */
export function quickAnswer(state: AppState, sections: Section[], context?: AssistantContext): Answer {
  const q = context?.question;
  if (!q) {
    return {
      text: 'Which question do you want the answer to? Open the AI hint from any question in the Question Bank or a lesson stage — then I will give the answer, hints, and percentage for that exact item.',
      sources: [{ title: 'Question Bank', route: '/questions' }, { title: 'Interview Mode', route: '/interview-mode' }],
      confidence: 1,
      kind: 'state',
    };
  }
  const { route, title } = questionRoute(q);

  if (q.methodOnly) {
    return {
      text:
        `This item has no model answer — the V15 document provides its METHOD here (checkpoint / production-scenario prompt):\n\n` +
        `${clip(q.model, 600)}\n\n` +
        'Follow this method to write your answer; I will give a percentage once you have written one.',
      sources: [
        { title: q.source ?? 'Playbook V15', route: '/playbook' },
        { title: q.sectionId ? `${q.sectionId.toUpperCase()} checkpoint` : 'Question Bank', route: q.sectionId ? `/lesson/${q.sectionId}/checkpoint` : '/questions' },
      ],
      confidence: 1,
      kind: 'curriculum',
    };
  }

  const keys = questionRubric(q.model).map((g) => g.split('|')[0]);
  return {
    text:
      `**Q:** ${clip(q.text, 220)}\n\n**Answer:**\n${clip(q.model, 700)}` +
      (keys.length ? `\n\nRubric key points: ${keys.join(' · ')}` : '') +
      '\n\nWrite your own answer first, then compare — press "How correct is my answer" to get a percentage.',
    sources: [{ title, route }],
    confidence: 1,
    kind: 'curriculum',
  };
}

/**
 * Quick action: score the learner's own answer for the item on screen.
 *
 * It reports the keyword-rubric percentage (the same rubric Interview Mode, the mock rounds and the
 * final paper use) plus the exact points the answer missed — and it says plainly that the
 * self-grade, not this number, is what moves mastery.
 */
export function quickScoreAnswer(state: AppState, sections: Section[], context?: AssistantContext): Answer {
  const q = context?.question;
  if (!q) return quickAccuracy(state, sections);
  const { route, title } = questionRoute(q);
  const mine = (q.mine ?? '').trim();

  if (q.methodOnly || mine.length < 2) {
    return {
      text:
        (q.methodOnly
          ? 'This item has no model answer (the document provides a method), so I will not generate a rubric percentage.'
          : 'You have not written anything for this question yet, so how can I give a percentage? Write your answer first (it is saved), then press this button.') +
        `\n\nQ: ${clip(q.text, 180)}`,
      sources: [{ title, route }],
      confidence: 1,
      kind: 'state',
    };
  }

  const r = rubricFor(mine, q.model);
  if (!r) {
    // Two different reasons reach here, and they need different advice: the learner wrote a stub, or
    // the model answer is too small to build a rubric from. Saying "model answer chhota hai" to
    // someone who typed "haan" would send them looking in the wrong place.
    const stub = !isAnswer(mine);
    return {
      text:
        (stub
          ? `You have written too little to measure ("${clip(mine, 60)}") — write 1-2 lines in your own words: what it is + one example. Then a percentage will mean something.`
          : 'A rubric could not be built from this model answer (it is too short) — I will not invent a percentage. Read the model answer yourself and grade with "Correct / Mistake".') +
        `\n\nQ: ${clip(q.text, 180)}`,
      sources: [{ title, route }],
      confidence: 1,
      kind: 'state',
    };
  }

  const verdict = r.pct >= 80 ? '✅ very correct' : r.pct >= 50 ? '⚠️ half-done' : '🔴 weak — write it again';
  return {
    text:
      `Rubric score for your answer: **${r.pct}%** ${verdict}\n` +
      (r.missing.length
        ? `\nThese key points were missed:\n${r.missing.map((m) => `• ${m.split('|').join(' / ')}`).join('\n')}`
        : '\nAll rubric points are covered — now just tighten the structure.') +
      '\n\nTo compare with the model answer, press "Full answer". The self-grade (correct/wrong) is yours — mastery depends on it; this percentage is feedback.',
    sources: [{ title, route }, { title: 'Mistake Tracker', route: '/mistakes' }],
    confidence: 1,
    kind: 'state',
  };
}

/** Quick action: how accurate the learner's answers are — overall and per section. */
export function quickAccuracy(state: AppState, sections: Section[]): Answer {
  const overall = bankAccuracy(state);
  const ranked = Object.entries(bankAccuracyBySection(state))
    .filter(([, a]) => a.pct !== null)
    .sort((a, b) => (a[1].pct ?? 0) - (b[1].pct ?? 0));

  if (!overall.answered) {
    return {
      text: 'No answers have been recorded yet — answer questions in the Question Bank or any lesson stage, then I will tell you where you are weak based on the percentage.',
      sources: [{ title: 'Question Bank', route: '/questions' }],
      confidence: 1,
      kind: 'state',
    };
  }

  const name = (sid: string) => sections.find((s) => s.id === sid)?.title ?? sid.toUpperCase();
  const weak = ranked.slice(0, 3);
  const strong = ranked.slice(-1)[0];
  return {
    text:
      `Answer accuracy: **${pctText(overall.pct)}** (${overall.correct}/${overall.graded} correct, ${overall.answered} answers written).\n` +
      (overall.avg !== null ? `Rubric average: ${pctText(overall.avg)} — match of written answers with the model answer.\n` : '') +
      (weak.length ? `\nWeakest:\n${weak.map(([sid, a]) => `• ${name(sid)} — ${pctText(a.pct)} (${a.correct}/${a.graded})`).join('\n')}` : '') +
      (strong ? `\nStrongest: ${name(strong[0])} — ${pctText(strong[1].pct)}` : '') +
      '\n\nThe percentage comes from self-graded answers (you mark correct/wrong), and the rubric average is for the answers you wrote. No number is estimated.',
    sources: [{ title: 'Progress', route: '/progress' }, { title: 'Mistake Tracker', route: '/mistakes' }],
    confidence: 1,
    kind: 'state',
  };
}

/** Quick action: the single best next thing to do, with the reason. */
export function quickNext(
  state: AppState,
  sections: Section[],
  context?: AssistantContext,
  question = '',
  knowledge?: KnowledgeIndex,
): Answer {
  const contextual = recommendNextTopic(question || context?.topic || '', sections, context, knowledge);
  if (contextual) return contextual;
  const active = context?.sectionId ? sections.find((section) => section.id === context.sectionId) : undefined;
  if (active) {
    const action = nextBestAction(active, state);
    return {
      text: `You are currently in **${active.title}**.\n\nNext in this section: **${action.label}** — ${action.reason}`,
      sources: [{ title: `${active.title} · ${action.label}`, route: action.route }],
      confidence: 1,
      kind: 'next',
    };
  }
  const t = nextTask(state, sections);
  const cur = currentSection(sections, state);
  const nba = nextBestAction(cur, state);
  return {
    text: `Next: **${t.label}**\n${t.reason}\n\nRight now in this section: ${nba.label} — ${nba.reason}`,
    sources: [{ title: t.label, route: t.route }],
    confidence: 1,
    kind: 'next',
  };
}

function recommendNextTopic(
  question: string,
  sections: Section[],
  context?: AssistantContext,
  knowledge?: KnowledgeIndex,
): Answer | null {
  const section = context?.sectionId ? sections.find((item) => item.id === context.sectionId) : undefined;
  if (!section) return null;
  const after = question.match(/(?:after|baad(?:\s+me)?|ke baad)\s+(.+?)(?:[?.!]|$)/i)?.[1]?.trim();
  const concepts = section.learn?.concepts ?? [];
  let currentIndex = -1;
  if (after) {
    const needle = after.toLowerCase().replace(/[^\w\s]/g, ' ').trim();
    currentIndex = concepts.findIndex((concept) => concept.title.toLowerCase().includes(needle));
  }
  if (currentIndex < 0 && context?.topic) {
    currentIndex = concepts.findIndex((concept) => concept.title.toLowerCase().includes(context.topic!.toLowerCase()));
  }
  if (currentIndex >= 0 && concepts[currentIndex + 1]) {
    const next = concepts[currentIndex + 1];
    return {
      text: `After **${concepts[currentIndex].title}**, continue with **${next.title}**.\n\n${next.body}` +
        (next.code ? `\n\nExample:\n${next.code.slice(0, 500)}` : ''),
      sources: [{
        title: `${section.title} · ${next.title}`,
        route: `/lesson/${section.id}/learn`,
        reference: `public/generated/curriculum/sections.json#${section.id}.learn.concepts[${currentIndex + 1}]`,
      }],
      confidence: 1,
      kind: 'next',
    };
  }

  const course = knowledge?.courses.find((item) => item.sections[section.id] !== undefined);
  const sameCourseSections = course
    ? sections.filter((candidate) => course.sections[candidate.id] !== undefined)
    : sections;
  const nextSection = sameCourseSections[sameCourseSections.indexOf(section) + 1];
  if (nextSection?.learn?.concepts?.length) {
    const next = nextSection.learn.concepts[0];
    return {
      text: `The next section in ${course?.title ?? 'the curriculum'} is **${nextSection.title}**.\n\nStart with **${next.title}**: ${next.body}`,
      sources: [{
        title: `${nextSection.title} · ${next.title}`,
        route: `/lesson/${nextSection.id}/learn`,
        reference: `public/generated/curriculum/sections.json#${nextSection.id}.learn.concepts[0]`,
      }],
      confidence: 1,
      kind: 'next',
    };
  }
  return null;
}

/** Quick action: a debug plan built from the learner's most recent real mistake. */
export function quickDebug(state: AppState, sections: Section[]): Answer {
  const last = [...state.mistakes].sort((a, b) => b.attempts - a.attempts)[0];
  if (!last) {
    return {
      text: 'There is no recorded mistake yet. Break something in the Playground — I will build a step-by-step debug plan from that traceback.',
      sources: [{ title: 'Code Playground', route: '/playground' }],
      confidence: 0,
      kind: 'debug',
    };
  }
  const sec = sections.find((s) => s.id === last.section);
  const steps = debugSteps(null, false);
  return {
    text:
      `Most repeated mistake: **${last.topic}** (${last.attempts}×)\n` +
      `Question: ${last.question.slice(0, 160)}\n\nFix plan:\n${steps.slice(0, 5).map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
    sources: [{ title: sec ? `${sec.title} lesson` : 'Mistake Tracker', route: sec ? `/lesson/${sec.id}/debug` : '/mistakes' }],
    confidence: 1,
    kind: 'debug',
  };
}

/** Quick action: an honest read of the learner's current standing. */
export function quickStatus(state: AppState, sections: Section[]): Answer {
  const cur = currentSection(sections, state);
  const p = sectionProgress(cur, state);
  const w = weakTopic(cur, state);
  const open = state.mistakes.filter((m) => !m.fixed).length;
  // The same tally the /questions KPI row reads — one owner for "a question was marked wrong".
  const bankish = bankRedo(state.mistakes).open;
  const tracked = Object.keys(state.review);
  // "Due" means really due, computed from the interval ladder — not just tracked.
  const due = tracked.filter((id) => reviewInfo(state, id)?.due).length;
  const next = tracked
    .map((id) => reviewInfo(state, id))
    .filter((i): i is NonNullable<typeof i> => !!i && !i.due)
    .sort((a, b) => a.dueAt - b.dueAt)[0];

  // The answer-accuracy figures are part of the status now: "kitna sahi hai" is the question this
  // report gets asked most, and the numbers come from the real `qb:` attempts (engine/accuracy.ts).
  const acc = bankAccuracy(state, cur.id);
  const all = bankAccuracy(state);
  return {
    text:
      `You are on "${cur.title}" — mastery ${p.masterPct}%.\n` +
      `Answer accuracy: ${pctText(acc.pct)} in this section (${acc.correct}/${acc.graded} correct)` +
      ` · ${pctText(all.pct)} across the app (${all.correct}/${all.graded}).\n` +
      `Open mistakes: ${open}${bankish ? ` (${bankish} from the Question Bank / Exam)` : ''} · ` +
      `Review due: ${due} of ${tracked.length} tracked · Streak: ${state.streak.current} days.\n` +
      (next ? `Next re-teach: ${next.id.toUpperCase()} — ${reviewLabel(next)}.\n` : '') +
      (w ? `Weak topic: ${w.topic} (${w.count}×).` : 'No weak topic detected.'),
    sources: [{ title: cur.title, route: `/lesson/${cur.id}/learn` }, { title: 'Progress', route: '/progress' }],
    confidence: 1,
    kind: 'state',
  };
}

/** Tokens helper re-exported for the assistant UI (question length sanity check). */
export const assistantTokens = tokenize;
