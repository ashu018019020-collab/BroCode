/**
 * A Masterclass exercise is marked by its RESULT. The learner's query and the authored solution run
 * on the same schema, and the two result sets are compared — so a join, a subquery or a CTE that
 * return the same rows all pass, and the solution's text never has to be revealed.
 *
 * The comparison rules pinned here: column count matters, labels do not, row order does not, and
 * duplicate rows do (a result set is a multiset, not a set).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

const { gradeSqlResult, isGradeableSql } = await load('src/core/learning/sql-exercise.ts');

const reference = {
  columns: ['name', 'total'],
  rows: [['Ravi', '2'], ['Sara', '1'], ['Ashu', '3']],
};

test('sql-exercise: a result that matches the reference passes', () => {
  const grade = gradeSqlResult({ columns: ['student', 'sum'], rows: [...reference.rows] }, reference);
  assert.equal(grade.ok, true, 'column labels are display, not meaning');
  assert.equal(grade.rows, 3);
});

test('sql-exercise: row order is not part of the answer', () => {
  const grade = gradeSqlResult(
    { columns: reference.columns, rows: [['Ashu', '3'], ['Ravi', '2'], ['Sara', '1']] },
    reference,
  );
  assert.equal(grade.ok, true, 'without ORDER BY the engine may return the same rows in any order');
});

test('sql-exercise: duplicate rows are counted, not collapsed', () => {
  const grade = gradeSqlResult(
    { columns: reference.columns, rows: [['Ravi', '2'], ['Ravi', '2'], ['Sara', '1']] },
    reference,
  );
  assert.equal(grade.ok, false);
  assert.match(grade.reason, /values differ/);
});

test('sql-exercise: a wrong row count or column count says so, without quoting the solution', () => {
  const short = gradeSqlResult({ columns: reference.columns, rows: [['Ravi', '2']] }, reference);
  assert.equal(short.ok, false);
  assert.match(short.reason, /1 row/);
  assert.doesNotMatch(short.reason, /SELECT/i, 'the reason must not leak the solution SQL');

  const wide = gradeSqlResult({ columns: ['name', 'total', 'extra'], rows: reference.rows }, reference);
  assert.equal(wide.ok, false);
  assert.match(wide.reason, /3 column/);
});

test('sql-exercise: the Lab grades with the authored solution and the panel links to the Lab', () => {
  const lab = read('src/features/labs/SQLLab.tsx');
  assert.match(lab, /gradeSqlResult\(mine, reference\)/, 'grading compares the learner with the solution');
  assert.match(lab, /moduleRun\(schema, referenceSql/, 'the solution runs with the module setup, not bare');
  const panel = read('src/features/labs/SqlMasterclass.tsx');
  assert.match(panel, /bank=labs&level=\$\{level\}&item=\$\{index\}/, 'a lab item opens in the Lab');
  assert.match(panel, /bank=debug&level=\$\{level\}&item=\$\{index\}/, 'a debug item opens in the Lab');
  assert.match(panel, /labRoute \? \t*\n?/, 'the course with a Lab passes the route its banks link to');
});

test('sql-exercise: only a query has a result set to grade', () => {
  assert.equal(isGradeableSql('SELECT name FROM students'), true);
  assert.equal(isGradeableSql('  with top as (select 1) select * from top'), true);
  // The authored labs also teach DDL/DML, and some debug fixes are prose advice.
  assert.equal(isGradeableSql('CREATE TABLE students (id INTEGER PRIMARY KEY)'), false);
  assert.equal(isGradeableSql('INSERT INTO students (name) VALUES (\'Aarav\')'), false);
  assert.equal(isGradeableSql('Review the ON DELETE action before deleting'), false);
});

test('sql-exercise: the panel keeps the reference for items the Lab cannot grade', () => {
  const panel = read('src/features/labs/SqlMasterclass.tsx');
  assert.match(panel, /isGradeableSql\(item\.solution\)/, 'a DDL lab keeps its reference reading');
  assert.match(panel, /isGradeableSql\(item\.fix\)/, 'a prose fix keeps its reference reading');
  assert.match(read('src/features/labs/SQLLab.tsx'), /isGradeableSql\(referenceSql\)/, 'the Lab only offers Check answer for a query');
});
