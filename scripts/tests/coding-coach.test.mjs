/**
 * The Coding Coach — `src/core/ai/coding-coach.ts` and the line diff it previews with.
 *
 * The rule these tests exist to enforce: a warning must quote evidence the learner can check, and a
 * patch may only be offered when the repair is deterministic from the text. So every fixture below
 * is a REAL traceback shape (Pyodide formats it exactly like CPython) or a line whose bug is visible
 * in the line itself. The tests also pin the honesty boundary: an analysis that was not executed may
 * never word itself as though it were, and a stale preview must refuse to apply.
 *
 * Zero dependencies: node:test plus the project's TS resolver hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const diff = await load('src/core/platform/diff.ts');
const coach = await load('src/core/ai/coding-coach.ts');

const NAMEDEF = 'Traceback (most recent call last):\n'
  + '  File "<exec>", line 3, in <module>\n'
  + '    print(total)\n'
  + "NameError: name 'total' is not defined";

/* --------------------------------- the diff -------------------------------- */

test('diff: a one-line change is one removal and one addition, with both line numbers', () => {
  const lines = diff.diffLines('a = 1\nb = 2\nc = 3', 'a = 1\nb = 20\nc = 3');
  assert.deepEqual(diff.diffStats(lines), { added: 1, removed: 1, unchanged: 2 });
  const removed = lines.find((line) => line.type === 'remove');
  const added = lines.find((line) => line.type === 'add');
  assert.deepEqual([removed.beforeLine, removed.afterLine, removed.text], [2, null, 'b = 2']);
  assert.deepEqual([added.beforeLine, added.afterLine, added.text], [null, 2, 'b = 20']);
});

test('diff: a trailing newline is a terminator, not an extra empty line', () => {
  assert.deepEqual(diff.diffLines('x\n', 'x\n'), [{ type: 'same', beforeLine: 1, afterLine: 1, text: 'x' }]);
  assert.deepEqual(diff.diffStats(diff.diffLines('x\ny\n', 'x\ny\n')), { added: 0, removed: 0, unchanged: 2 });
});

test('diff: apply refuses a stale line instead of overwriting an edit it did not make', () => {
  const patch = { line: 1, before: 'if x == None:', after: 'if x is None:', reason: 'identity check' };
  assert.equal(diff.applyLinePatch('if x == None:\n    pass', patch), 'if x is None:\n    pass');
  assert.equal(diff.applyLinePatch('if x == None:   \n    pass', patch), 'if x is None:\n    pass',
    'trailing whitespace is ignored; the code itself still matches');
  assert.equal(diff.applyLinePatch('if x == None:  # learner typed here\n    pass', patch), null,
    'a comment on the line is a real edit — refuse rather than drop it');
  assert.equal(diff.applyLinePatch('if x != None:\n    pass', patch), null, 'the line changed — refuse');
  assert.equal(diff.applyLinePatch('if x == None:', { ...patch, line: 99 }), null, 'out of range — refuse');
  assert.equal(diff.applyLinePatch('x', { line: 2, before: 'x', after: 'y' }), null, 'an append with before-text is a mistake');
  assert.equal(diff.applyLinePatch('x', { line: 2, before: '', after: 'y' }), 'x\ny');
  assert.equal(diff.previewPatch('if x != None:', patch), null, 'the preview uses the same refusal');
});

test('diff: an enormous paste degrades to a whole-file replace rather than freezing', () => {
  const before = Array.from({ length: diff.MAX_DIFF_LINES + 5 }, (_, i) => `old ${i}`).join('\n');
  const after = Array.from({ length: diff.MAX_DIFF_LINES + 5 }, (_, i) => `new ${i}`).join('\n');
  const lines = diff.diffLines(before, after);
  assert.ok(lines.every((line) => line.type !== 'same'), 'no false "same" lines at the cap');
  assert.equal(diff.diffStats(lines).removed, diff.MAX_DIFF_LINES + 5);
});

/* ------------------------------ runtime evidence ----------------------------- */

test('coach: a real traceback names the line, and the evidence quotes Python verbatim', () => {
  const code = 'values = [1, 2]\nfor value in values:\n    print(total)';
  const result = coach.analyzeCode({ code, language: 'python', error: NAMEDEF, ran: true });

  assert.equal(result.ran, true);
  const finding = result.findings.find((item) => item.source === 'runtime');
  assert.equal(finding.line, 3);
  assert.equal(finding.severity, 'error');
  assert.match(finding.title, /`total` is used before it exists/);
  assert.equal(finding.evidence, "Python reported NameError at line 3: name 'total' is not defined");
  assert.match(finding.why, /print\(total\)/, 'the finding quotes the actual source line');
  assert.equal(finding.patch, undefined, 'an undefined name has no deterministic repair');
});

test('coach: a pasted traceback is labelled as the traceback, not as a run', () => {
  const result = coach.analyzeCode({ code: 'print(total)', error: NAMEDEF, ran: false });
  const finding = result.findings.find((item) => item.source === 'runtime');
  assert.equal(result.ran, false);
  assert.equal(finding.evidence, "The traceback on screen reports NameError at line 3: name 'total' is not defined",
    'the traceback names the line even when the pasted snippet is shorter — it is not re-mapped');
  assert.match(result.summary, /traceback/);
  assert.doesNotMatch(result.summary, /in this run/);
});

test('coach: a real SyntaxError with a missing colon offers exactly that one-character patch', () => {
  const code = 'for i in range(3)\n    print(i)';
  const error = '  File "<exec>", line 1\n    for i in range(3)\n                      ^\nSyntaxError: expected \':\'';
  const result = coach.analyzeCode({ code, error, ran: true });
  const finding = result.findings.find((item) => item.source === 'runtime');

  assert.equal(finding.line, 1);
  assert.ok(finding.patch, 'a missing colon is deterministic');
  const preview = coach.previewFindingPatch(code, finding);
  assert.deepEqual(diff.diffStats(preview), { added: 1, removed: 1, unchanged: 1 });
  assert.equal(diff.applyLinePatch(code, finding.patch), 'for i in range(3):\n    print(i)');
});

test('coach: without a run or a traceback it reports no runtime evidence at all', () => {
  const result = coach.analyzeCode({ code: 'print(1)' });
  assert.equal(result.ran, false);
  assert.deepEqual(result.findings, []);
  assert.match(result.summary, /Nothing has been run yet/);
  assert.doesNotMatch(`${result.summary} ${result.hint}`, /passed|no errors/i);
  assert.match(result.hint, /Run the code/);
});

/* ------------------------------ static evidence ----------------------------- */

test('coach: a visible singleton comparison is a warning WITH a safe patch', () => {
  const code = 'value = input()\nif value == None:\n    print("missing")';
  const result = coach.analyzeCode({ code, language: 'python' });
  const finding = result.findings.find((item) => item.title.includes('`None`'));

  assert.equal(finding.severity, 'warning');
  assert.equal(finding.source, 'static', 'no runner saw this — the source says static');
  assert.equal(finding.line, 2);
  assert.equal(finding.evidence, 'Line 2: if value == None:');
  assert.equal(diff.applyLinePatch(code, finding.patch), 'value = input()\nif value is None:\n    print("missing")');
});

test('coach: a bare except is widened, and a mutable default gets a hint but no invented patch', () => {
  const bare = 'try:\n    x = 1\nexcept:\n    print("x")';
  const bareResult = coach.analyzeCode({ code: bare });
  const handler = bareResult.findings.find((item) => item.title.includes('Bare `except:`'));
  assert.equal(handler.severity, 'warning');
  assert.equal(diff.applyLinePatch(bare, handler.patch), 'try:\n    x = 1\nexcept Exception:\n    print("x")');

  const mutable = 'def add(item, bucket=[]):\n    bucket.append(item)\n    return bucket';
  const mutableResult = coach.analyzeCode({ code: mutable });
  const finding = mutableResult.findings.find((item) => item.title === 'Mutable default argument');
  assert.ok(finding, 'the shared default is visible in the def line');
  assert.equal(finding.patch, undefined, 'the repair changes the function body, so no one-line patch is claimed');
  assert.match(finding.fix, /None/);
});

test('coach: input shortfall is counted from Program Input, not guessed', () => {
  const code = 'a = input()\nb = input()\nprint(a, b)';
  const missing = coach.analyzeCode({ code, stdin: 'only-one' });
  const finding = missing.findings.find((item) => item.source === 'input');
  assert.match(finding.title, /asks for 2 input values, but 1 line is provided/);
  assert.equal(finding.line, null, 'a whole-program shortfall belongs to no single line');

  const supplied = coach.analyzeCode({ code, stdin: 'one\ntwo' });
  assert.equal(supplied.findings.some((item) => item.source === 'input'), false);
});

test('coach: JavaScript gets JavaScript rules, never Python ones', () => {
  const result = coach.analyzeCode({ code: 'var x = 1;\nif (x == "1") { console.log(x) }', language: 'javascript' });
  const titles = result.findings.map((item) => item.title).join(' | ');
  assert.match(titles, /`var` is function-scoped/);
  assert.match(titles, /Loose equality/);
  assert.doesNotMatch(titles, /colon|except|None/);
});

/* -------------------------------- complexity -------------------------------- */

test('coach: complexity is labelled an estimate and recursion is not given a fake Big-O', () => {
  const nested = coach.estimateComplexity('for i in range(n):\n    for j in range(n):\n        print(i, j)');
  assert.equal(nested.time, 'O(n^2) estimated (two nested loops)');
  assert.match(nested.basis, /not measured or profiled/);

  const flat = coach.estimateComplexity('print(1)');
  assert.equal(flat.time, 'O(1) estimated (no loops detected)');

  const recursive = coach.estimateComplexity('def fact(n):\n    return n * fact(n - 1)');
  assert.match(recursive.time, /^Recursive/);
  assert.doesNotMatch(recursive.time, /O\(n\)/, 'a call tree is not a loop');

  assert.equal(coach.estimateComplexity('SELECT 1', 'sql'), null, 'no Big-O is claimed for SQL');
});

/* ------------------------------------ hints --------------------------------- */

test('coach: hints climb one rung at a time and the last rung states nothing is applied', () => {
  const code = 'if x == None:\n    pass';
  const result = coach.analyzeCode({ code });
  const one = coach.coachHints(result, 1);
  const three = coach.coachHints(result, 3);

  assert.equal(one.length, 1);
  assert.equal(three.length, 3);
  assert.match(one[0], /^Look at line 1/);
  assert.match(three[2], /nothing is applied until you press Apply/i);
  assert.equal(coach.coachHints(result, 99).length, 3, 'the ladder is bounded');
});

/* --------------------------------- suggested -------------------------------- */

test('coach: suggested cases are phrased as things to try, not tests that ran', () => {
  const cases = coach.suggestedTests({ code: 'n = int(input())\nfor i in range(n):\n    print(i)' });
  assert.ok(cases.length >= 2);
  assert.ok(cases.some((item) => /input lines|empty sequence|not a number/i.test(item)));
  assert.ok(cases.every((item) => !/\bpassed\b/i.test(item)));
});

test('coach: Explain reports structure without a correctness verdict', () => {
  const read = coach.explainCode('import math\n\ndef area(r):\n    if r <= 0:\n        return 0\n    return math.pi * r ** 2', 'python');
  assert.deepEqual(read.functions, ['area']);
  assert.deepEqual(read.imports, ['math']);
  assert.equal(read.conditionals, 1);
  assert.equal(read.returns, 2);
  assert.equal(read.hasTry, false);
  assert.ok(read.observations.some((item) => /Defines 1 function: area/.test(item)));
  assert.ok(read.observations.every((item) => !/correct|good|bad|tested/i.test(item)));
});
