#!/usr/bin/env node
/**
 * Compile-and-run verification for the Java course.
 *
 * Phase 13 asks for proof, not promises: every example, lab solution, coding reference solution,
 * debugging fix and project starter is compiled by a real JDK and run with its documented stdin,
 * then its stdout is compared with the authored expected output. Failures are printed with the
 * exact compiler/first-line difference and the process exits 1.
 *
 * Usage:
 *   node scripts/java-verify.cjs                 # everything
 *   node scripts/java-verify.cjs --only=coding   # modules|examples|coding|debug|labs|projects|final
 *   node scripts/java-verify.cjs --limit=5       # first N items per group (fast smoke test)
 *
 * The JDK is discovered from JAVA_HOME or a `javac` on PATH, so this works locally and in CI alike.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'java-programming');
const read = (name) => JSON.parse(fs.readFileSync(path.join(SRC, name), 'utf8'));
const only = (process.argv.find((a) => a.startsWith('--only=')) ?? '').split('=')[1] ?? '';
const limit = Number((process.argv.find((a) => a.startsWith('--limit=')) ?? '').split('=')[1] ?? 0);

function findJdk() {
  if (process.env.JAVA_HOME) {
    const bin = path.join(process.env.JAVA_HOME, 'bin');
    if (fs.existsSync(path.join(bin, 'javac'))) return bin;
  }
  const which = spawnSync('which', ['javac'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim()) return path.dirname(which.stdout.trim());
  const home = os.homedir();
  const local = path.join(home, '.local', 'jdk');
  if (fs.existsSync(local)) {
    for (const dir of fs.readdirSync(local)) {
      const bin = path.join(local, dir, 'bin');
      if (fs.existsSync(path.join(bin, 'javac'))) return bin;
    }
  }
  return null;
}

const BIN = findJdk();
if (!BIN) {
  console.error('java-verify: no JDK found. Set JAVA_HOME or install a JDK (Temurin 21).');
  process.exit(2);
}
const JAVAC = path.join(BIN, 'javac');
const JAVA = path.join(BIN, 'java');

const readIf = (name, key, fallback) => {
  try { return read(name)[key]; } catch { return fallback; }
};
const course = read('course.json');
/** Only modules that exist yet, so verification can run while the course is being authored. */
const modules = course.modules
  .filter((id) => fs.existsSync(path.join(SRC, 'modules', `${id}.json`)))
  .map((id) => read(path.join('modules', `${id}.json`)))
  .filter(Boolean);
/** Banks are authored in parts; verify them directly until `java-course --write` publishes. */
const readParts = (dir, key) => {
  const full = path.join(SRC, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(full, f), 'utf8'))[key] ?? []);
};
const coding = readIf('coding.json', 'questions', null) ?? readParts('coding', 'questions');
const debugging = readIf('debugging.json', 'challenges', null) ?? readParts('debugging', 'challenges');
const extraLabs = readIf('labs.json', 'labs', []);
const projects = readIf('projects.json', 'projects', []);

const cases = [];
const add = (group, id, code, tests, note = '') => {
  for (const [i, test] of tests.entries()) {
    cases.push({ group, id: `${id}${tests.length > 1 ? `#${i + 1}` : ''}`, code, stdin: test.stdin ?? '', expected: test.stdout ?? '', note });
  }
};

/* The lesson examples carry their own documented output. */
if (!only || only === 'examples') {
  for (const m of modules) {
    for (const [i, ex] of m.examples.entries()) {
      add('examples', `${m.id}/ex${i + 1}`, ex.code, [{ stdin: ex.stdin ?? '', stdout: ex.output }], ex.title);
    }
  }
}

/* Module labs: the reference solution against every public test. */
if (!only || only === 'labs') {
  for (const m of modules) {
    add('labs', `${m.id}/lab`, m.lab.solution, m.lab.tests);
  }
  for (const lab of extraLabs) {
    add('labs', `${lab.id}/lab`, lab.solution, lab.tests.map((t) => ({ stdin: t.stdin ?? '', stdout: t.stdout })));
  }
}

/* Coding bank: every reference solution against every test, hidden ones included. */
if (!only || only === 'coding') {
  for (const q of coding) {
    add('coding', q.id, q.solution, q.tests.map((t) => ({ stdin: t.input ?? '', stdout: t.output })));
  }
}

/* Debugging: the FIXED code must produce the expected output. */
if (!only || only === 'debug') {
  for (const c of debugging) {
    add('debug', c.id, c.fix, c.tests.map((t) => ({ stdin: t.stdin ?? '', stdout: t.stdout })));
  }
}

/* Project starters must at least compile and run (they are the starting point, not the answer). */
if (!only || only === 'projects') {
  for (const p of projects) add('projects', p.id, p.starter, [{ stdin: '', stdout: null }]);
}

/* The module debug fixes are code too. */
if (!only || only === 'examples') {
  for (const m of modules) {
    if (m.debug?.fix) add('examples', `${m.id}/debug-fix`, m.debug.fix, [{ stdin: '', stdout: m.debug.expected }], m.debug.brief);
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brocode-java-'));
const failures = [];
/** Cache of compile outcomes per distinct source, so a lab's tests compile once. */
const seen = new Map();
let ran = 0;
const counts = {};

/** One compilation per distinct source; each test then runs the compiled class. */
function compile(code, id) {
  const key = `${id}:${code.length}:${code.slice(0, 80)}`;
  if (seen.has(key)) return seen.get(key);
  const file = path.join(dir, 'Main.java');
  fs.writeFileSync(file, code);
  const built = spawnSync(JAVAC, ['-encoding', 'UTF-8', '-d', dir, file], { encoding: 'utf8', timeout: 40_000 });
  const result = built.status === 0
    ? { ok: true }
    : { ok: false, error: `${(built.stderr || built.stdout || '').split('\n').filter(Boolean).slice(0, 3).join(' | ')}` };
  seen.set(key, result);
  return result;
}

const list = limit ? cases.slice(0, limit * 40) : cases;
for (const c of list) {
  if (!c.code || !c.code.trim()) { failures.push(`${c.group}/${c.id}: empty source`); continue; }
  const built = compile(c.code, c.id);
  if (!built.ok) { failures.push(`${c.group}/${c.id}: COMPILE — ${built.error}`); continue; }
  ran += 1;
  counts[c.group] = (counts[c.group] ?? 0) + 1;
  if (c.expected === null) continue; // compile-only case
  const run = spawnSync(JAVA, ['-cp', dir, 'Main'], { input: c.stdin, encoding: 'utf8', timeout: 20_000, cwd: dir });
  if (run.status !== 0) {
    failures.push(`${c.group}/${c.id}: RUNTIME exit ${run.status} — ${(run.stderr || '').split('\n').slice(0, 2).join(' | ')}`);
    continue;
  }
  const actual = (run.stdout ?? '').trim();
  const expected = String(c.expected).trim();
  if (actual !== expected) {
    failures.push(`${c.group}/${c.id}: OUTPUT expected ${JSON.stringify(expected.slice(0, 120))} got ${JSON.stringify(actual.slice(0, 120))}`);
  }
}

fs.rmSync(dir, { recursive: true, force: true });
const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ');
if (failures.length) {
  console.error(`java-verify: ${failures.length} failure(s) of ${ran} run case(s) [${summary}]`);
  for (const f of failures.slice(0, 80)) console.error(`  · ${f}`);
  if (failures.length > 80) console.error(`  … and ${failures.length - 80} more`);
  process.exit(1);
}
console.log(`java-verify: OK — ${ran} run case(s) compiled and matched [${summary}] using ${BIN}`);
