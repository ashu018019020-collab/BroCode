# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–14 delivered the architecture, two
depth passes, a grader, independent task banks, a verified debug lab, interactive checkpoints,
written checkpoints with rubrics, and authored interview/defense answers.

## Shipped so far

| Measure | Phase 10 | Phase 11 | Phase 12 | Phase 13 | Phase 14 (now) |
|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 |
| Entries published | 2,440 | 2,440 | 2,600 | 2,660 | **2,780** |
| Independent coding tasks | 340 | 340 | 500 | 500 | 500 |
| Debug challenges per module | 7 | 7 | 7 | 10 | 10 |
| Authored interview answers | 0 | 0 | 0 | 0 | **60** |
| Authored defense answers | 0 | 0 | 0 | 0 | **60** |
| Checkpoint quizzes / written | 240 / 240 | 240 / 240 | 240 / 240 | 240 / 240 | 240 / 240 |
| Written drafts persisted per entry | no | yes | yes | yes | yes |
| Generator validation | passes | passes | passes | passes | passes |

### Phase 14 — interview and defense answers written for their own section

- Every module now carries **three authored interview questions** and **three authored defense
  prompts** in `content/numpy-mastery/deepening-5.json` — 120 answers total. They are merged through
  the same `deepening*.json` layer the topics and debug challenges use, so authored source stays the
  only place content lives.
- Each answer is written for the section it appears in: a real interview question ("Why solve a
  system instead of multiplying by the inverse?", "What does a zero determinant tell you?", "How do
  you prove two arrays share memory?") and a real defense challenge ("Defend least squares over the
  normal equations", "Explain how text round-trips lose precision").
- A new test asserts every authored question is published with its authored answer **and that no
  authored answer is a copied Learn body**, which is the exact defect this phase exists to remove.
- The derived topic-backed questions remain in place for now; they are the next 460 interview and 700
  defense records the ledger still counts as remaining.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 540 | 1,000 | 460 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 240 | 1,000 | 760 |
| Debug | 200 | 1,000 | 800 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 300 | 1,000 | 700 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,780** | **10,000** | **7,220** |

### Per module

Every module ships **139 entries**: 12 Learn, 27 Interview (24 topic-backed + 3 authored), 25 Coding
(all independent), 12 Logic, 10 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 15 Defense (12
topic-backed + 3 authored), 24 Checkpoint (12 quizzes, 12 written with rubrics).

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

## Remaining work (phases 15+)

1. Replace the remaining topic-backed interview and defense questions with authored answers.
2. Raise Debug from 10 to 20+ per module.
3. Raise authored topics beyond 12 per module and split the hardest modules.
4. Grow Mini Project and Project Lab beyond one record per module.
5. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
