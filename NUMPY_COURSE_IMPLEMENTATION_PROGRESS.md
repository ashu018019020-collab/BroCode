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
| Entries published | 2,660 | 2,780 | 2,900 | 2,540 | **2,780** |
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
| Learn | 280 | 1,000 | 720 |
| Interview | 460 | 1,000 | 540 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 280 | 1,000 | 720 |
| Debug | 200 | 1,000 | 800 |
| Practice Solutions | 280 | 1,000 | 720 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 180 | 1,000 | 820 |
| Checkpoint | 560 | 1,000 | 440 |
| **Total** | **2,780** | **10,000** | **7,220** |

### Coding labs grow to forty tasks (phase 35)

Every module's Coding Lab now holds **40 independent tasks** (800 across the course, up from 500):
the fifteen added per module are in `tasks-6.json` … `tasks-9.json`, each with its own data, reference
solution, hidden check and printed output. `numpy-fill-outputs.cjs` executed all 800 solutions against
numpy 2.5.2 and filled the `expected` text from real stdout, so no output is typed by hand. Three first
drafts failed that run (a text-format check, a wrong square-sum constant, an FFT peak read off the wrong
bin) and were corrected rather than accepted — the generator also rejects duplicate task titles.

### datetime64 and string-array explorer (phase 46)

A **Dates & strings** tab adds both models the advanced-dtype module teaches. The date block takes two
dates, a unit and a day offset, and computes the `datetime64` difference in D/s/ms plus the shifted
date (the difference is presented as the `timedelta64` count it is). The string block rebuilds the
fixed-width dtype from the longest value, then shows `str_len`, `upper`, an `astype('<U<n>')`
truncation at the chosen width and the sorted order — all from the typed into the panel.

`numpy-text-time.ts` holds the arithmetic; `numpy-datetime.test.mjs` checks the `<U` width, lengths,
uppercase, sort order, truncation, the D and s differences and the 45-day shift against real NumPy
calls, and pins the strict parser that rejects `2026-02-30` and non-ISO input instead of rolling it
over. The page's heading outline rule required the new section titles to be `h2`, which the layout
test enforced before this shipped.

### Performance comparison lab (phase 45)

A **Performance lab** tab times a real CPython `for` loop over `values.tolist()` against the vectorised
`np.sum(values * values)` inside the tab, using the bundled offline Pyodide runtime and its NumPy
wheel. The program (`core/learning/numpy-bench.ts`) warms both kernels, runs five repeats, prints one
`NBENCH` JSON line, and the parser turns it into the median of each set, the speedup and the
difference between the two sums — so the panel also proves both kernels computed the same answer.
Sizes are 100k, 500k and 1M values; a first run includes the Python boot (5–15 s).

`numpy-bench.test.mjs` executes the identical program with the local Python and parses it with the
same function the panel calls, asserting the vectorised path wins and the checksums agree. The parser
also refuses a missing marker, broken JSON or empty timing arrays, so a failed run shows the runtime
error instead of a fabricated card.

### Copy-versus-view experiment (phase 44)

The tools panel gains a **Copy vs view** tab next to the existing axis explorer. `sharingOutcome` in
`core/learning/numpy-tools.ts` encodes the eight cases learners meet — basic slice, `.copy()`, fancy
indexing, reshape, transpose, `ravel`, `flatten` and a reversed slice — with the snippet, the
view/copy verdict and the reason. Selecting a case shows the predicted source array after
`b[0] = 99`, so the write-through consequence is visible instead of asserted.

The parity test runs the same eight expressions through real NumPy and compares every flag with
`np.shares_memory`; it skips only when numpy is absent from the machine, as the other NumPy probes do.

### Twenty Learn topics per module (phase 43)

`deepening-10.json` adds six executed topics to each of the eighteen modules below twenty (the two
advanced modules already had 22 and 21), so **every module now teaches at least 20 topics**:

| | topics | | topics |
|---|---|---|---|
| n01–n14 | 20 each | n15 | 22 |
| n16 | 21 | n17–n20 | 20 each |

Course totals move from 295 to **403 Learn topics and 4,058 published entries**. The additions stay
module-specific rather than generic: `strides` and `base` for attributes, `diag`/`tril`/`logspace` for
creation, `hypot` and ufunc `out=` for ufuncs, `quantile`/`lexsort`/`partition`/`bincount` for the
sorting and performance modules, `SeedSequence`/weighted `choice` for randomness, and
`digitize`/`convolve`/confusion-matrix `bincount` for the ecosystem module.

Every sample was executed by `numpy-fill-outputs.cjs` against numpy 2.5.2; the artifact's counts are
recomputed by `numpy:coverage` (403 topics) and by the bank tests, so the published numbers are counts,
not claims.

### Dual-level explanations for the forty depth-layer topics (phase 42)

`levels-6.json` gives every one of the 40 topics added by `deepening-8.json` a beginner Hinglish
explanation (`simple`, the default) and a professional English one (`pro`), so the level toggle now
works on all of them: **40/40 dual-level** in that layer, and course-wide dual coverage moves from
68 to **100 of 295 topics**.

The Hinglish side teaches with a concrete scene (a bag of chocolates for mixed types, an attendance
sheet for rows and columns, a vacuum bag for dtype memory), while the professional side states the
mechanism and the consequence — promotion tables, strides, aliasing, tolerance choice — without
repeating the beginner sentence.

### Linear algebra and file I/O depth (phase 41)

`deepening-9.json` adds fifteen executed topics to the two thinnest advanced modules:

- **Linear algebra (n15, 14 → 22):** SVD (`U @ diag(s) @ Vt` reconstruction), symmetric eig via
  `eigh` (real values, verified `A @ v == value * v`), QR (orthonormal `Q`, upper-triangular `R`,
  reconstruction), Cholesky (`L @ L.T == A`), pseudo-inverse (`A @ P @ A == A`, rank 1 input),
  `slogdet` (sign plus log-determinant, rebuilt), `matrix_power` (A³ and the identity at power 0), and
  `lstsq` with an intercept column (coefficients, rank and residuals).
- **File I/O (n16, 14 → 21):** `genfromtxt` with named, typed columns, a writable `memmap` that flushes
  through to disk, `savez_compressed` (keys and sum), `loadtxt` with `usecols`, `savetxt` with
  `fmt='%.2f'`, `tofile`/`fromfile` raw binary, and `allow_pickle=False` refusing an object array.

Every sample was executed by `numpy-fill-outputs.cjs` against numpy 2.5.2; the printed output above is
the real stdout. Course totals move to **295 Learn topics and 3,410 entries**.

### Coverage command (phase 40)

`npm run numpy:coverage` prints what every module actually teaches, read from the published artifact
rather than the authored files, so a dropped field shows up as a gap instead of a claim:

```
n04    Data Types and Type Conversion         14      14/14      14/14  ...  14/14
full 12-part: 70/280 (25%) · dual-level: 68/280 (24%)

Missing parts:
n06 Slicing and Array Views — dual 14, syntax 14, steps 14, visual 14, realWorld 14, mistakes 14, revision 14
  dual: Every second value; Slice with a step; ...
```

Columns are `topics` plus `authored/topics` for dual level and each of the five structure parts. The
gaps section names the topics still missing a part (first four, then `+N more`). `--strict` exits 1
when any part is missing, for a future gate; without it the report always exits 0.
`numpy-coverage.test.mjs` recomputes every row and the summary from the artifact and checks that
`--strict` fails exactly when a gap exists.

### Twelve-part structure for modules four and five (phase 39)

`structure-4.json` and `structure-5.json` add the five lesson-structure fields — `syntax`, `steps`,
`visual`, `realWorld`, `mistakes`, `revision` — to all 28 topics of **Data Types and Type Conversion**
and **Array Indexing and Selection**. Both modules already carried their dual-level explanations, so
these 28 topics are now fully teachable: 14/14 full shape and 14/14 dual level per module.

The structure is written from the topic's own verified sample (the uint8 wrap, the (2, 3) index pair,
the column slice that keeps or drops an axis), not generic advice, so `visual` predicts the printed
shape and `mistakes` names the error learners actually make. Course-wide full-shape coverage moves
from 42 to **70 of 280 topics (25%)**; modules 1–5 are now complete.

### True/false and fill-in-the-blank checkpoints (phase 38)

Checkpoint is no longer only a three-option quiz plus a written answer. Every module now ships
**five true/false** and **five fill-in-the-blank** checkpoints (200 new entries, 3,320 in the course):

- **True/false** quotes real output from the module. A true claim is the sample's verified stdout; a
  false claim is a *different* topic's real output, so it is plausible and definitely not what this
  code prints. The card shows the code, the claim, and exactly two buttons.
- **Fill-in-the-blank** removes one numeric literal from a verified sample (never from an import line),
  replaces it with `___`, and keeps the real output on screen. The learner types the token; the card
  records the section on a match and can reveal the answer.

The generator validates both shapes (two distinct options including the answer, a `___` with a
solution and an answer), `numpy-bank.test.mjs` re-executes all 200 entries against numpy to confirm the
blank's solution still prints the published output and each true/false code really prints its claimed
answer, and the two older checkpoint tests were updated to distinguish the formats instead of assuming
three options.

### Interview follow-ups (phase 37)

Every one of the 40 authored scenarios now carries **two follow-up questions**, 80 in total, each with
its own model answer in `scenarios.json` (`followUps: [{ q, answer }]`). They are the questions an
interviewer asks next — the measurement, the edge case, the trade-off — not a restatement of the first
answer. The generator validates the shape and publishes them with the scenario, `numpy-bank.test.mjs`
recomputes that every scenario has at least two with unique prompts, and the interview card reveals
each follow-up answer separately so the learner still attempts a reply first.

### Hints for modules two to six (phase 36)

`hints-2.json` adds **125 hints** (25 per module) so the first twenty-five tasks of ndarray fundamentals,
array creation, dtypes, indexing and slicing each get a Hint button: **150 hinted tasks** in total
(module 1 from `hints-1.json`). Each hint names the attribute or function that answers the task without
printing the solution, in the same voice as the existing set.

### Axis explorer and reshape playground (phase 34)

Two tools are now explicit about shapes instead of leaving them to the reader:

- **Axis explorer** — pick rows/columns (1–6) and `axis`, and the panel prints
  `before (r, c) → after (n)` plus the real `a.sum(axis=k)` totals and the axis that disappeared
  ("the rows axis disappears, so 2×3 becomes 3").
- **Reshape playground** — enter the array size and a target shape, with `-1` inferring exactly one
  dimension; the panel shows the before/after shapes, the flat C-order grid, and refuses a shape that
  changes the number of cells ("4 × 2 = 8 cells, but the array holds 6").

Both are computed by `axisReduce` and `reshapePlan` in `core/learning/numpy-tools.ts`, and the results
are **verified against a real numpy run**: `numpy-tools.test.mjs` executes
`a.sum(axis=0/1)` and `b.reshape(-1, 3)` and compares totals, shapes and the flat index grid, skipping
only when python/numpy is absent on the machine.

### Cross-device account sync (phase 33)

The NumPy course's own records — `nmod:` section records, `nans:` written drafts, `ntick:` rubric ticks,
`ncap`, `nlast`, `nlevel` — now travel with the account. The design keeps the two write paths apart:

- **contract** `src/core/learning/numpy-sync.ts` (pure, tested): allowlisted key families, drafts capped
  at 20 KB, payload capped at 64 KB, `mergeNumpyProgress` keeping local records and filling gaps from the
  server.
- **transport** `src/core/data/numpy-progress.ts` on the existing `apiJson` account client:
  `POST /api/numpy/progress` with `action: 'load' | 'save'`.
- **server** `server/app.mjs` validates the same allowlist and size limits, takes the identity from the
  JWT, and `server/store.mjs` stores one row per account in a new `numpy_progress` table
  (`prisma/schema.prisma` + migration `20261112120000_numpy_progress`, `ON DELETE CASCADE`).
- **surface** the course page pulls once per session, merges server-only records into local state, then
  pushes a debounced snapshot; the chip names the real outcome (`saved to your account (N sections ·
  M drafts)`, `no account API on this deployment — progress stays on this device`, `rejected`).

**Operational step still required:** apply the migration with `npm run db:deploy` against the project
database (`DATABASE_URL` + `DIRECT_URL`). Until it runs, the endpoint answers 500, the client falls back
to `local` and nothing is lost — the feature is additive, not a replacement for local storage. The
schema validates (`prisma validate` passes with placeholder URLs); the migration could not be applied
from this workspace because no database credentials are present.

### Dual-level teaching for modules 4 and 5 (phase 32)

`levels-4.json` (Data Types) and `levels-5.json` (Indexing and Selection) complete the dual-level layer
for **every topic in modules 2 through 5** — 56 Learn topics, 14 per module. What this phase added is
28 topics, because modules 2 and 3 were authored in phase 31; the four modules now read 14/14 each.
Dual-level coverage is **68 of 280 (24%)** and the module-header toggle changes the text in five
modules.

The pairs stay deliberately different: `simple` uses an everyday analogy ("astype round nahi karta,
decimal kaat deta hai"), `pro` states the mechanism and its consequence (truncation toward zero versus
`np.round`'s half-to-even, fancy indexing returning a copy, `a[:, 1:2]` keeping the axis).

### Dual-level teaching for modules 2 and 3 (phase 31, Part 15 of the brief)

`levels-2.json` and `levels-3.json` author the Hinglish `simple` and professional `pro` explanation for
all **28** topics in ndarray Fundamentals and Array Creation, so the module-header level toggle now
changes the text in three modules instead of one. Dual-level coverage moves from 12 to **40 of 280
(14%)**; the remaining 240 topics still show the single authored `body`.

The explanations are written to the same rule as module 1: `simple` explains the idea without jargon,
`pro` states the precise behaviour and its consequence (promotion, strides, broadcasting, endpoint
arithmetic) — neither is a translation of the other.

### Structure for modules 2 and 3 (phase 30, Part 14 of the brief)

`structure-2.json` and `structure-3.json` author the full 12-part lesson shape for all **28** Learn
topics in ndarray Fundamentals and Array Creation: syntax line, three steps, a compact visual, the
real-world use, common mistakes and revision points. The audit's full-shape number moves from 14 to
**42 of 280 (15%)**; the remaining 238 topics still render only the parts they have. Dual-level
(`simple`/`pro`) coverage is still module 1's 12 topics.

### Course search and audit (phase 29, Part 13 of the brief)

**Search** is a real feature, not a filter over titles: `searchCourse` scans all 2,820 records — Learn
explanations, coding statements, debug errors, practice tasks, answers and code — and ranks exact
title, title prefix, title substring, then body match. The course page shows the hits with section and
module labels and opens the exact record, so "ValueError" reaches a debug item and "broadcast" reaches
a coding task.

**`npm run numpy:audit`** is the read-only report: entries, per-module count against the 500 target,
shortfall, Learn topics with the full 12-part shape, dual-level coverage, coding hints, scenario
questions, capstone rubric total, artifact bytes, and the eight-category totals. It exits 1 only on a
broken invariant (duplicate id, duplicate Learn title, Learn without code/output, empty section), so
partial authoring is reported as a percentage instead of hidden:

```
entries              2820 (141 per module, target 500)
shortfall            359/module · 7180 course-wide
Learn topics         280
  full 12-part shape 14 (5%)
  dual-level simple+pro 12 (4%)
coding hints         25/500 (5%)
scenario questions   40
```

### Certificate and proof of work (phase 28, Part 12 of the brief)

`numpyCertificate` derives eligibility instead of assuming it: every one of the 200 sections must
have a record AND the capstone rubric (self-assessed, criterion by criterion, stored under `ncap`) must
reach the course's own pass mark of 70, with 90 for the excellent grade — the same thresholds the
capstone publishes. The course page renders the status, the tick list with each criterion's weight, the
reason when it is locked, and, once eligible, a printable certificate naming the learner, the completed
totals and the rubric score.

The certificate says plainly that it is **self-issued proof of work from the learner's own records,
not an accredited qualification** — the app has no server-side grading and will not imply otherwise.
`ncourse.test.mjs` drives the rule (no ticks, 80 pass, 100 excellent, 150/200 sections blocked).

### Capstone project (phase 27, Part 11 of the brief)

`content/numpy-mastery/capstone.json` adds the one assessable project for the whole course: a
twelve-month sales table generated from a fixed seed, three tiers (Beginner / Intermediate / Advanced)
each with at least three requirements, deliverables and a stretch goal, four ordered milestones, and a
four-row rubric whose weights total exactly 100 with a pass and an excellent bar. The starter is real
code, executed against numpy before publication, so the printed `units shape: (12, 6)` and the twelve
monthly totals on the page are the runtime's own output.

The generator rejects a capstone with a missing tier field or a rubric that does not sum to 100, and
`scripts/tests/numpy-capstone.test.mjs` checks the same contract from the published artifact.

Open: the twenty per-module mini projects and labs still carry only a brief and steps — they have no
requirements, dataset note, deliverable or rubric of their own.

### Progress and personalization (phase 26, Part 10 of the brief)

`numpyReport` (pure, in `core/learning/ncourse.ts`) turns the section records into everything the
brief asks for: overall percentage, sections and modules completed, a per-module row with its own
progress bar, every untouched section ranked in course order as a weak spot, the recommended next
place, and a resume target read from the `nlast` key the module page writes on every section change.
"Resume" therefore returns to the section you actually left, and `?section=` makes the deep link real.

The course page renders it as the **Your progress** card: counts, Resume and Next buttons, twenty
module bars, and weak-topic chips that jump straight to the module and section. Three tests drive the
report with fixtures (partial course, empty course, one complete module) so a change to the
completion rule fails there first.

**Cloud sync is still open, and precisely so:** the account snapshot stores aggregate counters
(`done_records`, `practiced_count`, …) through `save_my_progress`; the NumPy section keys (`nmod:`)
and written drafts (`nans:`/`ntick:`) are not part of that payload, so they survive a refresh on one
device but do not follow the learner to another. Fixing it needs either a migration with a per-course
JSON column or a second RPC — neither was invented here.

### Course UI (phase 25, Part 9 of the brief)

The overview now states what the brief asks for in one place: entry count, completion percentage,
**completed modules out of twenty**, **total authored hours**, level, prerequisites and the course
standard, then outcomes, the twenty module tiles with per-module section progress, and the counted
question bank. The recommended next module/section is computed from real attempts, so "Continue
learning" names an untouched module rather than always module one.

Inside a module: header with ring and level toggle, ten section cards with live counts and `✓`, the
50/50 workspace, the ten tools, and now **previous/next module navigation** that carries the module
number and title. The audit's remaining responsive risk (`minWidth: 260` on the course header) is
gone — it is `min(260px, 100%)` now, so 320px screens no longer overflow.

Still not done from the brief's UI section: a module-tree sidebar (the section cards are the
navigation), skeleton states inside a module, and a persistence check across a real browser
click-through (the app requires an account, so the UI is verified as shipped bytes + tests).

### AI tutor integration (phase 24, Part 8 of the brief)

The course does not add an assistant. The module page publishes a **scoped tutor** through the same
`usePublishTutorScope` store the step pages use (`kind: 'module'`), and an `Ask the AI tutor` button
dispatches `bi:open-ai`, which the shell already listens for: the footer `AiDock` opens on the one
existing `AssistantCard` and transcript. The published scope carries the module, the section, the
selected record's code, the learner's teaching level and a progress summary that names the untouched
sections, plus four starters (explain like a beginner, line-by-line, hint without the answer, what to
revise). `scripts/tests/numpy-tutor.test.mjs` pins the three couplings and asserts the course renders
no second assistant.

### Interactive tools (phase 23, Part 7 of the brief)

Every module carries **ten working tools**, all computed by the pure `src/core/learning/numpy-tools.ts`
and driven by tests: array visualizer (shape → ndim/size/strides/index grid), broadcasting simulator,
**slicing explorer** (Python `slice.indices` semantics including negative steps), **boolean-mask
explorer** (mask + selected values), **reshape explorer** (C-order flat indices), statistics playground
(population mean/median/std/var, p25/p50/p75), matrix lab (`A @ B`, `A.T`, refuses incompatible
shapes), **dtype memory calculator** (itemsize × count, formatted), **random & seeds playground**
(deterministic per seed) and **missing-value explorer** (sentinel + null + nan summary). The RNG panel
states plainly that it uses a small xorshift, not PCG64, and shows the real NumPy call to run in Code
Bro. Eight tools from the brief's list of eighteen are still missing: axis explorer, copy-vs-view,
interactive visualizer for 3-D grids, linear-algebra visualiser beyond matmul, performance comparison,
NumPy coding playground (Code Bro covers it), string/datetime explorer and FFT/frequency explorer.

### Question-bank manifest (phase 22, Part 6 of the brief)

The brief's 500-items-per-module target is not met, and the course now says so in the product instead
of only in this ledger. `stats.bank` is counted from the published records: per module it reports the
total, eight categories (concept, output, coding, debugging, quiz, written, project, scenario) and the
difficulty mix, plus the target, the per-module shortfall and the course-wide shortfall.
`scripts/tests/numpy-bank.test.mjs` recomputes every one of those numbers from the sections and fails
if the manifest disagrees, if a module claims 500, or if an id repeats.

`content/numpy-mastery/scenarios.json` adds **40 authored real-world questions** (two per module) —
seeded A/B splits, singular-matrix regressions, memmap reads, churn labels, silent int overflow — so
the scenario category is real content rather than a label. The course now holds **2,820 entries**
(141 per module).

### Section contract (phase 21, Part 5 of the brief)

All ten sections already existed; what was missing was a gate that proves each one carries what its
activity needs. `scripts/tests/numpy-sections.test.mjs` now checks, for every module: Learn has
title/body/code/output, Interview has a question and answer, Coding has starter/check/expected and a
statement, Logic has code and a verified answer, Debug has broken code + error + fix, Practice has
task/solution/expected, both projects have a brief and steps, Defense has a prompt and an authored
answer, and Checkpoint has quizzes whose answer is among three real options plus written entries with
three criteria.

Coding hints were genuinely missing (0 of 500). `content/numpy-mastery/hints-1.json` authors one for
each of module 1's **25 tasks** — a nudge toward the right function, never the solution — and the
workspace shows it behind a `Hint` button. The other 19 modules' tasks still have no hint.

### Lesson structure per topic (phase 20, Part 4 of the brief)

`content/numpy-mastery/structure-1.json` authors the brief's 12-part lesson shape for **all 14
module-1 Learn topics**: a syntax line, three ordered steps, a compact visual, the real-world use, the
common mistakes and the revision points (intro/easy/technical explanations already come from `body`,
`simple` and `pro`; practice and mastery are the module's Practice Solutions and Checkpoint sections,
linked in the panel rather than duplicated). The workspace renders every authored part as its own
labelled block, and `scripts/tests/numpy-structure.test.mjs` rejects an entry with a missing part.
The other 19 modules (266 Learn topics) do not have the structure authored yet and render only the
parts they have.

### Curriculum coverage (phase 19, Part 3 of the brief)

The brief's 18 module areas are mapped against the pack by `scripts/tests/numpy-coverage.test.mjs`:
every area must name a module title, a Learn topic or a section, or the suite fails. Phase 19 also
authored **40 new Learn topics** (two per module) in `content/numpy-mastery/deepening-8.json`, and
`scripts/numpy-fill-outputs.cjs` executed all 40 against numpy 2.5.2 before publication — the stored
outputs are what the runtime printed, not hand-written text. That moves the course from 2,540 to
**2,780 entries**, Learn from 240 to 280, and each module from 127 to 139 records. The 500-per-module
target is still open: 361 short per module, 7,220 across the course.

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

Every module ships **139 entries**: 14 Learn, 23 Interview (14 output questions + 9 authored),
25 Coding (all independent), 14 Logic, 10 Debug, 14 Practice, 1 Mini Project, 1 Project Lab,
9 authored Defense, 28 Checkpoint (14 quizzes, 14 written with rubrics).

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
