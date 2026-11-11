# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–10 delivered the architecture, two
depth passes, a grader, independent task banks, a verified debug lab, checkpoint quizzes and written
checkpoints with rubrics.

## Shipped so far

| Measure | Phase 0 | Phase 2 | Phase 7 | Phase 8 | Phase 9 | Phase 10 (now) |
|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 2,260 | 2,360 | 2,440 | 2,440 | **2,440** |
| Independent coding tasks | 0 | 0 | 260 | 340 | 340 | 340 |
| Guided (copyable) coding entries | 60 | 240 | 0 | 0 | 0 | 0 |
| Debug challenges executed and checked | no | no | yes | yes | yes | yes — 140 |
| Checkpoint quizzes (3 options) | 0 | 0 | 0 | 0 | 240 | 240 |
| Written checkpoints with rubrics | 0 | 0 | 0 | 0 | 0 | **240** |
| Generator validation | passes | passes | passes | passes | passes | passes |

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator.
`scripts/numpy-fill-outputs.cjs` executes every sample, every task solution plus hidden check, and
every debug challenge.

### Phase 10 — written checkpoints you can actually grade yourself

- The 240 written checkpoints now carry a **three-line rubric**, built from the topic's own title and
  its executed output: name the operation, mention the concrete values or shape, explain the dtype /
  axis / shape reasoning. Nothing is generic filler — the middle line quotes the real printed result.
- The learner must write at least a sentence **before** the model answer can be revealed, and the
  section can only be recorded once all three criteria are ticked. Writing nothing and clicking
  through no longer marks it done.
- The generator rejects a rubric with fewer than three lines or a blank line; a test re-checks all of
  them.

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
7 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint (12 quizzes, 12
written with rubrics).

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids and duplicate question text are rejected by the generator per section.
- All 340 coding reference solutions and hidden checks are executed against real NumPy by the test
  suite whenever Python is present; a skip is reported when it is not, never a pass.
- Every debug challenge is executed: 133 raise, 7 are wrong-output lessons, and every fix runs.
- Every quiz offers three distinct real outputs; every written checkpoint has three real criteria.
- Progress needs all ten sections, and written checkpoints need writing plus all criteria.

## Remaining work (phases 11+)

1. Raise independent coding tasks from 17 to 25+ per module.
2. Author the interview and defense banks to 50 independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Raise Debug from 7 to 20+ per module; each new one is execution-verified the same way.
4. Persist written checkpoint answers per entry instead of only marking the section complete.
5. Raise authored topics beyond 12 per module and split the hardest modules.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
