# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–15 delivered the architecture, two
depth passes, a grader, independent task banks, a verified debug lab, interactive checkpoints,
written checkpoints with rubrics, and two authored interview/defense passes.

## Shipped so far

| Measure | Phase 11 | Phase 12 | Phase 13 | Phase 14 | Phase 15 (now) |
|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 |
| Entries published | 2,440 | 2,600 | 2,660 | 2,780 | **2,900** |
| Independent coding tasks | 340 | 500 | 500 | 500 | 500 |
| Debug challenges per module | 7 | 7 | 10 | 10 | 10 |
| Authored interview answers | 0 | 0 | 0 | 60 | **90** |
| Authored defense answers | 0 | 0 | 0 | 60 | **90** |
| Checkpoint quizzes / written | 240 / 240 | 240 / 240 | 240 / 240 | 240 / 240 | 240 / 240 |
| Written drafts persisted per entry | yes | yes | yes | yes | yes |
| Generator validation | passes | passes | passes | passes | passes |

### Phase 15 — a second authored interview and defense pass

- `content/numpy-mastery/deepening-6.json` adds **three more questions and three more defenses per
  module** — 120 answers, taking authored coverage to 6 interview and 6 defense answers per module
  (90 + 90 across the course).
- The new questions probe judgement rather than definitions: *"What do you gain and lose with
  `int8`?"*, *"Why does a slice avoid copying memory?"*, *"Is `np.add(a, b)` different from `a + b`?"*,
  *"How do you draw reproducible batches in a loop?"*.
- The defenses force a position and a cost: *"Defend copying a function argument before mutating it"*,
  *"Explain why `np.vectorize` does not make code fast"*, *"Defend storing a factorisation instead of
  an inverse"*, *"Defend a memory budget when choosing a vectorised path"*.
- They merge through the same deepening layer, so no generator change was needed; the existing test
  still enforces that every authored answer is published and is never a copied Learn body.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 600 | 1,000 | 400 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 240 | 1,000 | 760 |
| Debug | 200 | 1,000 | 800 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 360 | 1,000 | 640 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,900** | **10,000** | **7,100** |

### Per module

Every module ships **145 entries**: 12 Learn, 30 Interview (24 topic-backed + 6 authored), 25 Coding
(all independent), 12 Logic, 10 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 18 Defense (12
topic-backed + 6 authored), 24 Checkpoint (12 quizzes, 12 written with rubrics).

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids, duplicate debug titles per module and duplicate question text are rejected by the
  generator; task titles are scanned across all banks.
- All 500 coding reference solutions and hidden checks are executed on numpy 2.x and on the 1.26
  build the browser runtime ships.
- All 200 debug challenges are executed on both runtimes: 193 raise, 7 are wrong-output lessons.
- Every quiz offers three distinct real outputs; every written checkpoint has three real criteria.
- Written drafts and rubric ticks are stored per entry and survive a refresh.
- Authored interview and defense answers are verified to differ from Learn bodies.

## Remaining work (phases 16+)

1. Replace the remaining topic-backed interview and defense questions with authored answers.
2. Raise Debug from 10 to 20+ per module.
3. Raise authored topics beyond 12 per module and split the hardest modules.
4. Grow Mini Project and Project Lab beyond one record per module.
5. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
