/**
 * The error lens' "Fix" button is only trustworthy if its rules are: a wrong repair is worse than
 * no button at all. These drive the pure `suggestFix` with the exact traceback/GCC shapes the app
 * receives, plus the cases where it must refuse.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
register('./_ts-resolve.mjs', import.meta.url);

const { suggestFix } = await load('src/core/ai/tutor.ts');

const python = (kind, message, line, source) =>
  `Traceback (most recent call last):\n  File "<exec>", line ${line}, in <module>\n    ${source}\n${kind}: ${message}`;

test('fix: a list method becomes the numpy call, and numpy is imported', () => {
  const code = 'arr = [1, 2, 3]\nprint(arr.mean())';
  const fix = suggestFix(python('AttributeError', "AttributeError: 'list' object has no attribute 'mean'", 2, 'print(arr.mean())'), code);
  assert.ok(fix, 'the tutor must offer a fix for the classic numpy mistake');
  assert.match(fix.code, /^import numpy as np\n/, 'numpy must be imported by the fix itself');
  assert.match(fix.code, /np\.mean\(arr\)/, 'the call must become np.mean(arr)');
  assert.match(fix.note, /np\.mean/);
});

test('fix: = in a condition becomes ==', () => {
  const code = 'x = 5\nif x = 5:\n    print(x)';
  const fix = suggestFix(python('SyntaxError', 'invalid syntax', 2, 'if x = 5:'), code);
  assert.ok(fix);
  assert.match(fix.code, /if x == 5:/);
});

test('fix: a block header without its colon gets one', () => {
  const code = 'for i in range(3)\n    print(i)';
  const fix = suggestFix(python('SyntaxError', "expected ':'", 1, 'for i in range(3)'), code);
  assert.ok(fix);
  assert.match(fix.code, /for i in range\(3\):/);
});

test('fix: a C missing semicolon is added to the reported line', () => {
  const code = '#include <stdio.h>\n\nint main(void) {\n    int x = 5\n    printf("%d\\n", x);\n    return 0;\n}';
  const fix = suggestFix("main.c:4:14: error: expected ';' before 'printf'", code);
  assert.ok(fix);
  assert.match(fix.code, /int x = 5;/);
  assert.match(fix.note, /;/);
});

test('fix: an undeclared stdlib function gets its header', () => {
  const code = 'int main(void) {\n    printf("hi");\n    return 0;\n}';
  const fix = suggestFix("main.c:2:5: warning: implicit declaration of function 'printf'", code);
  assert.ok(fix);
  assert.match(fix.code, /^#include <stdio\.h>\n/);
});

test('fix: an unrecognised error offers nothing instead of guessing', () => {
  assert.equal(suggestFix('ValueError: math domain error', 'import math\nprint(math.sqrt(-1))'), null);
  assert.equal(suggestFix('', 'print(1)'), null);
});
