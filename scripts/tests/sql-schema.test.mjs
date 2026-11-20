/**
 * SQL Masterclass content is authored as module-local examples. A module may use the shared
 * academic tables, but every other relation it names must be created by its own `setup` block or
 * by one of its own examples. This keeps a copied lab from silently depending on a table that only
 * exists in a different module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE_DIR = path.join(ROOT, 'content', 'sql-mastery');
const ARTIFACT = path.join(ROOT, 'public', 'generated', 'sql-masterclass', 'index.json');
const CORE = new Set(['students', 'courses', 'enrollments']);
// Teaching examples that deliberately show a missing-relation error are not schema dependencies.
const INTENTIONAL_MISSING = new Set(['sql01/topic t16/student']);
const SYSTEM = /^(information_schema|pg_|sql_|current_|now$|generate_series$|unnest$|jsonb?_|crosstab$)/i;
const SQL_START = /^\s*(?:SELECT\b|WITH\b|INSERT\s+INTO\b|UPDATE\s+|DELETE\s+FROM\b|MERGE\s+INTO\b|CREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW|UNIQUE\s+INDEX|INDEX|TRIGGER|POLICY|RULE|FUNCTION|ROLE|SCHEMA|EXTENSION|TYPE|SEQUENCE)\b|ALTER\s+(?:TABLE|DEFAULT|ROLE|SCHEMA)\b|DROP\s+(?:TABLE|VIEW|MATERIALIZED\s+VIEW|INDEX|TRIGGER|POLICY|RULE|FUNCTION|ROLE|SCHEMA|TYPE|SEQUENCE)\b|TRUNCATE\b|GRANT\b|REVOKE\b|COMMENT\s+ON\b|ANALYZE\b|VACUUM\b|EXPLAIN\b|COPY\b|BEGIN\b|COMMIT\b|ROLLBACK\b|REFRESH\s+MATERIALIZED\s+VIEW\b|SET\s+|DO\b|CALL\b)/i;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const normalize = (name) => name.split('.').pop().replace(/^"|"$/g, '').toLowerCase();

const strip = (sql) => sql
  .replace(/--[^\n]*/g, ' ')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/'(?:''|[^'])*'/g, "''")
  .replace(/\$\$[\s\S]*?\$\$/g, ' ');

function createdObjects(sql) {
  const names = new Set();
  const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW|MATERIALIZED\s+VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi;
  for (const match of strip(sql).matchAll(pattern)) names.add(normalize(match[1]));
  return names;
}

function ctes(sql) {
  const names = new Set();
  const pattern = /(?:\bWITH\b|,)\s*(?:RECURSIVE\s+)?([A-Za-z_]\w*)\s+AS\s+(?:MATERIALIZED\s+|NOT\s+MATERIALIZED\s+)?\(/gi;
  for (const match of strip(sql).matchAll(pattern)) names.add(match[1].toLowerCase());
  return names;
}

function tableRefs(sql) {
  const clean = strip(sql);
  const found = [];
  const add = (name) => {
    name = normalize(name);
    if (!SYSTEM.test(name)) found.push(name);
  };

  for (const match of clean.matchAll(/\b(?:FROM|JOIN|REFERENCES)\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) {
    const before = clean.slice(Math.max(0, match.index - 90), match.index);
    if (/^(?:information_schema|pg_catalog)\s*\./i.test(match[1])) continue;
    if (clean[(match.index ?? 0) + match[0].length] === '(') continue; // set-returning function, not a relation
    if (/\b(?:EXTRACT|SUBSTRING|TRIM|POSITION|OVERLAY)\s*\([^)]*$/i.test(before)) continue;
    if (/\bDISTINCT\s*$/i.test(before) || /\bIS\s+(?:NOT\s+)?DISTINCT\s*$/i.test(before)) continue;
    if (/\b(?:REVOKE|GRANT)\b/i.test(clean)) continue;
    add(match[1]);
  }
  for (const match of clean.matchAll(/(?:^|;)\s*UPDATE\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\bINSERT\s+INTO\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\bMERGE\s+INTO\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX|CREATE\s+TRIGGER|CREATE\s+POLICY|CREATE\s+RULE)\b[^;]*?\bON\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\bPARTITION\s+OF\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\bATTACH\s+PARTITION\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\b(?:DROP\s+TABLE|LOCK\s+TABLE|COMMENT\s+ON\s+TABLE)\s+(?:IF\s+EXISTS\s+)?((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/(?:^|;)\s*TRUNCATE(?:\s+TABLE)?\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)/gi)) add(match[1]);
  for (const match of clean.matchAll(/(?:^|;)\s*(?:VACUUM|ANALYZE)(?:\s+\([^)]*\))?\s+(?:VERBOSE\s+)?((?:"[^"]+"|[A-Za-z_]\w*))(?:\s*;|\s*$)/gi)) add(match[1]);
  for (const match of clean.matchAll(/\bCOPY\s+((?:"[^"]+"|[A-Za-z_]\w*)(?:\s*\.\s*(?:"[^"]+"|[A-Za-z_]\w*))?)\s+FROM\b/gi)) add(match[1]);
  return found;
}

function moduleSources(module) {
  const out = [];
  for (const [i, sql] of (module.setup ?? []).entries()) {
    out.push({ where: `setup[${i}]`, sql });
  }
  for (const topic of module.topics ?? []) {
    if (topic.example?.sql) out.push({ where: `topic ${topic.id}`, sql: topic.example.sql });
  }
  for (const [i, lab] of (module.banks?.labs ?? []).entries()) {
    if (lab.solution) out.push({ where: `labs[${i}]`, sql: lab.solution });
  }
  for (const [i, item] of (module.banks?.debug ?? []).entries()) {
    // `broken` is deliberately invalid and is not part of the runnable schema.
    if (item.fix && SQL_START.test(item.fix)) out.push({ where: `debug[${i}].fix`, sql: item.fix });
  }
  return out;
}

const sourceModules = fs.readdirSync(SOURCE_DIR)
  .filter((file) => /^module-.*\.json$/.test(file))
  .sort()
  .flatMap((file) => readJson(path.join(SOURCE_DIR, file)).modules);

test('sql-schema: every table reference resolves within its module or the core schema', () => {
  const failures = [];
  for (const module of sourceModules) {
    assert.ok(module.setup === undefined || Array.isArray(module.setup), `${module.id}: setup must be an array`);
    const sources = moduleSources(module);
    const defined = new Set(CORE);
    for (const { sql } of sources) {
      for (const name of createdObjects(sql)) defined.add(name);
      for (const name of ctes(sql)) defined.add(name);
    }
    for (const { where, sql } of sources) {
      const local = new Set([...defined, ...createdObjects(sql), ...ctes(sql)]);
      for (const name of tableRefs(sql)) {
        if (!local.has(name) && !INTENTIONAL_MISSING.has(`${module.id}/${where}/${name}`)) {
          failures.push(`${module.id} ${where}: undefined table "${name}"\n${sql}`);
        }
      }
    }
  }
  assert.deepEqual(failures, [], `undefined SQL table references:\n${failures.join('\n\n')}`);
});

test('sql-schema: students has no course_id — the link is modelled by enrollments', () => {
  const shared = readJson(path.join(SOURCE_DIR, 'module-00.json')).course?.schema ?? [];
  const students = shared.find((statement) => /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+students\b/i.test(statement));
  assert.ok(students, 'the shared course schema must create students');
  assert.doesNotMatch(students, /\bcourse_id\b/i, 'students must not repeat the enrollment link');

  const failures = [];
  for (const module of sourceModules) {
    for (const { where, sql } of moduleSources(module)) {
      if (/\b(?:s|students)\.course_id\b/i.test(strip(sql))) failures.push(`${module.id} ${where}`);
    }
  }
  assert.deepEqual(failures, [], 'join courses through enrollments (e.course_id), not students.course_id');
});

test('sql-schema: composite section lab has the semester column it joins on', () => {
  const module = sourceModules.find((candidate) => candidate.id === 'sql10');
  assert.ok(module, 'module sql10 is missing');
  const setup = (module.setup ?? []).join('\n');
  assert.match(setup, /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+course_sections\b/i);
  assert.match(setup, /ALTER\s+TABLE\s+enrollments\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+semester\b/i);
});

test('sql-schema: published artifact carries the authored module setup blocks', () => {
  const artifact = readJson(ARTIFACT);
  assert.deepEqual(artifact.modules.map(({ id, setup }) => ({ id, setup })),
    sourceModules.map(({ id, setup }) => ({ id, setup })),
    'run `npm run sql-masterclass:write` after editing module setup');
});
