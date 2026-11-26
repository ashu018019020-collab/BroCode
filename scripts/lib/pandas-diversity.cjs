'use strict';

/**
 * Content-diversity gate for the Pandas Mastery coding tasks.
 *
 * The hard gate is intentionally per module: the course repeats the same warm-up exercises across
 * modules on purpose, but a module's own task bank must not repeat itself. A module fails when two
 * tasks ask the same thing, when a title is only filler, or when two tasks use the same solution.
 *
 * Solutions are compared by a SEMANTIC FINGERPRINT rather than by their text. Two tasks that teach
 * the same thing are duplicates even when they spell it differently:
 *
 *     df.shape[0]        === len(df)
 *     df.shape[1]        === len(df.columns)   === df.columns.size
 *     df['b'].tolist()   === list(df["b"])     === df["b"].values.tolist()
 *     df.copy()          === df
 *
 * Quote style, comments, and whitespace are normalised too. Column names keep their case, so
 * `df["Sales"]` and `df["sales"]` stay different tasks.
 *
 * On top of the per-module gate there is a CROSS-MODULE check. It exists because a task copied from
 * one module into another is invisible to the per-module pass, and the course is only allowed to
 * repeat where it says so: `WARMUP_ALLOWLIST` names the warm-ups that are repeated in every module
 * on purpose. Anything else that repeats across modules fails.
 */

/*
 * Titles made only of these words say nothing about the task. Keeping the list as tokens (instead of
 * one large regex) also catches bare prefixes such as "Warm up" or "Pandas" that the old pattern let
 * through, while a title like "Practice with groupby" keeps its meaningful word and passes.
 */
const TITLE_FILLER = new Set([
  'pandas', 'dataframe', 'frame', 'data', 'dataset', 'series', 'python',
  'coding', 'code', 'programming', 'mini', 'practice', 'quick', 'warm', 'warmup', 'up', 'bonus',
  'task', 'tasks', 'exercise', 'exercises', 'problem', 'problems', 'question', 'questions',
  'challenge', 'challenges', 'activity', 'activities', 'assignment', 'assignments',
  'lab', 'labs', 'project', 'projects', 'example', 'examples', 'demo', 'demos',
  'solution', 'solutions', 'answer', 'answers', 'untitled', 'todo', 'try', 'it', 'your', 'turn',
  'no', 'number', 'part', 'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'using', 'and', 'or', 'by', 'from',
]);

/**
 * The repetitions the course makes on purpose: the same four orientation warm-ups in every module.
 * This list is the ONLY exemption from the cross-module check — a duplicate that is not named here
 * is a mistake (either dedupe it or add it here with a reason).
 */
const WARMUP_ALLOWLIST = Object.freeze([
  Object.freeze({ title: 'Count rows and columns', reason: 'orientation warm-up, repeated in every module' }),
  Object.freeze({ title: 'Select a column', reason: 'orientation warm-up, repeated in every module' }),
  Object.freeze({ title: 'Filter rows', reason: 'orientation warm-up, repeated in every module' }),
  Object.freeze({ title: 'Add a column', reason: 'orientation warm-up, repeated in every module' }),
]);

/** Case/whitespace-insensitive text key; trailing sentence punctuation is ignored. */
function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

/** Title key without the per-module `(pNN)` suffix, so the same warm-up counts as one title. */
function titleKeyOf(value) {
  return normalizeText(value).replace(/\s*\(p\d{2}\)\s*$/, '').trim();
}

/** A title is generic when nothing remains after filler words, numbers, and a `(pNN)` suffix. */
function isGenericTitle(value) {
  const meaningful = normalizeText(value)
    .replace(/\(p\d{2}\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((word) => !/^\d+$/.test(word) && !/^p\d{2}$/.test(word) && !TITLE_FILLER.has(word));
  return meaningful.length === 0;
}

const STRING_SENTINEL = '\u00a7';

/**
 * Replace every string literal with a numbered token. Column names must survive comparison, but the
 * equivalences below are code transforms — running them over a literal would corrupt it.
 */
function maskStrings(code) {
  const literals = [];
  let masked = '';
  for (let i = 0; i < code.length; i += 1) {
    const quote = code[i];
    if (quote !== '"' && quote !== "'") {
      masked += quote;
      continue;
    }
    let value = '';
    let j = i + 1;
    while (j < code.length && code[j] !== quote) {
      if (code[j] === '\\' && j + 1 < code.length) {
        value += code[j] + code[j + 1];
        j += 2;
        continue;
      }
      value += code[j];
      j += 1;
    }
    masked += `${STRING_SENTINEL}${literals.length}${STRING_SENTINEL}`;
    literals.push(value);
    i = j; // skip the closing quote (or run past the end, as Python would)
  }
  return { masked, literals };
}

/** A dotted/subscripted chain: `df`, `df.columns`, `df["a"]`, `s.cat.codes`. */
const CHAIN_TOKEN = `(?:[A-Za-z_][A-Za-z0-9_]*|${STRING_SENTINEL}\\d+${STRING_SENTINEL})`;
const CHAIN = `(?:${CHAIN_TOKEN})(?:(?:\\[\\s*${CHAIN_TOKEN}\\s*\\])|(?:\\.${CHAIN_TOKEN}))*`;

/**
 * Spellings that mean the same pandas operation. Applied until the text stops changing, so
 * `df["a"].values.tolist()` and `list(df["a"])` converge on one form.
 */
const EQUIVALENCES = [
  // Row and column counts. This is the pair that mattered most: `df.shape[0]` is `len(df)`.
  [new RegExp(`(${CHAIN})\\.shape\\s*\\[\\s*0\\s*\\]`, 'g'), 'len($1)'],
  [new RegExp(`(${CHAIN})\\.shape\\s*\\[\\s*1\\s*\\]`, 'g'), 'len($1.columns)'],
  [new RegExp(`(${CHAIN})\\.columns\\.size`, 'g'), 'len($1.columns)'],
  // Materialising a column as a Python list.
  [new RegExp(`(${CHAIN})\\.values\\.tolist\\s*\\(\\s*\\)`, 'g'), '$1.tolist()'],
  [new RegExp(`(${CHAIN})\\.tolist\\s*\\(\\s*\\)`, 'g'), 'list($1)'],
  // A copy is not a different computation.
  [new RegExp(`(${CHAIN})\\.copy\\s*\\(\\s*\\)`, 'g'), '$1'],
  // Keyword where a positional argument means the same thing.
  [/\b(head|tail|sample)\s*\(\s*n\s*=\s*/g, '$1('],
];

/** Drop comments, collapse whitespace, and tighten punctuation so only semantics remain. */
function canonicalCode(code) {
  const { masked, literals } = maskStrings(String(code ?? ''));
  let text = masked
    .split('\n')
    .map((line) => line.replace(/#.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  for (let pass = 0; pass < 4; pass += 1) {
    const before = text;
    for (const [pattern, replacement] of EQUIVALENCES) text = text.replace(pattern, replacement);
    if (text === before) break;
  }

  text = text
    .replace(/\s*([()[\]{},:])\s*/g, '$1')
    .replace(/\s*\.\s*/g, '.')
    .replace(/;+$/, '')
    .trim();

  return text.replace(/§(\d+)§/g, (_, index) => `"${literals[Number(index)]}"`);
}

/**
 * The comparison key for a solution. Two tasks with the same fingerprint teach the same thing.
 * Returns '' when the solution is empty, so an unfinished task never collides with another.
 */
function solutionFingerprint(solution) {
  const text = canonicalCode(solution);
  if (!text) return '';
  // The fixture preamble is identical for tasks in one module and different across modules, so it
  // is part of the fingerprint: two tasks are only duplicates when they compute the same thing from
  // the same data.
  return text;
}

/** A short, readable fingerprint for a failure message. */
function describeFingerprint(fingerprint) {
  const compact = fingerprint.replace(/\s+/g, ' ');
  return compact.length > 120 ? `${compact.slice(0, 117)}…` : compact;
}

/**
 * Return the diversity problems for one module's tasks. Empty means the bank is diverse enough.
 * @param {Array<{title?: string, statement?: string, solution?: string}>} tasks
 * @param {string} moduleId
 * @returns {string[]}
 */
function validateTaskDiversity(tasks, moduleId = 'module') {
  if (!Array.isArray(tasks)) return [`${moduleId}: tasks must be an array`];

  const problems = [];
  const statementOwners = new Map();
  const titleOwners = new Map();
  const solutionOwners = new Map();

  for (const [index, task] of tasks.entries()) {
    const at = task?.title ? `"${task.title}"` : `task ${index + 1}`;

    const titleKey = titleKeyOf(task?.title);
    if (isGenericTitle(task?.title)) {
      problems.push(`${moduleId}: task ${at} has a generic title`);
    } else if (titleKey && titleOwners.has(titleKey)) {
      problems.push(`${moduleId}: task ${at} repeats the title of ${titleOwners.get(titleKey)}`);
    }
    if (titleKey) titleOwners.set(titleKey, at);

    const statementKey = normalizeText(task?.statement);
    if (statementKey) {
      if (statementOwners.has(statementKey)) {
        problems.push(`${moduleId}: task ${at} repeats the statement of ${statementOwners.get(statementKey)}`);
      } else {
        statementOwners.set(statementKey, at);
      }
    }

    const fingerprint = solutionFingerprint(task?.solution);
    if (fingerprint) {
      if (solutionOwners.has(fingerprint)) {
        problems.push(
          `${moduleId}: task ${at} repeats the solution of ${solutionOwners.get(fingerprint)} — ` +
            `same semantic fingerprint: ${describeFingerprint(fingerprint)}`,
        );
      } else {
        solutionOwners.set(fingerprint, at);
      }
    }
  }

  return problems;
}

/**
 * The structured, ADVISORY cross-module duplicate audit.
 *
 * It reports three kinds of repeat — title, statement and semantic solution — and never throws or
 * exits. `WARMUP_ALLOWLIST` is the documented exemption: the same orientation warm-up in every
 * module is intentional, so a repeat is skipped only when BOTH the current task and the task it
 * repeats carry documented warm-up titles. A unique task that copies a warm-up's title, statement or
 * solution is still a finding. Everything is advisory for a human to review; only the
 * statement/solution findings feed the hard gate (`validateCrossModuleDiversity`).
 *
 * Titles are compared without the per-module `(pNN)` suffix, so "Filter rows (P01)" and
 * "Filter rows (P12)" are one title (and the warm-up rule can recognise it).
 *
 * @param {Array<{id?: string, tasks?: Array}>} modules
 * @param {{allowWarmups?: Array<string|{title: string}>}} [options]
 * @returns {{findings: Array<object>, counts: {title: number, statement: number, solution: number}, error?: string}}
 */
function crossModuleDuplicateReport(modules, options = {}) {
  const counts = { title: 0, statement: 0, solution: 0 };
  if (!Array.isArray(modules)) return { findings: [], counts, error: 'modules must be an array' };

  const allowlist = options.allowWarmups ?? WARMUP_ALLOWLIST;
  const allowed = new Set(
    allowlist
      .map((entry) => titleKeyOf(typeof entry === 'string' ? entry : entry?.title))
      .filter(Boolean),
  );

  const findings = [];
  const hint = (key) => `If "${key}" is an intended warm-up, add it to WARMUP_ALLOWLIST; otherwise make the task distinct.`;

  const checks = [
    {
      kind: 'title',
      value: (task) => titleKeyOf(task?.title),
      message: ({ moduleId, at, owner, key }) =>
        `${moduleId}: task ${at} repeats the title of ${owner.moduleId} ${owner.at} across modules. ${hint(key)}`,
    },
    {
      kind: 'solution',
      value: (task) => solutionFingerprint(task?.solution),
      message: ({ moduleId, at, owner, key, value }) =>
        `${moduleId}: task ${at} repeats the solution of ${owner.moduleId} ${owner.at} across modules — ` +
        `same semantic fingerprint: ${describeFingerprint(value)}. ${hint(key)}`,
    },
    {
      kind: 'statement',
      value: (task) => normalizeText(task?.statement),
      message: ({ moduleId, at, owner, key }) =>
        `${moduleId}: task ${at} repeats the statement of ${owner.moduleId} ${owner.at} across modules. ${hint(key)}`,
    },
  ];
  const owners = new Map(checks.map(({ kind }) => [kind, new Map()]));

  for (const module of modules) {
    const moduleId = module?.id ?? 'module';
    const tasks = Array.isArray(module?.tasks) ? module.tasks : [];

    for (const [index, task] of tasks.entries()) {
      const at = task?.title ? `"${task.title}"` : `task ${index + 1}`;
      const key = titleKeyOf(task?.title);
      const current = { moduleId, at, warmup: Boolean(key && allowed.has(key)) };

      for (const check of checks) {
        const value = check.value(task);
        if (!value) continue;
        const map = owners.get(check.kind);
        const owner = map.get(value);
        if (!owner) {
          map.set(value, current);
          continue;
        }
        if (owner.moduleId === moduleId || (current.warmup && owner.warmup)) continue;

        counts[check.kind] += 1;
        findings.push({
          kind: check.kind,
          moduleId,
          task: at,
          ownerModuleId: owner.moduleId,
          ownerTask: owner.at,
          message: check.message({ moduleId, at, owner, key: key || at, value }),
          ...(check.kind === 'solution' ? { fingerprint: value } : {}),
        });
      }
    }
  }

  return { findings, counts };
}

/**
 * Return the hard-gate problems where two modules repeat a STATEMENT or SOLUTION. A repeat is
 * exempt only when BOTH tasks are documented warm-ups. Titles are intentionally not fatal; they
 * are surfaced by `crossModuleDuplicateReport` instead, because a shared title can be a legitimate
 * variation while a copied statement/solution cannot.
 *
 * @param {Array<{id?: string, tasks?: Array}>} modules
 * @param {{allowWarmups?: Array<string|{title: string}>}} [options]
 * @returns {string[]}
 */
function validateCrossModuleDiversity(modules, options = {}) {
  const report = crossModuleDuplicateReport(modules, options);
  if (report.error) return [report.error];
  return report.findings.filter((finding) => finding.kind !== 'title').map((finding) => finding.message);
}

module.exports = {
  validateTaskDiversity,
  validateCrossModuleDiversity,
  crossModuleDuplicateReport,
  solutionFingerprint,
  isGenericTitle,
  WARMUP_ALLOWLIST,
};
