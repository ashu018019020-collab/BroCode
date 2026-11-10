import { prepareJavaSource } from '../shared/java-source.mjs';

/**
 * Java execution proxy.
 *
 * Untrusted source never runs in this process. Submissions go to a Judge0 instance over HTTP;
 * this module's job is validation, budgeting and shaping the answer. When `JUDGE0_URL` is not
 * configured it uses the keyless public Judge0 CE instance (the same one the C course uses), so
 * `Run` works on a static host — and when that service is unreachable the UI is told so honestly
 * instead of being shown a fake "Accepted".
 *
 * Java is a COMPILED single-file language here: the learner's file is compiled by javac and run on
 * a real JDK (Judge0's `Java (JDK 17.0.6)`, language id 91). A language id is not a preview
 * feature — it is the LTS the course was authored against.
 */
export class JavaExecError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** Java (JDK 17.0.6) on the public Judge0 CE image — verified against /languages. */
const JAVA_LANGUAGE_ID = 91;
const PUBLIC_JUDGE0_URL = 'https://ce.judge0.com';
const MAX_TEST_CASES = 8;
const MAX_SOURCE_BYTES = 40_000;
const WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = 12;
const REQUEST_TIMEOUT_MS = 25_000;

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

export function createJavaExecutor(options = {}) {
  const baseUrl = String(options.url ?? process.env.JUDGE0_URL ?? PUBLIC_JUDGE0_URL).replace(/\/+$/, '');
  const apiKey = String(options.key ?? process.env.JUDGE0_KEY ?? '').trim();
  const maxSourceBytes = positiveInt(options.maxSourceBytes, MAX_SOURCE_BYTES);
  const budget = new Map();
  let lastSweep = 0;

  /**
   * A per-caller sliding window. Running code is a tool, not a learner record, so the budget is
   * keyed by the caller (signed-in id, or the address for a visitor) rather than by account.
   */
  function allow(key) {
    const now = Date.now();
    if (now - lastSweep > WINDOW_MS) {
      for (const [k, times] of budget) {
        const live = times.filter((t) => now - t < WINDOW_MS);
        if (live.length) budget.set(k, live); else budget.delete(k);
      }
      lastSweep = now;
    }
    const times = (budget.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= MAX_RUNS_PER_WINDOW) { budget.set(key, times); return false; }
    times.push(now);
    budget.set(key, times);
    return true;
  }

  async function submit({ source, stdin, args }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['X-Auth-Token'] = apiKey;
      if (process.env.JUDGE0_HOST) headers['X-RapidAPI-Host'] = process.env.JUDGE0_HOST;
      if (process.env.JUDGE0_RAPIDAPI_KEY) headers['X-RapidAPI-Key'] = process.env.JUDGE0_RAPIDAPI_KEY;

      const res = await fetch(`${baseUrl}/submissions?base64_encoded=false&wait=true`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          source_code: source,
          language_id: JAVA_LANGUAGE_ID,
          stdin,
          command_line_arguments: args,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new JavaExecError(res.status === 429 ? 429 : 502,
          res.status === 429
            ? 'The Java compiler is busy right now. Try again in a few seconds.'
            : `The compiler service answered ${res.status}.`);
      }
      return await res.json();
    } catch (error) {
      if (error instanceof JavaExecError) throw error;
      if (error?.name === 'AbortError') throw new JavaExecError(504, 'The compiler took too long. Try a smaller program.');
      throw new JavaExecError(503, 'The Java compiler is unreachable right now.');
    } finally {
      clearTimeout(timer);
    }
  }

  function shape(body, expected) {
    const stdout = String(body?.stdout ?? '');
    const stderr = String(body?.stderr ?? '');
    const compileOutput = String(body?.compile_output ?? '');
    const status = String(body?.status?.description ?? 'Unknown');
    const statusId = Number(body?.status?.id ?? 0);
    const ran = statusId === 3 || statusId === 4;
    const failed = Boolean(compileOutput.trim()) || !ran;
    return {
      status,
      stdout,
      stderr,
      compileOutput,
      exitCode: typeof body?.exit_code === 'number' ? body.exit_code : ran ? 0 : statusId ? 1 : null,
      time: body?.time ? Math.round(Number(body.time) * 1000) : null,
      memory: body?.memory ?? null,
      timedOut: /time limit/i.test(status),
      ...(expected === undefined ? {} : { pass: !failed && stdout.trim() === expected.trim(), expected }),
    };
  }

  async function run(input) {
    if (!baseUrl) {
      throw new JavaExecError(503, 'The Java compiler is not connected. Set JUDGE0_URL on the server to run code.');
    }
    const rawSource = typeof input?.source === 'string' ? input.source : '';
    if (!rawSource.trim()) throw new JavaExecError(400, 'Write some Java code first.');
    if (Buffer.byteLength(rawSource, 'utf8') > maxSourceBytes) {
      throw new JavaExecError(413, `Keep the program under ${maxSourceBytes} bytes.`);
    }
    // Judge0 compiles one file as Main.java. Rename a different public class, or wrap a bare
    // statement snippet, so a valid learning example does not fail for a filename technicality.
    const source = prepareJavaSource(rawSource).source;
    if (Array.isArray(input?.files) && input.files.length) {
      throw new JavaExecError(400, 'Java Code Bro compiles one file. Keep every class in the same file.');
    }
    const stdin = typeof input?.stdin === 'string' ? input.stdin.slice(0, 16_000) : '';
    const args = typeof input?.args === 'string' ? input.args.trim().slice(0, 500) : '';

    const tests = Array.isArray(input?.tests) ? input.tests.slice(0, MAX_TEST_CASES) : [];
    if (tests.length) {
      const results = [];
      for (const [i, test] of tests.entries()) {
        const expected = typeof test?.stdout === 'string' ? test.stdout : '';
        const shaped = shape(await submit({ source, stdin: typeof test?.stdin === 'string' ? test.stdin : stdin, args }), expected);
        results.push({
          name: typeof test?.name === 'string' && test.name ? test.name : `Test ${i + 1}`,
          pass: shaped.pass,
          expected,
          actual: shaped.stdout,
          compileOutput: shaped.compileOutput,
          stderr: shaped.stderr,
        });
      }
      const passed = results.filter((r) => r.pass).length;
      return {
        status: passed === results.length ? 'Accepted' : 'Wrong Answer',
        stdout: results.map((r) => r.actual).join('\n'),
        stderr: results.map((r) => r.stderr).join('').trim(),
        compileOutput: results.map((r) => r.compileOutput).join('').trim(),
        exitCode: passed === results.length ? 0 : 1,
        time: null, memory: null, timedOut: false,
        tests: results, passed, total: results.length,
      };
    }

    return shape(await submit({ source, stdin, args }));
  }

  return {
    allow,
    status: () => ({ configured: Boolean(baseUrl), url: baseUrl, language: 'Java (JDK 17)' }),
    run,
  };
}
