/**
 * The browser performance lab's Python program, kept pure so a test can execute it.
 *
 * The NumPy course runs in this app's bundled Pyodide runtime (`public/pyodide`, offline), which
 * ships CPython and the NumPy wheel. So the lab times a genuine Python `for` loop against a genuine
 * NumPy expression in the learner's own tab — not a JavaScript imitation of either.
 *
 * The program prints one machine-readable line (`NBENCH` + JSON). Everything on screen is parsed from
 * that line, so the panel cannot show a number the runtime did not measure.
 */
export const BENCH_MARKER = 'NBENCH';

export interface BenchReport {
  n: number;
  reps: number;
  /** Milliseconds of every repeat, in the order they ran. */
  loopTimes: number[];
  vectorTimes: number[];
  /** Median of each set — the headline number, because one slow repeat is noise. */
  loopMs: number;
  vectorMs: number;
  /** How many times faster the vectorised expression was; 0 when it was slower. */
  speedup: number;
  /** Absolute difference between the two sums, which proves both computed the same thing. */
  checksumDelta: number;
}

/** Python source for a loop-versus-vectorised run of `n` values, each timed `reps` times. */
export function benchmarkSource(n: number, reps = 5): string {
  const size = Math.max(1000, Math.floor(n));
  const repeats = Math.max(1, Math.floor(reps));
  return `import json, time
import numpy as np

n = ${size}
reps = ${repeats}
values = np.arange(n, dtype=np.float64)

def python_loop():
    total = 0.0
    for v in values.tolist():
        total += v * v
    return total

def vectorised():
    return float(np.sum(values * values))

def timed(fn):
    fn()
    out = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        out.append(round((time.perf_counter() - t0) * 1000, 3))
    return out

loop_times = timed(python_loop)
vector_times = timed(vectorised)
loop_sum = python_loop()
vector_sum = vectorised()

print("${BENCH_MARKER}" + json.dumps({
    "n": n,
    "reps": reps,
    "loopTimes": loop_times,
    "vectorTimes": vector_times,
    "checksumDelta": round(abs(loop_sum - vector_sum), 9),
}))
`;
}

/** Median of a timing list; exported so the panel and the test agree on the headline number. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Parse the marker line into the report the panel renders.
 * Returns null when the runtime printed no marker (an import error, a stop, a timeout), so the UI can
 * show the real failure instead of an empty card.
 */
export function parseBenchmark(output: string): BenchReport | null {
  const line = output.split('\n').find((l) => l.startsWith(BENCH_MARKER));
  if (!line) return null;
  let raw: { n?: unknown; reps?: unknown; loopTimes?: unknown; vectorTimes?: unknown; checksumDelta?: unknown };
  try {
    raw = JSON.parse(line.slice(BENCH_MARKER.length));
  } catch {
    return null;
  }
  const nums = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x) && x >= 0);
  const loopTimes = nums(raw.loopTimes) ? (raw.loopTimes as number[]) : null;
  const vectorTimes = nums(raw.vectorTimes) ? (raw.vectorTimes as number[]) : null;
  if (!loopTimes?.length || !vectorTimes?.length) return null;
  const loopMs = median(loopTimes);
  const vectorMs = median(vectorTimes);
  return {
    n: typeof raw.n === 'number' ? raw.n : 0,
    reps: typeof raw.reps === 'number' ? raw.reps : loopTimes.length,
    loopTimes,
    vectorTimes,
    loopMs,
    vectorMs,
    speedup: vectorMs > 0 ? loopMs / vectorMs : 0,
    checksumDelta: typeof raw.checksumDelta === 'number' ? raw.checksumDelta : Number.NaN,
  };
}
