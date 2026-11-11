# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phase 1 delivered the architecture plus a
uniform depth pass; volume is tracked openly below.

## Shipped so far

| Measure | Phase 0 | Phase 1 (now) |
|---|---|---|
| Modules | 20 | 20 |
| Sections per module | 10 | 10 |
| Entries published | 620 | **1,540** |
| Authored topics | 60 (3/module) | **160 (8/module)** |
| Debug challenges | 40 (2/module) | **60 (3/module)** |
| Mini projects | 20 | 20 |
| Project-lab milestones | 20 | 20 |
| Code/output pairs executed against numpy 2.5 | 60 | **160 (160/160 match)** |
| Generator validation | passes | passes |

Phase 1 added `content/numpy-mastery/deepening.json` — 100 new authored topics and 20 new debug
challenges — and `scripts/numpy-fill-outputs.cjs`, which **runs each sample and stores the real
stdout**. Nothing in the depth layer is a hand-guessed output: 100/100 samples executed cleanly.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 160 | 1,000 | 840 |
| Interview | 320 | 1,000 | 680 |
| Coding Lab | 160 | 1,000 | 840 |
| Logic | 160 | 1,000 | 840 |
| Debug | 60 | 1,000 | 940 |
| Practice Solutions | 160 | 1,000 | 840 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 160 | 1,000 | 840 |
| Checkpoint | 320 | 1,000 | 680 |
| **Total** | **1,540** | **10,000** | **8,460** |

### Per module

Every module now ships **77 entries**: 8 Learn, 16 Interview, 8 Coding, 8 Logic, 3 Debug, 8 Practice,
1 Mini Project, 1 Project Lab, 8 Defense, 16 Checkpoint. Difficulty cycles easy → medium → hard, so
no section is single-difficulty.

## What is real today

- Every entry is module-specific and projected from authored material (topic body, executed code,
  verified output, authored debug challenge).
- Duplicate ids, duplicate questions and duplicate topic titles are rejected by the generator, and
  `scripts/tests/ncourse.test.mjs` re-checks the published artifact against the merged source.
- All 160 Learn code samples are executed against real NumPy by the test suite whenever Python is
  present (it reports a skip, never a pass, when it is not).
- Progress: a module is complete only when all ten sections have a record.

## Remaining work (phases 2+)

1. Raise authored topics per module from 8 to 12+ and give each topic a coding task with real test
   cases, so Coding Lab can grade submissions instead of showing a reference answer.
2. Author the interview and defense banks to 50 real answers per module (currently derived from
   topics, so the same body reappears in three sections).
3. Author 50 debug challenges per module (currently 3) and 50 mini-project variants (currently 1).
4. Add graded checkpoints (option distractors, not only "predict the output").
5. Wire per-module notebooks for Code Bro when a module lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
