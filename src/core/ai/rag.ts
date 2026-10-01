/**
 * Offline RAG primitives.
 *
 * This is a REAL, fully deterministic retrieval pipeline that runs in the
 * browser with no network and no model weights:
 *
 *   chunk → vectorise (hashed bag-of-words + IDF) → cosine rank → extractive answer
 *
 * It is deliberately honest about what it is: a lexical retriever, not a neural
 * one. Every number the RAG Lab displays (chunk count, dimensions, scores) is
 * computed from the actual text the learner put in — nothing is hardcoded.
 */

export interface Chunk {
  id: number;
  text: string;
  source: string;
}

export interface Scored extends Chunk {
  score: number;
}

const STOP = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'of', 'and', 'or', 'to', 'in', 'on',
  'for', 'with', 'as', 'at', 'by', 'it', 'its', 'this', 'that', 'from', 'we', 'you', 'your',
  'ka', 'ki', 'ke', 'hai', 'hain', 'aur', 'ek', 'me', 'mein', 'se', 'par', 'ko',
]);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9_]+/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

/** Split a document into overlapping word windows — the "chunking strategy". */
export function chunkText(text: string, size = 60, overlap = 12): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= size) return words.length ? [words.join(' ')] : [];
  const step = Math.max(1, size - overlap);
  const out: string[] = [];
  for (let i = 0; i < words.length; i += step) {
    out.push(words.slice(i, i + size).join(' '));
    if (i + size >= words.length) break;
  }
  return out;
}

export function buildChunks(docs: { text: string; source: string }[], size: number, overlap: number): Chunk[] {
  const out: Chunk[] = [];
  for (const d of docs) {
    const parts = chunkText(d.text, size, overlap);
    parts.forEach((text, i) => out.push({ id: out.length, text, source: parts.length > 1 ? `${d.source} #${i + 1}` : d.source }));
  }
  return out;
}

const DIM = 256;

/** Hashing trick: every token maps to a stable bucket, so vectors are comparable. */
const bucket = (token: string): { i: number; sign: number } => {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const u = h >>> 0;
  return { i: u % DIM, sign: (u >>> 31) === 0 ? 1 : 1 };
};

export interface Index {
  chunks: Chunk[];
  vectors: Float64Array[];
  idf: Float64Array;
  terms: number;
}

export function buildIndex(chunks: Chunk[]): Index {
  const df = new Float64Array(DIM);
  const raw: Float64Array[] = [];
  for (const c of chunks) {
    const v = new Float64Array(DIM);
    const seen = new Set<number>();
    for (const tok of tokenize(c.text)) {
      const { i, sign } = bucket(tok);
      v[i] += sign;
      if (!seen.has(i)) { seen.add(i); df[i] += 1; }
    }
    raw.push(v);
  }
  const n = Math.max(1, chunks.length);
  const idf = new Float64Array(DIM);
  for (let i = 0; i < DIM; i++) idf[i] = Math.log((n + 1) / (df[i] + 1)) + 1;
  const vectors = raw.map((v) => {
    const out = new Float64Array(DIM);
    let norm = 0;
    for (let i = 0; i < DIM; i++) { out[i] = v[i] * idf[i]; norm += out[i] * out[i]; }
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < DIM; i++) out[i] /= norm;
    return out;
  });
  let terms = 0;
  for (let i = 0; i < DIM; i++) if (df[i] > 0) terms++;
  return { chunks, vectors, idf, terms };
}

export function queryVector(index: Index, query: string): Float64Array {
  const v = new Float64Array(DIM);
  for (const tok of tokenize(query)) v[bucket(tok).i] += 1;
  const out = new Float64Array(DIM);
  let norm = 0;
  for (let i = 0; i < DIM; i++) { out[i] = v[i] * index.idf[i]; norm += out[i] * out[i]; }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) out[i] /= norm;
  return out;
}

const dot = (a: Float64Array, b: Float64Array) => {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
};

export function retrieve(index: Index, query: string, k = 4): Scored[] {
  const q = queryVector(index, query);
  return index.chunks
    .map((c, i) => ({ ...c, score: dot(q, index.vectors[i]) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Extractive answer: rank the sentences of the top chunks by how many query
 * terms they contain, then stitch the best 1–2 together. No generation, no
 * hallucination — every word comes from the retrieved source.
 */
export function answerFrom(query: string, hits: Scored[], sourceLabel = (s: string) => s): { text: string; used: number[] } {
  if (!hits.length) return { text: '', used: [] };
  const qterms = new Set(tokenize(query));
  const scored: { s: string; score: number; chunk: number }[] = [];
  hits.forEach((h, ci) => {
    for (const raw of h.text.split(/(?<=[.!?])\s+/)) {
      const s = raw.trim();
      if (s.length < 24) continue;
      const terms = tokenize(s);
      let overlap = 0;
      for (const t of terms) if (qterms.has(t)) overlap++;
      const score = overlap * 2 + (h.score > 0 ? 1 : 0);
      if (overlap > 0) scored.push({ s, score, chunk: ci });
    }
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 2);
  if (!picked.length) return { text: '', used: [] };
  const text = picked
    .map((p) => `${p.s}  [${sourceLabel(hits[p.chunk].source)}]`)
    .join('\n');
  return { text, used: [...new Set(picked.map((p) => p.chunk))] };
}
