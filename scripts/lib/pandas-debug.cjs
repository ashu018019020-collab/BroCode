/**
 * pandas-debug.cjs — guard for the Debug section of the Pandas Mastery course.
 *
 * A debug challenge is only honest when all three of these hold:
 *
 *   · the broken sample really fails, and it fails for the reason written in `error`.
 *     `error` is a human-readable explanation, not a byte-for-byte runtime pin: a raise must have
 *     the same exception class and the same distinctive anchors (quoted names, dates, numeric
 *     ranges) as the stored lesson, with a token-overlap floor. Version-specific wording is allowed.
 *     A `Wrong output:` lesson is checked against its authored `brokenOutput` instead;
 *   · the fix really runs and prints the stored `fixedOutput`;
 *   · the fix is a bounded edit of the broken sample, not a rewrite of the exercise.
 *
 * Broken/fix code pairs must also be unique across modules. The same exercise may not be
 * copied into every module under a different `(Pxx)` title.
 *
 * Samples are executed in one Python process per module so the guard stays fast while still
 * running every pair rather than trusting stored output.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** The interpreter CI and local runs use; Windows CI sets PYTHON=python. */
const PYTHON = process.env.PYTHON || 'python3';

/** A fix may change at most this many non-blank lines. */
const MAX_CHANGED_LINES = 6;
/** ...and must retain this share of the original tokens. */
const MIN_TOKEN_SIMILARITY = 0.7;

/**
 * The runtime combinations this course claims to support. The browser row is pinned by
 * `public/pyodide/pyodide-lock.json`; the local row is the generator/guard, which executes every
 * stored output. See `PANDAS_COURSE_PROGRESS.md` for the human-readable matrix.
 */
const SUPPORTED_RUNTIMES = Object.freeze([
  Object.freeze({
    surface: 'Browser (Pyodide)',
    python: '3.12.1',
    pandas: '2.2.0',
    numpy: '1.26.4',
    source: 'public/pyodide/pyodide-lock.json',
  }),
  Object.freeze({
    surface: 'Local generator and guard',
    python: '3.12-3.15',
    pandas: '2.2-3.0',
    numpy: '1.26-2.5',
    verified: 'Python 3.15.2 / pandas 3.0.6 / numpy 2.5.5',
  }),
]);

/** Code used for pair equality: line endings and blank lines do not make a pair new. */
function normalizeCode(code) {
  return String(code ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .filter((line) => line.trim())
    .join('\n');
}

/** Stored and executed stdout are compared exactly, with memory addresses made stable. */
function normalizeOutput(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/0x[0-9a-f]+/gi, '0xADDR')
    .replace(/\s+$/, '');
}

/**
 * Clean an exception line without claiming its exact wording is stable. The exception class is
 * compared separately by `errorClass`; the message is used for anchors and overlap.
 */
function normalizeError(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .replace(/\.?\s*Did you mean:.*$/i, '')
    .replace(/0x[0-9a-f]+/gi, '0xADDR')
    .replace(/\s+$/, '')
    .trim();
}

/** Exception class, tolerant of module moves and the re.error -> re.PatternError rename. */
function errorClass(value) {
  const head = normalizeError(value).split(':', 1)[0].trim();
  const leaf = head.split('.').pop().toLowerCase();
  return leaf === 'patternerror' ? 'error' : leaf;
}

/** The explanatory text after the exception class. */
function errorMessage(value) {
  const text = normalizeError(value);
  const colon = text.indexOf(':');
  return colon === -1 ? text : text.slice(colon + 1).trim();
}

/**
 * Distinctive facts a learner should still see in a new runtime's wording: a quoted name/value, a
 * date, or a numeric range. Short numbers such as "position 0" are deliberately not anchors.
 */
function errorAnchors(message) {
  const anchors = new Set();
  for (const match of message.matchAll(/'[^']*'|"[^"]*"|`[^`]*`/g)) anchors.add(match[0]);
  for (const match of message.matchAll(/\b\d{1,4}(?:[./:-]+\d{1,4})+\b/g)) anchors.add(match[0]);
  for (const match of message.matchAll(/\b\d{3,}\b/g)) anchors.add(match[0]);
  return [...anchors];
}

/** Share of the smaller message's meaningful tokens that survive; catches unrelated explanations. */
function errorTokenOverlap(want, got) {
  const tokens = (text) => new Set((text.match(/[A-Za-z_]{3,}|\d{1,4}(?:[./:-]+\d{1,4})+|\d{3,}/g) || []).map((token) => token.toLowerCase()));
  const a = tokens(want);
  const b = tokens(got);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

function lcsLength(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

const TOKEN_RE = /[A-Za-z_]\w*|\d+(?:\.\d+)?|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s]/g;

/** Line- and token-level distance between the broken sample and its fix. */
function debugDiff(broken, fix) {
  const a = normalizeCode(broken).split('\n').filter(Boolean);
  const b = normalizeCode(fix).split('\n').filter(Boolean);
  const sameLines = lcsLength(a, b);
  const ta = normalizeCode(broken).match(TOKEN_RE) || [];
  const tb = normalizeCode(fix).match(TOKEN_RE) || [];
  const sameTokens = lcsLength(ta, tb);
  const tokenTotal = ta.length + tb.length;
  return {
    changedLines: a.length + b.length - 2 * sameLines,
    unchangedLines: sameLines,
    similarity: tokenTotal ? (2 * sameTokens) / tokenTotal : 1,
  };
}

/** Same executable shape, including fixture data. */
const pairKey = (entry) => `${normalizeCode(entry.broken)}\n---\n${normalizeCode(entry.fix)}`;

function errorMatches(stored, actual) {
  const want = normalizeError(stored);
  const got = normalizeError(actual);
  if (!want || !got || errorClass(want) !== errorClass(got)) return false;

  const wantMessage = errorMessage(want);
  const gotMessage = errorMessage(got);
  // Exact wording and prefix-compatible messages are still the strongest match.
  if (wantMessage === gotMessage || gotMessage.startsWith(wantMessage) || wantMessage.startsWith(gotMessage)) return true;

  const anchors = errorAnchors(wantMessage);
  if (!anchors.length || !anchors.every((anchor) => gotMessage.includes(anchor))) return false;
  // A matching date alone is not enough: the explanation must still be recognisably the same.
  return errorTokenOverlap(wantMessage, gotMessage) > 0.5;
}

const PY_RUNNER = `import json, sys, io, traceback, contextlib
samples = json.load(open(sys.argv[1]))
results = []
for sample in samples:
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            exec(compile(sample["code"], "<pandas-debug>", "exec"), {"__name__": "__main__"})
        results.append({"state": "ok", "stdout": buf.getvalue().rstrip()})
    except BaseException:
        traceback_lines = traceback.format_exc().strip().splitlines()
        results.append({
            "state": "raised",
            "stdout": buf.getvalue().rstrip(),
            "error": traceback_lines[-1] if traceback_lines else "",
        })
json.dump(results, open(sys.argv[2], "w"))
`;

/** Execute samples grouped by module; each module gets one interpreter and one pandas import. */
function runPythonSamples(samples) {
  const results = new Map();
  if (!samples.length) return results;

  const groups = new Map();
  for (const sample of samples) {
    if (!groups.has(sample.module)) groups.set(sample.module, []);
    groups.get(sample.module).push(sample);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandas-debug-'));
  try {
    const runner = path.join(tmp, 'runner.py');
    fs.writeFileSync(runner, PY_RUNNER, 'utf8');
    for (const [module, group] of groups) {
      const input = path.join(tmp, 'samples.json');
      const output = path.join(tmp, 'results.json');
      fs.writeFileSync(input, JSON.stringify(group.map((s) => ({ code: s.code }))), 'utf8');
      try {
        execFileSync(PYTHON, [runner, input, output], {
          encoding: 'utf8',
          timeout: 120000,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch (error) {
        const detail = String(error.stderr || error.message || error).trim().split('\n').pop();
        throw new Error(`could not execute the debug samples for ${module}: ${detail}`);
      }
      const executed = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (!Array.isArray(executed) || executed.length !== group.length) {
        throw new Error(`the Python runner returned ${executed.length} result(s) for ${group.length} sample(s)`);
      }
      group.forEach((sample, index) => results.set(sample.key, executed[index]));
    }
    return results;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Inspect every debug entry. Returns the human-readable problems plus the set of entries that
 * produced at least one — one pair that fails several checks is still one failed pair, which is
 * what a pass/total count must subtract. `runSamples` is injectable for tests.
 */
function inspectDebugChallenges(modules, options = {}) {
  const problems = [];
  const failed = new Set();
  const fail = (message) => problems.push(message);
  const samples = [];
  const seenPairs = new Map();

  for (const module of modules) {
    const debug = Array.isArray(module.debug) ? module.debug : [];
    for (const [index, entry] of debug.entries()) {
      const at = `${module.id}: debug \"${entry?.title || index + 1}\"`;
      const fail = (message) => {
        problems.push(message);
        failed.add(`${module.id}:${index}`);
      };
      if (!entry || !entry.title || !entry.broken || !entry.fix || !entry.error) {
        fail(`${at} needs title/broken/fix/error`);
        continue;
      }

      const diff = debugDiff(entry.broken, entry.fix);
      if (normalizeCode(entry.broken) === normalizeCode(entry.fix)) {
        fail(`${at} fix is identical to the broken sample`);
      } else if (diff.changedLines > MAX_CHANGED_LINES) {
        fail(`${at} fix is not minimal: ${diff.changedLines} changed lines (max ${MAX_CHANGED_LINES})`);
      } else if (diff.similarity < MIN_TOKEN_SIMILARITY) {
        fail(`${at} fix is not minimal: only ${Math.round(diff.similarity * 100)}% of the code survives (min ${Math.round(MIN_TOKEN_SIMILARITY * 100)}%)`);
      }

      const key = pairKey(entry);
      const prior = seenPairs.get(key);
      if (prior && prior.module !== module.id) {
        fail(`${at} repeats the broken/fix pair from ${prior.module}:${prior.index}`);
      } else if (!prior) {
        seenPairs.set(key, { module: module.id, index });
      }

      samples.push(
        { key: `${module.id}:${index}:broken`, module: module.id, index, kind: 'broken', code: entry.broken },
        { key: `${module.id}:${index}:fix`, module: module.id, index, kind: 'fix', code: entry.fix },
      );
    }
  }

  if (options.execute === false || !samples.length) return { problems, failed };

  let results;
  try {
    results = (options.runSamples || runPythonSamples)(samples);
  } catch (error) {
    for (const sample of samples) failed.add(`${sample.module}:${sample.index}`);
    fail(`debug execution failed: ${error.message}`);
    return { problems, failed };
  }

  for (const module of modules) {
    const debug = Array.isArray(module.debug) ? module.debug : [];
    for (const [index, entry] of debug.entries()) {
      if (!entry || !entry.title || !entry.broken || !entry.fix || !entry.error) continue;
      const at = `${module.id}: debug \"${entry.title}\"`;
      const fail = (message) => {
        problems.push(message);
        failed.add(`${module.id}:${index}`);
      };
      const broken = results.get(`${module.id}:${index}:broken`);
      const fixed = results.get(`${module.id}:${index}:fix`);
      if (!broken || !fixed) {
        fail(`${at} has no execution result`);
        continue;
      }

      if (broken.state === 'raised') {
        if (entry.brokenOutput !== undefined) {
          fail(`${at} raises but still declares a brokenOutput`);
        }
        if (/^Wrong output:/i.test(entry.error)) {
          fail(`${at} declares a wrong-output lesson but the broken sample raises`);
        } else if (!errorMatches(entry.error, broken.error)) {
          fail(`${at} fails for a different reason: expected "${entry.error}", got "${broken.error}"`);
        }
      } else if (broken.state === 'ok') {
        if (!/^Wrong output:/i.test(entry.error)) {
          fail(`${at} runs cleanly but its error does not start with "Wrong output:"`);
        }
        if (entry.brokenOutput === undefined) {
          fail(`${at} runs cleanly but has no brokenOutput`);
        } else if (normalizeOutput(entry.brokenOutput) !== normalizeOutput(broken.stdout)) {
          fail(`${at} brokenOutput does not match the executed output "${broken.stdout}"`);
        }
        if (normalizeOutput(broken.stdout) === normalizeOutput(fixed.stdout)) {
          fail(`${at} broken and fixed samples print the same output, so the fix changes nothing`);
        }
      } else {
        fail(`${at} broken sample could not run: ${broken.reason || 'unknown error'}`);
      }

      if (fixed.state !== 'ok') {
        fail(`${at} fix raised: ${fixed.error || fixed.reason || 'unknown error'}`);
      } else if (normalizeOutput(entry.fixedOutput) !== normalizeOutput(fixed.stdout)) {
        fail(`${at} fixedOutput does not match the executed output "${fixed.stdout}"`);
      }
    }
  }

  return { problems, failed };
}

/** The guard's contract: just the human-readable problems. */
function validateDebugChallenges(modules, options = {}) {
  return inspectDebugChallenges(modules, options).problems;
}

module.exports = {
  MAX_CHANGED_LINES,
  MIN_TOKEN_SIMILARITY,
  SUPPORTED_RUNTIMES,
  debugDiff,
  inspectDebugChallenges,
  normalizeCode,
  normalizeError,
  normalizeOutput,
  validateDebugChallenges,
};
