/**
 * Turns a Masterclass module's authored setup into what the SQL Lab's SQLite engine can create.
 *
 * The course is written for PostgreSQL — identity columns, `LIKE … INCLUDING ALL`, `TSRANGE`,
 * `PARTITION BY`, `NOW()` defaults — while the Lab runs sql.js/SQLite. Pasting a module's examples
 * there is why a learner hit "no such table": the setup never ran anywhere.
 *
 * This translates the subset SQLite can express, keeps the authored text for anything adapted, and
 * REPORTS — never silently drops — the statements that need a real PostgreSQL server or a table the
 * module does not create. The Lab prints that report, so "schema loaded" is not a claim the engine
 * cannot back.
 *
 * Pure: no React, no store, no data layer — driven with fixtures in `scripts/tests/sql-setup.test.mjs`.
 */

export interface SqlSchemaPlan {
  /** Statements to run before the learner's query, authored order, no trailing semicolons. */
  statements: string[];
  /** Authored statements that run in SQLite but not verbatim — the Lab says they were adapted. */
  adapted: string[];
  /** Authored statements SQLite cannot run, with the reason the Lab shows. */
  skipped: { statement: string; reason: string }[];
}

/** One entry may hold several statements; the artifact also publishes one per array item. */
const splitStatements = (setup: readonly string[]): string[] =>
  setup.flatMap((entry) => entry.split(';').map((statement) => statement.replace(/\s+/g, ' ').trim()).filter(Boolean));

/** Tables a statement reads or writes. `REFERENCES` is deliberately absent: SQLite accepts a
 *  declared foreign key to a table that does not exist, so it must not fail the statement. */
const tableRefs = (sql: string): string[] => {
  const refs = new Set<string>();
  for (const match of sql.matchAll(/\b(?:from|join|into|update|alter\s+table)\s+"?([a-zA-Z_][\w]*)"?/gi)) {
    refs.add(match[1].toLowerCase());
  }
  return [...refs];
};

/**
 * @param setup    authored module setup (PostgreSQL)
 * @param seeded   tables the Lab creates from its demo datasets before any query runs
 */
export function sqliteSchema(
  setup: readonly string[] | undefined,
  seeded: readonly string[] = [],
): SqlSchemaPlan {
  const plan: SqlSchemaPlan = { statements: [], adapted: [], skipped: [] };
  const known = new Set(seeded.map((table) => table.toLowerCase()));

  for (const original of splitStatements(setup ?? [])) {
    const translated = translate(original);
    if (!translated) {
      plan.skipped.push({ statement: original, reason: 'needs a PostgreSQL server' });
      continue;
    }
    const created = translated.sql.match(/^create\s+(?:table|view)\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*)/i);
    const unknown = tableRefs(translated.sql).filter((table) => !known.has(table));
    if (unknown.length) {
      plan.skipped.push({ statement: original, reason: `needs the table ${unknown[0]}, which this module does not create` });
      continue;
    }
    if (created) known.add(created[1].toLowerCase());
    plan.statements.push(translated.sql);
    if (translated.adapted) plan.adapted.push(original);
  }

  return plan;
}

/** Tables a query creates or drops itself: it starts from an empty slate, so nothing may pre-create them. */
const definedTables = (query: string): string[] => [
  ...query.matchAll(/\b(?:create|drop)\s+(?:table|view)\s+(?:if\s+(?:not\s+)?exists\s+)?"?([a-zA-Z_][\w]*)"?/gi),
].map((match) => match[1].toLowerCase());

/** Tables a query ALTERs: the table must already exist, but not with the column the query adds. */
const alteredTables = (query: string): string[] => [
  ...query.matchAll(/\balter\s+table\s+(?:if\s+exists\s+)?"?([a-zA-Z_][\w]*)"?/gi),
].map((match) => match[1].toLowerCase());

const createdTable = (statement: string): string | null =>
  statement.match(/^create\s+(?:table|view)\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z_][\w]*)"?/i)?.[1].toLowerCase() ?? null;

export interface SqlModuleRun {
  /** The module's schema first, then what the learner wrote. */
  sql: string;
  /** Tables this run creates itself: the Lab must not seed its demo datasets for them. */
  shadowed: string[];
}

/**
 * One run, assembled. The Lab rebuilds its database per run, so a table the learner's own query
 * creates must not already exist — a DDL example would answer "table students already exists" for
 * the very schema it is teaching. Those tables step aside, and the Lab keeps its demo dataset for
 * them out of the seed for the same reason. An ALTER example needs its table to exist but not with
 * the column it adds, so when the Lab has a demo table of that name it seeds that one instead of
 * the shared schema; without one, the shared schema is the only way the table exists at all.
 */
export function moduleRun(
  plan: SqlSchemaPlan | null | undefined,
  query: string,
  demo: readonly string[] = [],
): SqlModuleRun {
  const defined = definedTables(query);
  const demoed = new Set(demo.map((table) => table.toLowerCase()));
  const altered = alteredTables(query).filter((table) => demoed.has(table));
  if (!plan || plan.statements.length === 0) return { sql: query, shadowed: defined };

  const own = new Set([...defined, ...altered]);
  const statements = plan.statements.filter((statement) => {
    const created = createdTable(statement);
    if (created && own.has(created)) return false;
    return !tableRefs(statement).some((table) => own.has(table));
  });

  const shadowed = [...new Set([...defined, ...statements.map(createdTable).filter((name): name is string => !!name)])];
  return {
    sql: statements.length ? `${statements.map((statement) => `${statement};`).join('\n')}\n${query}` : query,
    shadowed,
  };
}

/** `null` means SQLite cannot run the statement as written (or at all). */
function translate(statement: string): { sql: string; adapted: boolean } | null {
  // PostgreSQL-only features: an extension, an exclusion constraint (gist), a range type column
  // would run but hold no range, so it is declined rather than silently degraded.
  if (/^create\s+(?:or\s+replace\s+)?extension\b/i.test(statement)) return null;
  if (/\bexclude\s+using\b/i.test(statement)) return null;

  // `CREATE TABLE child PARTITION OF parent FOR VALUES …` — the child gets the parent's shape.
  if (/\bpartition\s+of\b/i.test(statement)) {
    const match = statement.match(
      /^create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*)\s+partition\s+of\s+([a-zA-Z_][\w]*)/i,
    );
    if (!match) return null;
    return { sql: `CREATE TABLE ${match[1]} AS SELECT * FROM ${match[2]} WHERE 0`, adapted: true };
  }

  // `CREATE TABLE copy (LIKE source INCLUDING ALL)` copies constraints, which SQLite's `LIKE` subset
  // does not carry; an empty copy keeps the shape and the column names the examples rely on.
  const like = statement.match(
    /^create\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*)\s*\(\s*like\s+([a-zA-Z_][\w]*)\s+including\s+all\s*\)$/i,
  );
  if (like) return { sql: `CREATE TABLE ${like[1]} AS SELECT * FROM ${like[2]} WHERE 0`, adapted: true };

  const sql = statement
    // An identity column is SQLite's `INTEGER PRIMARY KEY` (the rowid alias that auto-assigns).
    .replace(/\bbigint\s+generated\s+always\s+as\s+identity\s+primary\s+key\b/gi, 'INTEGER PRIMARY KEY')
    .replace(/\s+generated\s+always\s+as\s+identity\b/gi, '')
    .replace(/\bnow\(\)/gi, 'CURRENT_TIMESTAMP')
    // A cast in a DEFAULT is Postgres syntax; SQLite takes the value as written.
    .replace(/::\s*[a-zA-Z_][\w[\]]*/g, '')
    .replace(/\s+partition\s+by\s+range\s*\([^)]*\)/gi, '')
    // SQLite has no ADD COLUMN IF NOT EXISTS; the Lab rebuilds its database on every run, so the
    // column cannot already be there.
    .replace(/\badd\s+column\s+if\s+not\s+exists\b/gi, 'ADD COLUMN')
    .replace(/^create\s+or\s+replace\s+view\b/i, 'CREATE VIEW');

  return { sql, adapted: sql !== statement };
}
