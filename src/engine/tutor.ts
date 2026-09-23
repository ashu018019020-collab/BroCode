import { parseTraceback, type Diagnostic } from './traceback';
import type { AppState, Section, Mistake } from '../types';
import { nextBestAction, currentSection } from './progress';

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

/* ------------------------- Next task engine ------------------------- */

export interface NextTask {
  label: string;
  reason: string;
  route: string;
}

/**
 * Playground-grade "ab kya karein?" — reads the REAL learner state:
 * repeated open mistakes first, then the current frontier section's own
 * recommendation, then practice nudges.
 */
export function nextTask(state: AppState, sections: Section[]): NextTask {
  // 1. Repeated open mistakes across ALL sections — highest priority.
  const counts = new Map<string, { n: number; type: string; section: string }>();
  for (const m of state.mistakes.filter((x) => !x.fixed)) {
    const cur = counts.get(m.topic);
    counts.set(m.topic, { n: (cur?.n ?? 0) + 1, type: cur?.type ?? m.type, section: m.section });
  }
  let worst: { topic: string; n: number; type: string; section: string } | null = null;
  for (const [topic, v] of counts) if (v.n >= 2 && (!worst || v.n > worst.n)) worst = { topic, ...v };
  if (worst) {
    const stage = worst.type === 'debug' ? 'debug' : worst.type === 'logic' ? 'logic' : worst.type === 'interview' ? 'interview' : 'coding';
    const sid = sections.find((s) => worst!.section.includes(s.id))?.id ?? currentSection(sections, state).id;
    return {
      label: `Targeted practice: ${worst.topic}`,
      reason: `"${worst.topic}" me ${worst.n} baar galti hui hai — pehle isko fix karo.`,
      route: `/lesson/${sid}/${stage}`,
    };
  }
  // 2. No repeated mistakes: defer to the frontier section's own engine.
  const cur = currentSection(sections, state);
  const nba = nextBestAction(cur, state);
  return { label: nba.label, reason: nba.reason, route: nba.route };
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
  };
}
