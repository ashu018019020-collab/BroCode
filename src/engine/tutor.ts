import { parseTraceback, type Diagnostic } from './traceback';
import type { AppState, Section, Mistake } from '../types';
import type { QuestionRecord, QuestionType } from '../data/schema';
import { nextBestAction, currentSection, codingTasks, debugTasks } from './progress';
import { itemAttempt, debugDone, interviewAnswer, bankAttempt, BANK_ATTEMPT_PREFIX } from './keys';
import { reviewInfo, reviewLabel, nextReviewRecord, intervalDays } from './review';
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
    topic: 'Syntax', what: 'Python code padh hi nahi paya — syntax valid nahi hai.',
    cause: 'Zyada tar: colon (:) missing, bracket ya quote adhoora, ya `if x = 5` jaisa invalid assignment.',
    fix: 'Line number dekho, uske pehle wala character check karo, brackets/quotes gino. `=` ki jagah `==` comparison me.',
    example: '# Galat:  if x = 5:\n# Sahi:   if x == 5:',
  },
  IndentationError: {
    topic: 'Indentation', what: 'Indentation consistent nahi hai ya block indent hi nahi hua.',
    cause: 'Tabs aur spaces mix ho gaye, ya `:` ke baad wali line indent nahi ki.',
    fix: 'Har level par exactly 4 spaces use karo — editor me Tab ko spaces me set karo.',
    example: 'if True:\n    print("4 spaces")',
  },
  NameError: {
    topic: 'NameError', what: 'Ek naam use hua jo abhi exist nahi karta.',
    cause: 'Variable/function ka spelling galat, ya assign hone se pehle use kar liya.',
    fix: 'Failing line se pehle `print(<naam>)` laga ke check karo ki naam defined hai. Spelling milaan karo.',
    example: 'total = 0\nprint(totl)  # NameError — spelling dekho',
  },
  TypeError: {
    topic: 'TypeError', what: 'Operation ko galat type ka value mila.',
    cause: 'Classic: "abc" + 5 (str + int), ya aisi cheez call ki jo callable nahi hai.',
    fix: 'Failing line se pehle har operand ka `print(type(x))` karo, phir explicitly convert karo (str(), int()).',
    example: 'age = "22"\nprint(age + 1)        # TypeError\nprint(int(age) + 1)   # sahi',
  },
  ValueError: {
    topic: 'ValueError', what: 'Type sahi hai par value invalid hai.',
    cause: 'Jaise int("3.5") — int() decimal string parse nahi kar sakta.',
    fix: 'Jo value convert ho rahi hai use print karo. float() try karo ya input validate karo.',
    example: 'int("3.5")         # ValueError\nint(float("3.5"))  # 3',
  },
  IndexError: {
    topic: 'IndexError', what: 'Sequence ka index range se bahar chala gaya.',
    cause: 'len(seq)-1 se bada index, ya khaali list par indexing.',
    fix: 'Failing line se pehle `print(len(seq))` aur index print karo. Last valid index = len-1.',
    example: 'nums = [1, 2]\nprint(nums[2])   # IndexError\nprint(nums[-1])  # 2 — last item',
  },
  KeyError: {
    topic: 'KeyError', what: 'Dictionary me wo key mila hi nahi.',
    cause: 'Key kabhi insert nahi hui, ya key string me typo hai.',
    fix: 'Failing line se pehle `print(d.keys())` dekho. Safe access ke liye `d.get(key, default)` use karo.',
    example: 'd = {"name": "A"}\nprint(d.get("age", 0))  # 0, crash nahi',
  },
  AttributeError: {
    topic: 'AttributeError', what: 'Is object me wo attribute/method hai hi nahi.',
    cause: 'Galat type par method call — jaise tuple par .append(), ya function ko () ke bina reference kiya aur phir call kiya.',
    fix: '`print(type(obj))` karo aur confirm karo ki wo method us type par exist karta hai. Function reference ko call karne ke liye () lagao.',
    example: 't = (1, 2)\n# t.append(3)  # AttributeError — tuple immutable hai',
  },
  ZeroDivisionError: {
    topic: 'ZeroDivisionError', what: 'Zero se divide (ya modulo) kiya gaya.',
    cause: 'Denominator 0 evaluate hua — aksar user input se.',
    fix: 'Operation se pehle denominator print karo; guard lagao: `if denom:`.',
    example: 'avg = total / n if n else 0',
  },
  ModuleNotFoundError: {
    topic: 'ModuleNotFoundError', what: 'Module is offline runtime me available nahi hai.',
    cause: 'Sirf numpy, pandas aur poora Python stdlib bundled hai — baaki packages offline install nahi ho sakte.',
    fix: 'Packages panel me list dekho; example ko stdlib/numpy/pandas ke equivalent me rewrite karo.',
    example: '# matplotlib offline nahi — text-based chart banao:\nfor v in [3, 7, 5]: print("*" * v)',
  },
  ImportError: {
    topic: 'ImportError', what: 'Module mila par usme wo naam nahi hai.',
    cause: 'Galat submodule/naam import kiya, ya version me API badal gayi.',
    fix: 'Module ke available names `dir(module)` se dekho; spelling aur path check karo.',
    example: 'import numpy as np\nprint(hasattr(np, "mean"))  # True',
  },
  FileNotFoundError: {
    topic: 'FileNotFoundError', what: 'File mili hi nahi.',
    cause: 'Path galat hai ya file bani hi nahi. Offline lab me sirf bundled datasets safe hain.',
    fix: 'Jo directory expect kar rahe ho use list karo; bundled dataset naam use karo (e.g. students.csv).',
    example: "import pandas as pd\ndf = pd.read_csv('students.csv')  # bundled dataset",
  },
  OSError: {
    topic: 'OSError (input)', what: 'Runtime ko input/output error mila.',
    cause: 'Is lab me sabse common: input() — Program Input box me values do.',
    fix: 'Program Input box me har value ek line me likho, phir Run karo. Errors test karne ke liye khaali chhodo.',
    example: 'name = input("Name: ")  # Program Input: Ahetesham',
  },
  EOFError: {
    topic: 'EOFError', what: 'input() ko padhne ko kuch nahi mila — input khatam ho gaya.',
    cause: 'Program ne input() zyada baar call kiya jitni lines Program Input me hain.',
    fix: 'Code ke input() calls gino aur utni hi lines do — ek value per line.',
    example: '# 2 input() calls => Program Input me 2 lines',
  },
  RuntimeError: {
    topic: 'RuntimeError', what: 'Runtime ne operation refuse kiya.',
    cause: 'Zyada tar recursion depth ya invalid runtime state.',
    fix: 'Recursion ka base case check karo; loop ka termination condition dekho.',
    example: 'def f(n):\n    if n <= 0: return 0   # base case zaroori\n    return f(n - 1)',
  },
  RecursionError: {
    topic: 'RecursionError', what: 'Recursion bahut deep chali gayi.',
    cause: 'Base case missing hai ya kabhi hit nahi hota.',
    fix: 'Base case pehle likho aur confirm karo ki har call uski taraf badhta hai.',
    example: 'def fact(n):\n    if n <= 1: return 1\n    return n * fact(n - 1)',
  },
};

/** Extract the offending name/value from the raw message for sharper hints. */
function messageDetail(kind: string, message: string): string {
  if (!message) return '';
  if (kind === 'NameError') {
    const m = message.match(/name '([^']+)'/);
    if (m) return `Naam: "${m[1]}"`;
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
      'Output/Errors tab me poora traceback padho — line number sabse pehle dekho.',
      'Error ka type (NameError, TypeError…) batata hai kis CATEGORY ki galti hui.',
      'Failing line se pehle values print karke state check karo.',
    ];
  }
  const base: string[] = [];
  if (expl.line) base.push(`Line ${expl.line} par dhyaan do — wahi se execution ruk gayi.`);
  if (expl.kind === 'OSError' || expl.kind === 'EOFError') {
    base.push(hasInput ? 'Program Input box ki lines aur input() calls gino — count match karna chahiye.' : 'input() use kiya hai? Neeche Program Input box me values do (ek per line).');
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
  SyntaxError: ['Python ne code padha hi nahi — isliye line number "jahan tak samajh paya" wahan tak ka ho sakta hai.', 'Us line ke PEHLE wala character dekho: koi bracket `( [ {`, quote `" \'` ya colon `:` adhoora chhoot gaya?', 'Brackets ko jodiyan banao aur gino: ( ) [ ] { } sab barabar hone chahiye.'],
  IndentationError: ['Colon `:` ke baad wali line 4 spaces andar honi chahiye.', 'Tabs aur spaces mix mat karo — editor me har level par sirf 4 spaces rakho.', '`if`/`for`/`def` ke block ko dekhkar indent ka level milaan karo.'],
  NameError: ['Failing line se pehle `print(dir())` chalao — dekh lo ki naam list me hai ya nahi.', 'Spelling milaan karo: `total` vs `totl`.', 'Naam banaya hai ya nahi — assignment failing line se PEHLE chalna chahiye.'],
  TypeError: ['Failing line se pehle har operand ka `print(type(x))` karo.', '`"22"` string hai, `22` int — `int()`/`str()` se explicitly convert karo.', 'Jo call kar rahe ho wo function hai? `f` vs `f()` ka farak dekho.'],
  ValueError: ['Jo value convert ho rahi hai use `print(repr(value))` karo — hidden space ya khaali string pakdo.', '`int("3.5")` fail hota hai — `float()` ya validation try karo.', '`input()` se aayi value pehle `.strip()` karo.'],
  AttributeError: ['`print(type(obj))` karo — pehle confirm karo object kis type ka hai.', 'Us type par wo method exist karta hai? `.append()` sirf list par, `.mean()` numpy array par.', 'Function reference ko call karna bhool gaye? `np.mean` ki jagah `np.mean(arr)`.'],
  IndexError: ['`print(len(seq))` aur index print karo.', 'Last valid index `len(seq) - 1` hota hai — off-by-one check karo.', 'Khaali sequence par indexing bhi IndexError deti hai.'],
  KeyError: ['`print(d.keys())` karke dekho key asli me kaunsi hai.', 'String key me typo common hai — quotes ke andar spelling milao.', 'Safe access: `d.get(key, default)`, ya `if key in d:` guard lagao.'],
  ZeroDivisionError: ['Operation se pehle denominator `print(denom)` karo.', 'Guard lagao: `avg = total / n if n else 0`.', 'Denominator user input se aa raha hai? Khaali/zero check karo.'],
  ModuleNotFoundError: ['Iss offline lab me sirf numpy, pandas aur Python stdlib hai.', 'Packages panel kholo aur available naam dekho.', 'Example ko stdlib/numpy/pandas ke equivalent me likho.'],
  ImportError: ['`import module` ke baad `print(dir(module))` se available naam dekho.', 'Purani API ki jagah nayi API ka naam check karo.'],
  OSError: ['Ye lab me 90% baar `input()` ki wajah se hota hai — neeche Program Input box me values do.', 'Har input() ke liye ek line (ek value per line) do.', 'input() calls gino, utni hi lines daalo.'],
  EOFError: ['Code me `input()` kitni baar hai, gino.', 'Program Input box me bilkul utni hi lines do — ek value per line.'],
  RecursionError: ['Function ka base case pehle likho (`if n <= 1: return ...`).', 'Har recursive call base case ki taraf badh rahi hai ya nahi check karo.'],
  RuntimeError: ['Loop ka termination condition check karo — infinite loop ho sakta hai.', 'Recursion ka base case dobara dekho.'],
};

/**
 * Step-by-step debugging checklist for the current error (Hinglish, offline).
 * With no error yet it returns how to get a usable traceback in the first place.
 */
export function debugSteps(expl: TutorExplanation | null, hasInput: boolean): string[] {
  if (!expl) {
    return [
      'Pehle Run karo (Ctrl+Enter) — error aane par yahan asli line-by-line debug plan milegi.',
      'Program Input box me `input()` ke liye values ek-per-line do, warna OSError/EOFError aayega.',
      'Console me SABSE NEECHE wali line hi asli error hoti hai — upar ki lines sirf call path hain.',
    ];
  }
  const steps: string[] = ['Errors tab me SABSE NEECHE wali line padho — wahi asli error hai (upar ki lines call path hain).'];
  if (expl.line) steps.push(`Line ${expl.line} par jaao — editor me wahi line red highlight ki hui hai.`);
  steps.push(`Root cause bataya gaya: ${expl.cause}`);
  const kindSteps = DEBUG_STEPS[expl.kind];
  if (kindSteps) steps.push(...kindSteps);
  else steps.push('Failing line se PEHLE har variable ka value aur type print karo.');
  if (expl.kind === 'OSError' || expl.kind === 'EOFError') {
    steps.push(hasInput ? 'Input box ki lines aur input() calls ka count match karo.' : 'Program Input box me values daalo (ek value per line).');
  }
  steps.push('Chhota test karo: failing line se pehle `print()` lagao, phir Run — value confirm hone par fix karo.');
  steps.push('Fix karke dobara Run karo (Ctrl+Enter); clean chala to Mistake Tracker me save karke aage badho.');
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
    nextText: `Coach ke baad → level ${next.level} (${intervalDays(next.level)}-din interval me next re-teach)`,
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
        label: `Dobara: ${what.slice(0, 48)}${what.length > 48 ? '…' : ''}`,
        reason: `${top.reasons.join(' · ')}.`,
        route: where?.route ?? `/lesson/${top.sectionId}/learn`,
      };
    }
    return {
      label: `Review: ${top.title}`.slice(0, 60),
      reason: `${top.reasons.join(' · ')} — re-teach ke liye coach kholo.`,
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
    'Frontier section — yahi tumhari next best progress hai.',
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
    const done = new Set(
      Object.keys(state.attempts)
        .filter((k) => k.startsWith(BANK_ATTEMPT_PREFIX) && state.attempts[k]?.done)
        .map((k) => k.slice(BANK_ATTEMPT_PREFIX.length)),
    );
    const pick = nextBankDrill(bank, type, done, retakes.map((r) => r.question));
    if (pick) {
      return {
        kind: 'bank',
        label: `Bank se naya ${pick.bankType} question (${pick.question.difficulty})`,
        text: pick.question.question,
        solution: pick.question.answer,
        check: pick.question.explanation || 'Model answer se milao, phir Question Bank me self-grade karo.',
        route: '/questions',
        source: `public/questions/${section.id}.json · ${why}`,
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
        check: 'Bolkar jawab do, phir apne shabdon me likho — interview me jo bola wo yaad rehta hai.',
        route: `/lesson/${section.id}/interview`, source: `${section.title} → interview Q${idx + 1}`,
      };
    }
  }
  if (bankType === 'logic') {
    const idx = (section.logic ?? []).findIndex((l, i) => l.text?.trim() && l.answer?.trim() && !state.attempts[itemAttempt(section.id, 'logic', i)]?.done);
    const lg = idx >= 0 ? section.logic[idx] : null;
    if (lg) {
      return {
        kind: 'logic', label: `Pehle predict karo (${lg.kind})`, text: lg.text, solution: lg.answer,
        check: 'Pehle apna output likho, phir answer kholo.',
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
    label: `Dobara — ${m.label}`,
    question: m.question,
    answer: [
      m.myAnswer ? `Tumne likha tha: ${m.myAnswer}` : '',
      `Sahi jawab: ${m.correct}`,
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
  if (lg) pushOnce({ label: `Pehle predict karo (${lg.kind})`, question: lg.text, answer: lg.answer });
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
