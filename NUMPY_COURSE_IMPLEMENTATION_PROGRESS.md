# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–8 delivered the architecture, two
depth passes, a grader, independent task banks and a verified debug lab.

## Shipped so far

| Measure | Phase 0 | Phase 2 | Phase 4 | Phase 6 | Phase 7 | Phase 8 (now) |
|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 2,260 | 2,340 | 2,600 | 2,360 | **2,440** |
| Authored topics | 60 | 240 | 240 | 240 | 240 | 240 |
| Debug challenges | 40 | 60 | 60 | 140 | 140 | 140 |
| Independent coding tasks | 0 | 0 | 80 | 260 | 260 | **340 (17/module)** |
| Guided (copyable) coding entries | 60 | 240 | 240 | 240 | 0 | **0** |
| Coding Lab entries | 60 | 240 | 320 | 500 | 260 | **340** |
| Coding Lab graded by hidden check | 0 | 0 | 80 | 260 | 260 | **340 (all)** |
| Debug challenges executed and checked | no | no | no | yes | yes | yes — 140 |
| Generator validation | passes | passes | passes | passes | passes | passes |

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator.
`scripts/numpy-fill-outputs.cjs` executes every sample, every task solution plus hidden check, and
every debug challenge (broken must raise or differ, fix must run).

### Phase 8 — a bigger independent bank

- Four new tasks per module in `tasks-4.json`, taking Coding Lab from 13 to **17 independent tasks
  per module (340 total)**. Every one carries its own data and a hidden check.
- No guided entries exist; the section is entirely work the learner has to produce.
- All reference outputs and checks are executed before publishing, and re-executed by the suite on
  every run.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 340 | 1,000 | 660 |
| Logic | 240 | 1,000 | 760 |
| Debug | 140 | 1,000 | 860 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,440** | **10,000** | **7,560** |

### Per module

Every module ships **122 entries**: 12 Learn, 24 Interview, 17 Coding (all independent), 12 Logic,
7 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint.

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids and duplicate question text are rejected by the generator per section.
- All 340 coding reference solutions and hidden checks are executed against real NumPy by the test
  suite whenever Python is present; a skip is reported when it is not, never a pass.
- Every debug challenge is executed: 133 raise, 7 are wrong-output lessons, and every fix runs.
- Coding Lab grades a real run against a hidden check. Progress needs all ten sections.

## Remaining work (phases 9+)

1. Raise independent coding tasks from 17 to 25+ per module; the bank is the section closest to target.
2. Author the interview and defense banks to 50 independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Raise Debug from 7 to 20+ per module; each new one is execution-verified the same way.
4. Add multi-choice distractors to Checkpoint instead of only "predict the output".
5. Raise authored topics beyond 12 per module and split the hardest modules.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
