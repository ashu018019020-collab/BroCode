/**
 * The Coding Coach — evidence in, teaching out.
 *
 * The distinction this module exists to keep: BroCode's Python runner produces a REAL traceback, and
 * that traceback is the only source allowed to say "this line is broken". A static rule may point at
 * a pattern the author can see with their own eyes (`== None`, a bare `except:`, `input()` with no
 * program input), but it may not pretend the code was executed, and it may not claim a test passed.
 * The `ran` flag records exactly which of the two happened, and every finding carries its evidence
 * line so the learner can check it.
 *
 * Patches are equally strict. A patch is offered only for a repair that is deterministic from the
 * text — append a missing colon, replace `== None` with `is None`, widen a bare `except:`. Everything
 * else gets an explanation and a hint ladder, not fabricated corrected code. `applyLinePatch` then
 * refuses if the learner edited the line after the preview.
 *
 * Pure: no React, no store, no runner import. `scripts/tests/coding-coach.test.mjs` drives it with
 * real tracebacks and fixtures.
 */
import { parseTraceback } from '../platform/traceback';
import { applyLinePatch, diffLines, type CodePatch, type DiffLine } from '../platform/diff';

export type CoachLanguage = 'python' | 'javascript' | 'sql' | 'plaintext';
export type FindingSeverity = 'error' | 'warning' | 'info';

export interface CodeFinding {
  id: string;
  severity: FindingSeverity;
  /** 1-based line in the learner's code, or null when the diagnostic cannot be attributed. */
  line: number | null;
  title: string;
  /** The genuine diagnostic this came from — quoteable, never paraphrased into a claim. */
  evidence: string;
  why: string;
  fix: string;
  patch?: CodePatch;
  source: 'runtime' | 'static' | 'input';
}

export interface ComplexityNote {
  time: string;
  space: string;
  basis: string;
}

export interface CodeCoachResult {
  /** True only when the caller really executed this code and passed that fact in. */
  ran: boolean;
  findings: CodeFinding[];
  summary: string;
  hint: string;
  complexity: ComplexityNote | null;
  /** Edge cases to TRY. Never described as already-run tests. */
  nextTests: string[];
}

export interface CodeCoachInput {
  code: string;
  language?: CoachLanguage;
  /** The runner's stderr/traceback, verbatim. */
  error?: string;
  /** The runner's stdout, when it ran. */
  stdout?: string;
  stdin?: string;
  /** Set true by the caller only after its runner returned for this exact code. */
  ran?: boolean;
}

/* --------------------------------- helpers --------------------------------- */

const linesOf = (code: string): string[] => String(code ?? '').replace(/\r\n?/g, '\n').split('\n');
const lineAt = (code: string, line: number | null): string =>
  line && line >= 1 ? (linesOf(code)[line - 1] ?? '').trim() : '';

const stripComments = (line: string): string => line.replace(/#.*$/, '');

function severityRank(severity: FindingSeverity): number {
  return severity === 'error' ? 0 : severity === 'warning' ? 1 : 2;
}

/** The exact line patch this finding would apply; used by preview and apply. */
export function previewFindingPatch(code: string, finding: CodeFinding): DiffLine[] | null {
  if (!finding.patch) return null;
  const next = applyLinePatch(code, finding.patch);
  return next === null ? null : diffLines(code, next);
}

/** The lines a `while`/`try` header actually owns — indented or blank, stopping at the next sibling. */
function blockAfter(lines: string[], headerIndex: number): string[] {
  const headerIndent = lines[headerIndex].length - lines[headerIndex].trimStart().length;
  const out: string[] = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) { out.push(line); continue; }
    const indent = line.length - line.trimStart().length;
    if (indent <= headerIndent) break;
    out.push(line);
  }
  return out;
}

/* ------------------------------ runtime findings ----------------------------- */

interface TracebackFinding {
  title: string;
  why: string;
  fix: string;
  patch?: CodePatch;
}

/**
 * Map a real Python exception to teaching copy.
 *
 * The line is always the one the traceback named. When a repair is deterministic it is included;
 * otherwise the fix is a direction to investigate, never a pretend correction.
 */
function fromPythonTraceback(kind: string, message: string, code: string, line: number | null): TracebackFinding {
  const source = lineAt(code, line);
  const lineText = source ? ` The line the traceback names is: \`${source}\`.` : '';
  switch (kind) {
    case 'SyntaxError': {
      const missingColon = /expected ['"]?:['"]?|expected ':'/i.test(message)
        || (/^\s*(if|elif|else|for|while|def|class|try|except|finally|with)\b/.test(source) && !source.replace(/#.*$/, '').trimEnd().endsWith(':'));
      if (missingColon && line && source && !source.replace(/#.*$/, '').trimEnd().endsWith(':')) {
        return {
          title: 'A block header is missing its colon',
          why: `Python needs a \`:\` at the end of a block header.${lineText}`,
          fix: 'Add `:` at the end of that line. The preview shows exactly that one-character change.',
          patch: {
            line,
            before: linesOf(code)[line - 1] ?? '',
            after: `${linesOf(code)[line - 1].replace(/\s+$/, '')}:`,
            reason: 'The traceback points at this header and it does not end with a colon.',
          },
        };
      }
      return {
        title: 'Python could not parse this line',
        why: `A syntax error means the file never ran, so this is a grammar problem, not a logic problem.${lineText}`,
        fix: 'Read the exact message above and check brackets, quotes, colons and indentation around that line. I will not guess a replacement for a parse error.',
      };
    }
    case 'IndentationError':
      return {
        title: 'The indentation does not match the block',
        why: `Python uses indentation as syntax.${lineText || ' The traceback names the line where the indentation stops making sense.'}`,
        fix: 'Use one consistent indent (four spaces per level) for the whole block. Do not mix tabs and spaces.',
      };
    case 'NameError': {
      const name = message.match(/name '([^']+)' is not defined/)?.[1] ?? 'that name';
      return {
        title: `\`${name}\` is used before it exists`,
        why: `Python reached this line and could not find a variable, function or import called \`${name}\`.${lineText}`,
        fix: `Define \`${name}\` (or import it) before this line. If it is a typo, correct the spelling. I cannot invent the value it should hold.`,
      };
    }
    case 'TypeError': {
      const types = message.match(/can only concatenate (\w+) \(not "(\w+)"\) to (\w+)/i);
      return {
        title: 'The value has the wrong type for this operation',
        why: types
          ? `Python is trying to combine ${types[1]} and ${types[2]} values here.${lineText}`
          : `The operation received a type it cannot handle.${lineText}`,
        fix: 'Check the values on that line with `type(value)`, then convert explicitly (`str(...)`, `int(...)`) before combining them. Convert only where the value really should change type.',
      };
    }
    case 'ValueError':
      return {
        title: 'A conversion or lookup rejected the value',
        why: `Python accepted the call but rejected the value inside it.${lineText}`,
        fix: 'Check the input that reached this line. A common case is `int()` on text that is not a number; validate it or catch the failure with `try/except ValueError`.',
      };
    case 'IndexError':
      return {
        title: 'The index is outside the sequence',
        why: `A list or string was asked for a position it does not have.${lineText}`,
        fix: 'Print `len(sequence)` before the access and check the boundary. Remember the last valid index is `len(sequence) - 1`.',
      };
    case 'KeyError': {
      const key = message.match(/'([^']+)'/)?.[1] ?? 'that key';
      return {
        title: `The dictionary has no key \`${key}\``,
        why: `A lookup used a key that is not present in the dictionary.${lineText}`,
        fix: `Use \`d.get("${key}")\` when a missing key is allowed, or check membership with \`"${key}" in d\` before indexing.`,
      };
    }
    case 'AttributeError': {
      const attr = message.match(/has no attribute '([^']+)'/)?.[1] ?? 'that attribute';
      return {
        title: `This object has no \`${attr}\``,
        why: `The value on this line is not the kind of object that provides \`.${attr}\`.${lineText}`,
        fix: `Print \`type(value)\` and check what kind of object it really is. If this is a list and you meant an array operation, use the NumPy function (\`np.${attr}(...)\`) instead of a method.`,
      };
    }
    case 'ZeroDivisionError':
      return {
        title: 'Division by zero',
        why: `The denominator on this line evaluated to zero.${lineText}`,
        fix: 'Check the denominator before dividing, or handle zero explicitly (return a default / raise a clear error).',
      };
    case 'ModuleNotFoundError':
    case 'ImportError':
      return {
        title: 'That module is not available in this runtime',
        why: `The offline Python runtime contains a fixed wheel set, and this import is not in it.${lineText}`,
        fix: 'Use the Packages panel to see what is bundled. Do not assume a successful import means a cloud install happened — this app never installs at runtime.',
      };
    case 'EOFError':
      return {
        title: '`input()` ran out of values',
        why: 'The program asked for another line of input, but the Program Input box had no more lines.',
        fix: 'Add one value per line in Program Input, in the same order the code asks for them, then run again.',
      };
    case 'FileNotFoundError':
      return {
        title: 'The file is not where the code expects it',
        why: `The open() call used a path this offline workspace does not have.${lineText}`,
        fix: 'Use a bundled dataset name exactly as it appears in the Datasets list, or read from Program Input instead of a missing file.',
      };
    default:
      return {
        title: kind === 'Error' ? 'The program stopped with an error' : `The program raised \`${kind}\``,
        why: `The traceback on screen is the evidence for this finding.${lineText}`,
        fix: 'Start from the last frame above and inspect the values on that line. I will not invent a cause the traceback does not show.',
      };
  }
}

function runtimeFindings(input: CodeCoachInput, language: CoachLanguage): CodeFinding[] {
  const error = input.error?.trim();
  if (!error) return [];
  const diag = parseTraceback(error);
  if (!diag) {
    const last = error.split('\n').map((line) => line.trim()).filter(Boolean).pop() ?? error;
    return [{
      id: 'runtime:unparsed',
      severity: 'error',
      line: null,
      title: 'The runner reported an error it could not attribute to a line',
      evidence: last.slice(0, 240),
      why: 'Not every failure is a Python traceback (the runner itself can fail).',
      fix: 'Read the last line of the console above. If it is a Python exception, run again so the full traceback appears.',
      source: 'runtime',
    }];
  }
  const kind = diag.kind;
  const detail = fromPythonTraceback(kind, diag.message, input.code, diag.line);
  return [{
    id: `runtime:${diag.kind}:${diag.line ?? 'x'}`,
    severity: 'error',
    line: diag.line,
    title: detail.title,
    evidence: input.ran
      ? `Python reported ${diag.kind}${diag.line ? ` at line ${diag.line}` : ''}: ${diag.message || '(no message)'}`
      : `The traceback on screen reports ${diag.kind}${diag.line ? ` at line ${diag.line}` : ''}: ${diag.message || '(no message)'}`,
    why: detail.why,
    fix: detail.fix,
    patch: detail.patch,
    source: 'runtime',
  }];
}

/* ------------------------------- static findings ------------------------------ */

/** A whole-line replacement patch, or undefined when the repair is not deterministic. */
function replacePatch(code: string, line: number, pattern: RegExp, replacement: string, reason: string): CodePatch | undefined {
  const source = linesOf(code)[line - 1];
  if (source === undefined || !pattern.test(source)) return undefined;
  const after = source.replace(pattern, replacement);
  if (after === source) return undefined;
  return { line, before: source, after, reason };
}

function pythonStaticFindings(input: CodeCoachInput): CodeFinding[] {
  const code = input.code ?? '';
  const lines = linesOf(code);
  const findings: CodeFinding[] = [];

  lines.forEach((raw, index) => {
    const line = index + 1;
    const codeOnly = stripComments(raw);
    if (!codeOnly.trim()) return;

    // Equality against a singleton is a real correctness bug (identity vs equality), and the repair
    // is unambiguous. Offered as a warning, with a patch.
    const singleton = codeOnly.match(/==\s*(None|True|False)\b/);
    if (singleton) {
      const value = singleton[1];
      findings.push({
        id: `static:singleton:${line}`,
        severity: 'warning',
        line,
        title: `Compare \`${value}\` with \`is\`, not \`==\``,
        evidence: `Line ${line}: ${raw.trim()}`,
        why: `\`==\` asks whether two values are equal; for ${value} the correct question is identity, and \`is\` says that directly.`,
        fix: `Replace \`== ${value}\` with \`is ${value}\`${value === 'None' ? '' : ' (or \`is not ...\` for the negated check)'}.`,
        patch: replacePatch(code, line, new RegExp(`==\\s*${value}\\b`), `is ${value}`, 'The comparison is a simple singleton check on this line.'),
        source: 'static',
      });
    }

    // A bare except swallows KeyboardInterrupt and every unrelated bug. Widening it is a safe,
    // exact text change.
    if (/^\s*except\s*:\s*(#.*)?$/.test(raw)) {
      findings.push({
        id: `static:bare-except:${line}`,
        severity: 'warning',
        line,
        title: 'Bare `except:` catches everything',
        evidence: `Line ${line}: ${raw.trim()}`,
        why: 'A bare handler also catches Ctrl+C and programming mistakes, so a real bug can be hidden as if it were expected.',
        fix: 'Catch the narrow exception you expect, or at least `except Exception:` so system interrupts still work.',
        patch: replacePatch(code, line, /except\s*:/, 'except Exception:', 'The handler has no exception type on this line.'),
        source: 'static',
      });
    }

    // Mutable default arguments are shared across calls; a beginner trap the text alone proves.
    if (/^\s*def\s+\w+\s*\([^)]*=\s*(\[\]|\{\}|set\(\))/.test(raw)) {
      findings.push({
        id: `static:mutable-default:${line}`,
        severity: 'warning',
        line,
        title: 'Mutable default argument',
        evidence: `Line ${line}: ${raw.trim()}`,
        why: 'The default list/dict is created once and reused by every call, so changes leak between calls.',
        fix: 'Default to `None` and create the container inside the function: `def f(items=None): items = [] if items is None else items`.',
        source: 'static',
      });
    }

    // A leading tab in a file that otherwise indents with spaces — only claims what is visible.
    if (/^\t+/.test(raw) && lines.some((other) => /^ {2,}/.test(other))) {
      findings.push({
        id: `static:mixed-indent:${line}`,
        severity: 'warning',
        line,
        title: 'Tabs and spaces are mixed',
        evidence: `Line ${line} starts with a tab while another line starts with spaces.`,
        why: 'Python treats a tab and spaces as different indentation, even when they look aligned, which produces `TabError` or a block that is not where it looks.',
        fix: 'Convert the block to spaces (four per level) and keep one style for the whole file.',
        source: 'static',
      });
    }

    if (/while\s+True\s*:/.test(codeOnly) && !/break|return|raise/.test(blockAfter(lines, index).join('\n'))) {
      findings.push({
        id: `static:while-true:${line}`,
        severity: 'info',
        line,
        title: '`while True` with no visible exit',
        evidence: `Line ${line} opens an unbounded loop and no \`break\`, \`return\` or \`raise\` appears in its body.`,
        why: 'If the loop body never exits another way, the program will not finish on its own.',
        fix: 'Add a condition that exits the loop, or state clearly that the loop is meant to run until interrupted.',
        source: 'static',
      });
    }

    if (/\bexcept\s+Exception\s+as\s+\w+\s*:\s*(#.*)?$/.test(raw)) {
      const nextLine = lines[index + 1] ?? '';
      if (/^\s+pass\s*(#.*)?$/.test(nextLine)) {
        findings.push({
          id: `static:silent-except:${line}`,
          severity: 'warning',
          line,
          title: 'The exception is caught and thrown away',
          evidence: `Line ${line} catches \`Exception\`, and line ${line + 1} does nothing.`,
          why: 'A silent handler hides the evidence you need to debug the failure and can make a program look correct while it is not.',
          fix: 'Print or log the exception (or handle it meaningfully) instead of `pass`.',
          source: 'static',
        });
      }
    }

    if (/range\s*\(\s*len\s*\(/.test(codeOnly)) {
      findings.push({
        id: `static:range-len:${line}`,
        severity: 'info',
        line,
        title: '`range(len(...))` is usually clearer with `enumerate`',
        evidence: `Line ${line}: ${raw.trim()}`,
        why: 'You are using the index to fetch the item. `enumerate` gives both without a second lookup.',
        fix: 'Prefer `for index, item in enumerate(items):` when you need the index and the value together.',
        source: 'static',
      });
    }
  });

  const inputs = (code.match(/\binput\s*\(/g) ?? []).length;
  const provided = (input.stdin ?? '').split('\n').filter((line) => line.length > 0).length;
  if (inputs > provided) {
    findings.push({
      id: 'input:shortfall',
      severity: 'warning',
      line: null,
      title: `The code asks for ${inputs} input value${inputs === 1 ? '' : 's'}, but ${provided} ${provided === 1 ? 'line is' : 'lines are'} provided`,
      evidence: `Found ${inputs} \`input()\` call${inputs === 1 ? '' : 's'} and ${provided} non-empty Program Input line${provided === 1 ? '' : 's'}.`,
      why: '`input()` reads one line per call. When the box runs out, Python raises `EOFError` at that call.',
      fix: 'Add one value per line to Program Input, in the order the prompts ask for them.',
      source: 'input',
    });
  }

  return findings;
}

function javascriptStaticFindings(input: CodeCoachInput): CodeFinding[] {
  const findings: CodeFinding[] = [];
  linesOf(input.code).forEach((raw, index) => {
    const line = index + 1;
    const codeOnly = raw.replace(/\/\/.*$/, '');
    if (/\b(var)\s+[A-Za-z_$]/.test(codeOnly)) {
      findings.push({
        id: `static:var:${line}`,
        severity: 'info',
        line,
        title: '`var` is function-scoped',
        evidence: `Line ${line}: ${raw.trim()}`,
        why: '`var` ignores block scope and can be redeclared, which makes closures and loops harder to reason about.',
        fix: 'Use `const` when the binding does not change, otherwise `let`.',
        source: 'static',
      });
    }
    if (/(^|[^=!])==[^=]/.test(codeOnly) || /!=[^=]/.test(codeOnly)) {
      findings.push({
        id: `static:loose-equality:${line}`,
        severity: 'warning',
        line,
        title: 'Loose equality can coerce types',
        evidence: `Line ${line}: ${raw.trim()}`,
        why: '`==` converts types before comparing (`0 == "0"` is true), which hides mismatched data.',
        fix: 'Use `===` / `!==` unless you deliberately need coercion.',
        source: 'static',
      });
    }
  });
  return findings;
}

/* -------------------------------- complexity -------------------------------- */

/**
 * A Big-O ESTIMATE from visible structure.
 *
 * Loop nesting is measured from indentation, so a generated or tuple-packed one-liner is outside
 * what this can see. The label says so. It is not a profiler and the UI never presents it as one.
 */
export function estimateComplexity(code: string, language: CoachLanguage = 'python'): ComplexityNote | null {
  if (language !== 'python' && language !== 'javascript') return null;
  const lines = linesOf(code);
  let maxDepth = 0;
  const stack: number[] = [];
  let recursion: string | null = null;

  lines.forEach((raw, index) => {
    const line = stripComments(raw);
    if (!line.trim()) return;
    const indent = line.length - line.trimStart().length;
    const isLoop = /^\s*(for|while)\b/.test(line);
    while (stack.length && indent <= stack[stack.length - 1]) stack.pop();
    if (isLoop) {
      stack.push(indent);
      maxDepth = Math.max(maxDepth, stack.length);
    }
    const def = line.match(/^\s*(?:async\s+)?(?:def|function)\s+([A-Za-z_$][\w$]*)/);
    if (def) {
      const name = def[1];
      const body = lines.slice(index + 1).join('\n');
      if (new RegExp(`\\b${name}\\s*\\(`).test(body)) recursion = name;
    }
  });

  const grows = /\[\s*[^\]]*\]|\{\s*[^}]*\}|\.append\s*\(|\.push\s*\(|set\s*\(|dict\s*\(/.test(code);
  const space = grows
    ? 'O(n) auxiliary space (a growing collection is created)'
    : 'O(1) auxiliary space (no growing collection detected)';

  let time: string;
  if (recursion) {
    time = `Recursive (${recursion} calls itself; the real cost depends on the call tree, so no Big-O is claimed)`;
  } else if (maxDepth >= 3) {
    time = `O(n^${maxDepth}) estimated (${maxDepth} nested loops)`;
  } else if (maxDepth === 2) {
    time = 'O(n^2) estimated (two nested loops)';
  } else if (maxDepth === 1) {
    time = 'O(n) estimated (one loop)';
  } else {
    time = 'O(1) estimated (no loops detected)';
  }
  return {
    time,
    space,
    basis: 'Estimated from the loop structure and collection creation in this snippet — not measured or profiled.',
  };
}

/* ---------------------------------- entry ---------------------------------- */

const SEVERITY_LABEL: Record<FindingSeverity, string> = { error: 'Error', warning: 'Warning', info: 'Note' };

/** Only excludes exact duplicates (a runtime EOFError and the input shortfall rule can both fire). */
function dedupe(findings: CodeFinding[]): CodeFinding[] {
  const seen = new Map<string, CodeFinding>();
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.line ?? 'x'}:${finding.title}`;
    if (!seen.has(key)) seen.set(key, finding);
  }
  return [...seen.values()].sort((a, b) =>
    severityRank(a.severity) - severityRank(b.severity)
    || (a.line ?? 9999) - (b.line ?? 9999)
    || a.title.localeCompare(b.title));
}

/** Suggested edge cases, derived from what the snippet visibly does. Not claimed as run. */
export function suggestedTests(input: CodeCoachInput): string[] {
  const code = input.code ?? '';
  const out: string[] = [];
  if (/\binput\s*\(/.test(code)) out.push('Run once with the minimum number of input lines, and once with an empty line where a value is required.');
  if (/\b(for|while)\b/.test(code)) out.push('Try the empty sequence (`[]`) and a single-element sequence — loops often pass on the middle case only.');
  if (/\bint\s*\(/.test(code)) out.push('Enter text that is not a number and check that the error message is the one you intend.');
  if (/\b(if|elif)\b/.test(code)) out.push('Test both the true branch and the false branch, including the boundary value.');
  if (/\b(dict|\{)\s*/.test(code) && /\b\w+\s*\[/.test(code)) out.push('Look up a key that does not exist and decide whether it should raise or return a default.');
  if (/\b(\/|%)\b/.test(code) && !/\bZeroDivisionError\b/.test(code)) out.push('Try a zero divisor if zero is a possible input.');
  if (/\.append\s*\(/.test(code)) out.push('Run the same operation twice — check whether state leaks between calls.');
  if (!out.length) out.push('Try an empty input, a typical input, and one invalid input.');
  return out.slice(0, 4);
}

/**
 * Analyze one snippet. Runtime evidence is used only when `ran` is true; static evidence is always
 * labelled `static`, so the UI can say which statements were observed and which were inspected.
 */
export function analyzeCode(input: CodeCoachInput): CodeCoachResult {
  const language = input.language ?? 'python';
  const ran = input.ran === true;
  const findings: CodeFinding[] = [];

  // A traceback is real evidence whether it arrived from this run or was pasted in. `ran` only
  // changes the wording ("Python reported" vs "the traceback on screen reports") — it never turns a
  // static inspection into a claim that the code was executed.
  if (input.error?.trim()) findings.push(...runtimeFindings(input, language));
  if (language === 'python') findings.push(...pythonStaticFindings(input));
  else if (language === 'javascript') findings.push(...javascriptStaticFindings(input));

  const unique = dedupe(findings);
  const errors = unique.filter((f) => f.severity === 'error').length;
  const warnings = unique.filter((f) => f.severity === 'warning').length;
  const summary = errors
    ? `${errors} runtime error${errors === 1 ? '' : 's'} and ${warnings} warning${warnings === 1 ? '' : 's'} found${ran ? ' in this run' : ' in the traceback'} .`.replace(' .', '.')
    : warnings
      ? `No runtime error was reported, but ${warnings} warning${warnings === 1 ? '' : 's'} need a look.`
      : ran
        ? 'This run finished without a Python error. That is not proof the logic is correct — no tests were run, so use the edge cases below.'
        : 'Nothing has been run yet. Static notes only — I have no runtime evidence to report.';

  const first = unique.find((f) => f.severity === 'error') ?? unique[0];
  const hint = first
    ? `Look at ${first.line ? `line ${first.line}` : 'the finding'} — ${SEVERITY_LABEL[first.severity].toLowerCase()}: ${first.title}. Read the evidence before changing anything.`
    : 'Nothing is broken in the evidence I have. Run the code, then read the first failing line from the bottom of the traceback.';

  return {
    ran,
    findings: unique,
    summary,
    hint,
    complexity: estimateComplexity(input.code, language),
    nextTests: suggestedTests(input),
  };
}

/**
 * The hint ladder: 1 = point, 2 = explain, 3 = repair. Never starts with the answer.
 * Kept separate from `analyzeCode` so asking for another hint cannot re-run or mutate the analysis.
 */
export function coachHints(result: CodeCoachResult, level = 1): string[] {
  const first = result.findings.find((f) => f.severity === 'error') ?? result.findings[0];
  if (!first) {
    return [
      result.ran ? 'The run itself did not raise. Now test an edge case.' : 'Run the code first — a hint without evidence would be a guess.',
      'Test the empty input, then a single element, then a typical input.',
      'If the output is still wrong, paste the exact expected output and I will compare it with what ran.',
    ].slice(0, Math.max(1, Math.min(3, level)));
  }
  const rungs = [
    `Look at ${first.line ? `line ${first.line}` : 'the reported failure'}. Evidence: ${first.evidence}`,
    first.why,
    `${first.fix}${first.patch ? ' A one-line preview is available — nothing is applied until you press Apply.' : ''}`,
  ];
  return rungs.slice(0, Math.max(1, Math.min(3, level)));
}

/* ------------------------------- code reading ------------------------------- */

export interface CodeExplanation {
  lineCount: number;
  functions: string[];
  classes: string[];
  imports: string[];
  loops: number;
  conditionals: number;
  inputs: number;
  prints: number;
  returns: number;
  hasTry: boolean;
  complexity: ComplexityNote | null;
  observations: string[];
}

/**
 * A structural read of the snippet: what is visibly there. No "this is good/bad" verdict, because
 * correctness needs a requirement and runtime evidence. Used by the Explain tab.
 */
export function explainCode(code: string, language: CoachLanguage = 'python'): CodeExplanation {
  const lines = linesOf(code);
  const functions = [...code.matchAll(/\b(?:def|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const classes = [...code.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const imports = [...code.matchAll(/^\s*(?:import|from)\s+([A-Za-z_][\w.]*)/gm)].map((m) => m[1]);
  const loops = (code.match(/^\s*(?:for|while)\b/gm) ?? []).length;
  const conditionals = (code.match(/^\s*(?:if|elif|else|switch|case)\b/gm) ?? []).length;
  const inputs = (code.match(/\binput\s*\(/g) ?? []).length;
  const prints = (code.match(/\bprint\s*\(/g) ?? []).length;
  const returns = (code.match(/^\s*return\b/gm) ?? []).length;
  const hasTry = /\btry\s*[:(]/.test(code);

  const observations: string[] = [];
  if (functions.length) observations.push(`Defines ${functions.length} function${functions.length === 1 ? '' : 's'}: ${functions.slice(0, 5).join(', ')}${functions.length > 5 ? '…' : ''}.`);
  if (classes.length) observations.push(`Defines ${classes.length} class${classes.length === 1 ? '' : 'es'}: ${classes.slice(0, 5).join(', ')}.`);
  if (imports.length) observations.push(`Imports: ${imports.slice(0, 6).join(', ')}${imports.length > 6 ? '…' : ''}.`);
  if (inputs) observations.push(`Reads ${inputs} line${inputs === 1 ? '' : 's'} with \`input()\` — Program Input must supply them in order.`);
  if (prints) observations.push(`Calls \`print\` ${prints} time${prints === 1 ? '' : 's'} — output is written to stdout, not returned.`);
  if (functions.length && !returns) observations.push('A function is defined but no `return` statement is visible; check whether it is meant to print or return.');
  if (!hasTry) observations.push('No `try/except` block is visible; invalid input or a missing file would stop the program.');
  if (loops >= 2) observations.push('More than one loop is visible — check whether the bound is the same for each, and whether the inner loop allocates.');
  observations.push(lines.length ? `${lines.length} lines, ${lines.filter((line) => line.trim() && !line.trim().startsWith('#')).length} non-empty non-comment lines.` : 'The editor is empty.');

  return {
    lineCount: lines.length,
    functions,
    classes,
    imports,
    loops,
    conditionals,
    inputs,
    prints,
    returns,
    hasTry,
    complexity: estimateComplexity(code, language),
    observations,
  };
}
