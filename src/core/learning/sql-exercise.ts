/**
 * Grading a Masterclass exercise by what it RETURNS, not by matching the learner's SQL text.
 *
 * The authored bank used to reveal its reference solution in a `<details>` block; that teaches a
 * learner nothing and cannot tell a correct answer from a wrong one. The Lab now runs the learner's
 * query and the authored solution on the same schema and compares result sets, so any phrasing that
 * answers the task passes — a join, a subquery and a CTE that return the same rows are all correct.
 *
 * Equality is a result-set equality: column COUNT must match and the rows must be the same multiset
 * (order-insensitive, duplicates counted), compared value-by-value in column order. Column LABELS
 * are display, not meaning: `SELECT AVG(marks)` and `SELECT AVG(marks) AS average` answer alike.
 *
 * Pure: no React, no engine — driven with fixtures in `scripts/tests/sql-exercise.test.mjs`.
 */
export interface SqlResultSet {
  columns: readonly string[];
  rows: readonly (readonly string[])[];
}

export interface SqlGrade {
  ok: boolean;
  /** Why the result differs, worded for the learner — it never quotes the reference SQL. */
  reason?: string;
  rows: number;
  expectedRows: number;
}

const rowKey = (row: readonly string[]) => row.join('\u0001');

/**
 * Only a query has a result set to compare. Many authored labs are DDL/DML (`CREATE TABLE`, `INSERT`)
 * and some debug fixes are prose; grading those by their output would mean comparing nothing (or the
 * solution's empty result), which marks any answer right. They keep their reference reading instead.
 */
export function isGradeableSql(sql: string): boolean {
  return /^\s*(select|with)\b/i.test(sql);
}

export function gradeSqlResult(actual: SqlResultSet, reference: SqlResultSet): SqlGrade {
  const rows = actual.rows.length;
  const expectedRows = reference.rows.length;
  if (actual.columns.length !== reference.columns.length) {
    return {
      ok: false,
      rows,
      expectedRows,
      reason: `your answer returns ${actual.columns.length} column(s), the reference ${reference.columns.length}`,
    };
  }
  const mine = actual.rows.map(rowKey).sort();
  const wanted = reference.rows.map(rowKey).sort();
  if (mine.length === wanted.length && mine.every((row, i) => row === wanted[i])) {
    return { ok: true, rows, expectedRows };
  }
  return {
    ok: false,
    rows,
    expectedRows,
    reason: rows === expectedRows
      ? 'the row count is right but the values differ'
      : `your answer returns ${rows} row(s), the reference ${expectedRows}`,
  };
}
