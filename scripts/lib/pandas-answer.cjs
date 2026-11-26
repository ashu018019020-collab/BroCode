/**
 * pandas-answer.cjs — anti-constant guard for the Coding Lab of the Pandas Mastery course.
 *
 * The fixture guard proves each task runs from its starter and prints its stored output. That is
 * not enough: a solution whose whole body is `print("[2, 6, 24]")` satisfies it. This guard adds
 * two hidden checks, both read from the Python AST rather than from the task's prose:
 *
 *   · the answer must use the task's declared `requires` operation on the starter's fixture;
 *   · what it prints must depend on that fixture — a bare constant, or a fresh Series built from
 *     literals, is rejected.
 *
 * `requires` is authored per task and is not published to the artifact (the generator maps task
 * fields explicitly), so learners never see the contract. Failure messages always name the
 * operation, e.g. `p06: task "Cumulative product" never uses its required pandas operation
 * cumprod()`.
 *
 * The exact-output comparison stays in pandas-fixture.cjs and is not weakened here: this guard
 * only adds conditions, it never replaces execution.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

/** The interpreter CI and local runs use; Windows CI sets PYTHON=python. */
const PYTHON = process.env.PYTHON || 'python3';

const PY_ANALYZER = `import ast, json, sys

# The operations this course teaches. A requirement is chosen from this vocabulary so a failure
# names a real pandas API, never a Python builtin that happened to wrap it.
PANDAS_API = set("""
DataFrame Series Timestamp CategoricalDtype NA
mean median sum min max prod std var count nunique size sem skew kurt quantile describe corr corrwith cov
idxmax idxmin rank value_counts unique nlargest nsmallest cumsum cumprod diff pct_change shift rolling expanding ewm
clip round abs astype fillna ffill bfill dropna interpolate isna notna isnull notnull drop drop_duplicates duplicated
replace rename rename_axis set_index reset_index reindex reindex_like sort_values sort_index
groupby agg aggregate transform apply map applymap filter where mask query eval assign pipe
merge join concat merge_asof combine_first update compare pivot pivot_table melt stack unstack crosstab get_dummies
explode squeeze transpose T at iat loc iloc between isin select_dtypes infer_objects convert_dtypes memory_usage
insert pop items __getitem__ iterrows itertuples to_dict tolist to_string to_csv to_json to_numpy to_markdown
to_period to_timestamp read_csv read_table read_sql read_json json_normalize date_range bdate_range
to_datetime to_numeric to_timedelta str dt cat get dtypes dtype columns shape size index values names name levels ndim empty
strftime total_seconds days seconds year month day hour minute quarter dayofweek day_name month_name week
strip lower upper title casefold contains startswith endswith match findall extract split rsplit cat ljust rjust zfill
pad slice repeat ngroup first last head tail sample take xs droplevel add sub mul div truediv floordiv
mod pow radd rsub rmul rdiv dot gt ge lt le eq ne copy bool any all
""".split())
# A formatter is still pandas, but it only renders a result; prefer the operation that makes it.
FORMATTERS = {'tolist', 'to_string', 'to_dict', 'to_csv', 'to_json', 'to_numpy', 'to_markdown'}
PLUMBING = {'index', 'columns', 'shape', 'size', 'dtypes', 'T', 'name', 'names', 'levels', 'values', 'dtype'}
ACCESSORS = {'dt', 'str', 'cat'}


def collect(tree, taint, source):
    """Calls, attributes and subscripts in source order, with fixture-dependence attached."""
    ops, print_args, seen = [], [], set()

    def refs(node):
        return any(isinstance(n, ast.Name) and n.id in taint for n in ast.walk(node))

    def add(name, label, kind, tainted):
        key = (label, kind, source)
        if key in seen:
            return
        seen.add(key)
        ops.append({'name': name, 'label': label, 'kind': kind, 'tainted': tainted, 'source': source})

    class Visitor(ast.NodeVisitor):
        def visit_Call(self, node):
            target = node.func
            if isinstance(target, ast.Attribute):
                tainted = refs(target.value) or any(refs(a) for a in node.args)
                add(target.attr, target.attr + '()', 'method', tainted)
            elif isinstance(target, ast.Name) and target.id == 'print':
                print_args.extend(node.args)
            self.generic_visit(node)

        def visit_Attribute(self, node):
            if isinstance(node.ctx, ast.Load) and node.attr not in ACCESSORS:
                add(node.attr, node.attr, 'attr', refs(node.value))
            self.generic_visit(node)

        def visit_Subscript(self, node):
            if isinstance(node.ctx, ast.Load):
                add('__getitem__', '__getitem__()', 'getitem', refs(node.value))
            self.generic_visit(node)

    Visitor().visit(tree)
    return ops, print_args, refs


def analyze(starter, solution):
    try:
        starter_tree = ast.parse(starter)
        full_tree = ast.parse(solution)
    except SyntaxError as error:
        return {'error': 'SyntaxError: ' + str(error)}

    # The answer is exactly the statements the solution adds after the starter's fixture.
    answer_tree = ast.Module(body=full_tree.body[len(starter_tree.body):], type_ignores=[])

    # Fixture names are what the starter binds; an imported module is not fixture data, so a
    # solution that builds a Series out of literals cannot ride on the pd import to look genuine.
    taint = {
        node.id
        for node in ast.walk(starter_tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store)
    }
    for _ in range(6):
        changed = False
        for node in ast.walk(answer_tree):
            if not isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                continue
            value = node.value
            if value is None:
                continue
            if any(isinstance(n, ast.Name) and n.id in taint for n in ast.walk(value)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for target in targets:
                    for name in ast.walk(target):
                        if isinstance(name, ast.Name) and isinstance(name.ctx, ast.Store) and name.id not in taint:
                            taint.add(name.id)
                            changed = True
        if not changed:
            break

    answer_ops, print_args, refs = collect(answer_tree, taint, 'answer')
    starter_ops, _, _ = collect(starter_tree, taint, 'starter')
    printed_tainted = any(refs(arg) for arg in print_args)

    def rank(ops):
        calls = [o for o in ops if o['kind'] in ('method', 'func', 'getitem')]
        api = [o for o in calls if o['name'] in PANDAS_API]
        tiers = [
            [o for o in api if o['name'] not in FORMATTERS and o['tainted']],
            [o for o in api if o['name'] not in FORMATTERS],
            [o for o in api if o['tainted']],
            api,
            [o for o in ops if o['kind'] == 'attr' and o['name'] not in PLUMBING and o['tainted']],
            [o for o in ops if o['kind'] == 'attr' and o['name'] not in PLUMBING],
            [o for o in ops if o['kind'] == 'attr'],
        ]
        for tier in tiers:
            if tier:
                return tier[0]
        return None

    requirement = rank(answer_ops) or rank(starter_ops)
    return {
        'answerOps': answer_ops,
        'starterOps': starter_ops,
        'printedTainted': printed_tainted,
        'printCount': len(print_args),
        'requires': requirement['label'] if requirement else None,
        'requiresKind': requirement['kind'] if requirement else None,
        'requiresSource': requirement['source'] if requirement else None,
    }


samples = json.load(open(sys.argv[1]))
json.dump([analyze(s['starter'], s['solution']) for s in samples], open(sys.argv[2], 'w'))
`;

/** Analyse every sample with one interpreter per module; AST parsing is the only work done. */
function analyzeSolutions(samples) {
  const results = new Map();
  if (!samples.length) return results;

  const groups = new Map();
  for (const sample of samples) {
    if (!groups.has(sample.module)) groups.set(sample.module, []);
    groups.get(sample.module).push(sample);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pandas-answer-'));
  try {
    const analyzer = path.join(tmp, 'analyze.py');
    fs.writeFileSync(analyzer, PY_ANALYZER, 'utf8');
    for (const [module, group] of groups) {
      const input = path.join(tmp, 'samples.json');
      const output = path.join(tmp, 'analysis.json');
      fs.writeFileSync(
        input,
        JSON.stringify(group.map((s) => ({ starter: s.starter, solution: s.solution }))),
        'utf8',
      );
      try {
        execFileSync(PYTHON, [analyzer, input, output], {
          encoding: 'utf8',
          timeout: 60000,
          stdio: ['ignore', 'ignore', 'pipe'],
        });
      } catch (error) {
        const detail = String(error.stderr || error.message || error).trim().split('\n').pop();
        throw new Error(`could not parse the coding tasks for ${module}: ${detail}`);
      }
      const parsed = JSON.parse(fs.readFileSync(output, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length !== group.length) {
        throw new Error(`the AST analyzer returned ${parsed.length} result(s) for ${group.length} task(s)`);
      }
      group.forEach((sample, index) => results.set(sample.key, parsed[index]));
    }
    return results;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** The operation as it should read in a failure message. */
function describeRequirement(label) {
  return label === '__getitem__()' ? '__getitem__() (df[...] selection)' : label;
}

/**
 * Validate every task's answer against its declared pandas operation. Returns human-readable
 * problems; an empty array means no constant print can pass the Coding Lab. `analyze` is
 * injectable for tests and defaults to the real Python AST analyzer.
 */
function validateTaskAnswers(modules, options = {}) {
  const problems = [];
  const fail = (message) => problems.push(message);
  const samples = [];

  for (const module of modules) {
    const tasks = Array.isArray(module.tasks) ? module.tasks : [];
    for (const [index, task] of tasks.entries()) {
      if (!task || !task.starter || !task.solution) continue;
      const at = `${module.id}: task "${task.title || index + 1}"`;
      if (!task.requires || !String(task.requires).trim()) {
        fail(`${at} has no "requires" — declare the pandas operation the answer teaches (e.g. "cumprod()") so a constant print cannot pass`);
        continue;
      }
      samples.push({ key: `${module.id}:${index}`, module: module.id, starter: task.starter, solution: task.solution });
    }
  }

  let results;
  try {
    results = (options.analyze || analyzeSolutions)(samples);
  } catch (error) {
    fail(`AST analysis failed: ${error.message}`);
    return problems;
  }

  for (const module of modules) {
    const tasks = Array.isArray(module.tasks) ? module.tasks : [];
    for (const [index, task] of tasks.entries()) {
      if (!task || !task.starter || !task.solution || !task.requires) continue;
      const at = `${module.id}: task "${task.title || index + 1}"`;
      const required = describeRequirement(task.requires);
      const analysis = results.get(`${module.id}:${index}`);
      if (!analysis) {
        fail(`${at} has no AST result`);
        continue;
      }
      if (analysis.error) {
        fail(`${at} could not be parsed for the pandas AST check: ${analysis.error}`);
        continue;
      }

      const ops = [...(analysis.answerOps || []), ...(analysis.starterOps || [])];
      const used = ops.find((op) => op.label === task.requires);
      if (!used) {
        fail(`${at} never uses its required pandas operation ${required} — a constant print cannot pass`);
        continue;
      }
      if (used.source === 'answer' && !used.tainted) {
        fail(`${at} calls ${required} on data that is not the starter's fixture — compute it from the fixture, not a new literal`);
        continue;
      }

      if (!analysis.printCount) {
        fail(`${at} never prints its result — expected pandas operation ${required}`);
        continue;
      }
      if (!analysis.printedTainted) {
        fail(`${at} prints a constant and never reads its fixture — compute the output with its required pandas operation ${required}`);
      }
    }
  }

  return problems;
}

module.exports = { analyzeSolutions, describeRequirement, validateTaskAnswers };
