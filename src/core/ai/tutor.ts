import { parseTraceback, type Diagnostic } from '../platform/traceback';
import type { AppState, Section, Mistake } from '../../types';
import type { QuestionRecord, QuestionType } from '../data/schema';
import { nextBestAction, currentSection, codingTasks, debugTasks } from '../learning/progress';
import { itemAttempt, debugDone, interviewAnswer, bankAttempt } from '../platform/keys';
import { bankCorrectIds } from '../learning/coverage';
import { reviewInfo, reviewLabel, nextReviewRecord, intervalDays } from '../learning/review';
import {
  buildRetakes, coachSectionFor as rankCoachSection, failingType, nextBankDrill, mistakeRoute,
  type CoachCandidate, type CoachMistake, type CoachScheduleInput,
} from './coach';

/**
 * Offline tutor engine — deterministic, rule-based, no cloud AI.
 * Turns a parsed traceback into progressive Hinglish teaching content and
 * computes the next best task from real learner state (mistakes + attempts).
 */
export interface TutorExplanation {
  kind: string;
  line: number | null;
  topic: string;          // used for the Mistake Tracker topic field
  headline: string;
  what: string;
  cause: string;
  fix: string;
  example: string;
}

interface ErrMeta { topic: string; what: string; cause: string; fix: string; example: string }

const ERRORS: Record<string, ErrMeta> = {
  SyntaxError: {
    topic: 'Syntax', what: 'Python could not even read the code — the syntax is not valid.',
    cause: 'Most often: a missing colon (:), an unclosed bracket or quote, or an invalid assignment like `if x = 5`.',
    fix: 'Check the line number, inspect the character just before it, and count brackets/quotes. Use `==` instead of `=` when comparing.',
    example: '# Wrong:   if x = 5:\n# Correct: if x == 5:',
  },
  IndentationError: {
    topic: 'Indentation', what: 'Indentation is inconsistent, or the block was never indented.',
    cause: 'Tabs and spaces are mixed, or the line after `:` was not indented.',
    fix: 'Use exactly 4 spaces per level — configure your editor to insert spaces for Tab.',
    example: 'if True:\n    print("4 spaces")',
  },
  NameError: {
    topic: 'NameError', what: 'A name was used that does not exist yet.',
    cause: 'The variable/function is misspelled, or it was used before being assigned.',
    fix: 'Add `print(<name>)` before the failing line to confirm the name is defined. Compare the spelling.',
    example: 'total = 0\nprint(totl)  # NameError — check the spelling',
  },
  TypeError: {
    topic: 'TypeError', what: 'The operation received a value of the wrong type.',
    cause: 'Classic: "abc" + 5 (str + int), or calling something that is not callable.',
    fix: 'Before the failing line, print `print(type(x))` for every operand, then convert explicitly (str(), int()).',
    example: 'age = "22"\nprint(age + 1)        # TypeError\nprint(int(age) + 1)   # correct',
  },
  ValueError: {
    topic: 'ValueError', what: 'The type is correct but the value is invalid.',
    cause: 'For example int("3.5") — int() cannot parse a decimal string.',
    fix: 'Print the value being converted. Try float(), or validate the input.',
    example: 'int("3.5")         # ValueError\nint(float("3.5"))  # 3',
  },
  IndexError: {
    topic: 'IndexError', what: 'A sequence index went out of range.',
    cause: 'An index greater than len(seq)-1, or indexing an empty list.',
    fix: 'Before the failing line, print `print(len(seq))` and the index. The last valid index is len-1.',
    example: 'nums = [1, 2]\nprint(nums[2])   # IndexError\nprint(nums[-1])  # 2 — last item',
  },
  KeyError: {
    topic: 'KeyError', what: 'That key was not found in the dictionary.',
    cause: 'The key was never inserted, or there is a typo in the key string.',
    fix: 'Before the failing line, inspect `print(d.keys())`. For safe access use `d.get(key, default)`.',
    example: 'd = {"name": "A"}\nprint(d.get("age", 0))  # 0, no crash',
  },
  AttributeError: {
    topic: 'AttributeError', what: 'This object has no such attribute/method.',
    cause: 'A method was called on the wrong type — for example .append() on a tuple, or a function was referenced without () and then called.',
    fix: 'Run `print(type(obj))` and confirm that the method exists on that type. Add () to call a function reference.',
    example: 't = (1, 2)\n# t.append(3)  # AttributeError — tuples are immutable',
  },
  ZeroDivisionError: {
    topic: 'ZeroDivisionError', what: 'Division (or modulo) by zero.',
    cause: 'The denominator evaluated to 0 — often from user input.',
    fix: 'Print the denominator before the operation; add a guard: `if denom:`.',
    example: 'avg = total / n if n else 0',
  },
  ModuleNotFoundError: {
    topic: 'ModuleNotFoundError', what: 'The module is not available in this runtime.',
    cause: 'Only numpy, pandas, and the full Python standard library are bundled — other packages cannot be installed here.',
    fix: 'Check the list in the Packages panel; rewrite the example using stdlib/numpy/pandas equivalents.',
    example: '# matplotlib is not bundled — build a text-based chart:\nfor v in [3, 7, 5]: print("*" * v)',
  },
  ImportError: {
    topic: 'ImportError', what: 'The module was found but does not contain that name.',
    cause: 'A wrong submodule/name was imported, or the API changed between versions.',
    fix: "List the module's available names with `dir(module)`; check the spelling and path.",
    example: 'import numpy as np\nprint(hasattr(np, "mean"))  # True',
  },
  FileNotFoundError: {
    topic: 'FileNotFoundError', what: 'The file was not found.',
    cause: 'The path is wrong or the file was never created. In this lab only bundled datasets are safe.',
    fix: 'List the directory you expect; use a bundled dataset name (e.g. students.csv).',
    example: "import pandas as pd\ndf = pd.read_csv('students.csv')  # bundled dataset",
  },
  OSError: {
    topic: 'OSError (input)', what: 'The runtime hit an input/output error.',
    cause: 'Most common in this lab: input() — provide values in the Program Input box.',
    fix: 'Type each value on its own line in the Program Input box, then Run. Leave it empty to test error handling.',
    example: 'name = input("Name: ")  # Program Input: Ashu',
  },
  EOFError: {
    topic: 'EOFError', what: 'input() had nothing to read — the input ran out.',
    cause: 'The program called input() more times than there are lines in Program Input.',
    fix: 'Count the input() calls in the code and provide that many lines — one value per line.',
    example: '# 2 input() calls => 2 lines in Program Input',
  },
  RuntimeError: {
    topic: 'RuntimeError', what: 'The runtime refused the operation.',
    cause: 'Usually recursion depth or an invalid runtime state.',
    fix: "Check the recursion base case; inspect the loop's termination condition.",
    example: 'def f(n):\n    if n <= 0: return 0   # base case required\n    return f(n - 1)',
  },
  RecursionError: {
    topic: 'RecursionError', what: 'Recursion went too deep.',
    cause: 'The base case is missing or never reached.',
    fix: 'Write the base case first and confirm that every call moves toward it.',
    example: 'def fact(n):\n    if n <= 1: return 1\n    return n * fact(n - 1)',
  },
};

/** Extract the offending name/value from the raw message for sharper hints. */
function messageDetail(kind: string, message: string): string {
  if (!message) return '';
  if (kind === 'NameError') {
    const m = message.match(/name '([^']+)'/);
    if (m) return `Name: "${m[1]}"`;
  }
  if (kind === 'TypeError' || kind === 'ValueError') {
    if (message.length > 10) return `Message: ${message.slice(0, 90)}`;
  }
  if (kind === 'KeyError') return `Key: ${message.slice(0, 40)}`;
  return '';
}

export function explainDiagnostic(d: Diagnostic | null): TutorExplanation | null {
  if (!d) return null;
  const meta = ERRORS[d.kind];
  if (!meta) return null;
  const detail = messageDetail(d.kind, d.message);
  return {
    kind: d.kind,
    line: d.line,
    topic: meta.topic,
    headline: `${d.kind}${d.line ? ` — line ${d.line}` : ''}`,
    what: meta.what,
    cause: meta.cause,
    fix: meta.fix,
    example: detail ? `${meta.example}\n# ${detail}` : meta.example,
  };
}

/** Convenience: traceback text → explanation (or null when not parseable). */
export function explainTraceback(err: string): TutorExplanation | null {
  return explainDiagnostic(parseTraceback(err));
}

/* ------------------------- Progressive hints ------------------------- */

/**
 * H1 nudge → H2 concept reminder → H3 approach → H4 partial code.
 * Later attempts reveal deeper hints (attempt = 1-based try count).
 */
export function hintLadder(expl: TutorExplanation | null, attempt: number, hasInput: boolean): string[] {
  if (!expl) {
    return [
      'Read the full traceback in the Output/Errors tab — check the line number first.',
      'The error type (NameError, TypeError…) tells you which CATEGORY of mistake it is.',
      'Print values before the failing line to inspect the state.',
    ];
  }
  const base: string[] = [];
  if (expl.line) base.push(`Focus on line ${expl.line} — that is where execution stopped.`);
  if (expl.kind === 'OSError' || expl.kind === 'EOFError') {
    base.push(hasInput ? 'Count the lines in the Program Input box and the input() calls — the counts should match.' : 'Using input()? Provide values in the Program Input box below (one per line).');
  }
  base.push(expl.cause);
  if (attempt >= 3) base.push(expl.fix);
  if (attempt >= 4) base.push(`Example:\n${expl.example}`);
  return base;
}

/* ------------------------- Debug walkthrough ------------------------- */

/**
 * Extra, error-specific debugging steps. The generic skeleton (read the last
 * line, isolate, print, re-run) is shared; these sharpen it for the error kind.
 */
const DEBUG_STEPS: Record<string, string[]> = {
  SyntaxError: ['Python could not read the code at all — so the reported line number is only "as far as it could parse".', 'Look at the character just BEFORE that line: is a bracket `( [ {`, quote `" \'`, or colon `:` left unclosed?', 'Pair up the brackets and count them: ( ) [ ] { } must all balance.'],
  IndentationError: ['The line after a colon `:` must be indented 4 spaces.', 'Do not mix tabs and spaces — use only 4 spaces per level in the editor.', 'Inspect the `if`/`for`/`def` block and compare the indentation level.'],
  NameError: ['Run `print(dir())` before the failing line — check whether the name is in the list.', 'Compare spellings: `total` vs `totl`.', 'Was the name created at all — the assignment must run BEFORE the failing line.'],
  TypeError: ['Before the failing line, run `print(type(x))` for every operand.', '`"22"` is a string, `22` is an int — convert explicitly with `int()`/`str()`.', 'Is what you are calling actually a function? Note the difference between `f` and `f()`.'],
  ValueError: ['Print the value being converted with `print(repr(value))` — catch hidden spaces or empty strings.', '`int("3.5")` fails — try `float()` or validate first.', 'Call `.strip()` on values that come from `input()`.'],
  AttributeError: ['Run `print(type(obj))` — first confirm the object\'s type.', 'Does that method exist on the type? `.append()` only on lists, `.mean()` on numpy arrays.', 'Forgot to call the function reference? Use `np.mean(arr)` instead of `np.mean`.'],
  IndexError: ['Print `print(len(seq))` and the index.', 'The last valid index is `len(seq) - 1` — check for off-by-one.', 'Indexing an empty sequence also raises IndexError.'],
  KeyError: ['Run `print(d.keys())` to see which keys actually exist.', 'Typos in string keys are common — compare the spelling inside the quotes.', 'Safe access: `d.get(key, default)`, or add a guard with `if key in d:`.'],
  ZeroDivisionError: ['Print the denominator with `print(denom)` before the operation.', 'Add a guard: `avg = total / n if n else 0`.', 'Is the denominator coming from user input? Check for empty/zero values.'],
  ModuleNotFoundError: ['This lab only has numpy, pandas, and the Python standard library.', 'Open the Packages panel and check the available names.', 'Rewrite the example using stdlib/numpy/pandas equivalents.'],
  ImportError: ['After `import module`, inspect the available names with `print(dir(module))`.', 'Check the new API name instead of the old API.'],
  OSError: ['In this lab this is caused by `input()` 90% of the time — provide values in the Program Input box below.', 'Give one line per input() (one value per line).', 'Count the input() calls and provide exactly that many lines.'],
  EOFError: ['Count how many times `input()` appears in the code.', 'Provide exactly that many lines in the Program Input box — one value per line.'],
  RecursionError: ['Write the function\'s base case first (`if n <= 1: return ...`).', 'Check whether every recursive call moves toward the base case.'],
  RuntimeError: ['Check the loop\'s termination condition — it may be an infinite loop.', 'Re-examine the recursion base case.'],
};

/**
 * Step-by-step debugging checklist for the current error (offline).
 * With no error yet it returns how to get a usable traceback in the first place.
 */
export function debugSteps(expl: TutorExplanation | null, hasInput: boolean): string[] {
  if (!expl) {
    return [
      'Run first (Ctrl+Enter) — once an error appears, you will get a real line-by-line debug plan here.',
      'Provide one value per line in the Program Input box for `input()`, otherwise you will get OSError/EOFError.',
      'The BOTTOM line in the console is the actual error — the lines above are just the call path.',
    ];
  }
  const steps: string[] = ['Read the BOTTOM line in the Errors tab — that is the actual error (the lines above are the call path).'];
  if (expl.line) steps.push(`Go to line ${expl.line} — the editor highlights that line in red.`);
  steps.push(`Root cause: ${expl.cause}`);
  const kindSteps = DEBUG_STEPS[expl.kind];
  if (kindSteps) steps.push(...kindSteps);
  else steps.push('Print the value and type of every variable BEFORE the failing line.');
  if (expl.kind === 'OSError' || expl.kind === 'EOFError') {
    steps.push(hasInput ? 'Match the lines in the Input box with the input() calls.' : 'Provide values in the Program Input box (one value per line).');
  }
  steps.push('Run a small test: add `print()` before the failing line, then Run — fix once the value is confirmed.');
  steps.push('Run again after the fix (Ctrl+Enter); if it runs clean, save it to the Mistake Tracker and move on.');
  return steps;
}

/* ------------------------- Next task engine ------------------------- */

export interface NextTask {
  label: string;
  reason: string;
  route: string;
}

/**
 * The learner's schedule for one section, wired from review.ts (the only owner of
 * the 1/3/7/14/30 ladder). Everything the coach shows about timing comes from here.
 */
export function coachSchedule(sectionId: string, state: AppState): CoachScheduleInput | null {
  const info = reviewInfo(state, sectionId);
  if (!info) return null;
  const next = nextReviewRecord(info.level);
  return {
    level: info.level,
    intervalDays: info.intervalDays,
    due: info.due,
    daysLeft: info.daysLeft,
    overdueDays: info.overdueDays,
    text: reviewLabel(info),
    nextText: `After coaching → level ${next.level} (next re-teach in ${intervalDays(next.level)} days)`,
  };
}

export const coachOptions = (state: AppState) => ({ scheduleOf: (id: string) => coachSchedule(id, state) });

/**
 * "Ab kya karein?" — reads the REAL learner state: the highest-ranked open
 * mistake (question-bank, exam or coding-lab) first, then a section whose
 * spaced-repetition review is due, then the frontier section's own engine.
 */
export function nextTask(state: AppState, sections: Section[]): NextTask {
  const opts = coachOptions(state);
  const top = rankCoachSection(state, sections, null, '', opts).candidates[0];
  if (top) {
    if (top.openMistakes > 0) {
      const own = state.mistakes.filter((m) => !m.fixed && m.section === top.sectionId);
      const worst = own.slice().sort((a, b) => b.attempts - a.attempts)[0];
      const where = worst ? mistakeRoute(worst) : null;
      // Name the actual question rather than a generic tag — that is what has to be retried.
      const what = (worst?.question || worst?.topic || top.title).replace(/\s+/g, ' ').trim();
      return {
        label: `Retry: ${what.slice(0, 48)}${what.length > 48 ? '…' : ''}`,
        reason: `${top.reasons.join(' · ')}.`,
        route: where?.route ?? `/lesson/${top.sectionId}/learn`,
      };
    }
    return {
      label: `Review: ${top.title}`.slice(0, 60),
      reason: `${top.reasons.join(' · ')} — open the coach to re-teach this.`,
      route: `/lesson/${top.sectionId}/learn`,
    };
  }
  // Nothing to re-teach: defer to the frontier section's own engine.
  const cur = currentSection(sections, state);
  const nba = nextBestAction(cur, state);
  return { label: nba.label, reason: nba.reason, route: nba.route };
}

/* ------------------------- Coach mode (concept + Socratic) ------------------------- */

export interface CoachStep {
  label: string;
  question: string;
  answer: string;
}

export interface CoachDrill {
  kind: 'bank' | 'interview' | 'logic' | 'coding' | 'debug' | 'checkpoint';
  label: string;
  text: string;
  solution: string;
  check: string;
  route: string;
  /** Where this drill physically came from — stated so nothing looks generated. */
  source: string;
}

export interface CoachSession {
  sectionId: string;
  sectionTitle: string;
  why: string;
  concept: { title: string; body: string; code: string; output: string; tip: string } | null;
  recap: string;
  remember: string[];
  /** The learner's own failures in this section, most important first. */
  mistakes: CoachMistake[];
  /** Spaced-repetition position of this section, straight from review.ts. */
  schedule: CoachScheduleInput | null;
  socratic: CoachStep[];
  drill: CoachDrill | null;
}

const squeeze = (s: string | undefined, max = 1200) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Which section the coach should teach right now, and why.
 * Ranked purely from real state: open mistakes (any surface) and spaced-repetition
 * review levels. The frontier section is only the fallback.
 */
export function coachSectionFor(
  state: AppState,
  sections: Section[],
): { section: Section | null; why: string; schedule: CoachScheduleInput | null; candidates: CoachCandidate[] } {
  const fallback = sections.length ? currentSection(sections, state) : null;
  return rankCoachSection(
    state, sections, fallback,
    'Frontier section — this is your next best progress.',
    coachOptions(state),
  );
}

/**
 * A drill aimed at the type the learner actually keeps failing.
 *
 * First choice is a FRESH question from the real bank of that type (published,
 * never answered correctly, not the question already shown as a retake). If the
 * bank has nothing left, it falls back to the next untouched curriculum item of
 * that same stage — never to a random coding task that ignores the failure.
 */
function buildDrill(
  section: Section,
  state: AppState,
  why: string,
  retakes: CoachMistake[],
  bank?: QuestionRecord[],
): CoachDrill | null {
  const type = failingType(section, state);

  if (bank?.length) {
    // Already-mastered ids, from the module that owns the bank's predicates — not a second copy of
    // the key shape and the `done` rule living inside a drill builder.
    const done = bankCorrectIds(state.attempts);
    const pick = nextBankDrill(bank, type, done, retakes.map((r) => r.question));
    if (pick) {
      return {
        kind: 'bank',
        label: `New ${pick.bankType} question from the bank (${pick.question.difficulty})`,
        text: pick.question.question,
        solution: pick.question.answer,
        check: pick.question.explanation || 'Compare with the model answer, then self-grade in the Question Bank.',
        route: '/questions',
        source: `public/generated/questions/${section.id}.json · ${why}`,
      };
    }
  }

  const bankType: QuestionType = type === 'interview' || type === 'final' ? 'interview' : (type as QuestionType);
  if (bankType === 'interview') {
    const idx = (section.interview ?? []).findIndex((q, i) => q.q?.trim() && q.a?.trim() && !state.interviewAnswers[interviewAnswer(section.id, i)]);
    const iv = idx >= 0 ? section.interview[idx] : null;
    if (iv) {
      return {
        kind: 'interview', label: 'Interview drill (curriculum)', text: iv.q,
        solution: [iv.a, iv.tip && `TIP: ${iv.tip}`, iv.fu && `FOLLOW-UP: ${iv.fu}`].filter(Boolean).join('\n\n'),
        check: 'Answer aloud, then write it in your own words — what you say in an interview sticks.',
        route: `/lesson/${section.id}/interview`, source: `${section.title} → interview Q${idx + 1}`,
      };
    }
  }
  if (bankType === 'logic') {
    const idx = (section.logic ?? []).findIndex((l, i) => l.text?.trim() && l.answer?.trim() && !state.attempts[itemAttempt(section.id, 'logic', i)]?.done);
    const lg = idx >= 0 ? section.logic[idx] : null;
    if (lg) {
      return {
        kind: 'logic', label: `Predict first (${lg.kind})`, text: lg.text, solution: lg.answer,
        check: 'Write your output first, then reveal the answer.',
        route: `/lesson/${section.id}/logic`, source: `${section.title} → logic card ${idx + 1}`,
      };
    }
  }

  // Debug drills use the debug list (one section-level gate), coding drills use the coding
  // list — the same two lists the Debug stage and Coding Lab render, so the item key this
  // drill reads is the key the lab actually wrote.
  const debugList = debugTasks(section);
  if (bankType === 'debug') {
    const untouched = debugList.find((c) => c.text?.trim() && !state.attempts[debugDone(section.id)]?.done) ?? debugList.find((c) => c.text?.trim());
    if (untouched) {
      return {
        kind: 'debug', label: `Debug task (${untouched.difficulty || 'debug'})`,
        text: untouched.text, solution: untouched.solution ?? '', check: untouched.check ?? '',
        route: `/lesson/${section.id}/debug`,
        source: `${section.title} → debug task`,
      };
    }
  }
  const coding = codingTasks(section);
  const idx = coding.findIndex((c, i) => c.text?.trim() && !state.attempts[itemAttempt(section.id, 'coding', i)]?.done);
  const at = idx >= 0 ? idx : coding.findIndex((c) => c.text?.trim());
  if (at >= 0) {
    const task = coding[at];
    return {
      kind: 'coding',
      label: `Coding task (${task.difficulty || 'task'})`,
      text: task.text, solution: task.solution ?? '', check: task.check ?? '',
      route: `/lesson/${section.id}/coding`,
      source: `${section.title} → coding task ${at + 1} of ${coding.length}`,
    };
  }
  return null;
}

/**
 * Coach session for a section — the learner's own mistakes first, then the concept
 * explanation, Socratic questions and a drill aimed at what actually failed.
 *
 * Every string comes from the PDF curriculum, the question banks, or the learner's
 * own stored records. Nothing is generated, nothing is fetched, and the section's
 * spaced-repetition position is reported as-is.
 */
export function coachFor(
  section: Section | null,
  state: AppState,
  why = '',
  opts: { bank?: QuestionRecord[] } = {},
): CoachSession | null {
  if (!section) return null;
  const concepts = section.learn?.concepts ?? [];
  // Prefer a concept that actually carries content; code-bearing concepts make better teaching cards.
  const concept = concepts.find((c) => c.code?.trim() && c.body?.trim())
    ?? concepts.find((c) => c.body?.trim())
    ?? concepts[0]
    ?? null;

  const retakes = buildRetakes(section, state);

  // Mistakes come FIRST: they are the reason the coach picked this section.
  const socratic: CoachStep[] = retakes.map((m) => ({
    label: `Retry — ${m.label}`,
    question: m.question,
    answer: [
      m.myAnswer ? `You wrote: ${m.myAnswer}` : '',
      `Correct answer: ${m.correct}`,
      `Retry: ${m.routeLabel}`,
    ].filter(Boolean).join('\n\n'),
  }));

  const seen = new Set(retakes.map((m) => m.question.trim().slice(0, 120)));
  const pushOnce = (step: CoachStep) => {
    const key = step.question.trim().slice(0, 120);
    if (seen.has(key)) return;
    seen.add(key);
    socratic.push(step);
  };

  const iv = (section.interview ?? []).find((q) => q.q?.trim() && q.a?.trim());
  if (iv) {
    pushOnce({
      label: 'Interview drill',
      question: iv.q,
      answer: [iv.a, iv.tip && `TIP: ${iv.tip}`, iv.fu && `FOLLOW-UP: ${iv.fu}`].filter(Boolean).join('\n\n'),
    });
  }
  const lg = (section.logic ?? []).find((l) => l.text?.trim() && l.answer?.trim());
  if (lg) pushOnce({ label: `Predict first (${lg.kind})`, question: lg.text, answer: lg.answer });
  const cp = (section.checkpoint ?? []).find((c) => c.q?.trim() && (c.key ?? '').trim().length > 1);
  if (cp) pushOnce({ label: 'Self-check', question: cp.q, answer: cp.key });

  return {
    sectionId: section.id,
    sectionTitle: section.title,
    why,
    concept: concept
      ? { title: concept.title, body: squeeze(concept.body, 1400), code: concept.code ?? '', output: squeeze(concept.output, 400), tip: squeeze(concept.tip, 300) }
      : null,
    recap: squeeze(section.learn?.recap, 900),
    remember: (section.learn?.remember ?? []).map((r) => squeeze(r, 220)).filter(Boolean).slice(0, 4),
    mistakes: retakes,
    schedule: coachSchedule(section.id, state),
    socratic,
    drill: buildDrill(section, state, why, retakes, opts.bank),
  };
}

/** Mistake record shaped exactly like the Lesson page's addMistake payloads. */
export function mistakeFromDiagnostic(
  expl: TutorExplanation,
  code: string,
  errText: string,
  section = 'playground',
): Omit<Mistake, 'id' | 'date' | 'attempts' | 'fixed'> {
  return {
    section,
    topic: expl.topic,
    question: code.slice(0, 120),
    myAnswer: errText.slice(0, 200),
    correct: expl.cause,
    type: 'code',
    source: 'lab',
  };
}
