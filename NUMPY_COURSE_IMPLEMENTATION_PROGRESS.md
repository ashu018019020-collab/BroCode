# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1 and 2 delivered the architecture plus
two depth passes; volume is tracked openly below.

## Shipped so far

| Measure | Phase 0 | Phase 1 | Phase 2 (now) |
|---|---|---|---|
| Modules | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 |
| Entries published | 620 | 1,540 | **2,260** |
| Authored topics | 60 (3/module) | 160 (8/module) | **240 (12/module)** |
| Debug challenges | 40 (2/module) | 60 (3/module) | 60 (3/module) |
| Mini projects | 20 | 20 | 20 |
| Project-lab milestones | 20 | 20 | 20 |
| Code/output pairs executed against numpy 2.5 | 60 | 160 | **240 (240/240 match)** |
| Generator validation | passes | passes | passes |

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator
(`deepening.json`, then `deepening-2.json`). `scripts/numpy-fill-outputs.cjs` **runs each sample and
stores the real stdout**, skipping the ones already verified: 180/180 new samples executed cleanly in
this pass.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 240 | 1,000 | 760 |
| Logic | 240 | 1,000 | 760 |
| Debug | 60 | 1,000 | 940 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,260** | **10,000** | **7,740** |

### Per module

Every module now ships **113 entries**: 12 Learn, 24 Interview, 12 Coding, 12 Logic, 3 Debug,
12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint. Difficulty cycles
easy → medium → hard, so no section is single-difficulty.

## What is real today

- Every entry is module-specific and projected from authored material (topic body, executed code,
  verified output, authored debug challenge).
- Duplicate ids, duplicate questions and duplicate topic titles are rejected by the generator, and
  `scripts/tests/ncourse.test.mjs` re-checks the published artifact against the merged source.
- All 240 Learn code samples are executed against real NumPy by the test suite whenever Python is
  present (it reports a skip, never a pass, when it is not).
- Progress: a module is complete only when all ten sections have a record.

## Remaining work (phases 3+)

1. Give Coding Lab a real grader: an authored test case per task (stdin/expected) instead of a
   reference solution, so a learner's code can pass or fail.
2. Author the interview and defense banks to 50 independent answers per module. They are currently
   derived from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Author 50 debug challenges per module (currently 3) and 50 mini-project variants (currently 1).
4. Add multi-choice distractors to Checkpoint instead of only "predict the output".
5. Raise authored topics per module beyond 12 and split the hardest modules into two.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
