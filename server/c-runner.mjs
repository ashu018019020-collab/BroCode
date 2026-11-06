/**
 * C execution proxy.
 *
 * Untrusted source never runs in this process. Submissions go to an isolated Judge0 instance over
 * HTTP; this module's job is validation, budgeting and shaping the answer. When `JUDGE0_URL` is not
 * configured it throws a typed 503 — the UI shows "compiler not connected", never a fake result.
 *
 * Multi-file projects are assembled into one translation unit here (the entry file first, then the
 * other `.c` files with their quoted includes removed) and headers ride along in a stored ZIP that
 * Judge0 unpacks next to the source. That is a real compile of the code the learner wrote, but it is
 * not separate-object linking: a self-hosted runner with a build script is the upgrade path.
 */
export class CExecError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const DEFAULT_LANGUAGE_ID = 103; // C (GCC 14) on the public Judge0 CE image
const MAX_FILES = 8;
const MAX_TEST_CASES = 8;
const WINDOW_MS = 60_000;
const MAX_RUNS_PER_WINDOW = 12;

const positiveInt = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/* ------------------------------- CRC32 + ZIP ------------------------------ */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A stored (uncompressed) zip: enough for Judge0's `additional_files`, no dependency needed. */
export function zipStore(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const sum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, name, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0, 14);
    entry.writeUInt32LE(sum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);
    offset += local.length + name.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}

/** Strip quoted includes from a file that is about to be appended to the entry file. */
function withoutLocalIncludes(source) {
  return source.replace(/^[ \t]*#[ \t]*include[ \t]*"[^"]*"[^\n]*\n?/gm, '');
}

export function createCExecutor({ env = process.env, fetchImpl = fetch, now = Date.now, logger = console } = {}) {
  const baseUrl = String(env.JUDGE0_URL ?? '').trim().replace(/\/+$/, '');
  const apiKey = String(env.JUDGE0_KEY ?? '').trim();
  const apiHost = String(env.JUDGE0_HOST ?? '').trim();
  const languageId = positiveInt(env.JUDGE0_LANGUAGE_ID, DEFAULT_LANGUAGE_ID);
  const timeoutMs = positiveInt(env.C_EXEC_TIMEOUT_MS, 12_000);
  const maxSourceBytes = positiveInt(env.C_MAX_SOURCE_BYTES, 12_000);
  const hits = new Map();

  function allow(key) {
    const at = now();
    const recent = (hits.get(key) ?? []).filter((stamp) => at - stamp < WINDOW_MS);
    if (recent.length >= MAX_RUNS_PER_WINDOW) { hits.set(key, recent); return false; }
    recent.push(at);
    hits.set(key, recent);
    return true;
  }

  function status() {
    return {
      configured: Boolean(baseUrl),
      language: 'C',
      standard: 'C17',
      compiler: 'GCC',
      languageId,
      limits: { sourceBytes: maxSourceBytes, timeoutMs, tests: MAX_TEST_CASES },
    };
  }

  function headers() {
    const out = { 'Content-Type': 'application/json' };
    if (apiKey) {
      out['X-RapidAPI-Key'] = apiKey;
      if (apiHost) out['X-RapidAPI-Host'] = apiHost;
    }
    return out;
  }

  async function submit({ source, stdin = '', args = '', extraFiles = [] }) {
    const params = new URLSearchParams({ base64_encoded: 'false', wait: 'true' });
    const body = {
      source_code: source,
      language_id: languageId,
      stdin,
      command_line_arguments: args,
      cpu_time_limit: Math.max(1, Math.ceil(timeoutMs / 1000)),
      wall_time_limit: Math.max(2, Math.ceil(timeoutMs / 1000) + 2),
      compiler_options: '-std=c17 -Wall -Wextra -O2',
    };
    if (extraFiles.length) {
      const zip = zipStore(extraFiles);
      body.additional_files = zip.toString('base64');
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);
    try {
      const res = await fetchImpl(`${baseUrl}/submissions?${params}`, {
        method: 'POST', headers: headers(), body: JSON.stringify(body), signal: controller.signal,
      });
      if (!res.ok) throw new CExecError(502, `The compiler service answered ${res.status}.`);
      return await res.json();
    } catch (error) {
      if (error instanceof CExecError) throw error;
      if (error?.name === 'AbortError') throw new CExecError(504, 'The compiler service timed out. Try a smaller program.');
      logger.error?.('c-execute failed', error?.message ?? 'unknown');
      throw new CExecError(502, 'The compiler service is unreachable right now.');
    } finally {
      clearTimeout(timer);
    }
  }

  function shape(submission, expected) {
    const stdout = String(submission?.stdout ?? '');
    const stderr = String(submission?.stderr ?? '');
    const compileOutput = String(submission?.compile_output ?? '');
    const timedOut = /time limit exceeded/i.test(String(submission?.status?.description ?? ''));
    const failed = compileOutput.trim().length > 0 || Number(submission?.exit_code ?? 0) !== 0;
    return {
      status: submission?.status?.description ?? 'Unknown',
      stdout, stderr, compileOutput,
      exitCode: submission?.exit_code ?? null,
      time: submission?.time ? Math.round(Number(submission.time) * 1000) : null,
      memory: submission?.memory ?? null,
      timedOut,
      ...(expected === undefined ? {} : { pass: !failed && stdout.trim() === expected.trim(), expected }),
    };
  }

  async function run(input) {
    if (!baseUrl) {
      throw new CExecError(503, 'The C compiler is not connected. Set JUDGE0_URL on the server to run code.');
    }
    const source = typeof input?.source === 'string' ? input.source : '';
    if (!source.trim()) throw new CExecError(400, 'Write some C code first.');
    const files = Array.isArray(input?.files) ? input.files.slice(0, MAX_FILES) : [];
    for (const file of files) {
      if (!file || typeof file.name !== 'string' || typeof file.content !== 'string' || !file.name.trim()) {
        throw new CExecError(400, 'Every extra file needs a name and contents.');
      }
    }
    const headersOnly = files.filter((f) => /\.(h|hpp)$/i.test(f.name));
    const extraSources = files.filter((f) => /\.c$/i.test(f.name));
    const merged = [source, ...extraSources.map((f) => `\n/* ${f.name} */\n${withoutLocalIncludes(f.content)}`)].join('\n');
    const bytes = Buffer.byteLength(merged, 'utf8') + headersOnly.reduce((a, f) => a + Buffer.byteLength(f.content, 'utf8'), 0);
    if (bytes > maxSourceBytes) {
      throw new CExecError(413, `Keep the project under ${maxSourceBytes} bytes (this is ${bytes}).`);
    }
    const stdin = typeof input?.stdin === 'string' ? input.stdin.slice(0, 16_000) : '';
    const args = typeof input?.args === 'string' ? input.args.trim().slice(0, 500) : '';

    const tests = Array.isArray(input?.tests) ? input.tests.slice(0, MAX_TEST_CASES) : [];
    if (tests.length) {
      const results = [];
      for (const [i, test] of tests.entries()) {
        const expected = typeof test?.stdout === 'string' ? test.stdout : '';
        const submission = await submit({ source: merged, stdin: typeof test?.stdin === 'string' ? test.stdin : stdin, args, extraFiles: headersOnly });
        const shaped = shape(submission, expected);
        results.push({ name: typeof test?.name === 'string' && test.name ? test.name : `Test ${i + 1}`, pass: shaped.pass, expected, actual: shaped.stdout, compileOutput: shaped.compileOutput, stderr: shaped.stderr });
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

    const submission = await submit({ source: merged, stdin, args, extraFiles: headersOnly });
    return shape(submission);
  }

  return { allow, status, run };
}
