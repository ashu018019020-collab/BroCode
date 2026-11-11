# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total); this batch ships the full architecture and a
first real content pass.

## Shipped in this batch

| Measure | Value |
|---|---|
| Modules | 20 |
| Sections per module | 10 (all present, none empty) |
| Entries published | **620** |
| Authored topics | 60 (3 per module) |
| Debug challenges | 40 (2 per module) |
| Mini projects | 20 |
| Project-lab milestones | 20 |
| Code/output pairs executed against numpy 2.5 | 60/60 match |
| Generator validation | passes (`node scripts/numpy-course.cjs`) |

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 60 | 1,000 | 940 |
| Interview | 120 | 1,000 | 880 |
| Coding Lab | 60 | 1,000 | 940 |
| Logic | 60 | 1,000 | 940 |
| Debug | 40 | 1,000 | 960 |
| Practice Solutions | 60 | 1,000 | 940 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 60 | 1,000 | 940 |
| Checkpoint | 120 | 1,000 | 880 |
| **Total** | **620** | **10,000** | **9,380** |

### Per module

Every module ships **31 entries**: 3 Learn, 6 Interview, 3 Coding, 3 Logic, 2 Debug, 3 Practice,
1 Mini Project, 1 Project Lab, 3 Defense, 6 Checkpoint — each with Easy/Medium/Hard cycling, so no
section is single-difficulty.

## What is real today

- Every entry is module-specific and generated from authored material (topic body, executed code,
  verified output, authored debug challenge).
- Duplicate ids/questions are rejected by the generator and by `scripts/tests/ncourse.test.mjs`.
- The Learn code samples are executed against real NumPy in the test suite when Python is present.
- Progress: a module is complete only when all ten sections have a record.

## Remaining work (next batches)

1. Grow each module's authored topic list from 3 to 12+, and add authored per-topic coding tasks,
   logic variants and checkpoint distractors (target: 20 easy / 20 medium / 10 hard per section).
2. Author 50+ real interview answers and 50+ defense prompts per module.
3. Add real test cases (stdin/expected) to Coding Lab so submissions can be graded, not just viewed.
4. Add the NumPy pack to the owner content page once counts reach the publishing threshold.
5. Wire per-module notebooks for Code Bro when the module lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
