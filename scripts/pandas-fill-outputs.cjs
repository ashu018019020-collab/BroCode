#!/usr/bin/env node
/**
 * Pandas Mastery — executes the authored samples and stores what they actually printed.
 *
 * The course artifact may only publish an `output` that was produced by running the code, so this
 * script is the one place those strings come from. It fills, in place:
 *
 *   · a Learn topic's `output` (from its `code`)
 *   · a coding task's `expected` (from its `solution`)
 *   · a debug challenge's `error` (the last line of the traceback its `broken` code raises)
 *
 * Run it after editing any sample: `node scripts/pandas-fill-outputs.cjs`.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'pandas-mastery');
/* Optional file arguments keep a full re-run inside the five-minute command budget. */
const only = process.argv.slice(2);
const files = fs.readdirSync(SRC).filter((f) => /^(modules-|deepening).*\.json$/.test(f))
  .filter((f) => !only.length || only.includes(f)).sort();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandas-fill-'));
const script = path.join(tmp, 'sample.py');

function run(code) {
  fs.writeFileSync(script, `${String(code).replace(/\t/g, '    ')}\n`, 'utf8');
  try {
    const out = execFileSync('python3', [script], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { out: out.replace(/\s+$/, ''), error: null };
  } catch (e) {
    const stderr = String(e.stderr || '');
    const lines = stderr.trim().split('\n').filter(Boolean);
    const last = lines[lines.length - 1] || 'the sample failed with no message';
    return { out: String(e.stdout || '').replace(/\s+$/, ''), error: last.trim() };
  }
}

let topics = 0; let tasks = 0; let debug = 0; const problems = [];
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
  /*
   * A module file is an array of modules; a growth layer is an object keyed by module id. Both hold
   * the same pack shape, so the executor walks either one and writes it back in the shape it read.
   */
  const packs = Array.isArray(data)
    ? data.map((m) => ({ id: m.id, pack: m }))
    : Object.entries(data).map(([id, pack]) => ({ id, pack }));
  for (const { id, pack: source } of packs) {
    /* Nested arrays are shared with `data`, so the edits below are written back with the file. */
    const m = { ...source, id };
    for (const t of m.topics || []) {
      if (!t.code) { problems.push(`${m.id}: topic "${t.title}" has no code`); continue; }
      const r = run(t.code);
      if (r.error) { problems.push(`${m.id}: topic "${t.title}" raised: ${r.error}`); continue; }
      t.output = r.out;
      topics += 1;
    }
    for (const d of m.debug || []) {
      const r = run(d.broken);
      const fixed = run(d.fix);
      if (fixed.error) { problems.push(`${m.id}: fix for "${d.title}" raised: ${fixed.error}`); continue; }
      d.fixedOutput = fixed.out;
      if (r.error) {
        d.error = r.error;
      } else {
        /*
         * A wrong-output lesson is allowed only when the mistake is declared and the fix really prints
         * something else — otherwise "the code runs" would be shipped as a debugging exercise.
         */
        if (!d.error) { problems.push(`${m.id}: debug "${d.title}" did not raise and declares no wrong-output lesson`); continue; }
        if (fixed.out === r.out) { problems.push(`${m.id}: fix for "${d.title}" prints the same output as the broken code`); continue; }
        d.brokenOutput = r.out;
      }
      debug += 1;
    }
    for (const task of m.tasks || []) {
      const r = run(task.solution);
      if (r.error) { problems.push(`${m.id}: task "${task.title}" raised: ${r.error}`); continue; }
      task.expected = r.out;
      tasks += 1;
    }
  }
  fs.writeFileSync(path.join(SRC, file), `${JSON.stringify(data, null, 1)}\n`, 'utf8');
}

if (problems.length) {
  console.error(`pandas-fill-outputs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`pandas-fill-outputs: executed ${topics} topics, ${debug} debug fixes, ${tasks} task solutions`);
