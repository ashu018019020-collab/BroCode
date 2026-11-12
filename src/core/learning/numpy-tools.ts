/**
 * The NumPy course's interactive tools, as pure functions.
 *
 * The tools on the page must not be decorative: every number they show is computed here, by rules
 * that match NumPy's documented behaviour, and driven with fixtures under `node --test`:
 *
 *   · broadcasting follows the trailing-dimension rule (equal, or one of them is 1, or it is absent)
 *   · `statsSummary` uses the population variance (NumPy's default `ddof=0`), and percentiles use the
 *     linear interpolation `np.percentile` defaults to
 *   · `matmul` is the real inner-product contraction, and refuses shapes it cannot contract
 *
 * No React, no store, no fetch — the UI in `NTools.tsx` only formats what these return.
 */

export type Shape = number[];

export interface BroadcastResult {
  ok: boolean;
  shape: Shape | null;
  steps: string[];
}

/** Max dimension the visual tools will draw; larger shapes are still legal, just not rendered. */
export const SHAPE_RENDER_LIMIT = 12;

/**
 * Parses `"2, 3"`, `"2x3"` or `"2 3"` into a shape. Dimensions must be positive integers.
 * A blank string is not a shape, and neither is a zero dimension.
 */
export function parseShape(input: string): Shape | null {
  const parts = input.trim().split(/[,x×*]+|\s+/).filter(Boolean);
  if (!parts.length) return null;
  const shape: Shape = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > 64) return null;
    shape.push(n);
  }
  return shape.length <= 4 ? shape : null;
}

/** The number of cells a shape addresses. */
export function shapeSize(shape: Shape): number {
  return shape.reduce((a, b) => a * b, 1);
}

/** C-order strides, in elements, exactly as `ndarray.strides` reports them divided by itemsize. */
export function shapeStrides(shape: Shape): number[] {
  const strides = new Array(shape.length).fill(1);
  for (let i = shape.length - 2; i >= 0; i -= 1) strides[i] = strides[i + 1] * shape[i + 1];
  return strides;
}

/**
 * Whether two shapes broadcast, and the shape they produce.
 *
 * Dimensions are compared from the right: they match, one of them is 1, or one array has no
 * dimension there. Anything else is the ValueError NumPy raises.
 */
export function broadcastShape(a: Shape, b: Shape): BroadcastResult {
  const steps: string[] = [];
  const rank = Math.max(a.length, b.length);
  const left = [...new Array(rank - a.length).fill(1), ...a];
  const right = [...new Array(rank - b.length).fill(1), ...b];
  steps.push(`Pad the shorter shape on the left: ${left.join(', ')} vs ${right.join(', ')}`);
  const out: Shape = [];
  for (let i = 0; i < rank; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === r) {
      out.push(l);
      steps.push(`dim ${i + 1}: ${l} = ${r} → ${l}`);
    } else if (l === 1) {
      out.push(r);
      steps.push(`dim ${i + 1}: ${l} is 1, so it stretches to ${r}`);
    } else if (r === 1) {
      out.push(l);
      steps.push(`dim ${i + 1}: ${r} is 1, so it stretches to ${l}`);
    } else {
      steps.push(`dim ${i + 1}: ${l} and ${r} neither match nor include 1 → cannot broadcast`);
      return { ok: false, shape: null, steps };
    }
  }
  steps.push(`Result shape: (${out.join(', ')})`);
  return { ok: true, shape: out, steps };
}

/** Reads a row-major matrix: rows separated by `;` or a newline, values by commas or spaces. */
export function parseMatrix(input: string): number[][] | null {
  const rows = input.trim().split(/;|\n/).map((r) => r.trim()).filter(Boolean);
  if (!rows.length) return null;
  const matrix: number[][] = [];
  for (const row of rows) {
    const cells = row.split(/[,\s]+/).filter(Boolean).map(Number);
    if (!cells.length || cells.some((n) => !Number.isFinite(n))) return null;
    matrix.push(cells);
  }
  const width = matrix[0].length;
  return matrix.every((row) => row.length === width) ? matrix : null;
}

/**
 * Sorts the numbers and interpolates linearly at rank `(n - 1) * q / 100`, which is what
 * `np.percentile(values, q)` returns by default.
 */
export function percentile(values: number[], q: number): number | null {
  const clean = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!clean.length) return null;
  const clamped = Math.max(0, Math.min(100, q));
  const rank = ((clean.length - 1) * clamped) / 100;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return clean[low];
  return clean[low] + (clean[high] - clean[low]) * (rank - low);
}

export interface StatsSummary {
  count: number;
  mean: number;
  median: number;
  std: number;
  variance: number;
  min: number;
  max: number;
  p25: number;
  p50: number;
  p75: number;
  range: number;
}

/**
 * Population statistics, matching `np.mean`, `np.std`, `np.var` with their default `ddof=0`.
 * Returns `null` for an empty list rather than NaN soup.
 */
export function statsSummary(values: number[]): StatsSummary | null {
  const clean = values.filter((n) => Number.isFinite(n));
  if (!clean.length) return null;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((a, b) => a + (b - mean) ** 2, 0) / clean.length;
  const median = percentile(clean, 50) as number;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  return {
    count: clean.length,
    mean,
    median,
    std: Math.sqrt(variance),
    variance,
    min,
    max,
    p25: percentile(clean, 25) as number,
    p50: median,
    p75: percentile(clean, 75) as number,
    range: max - min,
  };
}

/** `A @ B`: contracts A's columns with B's rows, or returns `null` on a shape mismatch. */
export function matmul(a: number[][], b: number[][]): number[][] | null {
  if (!a.length || !b.length) return null;
  const inner = a[0].length;
  if (!a.every((row) => row.length === inner)) return null;
  if (b.length !== inner) return null;
  const width = b[0].length;
  if (!b.every((row) => row.length === width)) return null;
  return a.map((row) =>
    b[0].map((_, j) => row.reduce((sum, value, k) => sum + value * b[k][j], 0)),
  );
}

export function transpose(matrix: number[][]): number[][] {
  if (!matrix.length) return [];
  return matrix[0].map((_, j) => matrix.map((row) => row[j]));
}

/** Shapes a rectangular `rows × cols` grid gets in the Array Visualizer. */
export function gridShape(shape: Shape): { rows: number; cols: number } {
  if (shape.length === 1) return { rows: 1, cols: shape[0] };
  return { rows: shape[0], cols: shape[1] };
}

/**
 * Python slicing, including negative bounds and a negative step, as `slice.indices` computes it.
 * `null` means the bound was omitted, which is not the same as 0 (or length-1 for a reverse).
 */
export function sliceIndices(
  length: number, start: number | null, stop: number | null, step: number,
): { indices: number[]; error: string | null } {
  if (!Number.isInteger(length) || length < 0) return { indices: [], error: 'length must be a positive whole number' };
  if (!Number.isInteger(step) || step === 0) return { indices: [], error: 'step must be a non-zero whole number' };
  let from: number;
  let to: number;
  if (step > 0) {
    from = start === null ? 0 : start < 0 ? Math.max(0, length + start) : Math.min(start, length);
    to = stop === null ? length : stop < 0 ? Math.max(0, length + stop) : Math.min(stop, length);
  } else {
    from = start === null ? length - 1 : start < 0 ? length + start : Math.min(start, length - 1);
    to = stop === null ? -1 : stop < 0 ? length + stop : Math.min(stop, length - 1);
  }
  const indices: number[] = [];
  if (step > 0) for (let i = from; i < to; i += step) indices.push(i);
  else for (let i = from; i > to; i += step) indices.push(i);
  return { indices, error: null };
}

export type CompareOp = '>' | '>=' | '<' | '<=' | '==' | '!=';

/** A boolean mask and the values it selects — what `a[a > t]` returns, step by step. */
export function maskFilter(values: number[], op: CompareOp, threshold: number): { mask: boolean[]; selected: number[] } {
  const test = (v: number) => {
    switch (op) {
      case '>': return v > threshold;
      case '>=': return v >= threshold;
      case '<': return v < threshold;
      case '<=': return v <= threshold;
      case '==': return v === threshold;
      default: return v !== threshold;
    }
  };
  const mask = values.map(test);
  return { mask, selected: values.filter((_, i) => mask[i]) };
}

/** The flat C-order index behind every cell of a `rows × cols` reshape. */
export function reshapeGrid(rows: number, cols: number): number[][] {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return [];
  return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => i * cols + j));
}

/** Bytes per element for the dtypes the course teaches; `null` for one it does not. */
export const DTYPE_BYTES: Record<string, number> = {
  bool: 1, int8: 1, int16: 2, int32: 4, int64: 8,
  float16: 2, float32: 4, float64: 8, complex64: 8, complex128: 16,
};

/** Total bytes a dtype needs for `count` elements, in the same units the course prints. */
export function dtypeMemory(dtype: string, count: number): { bytes: number; readable: string } | null {
  const per = DTYPE_BYTES[dtype];
  if (!per || !Number.isInteger(count) || count < 0) return null;
  const bytes = per * count;
  const readable = bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(2)} MiB`
    : bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${bytes} B`;
  return { bytes, readable };
}

/**
 * A deterministic uniform stream, so the RNG playground can show reproducibility without a seed
 * server: the same seed always yields the same numbers, a different seed yields different ones.
 * This is a small xorshift32, not NumPy's PCG64 — the panel says so instead of pretending.
 */
export function uniformSamples(seed: number, count: number): number[] {
  let state = (Math.abs(Math.trunc(seed)) || 1) >>> 0;
  const out: number[] = [];
  for (let i = 0; i < Math.max(0, Math.min(64, Math.trunc(count))); i += 1) {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    out.push(Math.round((state / 0xffffffff) * 10000) / 10000);
  }
  return out;
}

export interface MissingSummary {
  total: number;
  missing: number;
  present: number;
  meanPresent: number | null;
  minPresent: number | null;
  maxPresent: number | null;
}

/** Counts how many cells are absent (`null`, NaN or the sentinel) and summarises the rest. */
export function missingSummary(values: (number | null)[], sentinel: number | null = null): MissingSummary {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v) && (sentinel === null || v !== sentinel));
  const missing = values.length - present.length;
  return {
    total: values.length,
    missing,
    present: present.length,
    meanPresent: present.length ? present.reduce((a, b) => a + b, 0) / present.length : null,
    minPresent: present.length ? Math.min(...present) : null,
    maxPresent: present.length ? Math.max(...present) : null,
  };
}
