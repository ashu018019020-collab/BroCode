/**
 * Line diff — the engine behind the coding coach's "preview the change" panel.
 *
 * The coach may only offer a patch it can PROVE it can apply: the line it is about to replace must
 * still read exactly as it did when the finding was produced. So this module owns two things and
 * nothing else: a line-level LCS diff for display, and the same safety check the apply button uses.
 *
 * Pure on purpose: no React, no editor, no DOM. `scripts/tests/coding-coach.test.mjs` drives it with
 * fixtures, including the "the learner edited the line after the preview" case.
 */

export type DiffType = 'same' | 'add' | 'remove';

export interface DiffLine {
  type: DiffType;
  /** 1-based line number in the BEFORE text (`null` for an added line). */
  beforeLine: number | null;
  /** 1-based line number in the AFTER text (`null` for a removed line). */
  afterLine: number | null;
  text: string;
}

export interface DiffStats {
  added: number;
  removed: number;
  unchanged: number;
}

/** A single deterministic repair: replace one 1-based line, or append when `line` is the last + 1. */
export interface CodePatch {
  /** 1-based line to replace; `lines + 1` appends a new line at the end. */
  line: number;
  /** The exact text that line must still have (trim-end compared). Empty for an append. */
  before: string;
  /** The replacement text, without a trailing newline. */
  after: string;
  /** Why the patch is safe — shown next to the preview. */
  reason: string;
}

/** The diff is bounded so a paste of a 5,000-line file cannot freeze the tab. */
export const MAX_DIFF_LINES = 800;

function splitLines(text: string): string[] {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  // A trailing newline is a terminator, not an extra empty line of code.
  return normalized.endsWith('\n') ? normalized.slice(0, -1).split('\n') : normalized.split('\n');
}

/**
 * Longest-common-subsequence diff.
 *
 * O(n·m) is deliberate: the cap is 800 lines (640k cells, a 2.6 MB Int32Array) and code the coach
 * previews is a single lesson-sized snippet, not a repository. At the cap the diff degrades to a
 * whole-file replace rather than lying about line positions or hanging.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = splitLines(before);
  const b = splitLines(after);
  if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) {
    const out: DiffLine[] = [];
    a.forEach((text, i) => out.push({ type: 'remove', beforeLine: i + 1, afterLine: null, text }));
    b.forEach((text, i) => out.push({ type: 'add', beforeLine: null, afterLine: i + 1, text }));
    return out;
  }

  const rows = a.length + 1;
  const cols = b.length + 1;
  const table = new Int32Array(rows * cols);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * cols + j] = a[i] === b[j]
        ? table[(i + 1) * cols + (j + 1)] + 1
        : Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', beforeLine: i + 1, afterLine: j + 1, text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      out.push({ type: 'remove', beforeLine: i + 1, afterLine: null, text: a[i] });
      i += 1;
    } else {
      out.push({ type: 'add', beforeLine: null, afterLine: j + 1, text: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    out.push({ type: 'remove', beforeLine: i + 1, afterLine: null, text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    out.push({ type: 'add', beforeLine: null, afterLine: j + 1, text: b[j] });
    j += 1;
  }
  return out;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  const stats: DiffStats = { added: 0, removed: 0, unchanged: 0 };
  for (const line of lines) {
    if (line.type === 'add') stats.added += 1;
    else if (line.type === 'remove') stats.removed += 1;
    else stats.unchanged += 1;
  }
  return stats;
}

/**
 * Apply one line patch, or refuse.
 *
 * Refusal is the point. A preview can go stale between the click and the apply — the learner may
 * have typed into that exact line, or run Format. Applying anyway would silently overwrite an edit
 * that was not the one being fixed, which is the one thing a coach must never do to a learner's
 * code. `null` means "the file moved; regenerate the finding".
 */
export function applyLinePatch(code: string, patch: CodePatch): string | null {
  const lines = splitLines(code);
  const expected = patch.before.replace(/\s+$/, '');
  if (!Number.isInteger(patch.line) || patch.line < 1) return null;

  if (patch.line === lines.length + 1) {
    // Append, but only when the caller really meant an append (no before text).
    if (expected) return null;
    return [...lines, patch.after].join('\n');
  }
  const index = patch.line - 1;
  if (index >= lines.length) return null;
  if (lines[index].replace(/\s+$/, '') !== expected) return null;
  const next = [...lines];
  next[index] = patch.after;
  return next.join('\n');
}

/** The diff a patch WOULD make — used by the preview, and identical to what apply produces. */
export function previewPatch(code: string, patch: CodePatch): DiffLine[] | null {
  const next = applyLinePatch(code, patch);
  return next === null ? null : diffLines(code, next);
}
