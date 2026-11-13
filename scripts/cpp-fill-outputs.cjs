#!/usr/bin/env node
/**
 * C++ Mastery — compiles and runs every authored sample, then stores what it actually printed.
 *
 * The artifact may only publish an output that a compiler produced, so this script is the one source
 * of `output`, `expected` and `error` strings. It fills, in place:
 *
 *   · a Learn topic's `output` (its `code` compiled with g++ -std=c++17)
 *   · a coding task's `expected` (its `solution`)
 *   · a debug challenge's compiler/runtime `error`, and its fix's `fixedOutput`
 *
 * A broken sample may either fail to compile, fail at runtime, or print a declared wrong result whose
 * fix prints something different. Anything else fails the run instead of shipping as an exercise.
 *
 * Usage: node scripts/cpp-fill-outputs.cjs [modules-01-07.json …]
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'cpp-mastery');
const only = process.argv.slice(2);
const files = fs.readdirSync(SRC).filter((f) => /^(modules-|deepening).*\.json$/.test(f))
  .filter((f) => !only.length || only.includes(f)).sort();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cpp-fill-'));
const source = path.join(tmp, 'main.cpp');
const binary = path.join(tmp, 'main');

/** The first diagnostic that names the actual mistake, without the temporary path noise. */
function firstError(stderr) {
  const lines = String(stderr || '').split('\n');
  const line = lines.find((l) => l.includes('error:')) || lines.find((l) => l.trim()) || '';
  const at = line.indexOf('error:');
  if (at >= 0) return line.slice(at).trim();
  return line.trim();
}

function run(code) {
  fs.writeFileSync(source, `${String(code).replace(/\t/g, '    ')}\n`, 'utf8');
  try {
    execFileSync('g++', ['-std=c++17', '-O0', '-pthread', 'main.cpp', '-o', 'main'],
      { cwd: tmp, encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { out: '', error: firstError(e.stderr) || 'the compiler rejected the program' };
  }
  try {
    const out = execFileSync(binary, [], { cwd: tmp, encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
    return { out: out.replace(/\s+$/, ''), error: null };
  } catch (e) {
    const stderr = String(e.stderr || '').trim();
    const status = e.status === undefined ? 'no status' : e.status;
    const detail = stderr ? ` — ${stderr.split('\n')[0]}` : '';
    return { out: String(e.stdout || '').replace(/\s+$/, ''), error: `the program failed at runtime (exit ${status})${detail}` };
  }
}

let topics = 0; let tasks = 0; let debug = 0; const problems = [];
for (const file of files) {
  const data = JSON.parse(fs.readFileSync(path.join(SRC, file), 'utf8'));
  const packs = Array.isArray(data)
    ? data.map((m) => ({ id: m.id, pack: m }))
    : Object.entries(data).map(([id, pack]) => ({ id, pack }));
  for (const { id, pack: sourcePack } of packs) {
    const m = { ...sourcePack, id };
    for (const t of m.topics || []) {
      const r = run(t.code);
      if (r.error) { problems.push(`${m.id}: topic "${t.title}" failed: ${r.error}`); continue; }
      t.output = r.out;
      topics += 1;
    }
    for (const d of m.debug || []) {
      const broken = run(d.broken);
      const fixed = run(d.fix);
      if (fixed.error) { problems.push(`${m.id}: fix for "${d.title}" failed: ${fixed.error}`); continue; }
      d.fixedOutput = fixed.out;
      if (broken.error) {
        d.error = broken.error;
      } else {
        if (!d.error) { problems.push(`${m.id}: debug "${d.title}" ran and declares no wrong-output lesson`); continue; }
        if (fixed.out === broken.out) { problems.push(`${m.id}: fix for "${d.title}" prints the same output as the broken code`); continue; }
        d.brokenOutput = broken.out;
      }
      debug += 1;
    }
    for (const task of m.tasks || []) {
      const r = run(task.solution);
      if (r.error) { problems.push(`${m.id}: task "${task.title}" failed: ${r.error}`); continue; }
      task.expected = r.out;
      tasks += 1;
    }
  }
  fs.writeFileSync(path.join(SRC, file), `${JSON.stringify(data, null, 1)}\n`, 'utf8');
}

if (problems.length) {
  console.error(`cpp-fill-outputs: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}
console.log(`cpp-fill-outputs: compiled and ran ${topics} topics, ${debug} debug pairs, ${tasks} task solutions`);
