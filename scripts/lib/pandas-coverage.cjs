'use strict';

/**
 * Operation coverage and prerequisite gate for the Pandas Mastery course.
 *
 * The course promises that every module teaches an operation and then makes the learner use it.
 * That promise is easy to break: a topic explains `groupby` while the module's tasks never group,
 * or a task slips in `merge` in module 4 even though joins are only taught in module 12. Neither
 * mistake shows up in the fixture guard, which only checks that a task prints its stored output.
 *
 * This module builds the missing map: every operation family (selection, filtering, groupby,
 * merge, datetime, reshape, …) is declared here once, with
 *
 *   · `taughtIn`  the module that introduces it — authored, never inferred from loose code scans,
 *                 because one incidental line in a topic snippet would otherwise mark an operation
 *                 as "taught" in module 1 and hide a real prerequisite violation;
 *   · `requires`  the exact `requires` labels its tasks use (every authored label maps to exactly
 *                 one family, so a task's prerequisite is known without guessing from its code);
 *   · `uses`      code shapes that mean the family, for coverage credit and for debug challenges;
 *   · `keywords`  the words a topic title uses when it teaches the family (topic grounding).
 *
 * `validateOperationCoverage` fails in four cases, and every message names the operation:
 *
 *   · a task's `requires` label belongs to no family (the matrix would silently miss it);
 *   · a task uses an operation whose family is taught only later (a prerequisite violation);
 *   · a module teaches a family but no coding task or debug challenge tests it;
 *   · a family claims a `taughtIn` module that never mentions it in a topic, task or debug challenge.
 *
 * Debug challenges count for coverage but not for prerequisites: a drill may legitimately show a
 * later API while diagnosing an error (for example a `merge` indicator drill in a missing-data
 * module), and rewriting those drills would change pinned error strings.
 */

/** Replace string literals so a column named "merge" is never mistaken for the merge operation. */
function stripStrings(code) {
  return String(code ?? '').replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, '""');
}

/**
 * The course's operation families. Order is the teaching order; it is also the matrix row order.
 * `taughtIn` is a module id (`p01`…`p20`).
 */
const OPERATIONS = [
  {
    id: 'selection',
    label: 'column and row selection',
    example: 'df["col"]',
    taughtIn: 'p01',
    requires: ['__getitem__()', 'insert()', 'columns'],
    uses: [/\bdf\s*\[/, /\.loc\s*\[/, /\.iloc\s*\[/, /\.at\s*\[/, /\.iat\s*\[/, /\.insert\s*\(/, /\.columns\b/],
    keywords: [/\bselect/i, /\bindexing\b/i, /\bcolumns?\b/i],
  },
  {
    id: 'inspection',
    label: 'inspecting shape, size and dtypes',
    example: 'df.shape',
    taughtIn: 'p01',
    requires: ['shape', 'nunique()'],
    uses: [/\.shape\b/, /\.ndim\b/, /\.size\b/, /\.info\s*\(/, /\.head\s*\(/, /\.tail\s*\(/, /nunique\s*\(/, /\.empty\b/],
    keywords: [/\bshape\b/i, /\bsize\b/i, /\binspect/i, /\bhead and tail/i, /\bndim\b/i],
  },
  {
    id: 'aggregation',
    label: 'aggregation',
    example: 'df["col"].mean()',
    taughtIn: 'p01',
    requires: ['mean()', 'sum()', 'max()', 'count()', 'median()', 'describe()', 'value_counts()'],
    uses: [/\.(?:mean|sum|max|min|count|median|describe|value_counts)\s*\(/],
    keywords: [/\baggregat/i, /\bmean\b/i, /\bsummary\b/i, /\bdescriptive\b/i, /\bvalue counts\b/i],
  },
  {
    id: 'conversion',
    label: 'converting values to Python',
    example: 's.tolist()',
    taughtIn: 'p01',
    requires: ['tolist()'],
    uses: [/\.tolist\s*\(/, /\blist\s*\(/],
    keywords: [/\bpython (list|values)\b/i, /\btolist\b/i, /\blists? concatenate\b/i],
  },
  {
    id: 'index',
    label: 'index handling',
    example: 'df.set_index("id")',
    taughtIn: 'p02',
    requires: [],
    uses: [/\.reindex\s*\(/, /\.set_index\s*\(/, /\.reset_index\s*\(/, /\bIndex\s*\(/],
    keywords: [/\bindex\b/i, /\breindex\b/i, /\bset_index\b/i, /\blabel alignment\b/i],
  },
  {
    id: 'arithmetic',
    label: 'vectorised arithmetic',
    example: 'df["a"] + df["b"]',
    taughtIn: 'p02',
    requires: ['add()', 'abs()', 'gt()'],
    uses: [/\.(?:add|sub|mul|div|abs|gt|lt|ge|le)\s*\(/, /\bdf\[[^\]]*\]\s*[-+*/]\s*/],
    keywords: [/\barithmetic\b/i, /\bvectori[sz]ed\b/i, /\bbroadcast/i, /\baligns by label\b/i],
  },
  {
    id: 'types',
    label: 'data types and conversion',
    example: 's.astype("int64")',
    taughtIn: 'p02',
    requires: ['astype()', 'select_dtypes()'],
    uses: [/\.astype\s*\(/, /select_dtypes\s*\(/, /\.dtypes\b/, /convert_dtypes\s*\(/],
    keywords: [/\bdtypes?\b/i, /\btypes?\b/i, /\bastype\b/i, /\bnullable\b/i],
  },
  {
    id: 'filtering',
    label: 'filtering rows',
    example: 'df[df["a"] > 1]',
    taughtIn: 'p04',
    requires: ['where()'],
    uses: [
      /\.query\s*\(/, /\.isin\s*\(/, /\.between\s*\(/, /\.where\s*\(/, /\.mask\s*\(/,
      /df\[[^\n]*(?:[<>=!]|&&?|\|\|?)[^\n]*\]/,
    ],
    keywords: [/\bfilter/i, /\bboolean mask\b/i, /\bquery\b/i, /\bconditions?\b/i],
  },
  {
    id: 'datetime',
    label: 'datetime access',
    example: 's.dt.year',
    taughtIn: 'p05',
    requires: [
      'year', 'dayofweek', 'quarter', 'days', 'strftime()', 'total_seconds()', 'bdate_range()',
    ],
    uses: [
      /to_datetime\s*\(/, /\.dt\./, /date_range\s*\(/, /bdate_range\s*\(/, /strftime\s*\(/,
      /\bTimestamp\b/, /\bTimedelta\b/,
    ],
    keywords: [/\bdatetime\b/i, /\bdates?\b/i, /\btime ?series\b/i, /\btimestamp\b/i],
  },
  {
    id: 'categorical',
    label: 'categorical data',
    example: 's.cat.categories',
    taughtIn: 'p05',
    requires: ['categories'],
    uses: [/\.cat\./, /astype\(\s*["']category/, /\bCategoricalDtype\b/, /\bpd\.Categorical\b/],
    keywords: [/\bcategor/i, /\bordered dtype\b/i],
  },
  {
    id: 'functions',
    label: 'element-wise functions',
    example: 's.map({...})',
    taughtIn: 'p06',
    requires: ['map()', 'clip()', 'assign()', 'round()'],
    uses: [/\.map\s*\(/, /\.apply\s*\(/, /\.clip\s*\(/, /\.assign\s*\(/, /\.round\s*\(/],
    keywords: [/\bmap\b/i, /\bapply\b/i, /\bclip\b/i, /\bassign\b/i, /\bround\b/i],
  },
  {
    id: 'cumulative',
    label: 'cumulative operations',
    example: 's.cumsum()',
    taughtIn: 'p06',
    requires: ['cumsum()', 'cumprod()', 'diff()'],
    uses: [/cumsum\s*\(/, /cumprod\s*\(/, /cummax\s*\(/, /cummin\s*\(/, /\.diff\s*\(/],
    keywords: [/\bcumulative\b/i, /\brunning (?:total|product)\b/i, /\bdiff\b/i],
  },
  {
    id: 'sorting',
    label: 'sorting and ranking',
    example: 'df.sort_values("a")',
    taughtIn: 'p07',
    requires: ['sort_values()', 'sort_index()', 'rank()'],
    uses: [/sort_values\s*\(/, /sort_index\s*\(/, /nlargest\s*\(/, /nsmallest\s*\(/, /\.rank\s*\(/],
    keywords: [/\bsort/i, /\brank/i, /\bnlargest\b/i],
  },
  {
    id: 'statistics',
    label: 'statistics and correlation',
    example: 'df.corr()',
    taughtIn: 'p07',
    requires: ['idxmax()', 'quantile()', 'corr()', 'kurt()', 'skew()'],
    uses: [/\.corr\s*\(/, /corrwith\s*\(/, /\.quantile\s*\(/, /idxmax\s*\(/, /\.skew\s*\(/, /\.kurt\s*\(/],
    keywords: [/\bcorrelat/i, /\bquantile/i, /\bskew/i, /\bkurtosis/i, /\bstatistic/i],
  },
  {
    id: 'missing',
    label: 'missing data',
    example: 'df.fillna(0)',
    taughtIn: 'p08',
    requires: ['fillna()', 'dropna()', 'bfill()', 'combine_first()'],
    uses: [
      /isna\s*\(/, /isnull\s*\(/, /fillna\s*\(/, /dropna\s*\(/, /ffill\s*\(/, /bfill\s*\(/,
      /interpolate\s*\(/, /combine_first\s*\(/,
    ],
    keywords: [/\bmissing\b/i, /\bfill/i, /\bdropna\b/i, /\binterpolat/i, /\bgaps?\b/i],
  },
  {
    id: 'cleaning',
    label: 'cleaning and de-duplication',
    example: 'df.drop_duplicates()',
    taughtIn: 'p09',
    requires: ['drop_duplicates()', 'rename()', 'replace()', 'unique()'],
    uses: [/drop_duplicates\s*\(/, /duplicated\s*\(/, /\.rename\s*\(/, /\.replace\s*\(/, /\.unique\s*\(/],
    keywords: [/\bduplicat/i, /\brename\b/i, /\bclean/i, /\breplace\b/i],
  },
  {
    id: 'strings',
    label: 'string operations',
    example: 's.str.lower()',
    taughtIn: 'p09',
    requires: ['lower()', 'title()', 'strip()', 'split()', 'cat()', 'zfill()', 'ljust()'],
    uses: [
      /\.str\./, /\.lower\s*\(/, /\.upper\s*\(/, /\.title\s*\(/, /\.strip\s*\(/, /\.split\s*\(/,
      /\.cat\s*\(/, /zfill\s*\(/, /ljust\s*\(/, /rjust\s*\(/,
    ],
    keywords: [/\bstrings?\b/i, /\bwhitespace\b/i, /\bregex\b/i, /\btext\b/i],
  },
  {
    id: 'io',
    label: 'import and export',
    example: 'pd.read_csv("file.csv")',
    taughtIn: 'p11',
    requires: ['read_csv()', 'to_json()'],
    uses: [
      /read_csv\s*\(/, /read_json\s*\(/, /read_sql\s*\(/, /read_excel\s*\(/, /to_csv\s*\(/,
      /to_json\s*\(/, /\bna_values\b/,
    ],
    keywords: [/\bread_csv\b/i, /\bto_csv\b/i, /\bjson\b/i, /\bimport/i, /\bexport/i],
  },
  {
    id: 'merge',
    label: 'merging and joining',
    example: 'left.merge(right, on="id")',
    taughtIn: 'p12',
    requires: ['merge()', 'join()', 'concat()'],
    uses: [/\.merge\s*\(/, /pd\.concat\s*\(/, /\.join\s*\(/],
    keywords: [/\bmerge/i, /\bjoin/i, /\bconcat/i],
  },
  {
    id: 'groupby',
    label: 'grouping and aggregation',
    example: 'df.groupby("a")["b"].sum()',
    taughtIn: 'p13',
    requires: ['agg()', 'size()', 'first()', 'ngroup()', 'transform()'],
    uses: [/groupby\s*\(/, /\.agg\s*\(/, /\.transform\s*\(/, /\.ngroup\s*\(/, /\.size\s*\(/],
    keywords: [/\bgroup ?by\b/i, /\baggregat/i, /\btransform\b/i],
  },
  {
    id: 'reshape',
    label: 'reshaping and pivoting',
    example: 'df.pivot_table(...)',
    taughtIn: 'p14',
    requires: ['melt()', 'pivot()', 'pivot_table()', 'crosstab()', 'unstack()'],
    uses: [
      /melt\s*\(/, /pivot_table\s*\(/, /\.pivot\s*\(/, /crosstab\s*\(/, /\.stack\s*\(/,
      /\.unstack\s*\(/, /explode\s*\(/, /get_dummies\s*\(/, /wide_to_long\s*\(/,
    ],
    keywords: [/\bpivot/i, /\bmelt/i, /\breshape/i, /\bcrosstab/i, /\bwide\b/i, /\bunstack\b/i],
  },
  {
    id: 'timeseries',
    label: 'time series and windows',
    example: 's.rolling(3).mean()',
    taughtIn: 'p15',
    requires: ['shift()'],
    uses: [/resample\s*\(/, /\.rolling\s*\(/, /\.shift\s*\(/, /asfreq\s*\(/, /\bDateOffset\b/],
    keywords: [/\bresampl/i, /\brolling\b/i, /\bshift\b/i, /\bwindows?\b/i, /\basfreq\b/i],
  },
  {
    id: 'multiindex',
    label: 'multi-level indexes',
    example: 'df.index.names',
    taughtIn: 'p16',
    requires: ['names'],
    uses: [/\bMultiIndex\b/, /\.xs\s*\(/, /swaplevel\s*\(/, /\.droplevel\s*\(/, /\.names\b/],
    keywords: [/\bmultiindex\b/i, /\blevels?\b/i],
  },
  {
    id: 'binning',
    label: 'binning and buckets',
    example: 'pd.cut(s, 3)',
    taughtIn: 'p17',
    requires: [],
    uses: [/\bpd\.cut\s*\(/, /\bpd\.qcut\s*\(/, /\bcut\s*\(/, /\bqcut\s*\(/],
    keywords: [/\bcut\b/i, /\bbins?\b/i, /\bbuckets?\b/i, /\bband\b/i],
  },
  {
    id: 'performance',
    label: 'memory and performance',
    example: 'df.eval("a + b")',
    taughtIn: 'p18',
    requires: ['eval()'],
    uses: [/\.eval\s*\(/, /memory_usage/, /chunksize/, /\.downcast/],
    keywords: [/\bmemory\b/i, /\bperformance\b/i, /\bchunk/i, /\beval\b/i, /\bdowncast/i],
  },
  {
    id: 'numpy',
    label: 'NumPy interoperability',
    example: 'df.to_numpy()',
    taughtIn: 'p19',
    requires: ['to_numpy()'],
    uses: [/to_numpy\s*\(/, /\bnp\.\w+/, /from_records\s*\(/],
    keywords: [/\bnumpy\b/i, /\bndarray\b/i, /\barray\b/i],
  },
];

/** `requires` label → family. Each label is authored once; a duplicate would make the map ambiguous. */
const REQUIRES_FAMILY = new Map();
for (const family of OPERATIONS) {
  if (!family.id || !family.label || !family.example) {
    throw new Error('pandas-coverage: every operation needs an id, label and example');
  }
  if (!/^p\d{2}$/.test(family.taughtIn || '')) {
    throw new Error(`pandas-coverage: ${family.id} needs a taughtIn module id`);
  }
  for (const requirement of family.requires) {
    if (REQUIRES_FAMILY.has(requirement)) {
      throw new Error(`pandas-coverage: ${requirement} is declared by both ${REQUIRES_FAMILY.get(requirement)} and ${family.id}`);
    }
    REQUIRES_FAMILY.set(requirement, family);
  }
}

const FAMILY_BY_ID = new Map(OPERATIONS.map((family) => [family.id, family]));

/** The family a task's authored `requires` label belongs to, or undefined. */
function familyOfRequires(requirement) {
  return REQUIRES_FAMILY.get(String(requirement ?? '').trim());
}

/** Every family a block of pandas code uses. Strings are stripped first. */
function operationsIn(code) {
  const text = stripStrings(code);
  return OPERATIONS.filter((family) => family.uses.some((pattern) => pattern.test(text)));
}

/** Families a topic mentions in its title or its verified sample. */
function operationsInTopic(topic) {
  const title = String(topic?.title ?? '');
  const code = stripStrings(topic?.code ?? '');
  return OPERATIONS.filter((family) => (
    family.keywords.some((pattern) => pattern.test(title)) ||
    family.uses.some((pattern) => pattern.test(code))
  ));
}

/** A debug challenge belongs to the families its broken code and its fix share; the fix is the fallback. */
function operationsInDebug(challenge) {
  const fixed = operationsIn(challenge?.fix);
  if (!fixed.length) return [];
  const broken = new Set(operationsIn(challenge?.broken).map((family) => family.id));
  const shared = fixed.filter((family) => broken.has(family.id));
  return shared.length ? shared : [fixed[0]];
}

const unique = (families) => [...new Set(families.map((family) => family.id))]
  .map((id) => FAMILY_BY_ID.get(id));

/**
 * Build the module × operation matrix.
 * @returns {{rows: Array, teaching: Array, operations: Array}}
 */
function buildCoverageMatrix(modules) {
  if (!Array.isArray(modules)) return { rows: [], teaching: [], operations: OPERATIONS };

  const rows = modules.map((module) => {
    const tasks = Array.isArray(module.tasks) ? module.tasks : [];
    const debug = Array.isArray(module.debug) ? module.debug : [];
    const topics = Array.isArray(module.topics) ? module.topics : [];

    const coding = unique(tasks.flatMap((task) => [
      ...(familyOfRequires(task?.requires) ? [familyOfRequires(task.requires)] : []),
      ...operationsIn(task?.solution),
    ]));
    const debugging = unique(debug.flatMap((challenge) => operationsInDebug(challenge)));
    const topicFamilies = unique(topics.flatMap((topic) => operationsInTopic(topic)));
    const taught = OPERATIONS.filter((family) => family.taughtIn === module.id);

    return {
      id: module.id,
      title: module.title,
      taught,
      topics: topicFamilies,
      coding,
      debug: debugging,
    };
  });

  return {
    rows,
    teaching: rows.map((row) => ({ id: row.id, taught: row.taught })),
    operations: OPERATIONS,
  };
}

/**
 * Problems that mean the course's operation map is incomplete or out of order. Empty means the
 * matrix is sound: every taught operation is tested where it is taught, nothing is used before it
 * is introduced, and every task's requirement belongs to a known family.
 *
 * @param {Array<{id?: string, topics?: Array, tasks?: Array, debug?: Array}>} modules
 * @returns {string[]}
 */
function validateOperationCoverage(modules) {
  if (!Array.isArray(modules)) return ['modules must be an array for the operation coverage check'];

  const problems = [];
  const fail = (message) => problems.push(message);
  const position = new Map(modules.map((module, index) => [module?.id, index]));
  const name = (family) => `${family.label} (${family.example})`;

  for (const family of OPERATIONS) {
    if (!position.has(family.taughtIn)) {
      fail(`${family.taughtIn}: ${name(family)} is declared as taught here, but the course has no such module`);
    }
  }

  for (const [index, module] of modules.entries()) {
    const moduleId = module?.id ?? `module ${index + 1}`;
    const tasks = Array.isArray(module?.tasks) ? module.tasks : [];
    const debug = Array.isArray(module?.debug) ? module.debug : [];
    const topics = Array.isArray(module?.topics) ? module.topics : [];

    for (const [taskIndex, task] of tasks.entries()) {
      const at = task?.title ? `task "${task.title}"` : `task ${taskIndex + 1}`;
      const requirement = String(task?.requires ?? '').trim();
      if (!requirement) {
        fail(`${moduleId}: ${at} has no "requires" — the coverage matrix cannot place it`);
        continue;
      }
      const family = familyOfRequires(requirement);
      if (!family) {
        fail(`${moduleId}: ${at} requires ${requirement}, which maps to no pandas operation family — add it to OPERATIONS in scripts/lib/pandas-coverage.cjs`);
        continue;
      }
      const taughtAt = position.get(family.taughtIn);
      if (taughtAt !== undefined && taughtAt > index) {
        fail(`${moduleId}: ${at} uses ${name(family)} via ${requirement}, taught only later in ${family.taughtIn} — move the task after that module or teach ${family.example} earlier`);
      }
    }

    const coding = new Set(tasks.flatMap((task) => [
      ...(familyOfRequires(task?.requires) ? [familyOfRequires(task.requires).id] : []),
      ...operationsIn(task?.solution).map((family) => family.id),
    ]));
    const debugging = new Set(debug.flatMap((challenge) => operationsInDebug(challenge).map((family) => family.id)));
    /* Grounding must be visible in the material itself — a topic, a task's code, or a drill — never
     * solely in a `requires` label, which would make the claim unfalsifiable. */
    const grounded = new Set([
      ...topics.flatMap((topic) => operationsInTopic(topic).map((family) => family.id)),
      ...tasks.flatMap((task) => operationsIn(task?.solution).map((family) => family.id)),
      ...debugging,
    ]);

    for (const family of OPERATIONS.filter((entry) => entry.taughtIn === moduleId)) {
      if (!coding.has(family.id) && !debugging.has(family.id)) {
        fail(`${moduleId}: no coding task or debug challenge tests ${name(family)}, which this module teaches — add a task that uses ${family.example}`);
      }
      if (!grounded.has(family.id)) {
        fail(`${moduleId}: ${name(family)} claims to be taught here, but no topic, task or debug challenge mentions it`);
      }
    }
  }

  return problems;
}

/**
 * The matrix as plain text: one block per module with the operations it teaches, its topics mention,
 * its coding tasks test, and its debug challenges exercise.
 */
function formatCoverageMatrix(modules) {
  const { rows, operations } = buildCoverageMatrix(modules);
  const label = (families) => (families.length ? families.map((family) => family.id).join(', ') : '—');
  const lines = [`operation coverage: ${rows.length} modules, ${operations.length} operation families`];
  for (const row of rows) {
    lines.push(
      `${row.id} ${row.title ?? ''}`.trim(),
      `  taught: ${label(row.taught)}`,
      `  topics: ${label(row.topics)}`,
      `  coding: ${label(row.coding)}`,
      `  debug:  ${label(row.debug)}`,
    );
  }
  return lines.join('\n');
}

module.exports = {
  OPERATIONS,
  REQUIRES_FAMILY,
  buildCoverageMatrix,
  validateOperationCoverage,
  formatCoverageMatrix,
  operationsIn,
  operationsInTopic,
  operationsInDebug,
  familyOfRequires,
  stripStrings,
};
