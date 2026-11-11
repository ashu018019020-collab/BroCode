# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–9 delivered the architecture, two
depth passes, a grader, independent task banks, a verified debug lab and checkpoint quizzes.

## Shipped so far

| Measure | Phase 0 | Phase 2 | Phase 6 | Phase 7 | Phase 8 | Phase 9 (now) |
|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 2,260 | 2,600 | 2,360 | 2,440 | **2,440** |
| Independent coding tasks | 0 | 0 | 260 | 260 | 340 | 340 |
| Guided (copyable) coding entries | 60 | 240 | 240 | 0 | 0 | 0 |
| Debug challenges executed and checked | no | no | yes | yes | yes | yes — 140 |
| Checkpoint quizzes (3 options) | 0 | 0 | 0 | 0 | 0 | **240** |
| Code/output pairs executed against numpy | 60 | 240 | 500 | 260 | 340 | 340 |
| Generator validation | passes | passes | passes | passes | passes | passes |

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator.
`scripts/numpy-fill-outputs.cjs` executes every sample, every task solution plus hidden check, and
every debug challenge (broken must raise or differ, fix must run).

### Phase 9 — checkpoints you can answer

- Half of every Checkpoint section (the "predict the output" half) is now a **multiple-choice quiz**:
  240 questions, each offering three options.
- Distractors are **real outputs of other topics in the same module**, taken from the executed pack —
  never hand-written text. The correct answer is always present, the options are distinct, and the
  answer position rotates with the question title so it is not always first.
- The generator rejects a quiz that lacks the answer or repeats an option; a test re-checks all 240.
- The card grades on click: the right option records the section, a wrong one keeps the question open
  and offers the answer.

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
7 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint (12 of them quizzes).

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids and duplicate question text are rejected by the generator per section.
- All 340 coding reference solutions and hidden checks are executed against real NumPy by the test
  suite whenever Python is present; a skip is reported when it is not, never a pass.
- Every debug challenge is executed: 133 raise, 7 are wrong-output lessons, and every fix runs.
- Every checkpoint quiz offers three distinct real outputs and includes the answer.
- Coding Lab grades a hidden check; Checkpoint grades the chosen option. Progress needs all ten
  sections.

## Remaining work (phases 10+)

1. Raise independent coding tasks from 17 to 25+ per module.
2. Author the interview and defense banks to 50 independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Raise Debug from 7 to 20+ per module; each new one is execution-verified the same way.
4. Turn the written half of Checkpoint into authored short-answer rubrics instead of "in your own
   words" prompts.
5. Raise authored topics beyond 12 per module and split the hardest modules.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
