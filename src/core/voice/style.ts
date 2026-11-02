/**
 * Voice-style JSON → two flat float tensors.
 *
 * `voice_styles/F1.json` stores `style_ttl` as `{ data: [[[…]]] }` — a nested list whose nesting IS
 * the shape (`[1, 50, 256]`). The tensors have to be rebuilt from that, and a wrong shape is the kind
 * of failure that surfaces as nonsense audio rather than an error, so the shapes are checked against
 * the model's own `tts.json` contract here instead of being trusted.
 *
 * Pure: no fetch, no runtime. The worker fetches the JSON and calls this.
 */
import type { StyleVectors, Tensor } from './engine';

/** `style_ttl` is `[1, 50, 256]` and `style_dp` is `[1, 8, 16]` for Supertonic 3. */
export const STYLE_TTL_DIMS = [1, 50, 256] as const;
export const STYLE_DP_DIMS = [1, 8, 16] as const;

export class StyleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StyleError';
  }
}

/** Recursively flatten `[[[…]]]` into a Float32Array, recording the shape on the way down. */
export function flattenStyle(node: unknown, out: number[] = []): Float32Array {
  if (Array.isArray(node)) {
    for (const child of node) flattenStyle(child, out);
  } else if (typeof node === 'number' && Number.isFinite(node)) {
    out.push(node);
  } else {
    throw new StyleError('The voice preset contains a value that is not a number.');
  }
  return Float32Array.from(out);
}

/** The shape implied by the nesting of a JSON list. */
export function shapeOf(node: unknown): number[] {
  const dims: number[] = [];
  let cursor: unknown = node;
  while (Array.isArray(cursor)) {
    dims.push(cursor.length);
    cursor = cursor[0];
  }
  return dims;
}

function readTensor(node: unknown, expected: readonly number[], label: string): Tensor {
  const dims = shapeOf(node);
  if (dims.length !== expected.length || dims.some((size, index) => size !== expected[index])) {
    throw new StyleError(`The voice preset's ${label} has shape [${dims.join(', ')}], expected [${expected.join(', ')}].`);
  }
  const data = flattenStyle(node);
  const total = expected.reduce((product, size) => product * size, 1);
  if (data.length !== total) {
    throw new StyleError(`The voice preset's ${label} holds ${data.length} values, expected ${total}.`);
  }
  return { data, dims: [...expected] };
}

/**
 * Parse one `voice_styles/<preset>.json`.
 *
 * `metadata` is ignored on purpose: it records where the style was extracted from, which is
 * provenance for a human, not an input to inference.
 */
export function parseStyle(raw: unknown): StyleVectors {
  if (!raw || typeof raw !== 'object') throw new StyleError('The voice preset is not an object.');
  const json = raw as Record<string, Record<string, unknown> | undefined>;
  return {
    ttl: readTensor(json.style_ttl?.data, STYLE_TTL_DIMS, 'style_ttl'),
    dp: readTensor(json.style_dp?.data, STYLE_DP_DIMS, 'style_dp'),
  };
}
