# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–6 delivered the architecture, two
depth passes, a grader, an independent task bank and a verified debug lab; volume is tracked openly.

## Shipped so far

| Measure | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 6 (now) |
|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 1,540 | 2,260 | 2,260 | 2,340 | **2,600** |
| Authored topics | 60 | 160 | 240 | 240 | 240 | 240 |
| Debug challenges | 40 | 60 | 60 | 60 | 60 | **140 (7/module)** |
| Independent coding tasks | 0 | 0 | 0 | 0 | 80 | **260 (13/module)** |
| Coding Lab entries | 60 | 160 | 240 | 240 | 320 | **500** |
| Code/output pairs executed against numpy | 60 | 160 | 240 | 240 | 320 | 500 |
| Coding Lab graded | no | no | no | yes | yes | yes — hidden checks |
| Debug challenges executed and checked | no | no | no | no | no | **yes — 140 (133 raise, 7 wrong-output)** |
| Generator validation | passes | passes | passes | passes | passes | passes |

The phase-5 pass was interrupted after authoring its task banks; phase 6 finished that execution and
verification as part of the same green build, so both appear together below.

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator.
`scripts/numpy-fill-outputs.cjs` **runs each sample and stores the real stdout**, runs every task's
solution plus hidden check, and now runs every debug challenge twice: the broken code must raise (its
real error line is stored) and the fix must run clean.

### Phase 6 — debug challenges that are true failures

- 80 new challenges (4 per module) in `deepening-3.json`, on top of the existing 3 per module.
- Each one is executed by the fill step: if the broken code **does not raise**, the run fails and the
  challenge cannot publish; the stored `error` is the interpreter's own last stderr line, not prose.
- The fix is executed too, so a "fix" that still raises is rejected.
- Across the whole Debug section (140), the suite also checks that every fix runs and that broken
  code either raises or prints a different result than the fix: 133 raise, 7 are wrong-output
  lessons (a wrong `mean`, a method that returns `None`, an alias that mutates its source).
- This caught four broken samples that did not actually fail (`np.where` with one argument is valid,
  `np.lexsort` accepts a single key array, `np.nan_to_num` passes text through, and `einsum` labels
  are arbitrary names, not positions) plus one duplicate title against the original module pack.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 240 | 1,000 | 760 |
| Debug | 140 | 1,000 | 860 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,600** | **10,000** | **7,400** |

### Per module

Every module ships **130 entries**: 12 Learn, 24 Interview, 25 Coding (12 guided + 13 independent
tasks), 12 Logic, 7 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint.

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids and duplicate question text are rejected by the generator per section.
- All 500 coding reference solutions and 260 hidden checks are executed against real NumPy by the
  test suite whenever Python is present; a skip is reported when it is not, never a pass.
- Every debug challenge is proven to fail and its fix proven to run.
- Coding Lab grades a real run: guided entries against printed output, independent tasks against a
  hidden check. Progress needs all ten sections.

## Remaining work (phases 7+)

1. Raise independent coding tasks from 13 to 20+ per module so guided copies are a small minority.
2. Author the interview and defense banks to 50 independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Raise Debug from 7 to 20+ per module; each new one is execution-verified the same way.
4. Add multi-choice distractors to Checkpoint instead of only "predict the output".
5. Raise authored topics beyond 12 per module and split the hardest modules.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
