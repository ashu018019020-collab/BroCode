# NumPy Mastery — implementation progress

Honest ledger. Counts are **records that shipped**, not targets. The brief's target is 50 entries per
section (500 per module, 10,000 total). Phases 1–16 built the architecture, two depth passes, a
grader, independent task banks, a verified debug lab, interactive and written checkpoints, three
authored interview/defense passes, and removed every entry that quoted a Learn body.

## Shipped so far

| Measure | Phase 12 | Phase 13 | Phase 14 | Phase 15 | Phase 16 (now) |
|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 |
| Entries published | 2,600 | 2,660 | 2,780 | 2,900 | **2,540** |
| Independent coding tasks | 500 | 500 | 500 | 500 | 500 |
| Debug challenges per module | 7 | 10 | 10 | 10 | 10 |
| Authored interview answers per module | 0 | 0 | 3 | 6 | **9** |
| Authored defense answers per module | 0 | 0 | 3 | 6 | **9** |
| Answers copied from a Learn body | 480 | 480 | 420 | 360 | **0** |
| Checkpoint quizzes / written | 240 / 240 | 240 / 240 | 240 / 240 | 240 / 240 | 240 / 240 |
| Generator validation | passes | passes | passes | passes | passes |

### Phase 16 — the body-copying entries are gone

- The generator used to publish two entries per topic whose **answer was the Learn body**: an
  interview "What is X, and when would you use it?" and a defense "Explain X…". That is why one
  sentence appeared in Learn, Interview, Practice and Defense.
- Both derivations are **removed** from `scripts/numpy-course.cjs`, not rewritten. Interview now
  publishes only the verified-output question per topic ("What does this snippet print, and why?",
  answer = the executed stdout) plus the authored bank. Defense publishes **authored answers only**.
- A third authored pass, `content/numpy-mastery/deepening-7.json` (3 interview + 3 defense per
  module, 120 answers), brings the authored bank to **9 interview and 9 defense answers per module**
  so neither section shrinks to a stub after the removal.
- Measured on the published artifact: **0 of 600 interview/defense answers equals any Learn body.** A
  test asserts that for every record and also that Defense publishes exactly the authored bank.
- The count moved **down** by design: 2,900 → 2,540. 180 interview records and 120 defense records
  were deleted because they were duplicates, and 120 authored answers were added. The ledger records
  the loss rather than hiding it.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 420 | 1,000 | 580 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 240 | 1,000 | 760 |
| Debug | 200 | 1,000 | 800 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 180 | 1,000 | 820 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,540** | **10,000** | **7,460** |

### Dual-level teaching (phase 18, Part 2 of the brief)

The Learn entry now carries two authored explanations: `simple` (Hinglish, written for a beginner) and
`pro` (professional English). A persistent toggle in the module header switches between them and the
choice is stored under `nlevel`, so it survives a refresh. `content/numpy-mastery/levels-1.json`
authors both halves for **all 12 module-1 topics**; the other 19 modules (228 topics) still fall back
to the single existing body, and the tests only require both levels where they were authored.
`scripts/tests/numpy-levels.test.mjs` proves the artifact keeps both, that neither copies the body,
that the simple half is shorter, and that no authored title is orphaned.

### Interactive tools (phase 17)

Every module now shares four working tools below the 50/50 workspace: an array visualizer (shape →
ndim/size/strides/index grid), a broadcasting simulator that shows each axis decision or the exact
failure, a statistics playground (population mean/median/std/var, p25/p50/p75 with linear
interpolation) and a matrix lab (`A @ B`, `A.T`, incompatible shapes refused). The arithmetic lives in
the pure `src/core/learning/numpy-tools.ts` and is driven by `scripts/tests/numpy-tools.test.mjs` —
the panels format real computed values, not canned output. The 18-module brief's remaining 14 tools
are listed with their gaps in `NUMPY_CURRICULUM_AUDIT.md`.

### Per module

Every module ships **127 entries**: 12 Learn, 21 Interview (12 output questions + 9 authored),
25 Coding (all independent), 12 Logic, 10 Debug, 12 Practice, 1 Mini Project, 1 Project Lab,
9 authored Defense, 24 Checkpoint (12 quizzes, 12 written with rubrics).

## What is real today

- Every entry is module-specific; no interview or defense answer repeats a Learn body.
- Duplicate ids, duplicate debug titles per module and duplicate question text are rejected by the
  generator; task titles are scanned across all banks.
- All 500 coding reference solutions and hidden checks are executed on numpy 2.x and on the 1.26
  build the browser runtime ships.
- All 200 debug challenges are executed on both runtimes: 193 raise, 7 are wrong-output lessons.
- Every quiz offers three distinct real outputs; every written checkpoint asks a specific short-answer
  question and grades it against three authored criteria, with the model answer gated behind writing.
- Written drafts and rubric ticks are stored per entry and survive a refresh.

## Remaining work (phases 17+)

1. Grow the authored interview and defense banks past 9 per module (the topics still hold 12 more
   verified-output questions each).
2. Raise Debug from 10 to 20+ per module.
3. Raise authored topics beyond 12 per module and split the hardest modules; Practice still projects
   the topic body as its brief.
4. Grow Mini Project and Project Lab beyond one record per module.
5. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
