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
