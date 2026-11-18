/**
 * The SQL Lab loads a Masterclass module's setup before the learner's query, because the authored
 * examples assume tables the Lab does not seed. The setup is PostgreSQL and the engine is SQLite, so
 * the rule that matters is: every authored statement is either RUNNABLE on sql.js or REPORTED to the
 * learner — never silently dropped, and never a "near GENERATED: syntax error" at the first Run.
 *
 * `sql-setup.ts` is pure, so it is imported directly through the project resolver; the artifact sweep
 * executes the translated DDL on the same sql.js engine the Lab uses, seeded exactly as `runSQL` seeds.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (relative) => import(pathToFileURL(path.join(ROOT, relative)).href);

const { sqliteSchema, moduleRun } = await load('src/core/learning/sql-setup.ts');
const { DATASETS, seedForSQL } = await load('src/core/data/datasets.ts');

const require = createRequire(import.meta.url);
const initSqlJs = require('sql.js');
const SQL = await initSqlJs({ locateFile: (file) => path.join(ROOT, 'node_modules/sql.js/dist', file) });

/** The Lab's own seeding step (`runSQL` in `features/coding/runners.ts`), reproduced so the DDL is
 *  exercised against the tables a learner actually has. sql.js is the browser engine, run in Node. */
function labDatabase(datasets = DATASETS) {
  const db = new SQL.Database();
  for (const { name, rows } of datasets.map(seedForSQL)) {
    db.run(`CREATE TABLE ${name} (${rows[0].map((column) => `"${column}"`).join(',')});`);
    for (let i = 1; i < rows.length; i += 1) {
      const values = rows[i].map((value) => (typeof value === 'number' ? value : `'${String(value).replace(/'/g, "''")}'`));
      db.run(`INSERT INTO ${name} VALUES (${values.join(',')});`);
    }
  }
  return db;
}

const artifact = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/generated/sql-masterclass/index.json'), 'utf8'));
const withSetup = artifact.modules.filter((module) => Array.isArray(module.setup) && module.setup.length > 0);
const SEEDED = DATASETS.map((dataset) => dataset.name);

test('sql-setup: PostgreSQL clauses are translated, not dropped', () => {
  const identity = sqliteSchema(
    ["CREATE TABLE IF NOT EXISTS settings (id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, name TEXT NOT NULL DEFAULT 'default');"],
    SEEDED,
  );
  assert.deepEqual(identity.statements, [
    "CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT 'default')",
  ]);
  assert.equal(identity.adapted.length, 1, 'the identity column is an adaptation the Lab reports');
  assert.equal(identity.skipped.length, 0);

  const like = sqliteSchema(['CREATE TABLE IF NOT EXISTS students_backup (LIKE students INCLUDING ALL);'], SEEDED);
  assert.deepEqual(like.statements, ['CREATE TABLE students_backup AS SELECT * FROM students WHERE 0']);

  const defaults = sqliteSchema(
    ["CREATE TABLE audit (id BIGINT PRIMARY KEY, changed_at TIMESTAMPTZ DEFAULT NOW(), payload JSONB DEFAULT '{}'::jsonb);"],
    SEEDED,
  );
  assert.deepEqual(defaults.statements, [
    "CREATE TABLE audit (id BIGINT PRIMARY KEY, changed_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, payload JSONB DEFAULT '{}')",
  ]);

  const partitioning = sqliteSchema(
    [
      'CREATE TABLE IF NOT EXISTS events (id BIGINT, created_at DATE NOT NULL, payload JSONB) PARTITION BY RANGE (created_at);',
      "CREATE TABLE IF NOT EXISTS events_2024 PARTITION OF events FOR VALUES FROM ('2024-01-01') TO ('2025-01-01');",
    ],
    SEEDED,
  );
  assert.deepEqual(partitioning.statements, [
    'CREATE TABLE IF NOT EXISTS events (id BIGINT, created_at DATE NOT NULL, payload JSONB)',
    'CREATE TABLE events_2024 AS SELECT * FROM events WHERE 0',
  ]);

  const view = sqliteSchema(['CREATE OR REPLACE VIEW v AS SELECT 1 AS one;'], SEEDED);
  assert.deepEqual(view.statements, ['CREATE VIEW v AS SELECT 1 AS one']);
});

test('sql-setup: what SQLite cannot run is reported with a reason', () => {
  const plan = sqliteSchema(
    [
      'CREATE EXTENSION IF NOT EXISTS btree_gist;',
      'ALTER TABLE enrollments ADD COLUMN IF NOT EXISTS semester TEXT;',
    ],
    SEEDED,
  );
  assert.deepEqual(plan.statements, [], 'neither statement may run against the demo datasets');
  assert.equal(plan.skipped.length, 2);
  assert.match(plan.skipped[0].reason, /PostgreSQL/);
  assert.match(plan.skipped[1].reason, /enrollments/, 'the reason names the table the module does not create');

  // The same ALTER on a table the Lab does have is a dialect adaptation, not a skip.
  const ok = sqliteSchema(['ALTER TABLE students ADD COLUMN IF NOT EXISTS semester TEXT;'], SEEDED);
  assert.deepEqual(ok.statements, ['ALTER TABLE students ADD COLUMN semester TEXT']);
  assert.equal(ok.adapted.length, 1);
  assert.equal(ok.skipped.length, 0);
});

test('sql-setup: the schema runs before the query, and never replaces it', () => {
  const plan = sqliteSchema(['CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY);'], SEEDED);
  assert.equal(
    moduleRun(plan, 'SELECT * FROM people;').sql,
    'CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY);\nSELECT * FROM people;',
  );
  assert.equal(moduleRun(sqliteSchema(undefined, SEEDED), 'SELECT 1;').sql, 'SELECT 1;');
  assert.equal(moduleRun(null, 'SELECT 1;').sql, 'SELECT 1;');
});

test('sql-setup: a query that defines or alters a table owns it', () => {
  const plan = sqliteSchema(['CREATE TABLE IF NOT EXISTS students (id INTEGER PRIMARY KEY, email TEXT);'], SEEDED);

  // A DDL example creates the table it is teaching, so nothing may pre-create it or seed it.
  const creates = moduleRun(plan, 'CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);');
  assert.equal(creates.sql, 'CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT);');
  assert.deepEqual(creates.shadowed, ['students']);

  // An ALTER example needs the table, but not with the column it adds: the demo table is the base.
  const alters = moduleRun(plan, 'ALTER TABLE students ADD COLUMN email TEXT;', SEEDED);
  assert.equal(alters.sql, 'ALTER TABLE students ADD COLUMN email TEXT;');
  assert.deepEqual(alters.shadowed, []);
  const db = labDatabase(DATASETS.filter((dataset) => !alters.shadowed.includes(dataset.name)));
  assert.doesNotThrow(() => db.exec(alters.sql), 'the demo students table has no email column yet');
  db.close();
});

test('sql-setup: the course’s shared tables make a school-schema join run', () => {
  const courseSchema = artifact.course.schema;
  assert.ok(Array.isArray(courseSchema) && courseSchema.length >= 3, 'the course publishes its school tables');
  const joins = artifact.modules.find((module) => module.id === 'sql10');
  const topic = joins.topics.find((t) => /\benrollments\b/.test(t.example.sql));
  assert.ok(topic, 'sql10 has an example that joins enrollments');

  const plan = sqliteSchema([...courseSchema, ...(joins.setup ?? [])], SEEDED);
  const run = moduleRun(plan, topic.example.sql, SEEDED);
  const db = labDatabase(DATASETS.filter((dataset) => !run.shadowed.includes(dataset.name)));
  const results = db.exec(run.sql);
  db.close();
  const result = results[results.length - 1];
  assert.ok(result && result.values.length > 0, 'the join reads the shared roster instead of failing on a missing table');
});

test('sql-setup: no example is missing the course’s school tables', () => {
  const courseSchema = artifact.course.schema;
  const missing = [];
  let ran = 0;
  let total = 0;
  for (const module of artifact.modules) {
    const plan = sqliteSchema([...courseSchema, ...(module.setup ?? [])], SEEDED);
    for (const topic of module.topics) {
      total += 1;
      const run = moduleRun(plan, topic.example.sql, SEEDED);
      const db = labDatabase(DATASETS.filter((dataset) => !run.shadowed.includes(dataset.name)));
      try {
        db.exec(run.sql);
        ran += 1;
      } catch (error) {
        const message = String(error instanceof Error ? error.message : error);
        if (/no such table: (students|courses|enrollments)\b/i.test(message)) missing.push(`${module.id} ${topic.id}: ${message}`);
      } finally {
        db.close();
      }
    }
  }
  assert.deepEqual(missing, [], 'every module must find the school tables the course shares');
  // The floor measured when the shared schema landed; PostgreSQL-only examples are the rest.
  assert.ok(ran >= 400, `only ${ran} of ${total} examples run with their module’s schema`);
});

test('sql-setup: every authored module setup is runnable on sql.js or reported', () => {
  assert.ok(withSetup.length >= 16, `expected the authored setups, found ${withSetup.length}`);
  const postgresOnly = [
    /\bgenerated\s+always\b/i, /\bincluding\s+all\b/i, /\bnow\(\)/i, /::/,
    /\bpartition\s+of\b/i, /\bcreate\s+extension\b/i, /\badd\s+column\s+if\s+not\s+exists\b/i,
  ];
  let runnableModules = 0;
  for (const module of withSetup) {
    const plan = sqliteSchema(module.setup, SEEDED);
    if (plan.statements.length > 0) runnableModules += 1;
    else assert.ok(plan.skipped.length > 0, `${module.id}: nothing ran and nothing was reported`);
    const runnable = plan.statements.join('\n');
    for (const clause of postgresOnly) {
      assert.doesNotMatch(runnable, clause, `${module.id}: PostgreSQL syntax reached the SQLite run`);
    }
    const authored = module.setup.flatMap((entry) => entry.split(';').map((s) => s.trim()).filter(Boolean)).length;
    assert.equal(
      plan.statements.length + plan.skipped.length,
      authored,
      `${module.id}: a statement is neither run nor reported`,
    );
  }
  // One module (security) is genuinely PostgreSQL-only; a translator that stopped working would
  // move the whole set into `skipped`, which is the regression this floor catches.
  assert.ok(runnableModules >= 15, `only ${runnableModules} of ${withSetup.length} modules have a runnable schema`);
});

test('sql-setup: the translated module schemas execute on the lab engine', () => {
  for (const module of withSetup) {
    const plan = sqliteSchema(module.setup, SEEDED);
    const db = labDatabase();
    let running = '';
    try {
      for (const statement of plan.statements) {
        running = statement;
        db.run(statement);
      }
    } catch (error) {
      assert.fail(`${module.id}: ${running} → ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      db.close();
    }
  }
});

test('sql-setup: the SQL Lab loads the module named in the URL', () => {
  // The lab is .tsx (the test loader only resolves .ts), so the wiring is read as text.
  const lab = fs.readFileSync(path.join(ROOT, 'src/features/labs/SQLLab.tsx'), 'utf8');
  assert.match(lab, /useSearchParams\(\)/, 'the module must come from ?module=');
  assert.match(lab, /sqliteSchema\(/, 'the setup must go through the translator');
  assert.match(lab, /moduleRun\(/, 'every run must prepend the module schema');
  assert.match(lab, /course\.schema/, 'the course’s shared tables load with the module setup');
  assert.match(lab, /module \? \[/, 'the shared tables load only when a module is selected');
  assert.match(lab, /DATASETS\.filter\(/, 'a table the learner’s query creates must not be seeded');
});
