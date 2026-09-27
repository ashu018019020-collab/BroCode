/**
 * Export tests — the `.ipynb` a learner downloads.
 *
 * A downloaded notebook is the one artefact that leaves the app, so it gets its own guards: it
 * must be valid nbformat 4, it must not lose a single character of the learner's code, and it must
 * record what actually ran. A file that silently dropped a cell, or printed clean outputs for a
 * session full of errors, would teach the wrong lesson in the learner's own Jupyter — and nobody
 * would see it fail here.
 *
 * Runs against the REAL bundled notebooks in `public/notebooks` plus the REAL `src/engine/ipynb.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);
const { buildIpynb, ipynbFileName, toLines, outputsFor } = await load('src/engine/ipynb.ts');

const NOTEBOOK_DIR = path.join(ROOT, 'public', 'notebooks');
const files = fs.readdirSync(NOTEBOOK_DIR).filter((f) => f.endsWith('.ipynb')).sort();

/** The authored source of an ipynb cell, however it was serialised (array of lines or one string). */
const sourceOf = (cell) => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source ?? ''));
/** Every authored notebook, as the same shape the notebook surface hands to the exporter. */
const authored = (file) => {
  const nb = JSON.parse(read(path.join('public', 'notebooks', file)));
  return { nb, cells: nb.cells.map((c) => ({ kind: c.cell_type === 'markdown' ? 'md' : 'code', source: sourceOf(c) })) };
};

test('ipynb: every bundled notebook survives an export with no code lost', () => {
  assert.ok(files.length >= 4, `expected the bundled notebooks to be readable, found ${files.length}`);
  for (const file of files) {
    const { nb, cells } = authored(file);
    const doc = buildIpynb(cells);
    assert.equal(doc.cells.length, nb.cells.length, `${file}: a cell went missing`);
    doc.cells.forEach((exported, i) => {
      const before = sourceOf(nb.cells[i]);
      const after = exported.source.join('');
      assert.equal(after, before, `${file} cell ${i}: the exported source differs from the authored source`);
      const want = nb.cells[i].cell_type === 'markdown' ? 'markdown' : 'code';
      assert.equal(exported.cell_type, want, `${file} cell ${i}: wrong cell_type`);
      if (want === 'code') assert.ok(Array.isArray(exported.outputs), `${file} cell ${i}: code cells need an outputs array`);
    });
  }
});

test('ipynb: the document is valid nbformat 4 JSON', () => {
  const doc = buildIpynb([{ kind: 'md', source: '# Title\n' }, { kind: 'code', source: 'x = 1\n' }]);
  assert.equal(doc.nbformat, 4);
  assert.equal(typeof doc.nbformat_minor, 'number');
  assert.equal(doc.metadata.kernelspec.name, 'python3');
  assert.equal(doc.metadata.kernelspec.language, 'python');
  assert.equal(doc.metadata.language_info.name, 'python');
  // What actually lands on disk is a JSON string — it must parse back to the same thing.
  const parsed = JSON.parse(JSON.stringify(doc));
  assert.deepEqual(parsed, doc);
  assert.equal(parsed.cells[0].cell_type, 'markdown');
  assert.equal(parsed.cells[1].cell_type, 'code');
});

test('ipynb: a cell that was never run is exported as never run, not as a clean result', () => {
  // The file must tell the truth about the session: an untried cell has no execution_count and no
  // outputs, so a learner can see which parts they still owe themselves.
  const doc = buildIpynb([{ kind: 'code', source: 'total = sum(range(10))\n' }]);
  const cell = doc.cells[0];
  assert.equal(cell.cell_type, 'code');
  assert.equal(cell.execution_count, null);
  assert.deepEqual(cell.outputs, []);
});

test('ipynb: a real run exports its stdout as a stream output', () => {
  const doc = buildIpynb([{
    kind: 'code',
    source: 'print("hello")\nprint("world")\n',
    run: { ok: true, output: 'hello\nworld' },
    executionCount: 3,
  }]);
  const cell = doc.cells[0];
  assert.equal(cell.execution_count, 3);
  assert.equal(cell.outputs.length, 1);
  const out = cell.outputs[0];
  assert.equal(out.output_type, 'stream');
  assert.equal(out.name, 'stdout');
  assert.equal(out.text.join(''), 'hello\nworld', 'the output text must survive verbatim');
});

test('ipynb: a failed run exports as a real error cell, not as empty output', () => {
  const doc = buildIpynb([{
    kind: 'code',
    source: 'print(1 / 0)\n',
    run: { ok: false, output: '', error: 'Traceback (most recent call last):\n  File "<exec>", line 1, in <module>\nZeroDivisionError: division by zero' },
    executionCount: 2,
  }]);
  const out = doc.cells[0].outputs[0];
  assert.equal(out.output_type, 'error');
  assert.equal(out.ename, 'ZeroDivisionError');
  assert.equal(out.evalue, 'division by zero');
  assert.ok(out.traceback.length >= 3, 'the traceback must be kept whole');
});

test('ipynb: line splitting keeps blank lines and the final newline', () => {
  assert.deepEqual(toLines('a\n\nb\n'), ['a\n', '\n', 'b\n']);
  assert.deepEqual(toLines(''), []);
  assert.deepEqual(toLines('no trailing newline'), ['no trailing newline']);
  // A cell that ran but printed nothing has no outputs — not an empty stream.
  assert.deepEqual(outputsFor({ kind: 'code', source: 'x = 1', run: { ok: true, output: '' } }), []);
});

test('ipynb: the download name is always a safe .ipynb filename', () => {
  assert.equal(ipynbFileName('python-lists.ipynb'), 'python-lists.ipynb');
  // Lesson cells are keyed like `nbc:s01:coding:3` — Windows would reject those colons outright.
  const lesson = ipynbFileName('nbc:s01:coding:3');
  assert.match(lesson, /^[A-Za-z0-9._-]+\.ipynb$/, `unsafe filename: ${lesson}`);
  assert.ok(!lesson.includes(':') && !lesson.includes('/') && !lesson.includes('\\'));
  assert.equal(ipynbFileName(''), 'notebook.ipynb');
  assert.match(ipynbFileName('notebooks/python lists.ipynb'), /\.ipynb$/);
});
