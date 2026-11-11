# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–4 delivered the architecture, two
depth passes, a grader and an independent task bank; volume is tracked openly below.

## Shipped so far

| Measure | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 (now) |
|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 1,540 | 2,260 | 2,260 | **2,340** |
| Authored topics | 60 | 160 | 240 (12/module) | 240 | 240 |
| Debug challenges | 40 | 60 | 60 | 60 | 60 |
| Mini projects | 20 | 20 | 20 | 20 | 20 |
| Independent coding tasks | 0 | 0 | 0 | 0 | **80 (4/module)** |
| Coding Lab entries | 60 | 160 | 240 | 240 | **320** |
| Code/output pairs executed against numpy | 60 | 160 | 240 | 240 | 320 |
| Coding Lab graded | no | no | no | yes | yes — with hidden checks |
| Generator validation | passes | passes | passes | passes | passes |

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator
(`deepening.json`, then `deepening-2.json`). `scripts/numpy-fill-outputs.cjs` **runs each sample and
stores the real stdout**; it also runs every task's solution *and its hidden check*, so a task whose
own reference fails its check cannot publish.

### Phase 4 — independence, not copying

- `content/numpy-mastery/tasks.json` holds 80 authored tasks (4 per module), each posed with its own
  data and a **hidden check** (`assert result == 43`, array equality, tolerance for floats).
- Grading runs the learner's code, then runs the check **in the same kernel namespace**. The check
  asserts on the variable the statement asks for, so re-running the taught lesson snippet defines
  nothing and fails — matching output is no longer enough to pass.
- Tasks are published as `kind: 'task'` entries inside Coding Lab (12 guided + 4 independent per
  module), so the section grew from 240 to 320 entries without touching any other section.
- Verification runs on **numpy 1.26.4 + pandas 2.2.0** (the bundled browser runtime) as well as
  numpy 2.5: 320/320 coding cases match, every reference solution passes its own hidden check.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 320 | 1,000 | 680 |
| Logic | 240 | 1,000 | 760 |
| Debug | 60 | 1,000 | 940 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,340** | **10,000** | **7,660** |

### Per module

Every module now ships **117 entries**: 12 Learn, 24 Interview, 16 Coding (12 guided + 4 independent),
12 Logic, 3 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint. Difficulty
cycles easy → medium → hard, so no section is single-difficulty.

## What is real today

- Every entry is module-specific and projected from authored material (topic body, executed code,
  verified output, authored debug challenge, authored task with check).
- Duplicate ids, duplicate questions and duplicate topic titles are rejected by the generator, and
  `scripts/tests/ncourse.test.mjs` re-checks the published artifact against the merged source.
- All 320 coding reference solutions are executed against real NumPy by the test suite whenever
  Python is present (it reports a skip, never a pass, when it is not), and every task's hidden check
  must accept its own reference solution.
- Coding Lab grades a real run: guided entries against the printed output, independent tasks against
  the hidden check.
- Progress: a module is complete only when all ten sections have a record.

## Remaining work (phases 5+)

1. Only 4 of the 16 coding entries per module are independent tasks; raise that to 12+ so guided
   practice is the minority.
2. Author the interview and defense banks to 50 independent answers per module. They are currently
   derived from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Author 50 debug challenges per module (currently 3) and 50 mini-project variants (currently 1).
4. Add multi-choice distractors to Checkpoint instead of only "predict the output".
5. Raise authored topics per module beyond 12 and split the hardest modules into two.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
