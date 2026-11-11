# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–13 delivered the architecture, two
depth passes, a grader, independent task banks, a verified debug lab, interactive checkpoints and
written checkpoints with rubrics.

## Shipped so far

| Measure | Phase 2 | Phase 8 | Phase 9 | Phase 10 | Phase 11 | Phase 12 | Phase 13 (now) |
|---|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 2,260 | 2,440 | 2,440 | 2,440 | 2,440 | 2,600 | **2,660** |
| Independent coding tasks | 0 | 340 | 340 | 340 | 340 | 500 | 500 |
| Debug challenges per module | 3 | 7 | 7 | 7 | 7 | 7 | **10** |
| Debug challenges executed and checked | no | yes ×140 | yes ×140 | yes ×140 | yes ×140 | yes ×140 | **yes ×200** |
| Checkpoint quizzes (3 options) | 0 | 0 | 240 | 240 | 240 | 240 | 240 |
| Written checkpoints with rubrics | 0 | 0 | 0 | 240 | 240 | 240 | 240 |
| Written drafts persisted per entry | no | no | no | no | yes | yes | yes |
| Generator validation | passes | passes | passes | passes | passes | passes | passes |

### Phase 13 — ten verified debug challenges per module

- Debug grew from 7 to **10 challenges per module (200 total)**, adding 60 in
  `content/numpy-mastery/deepening-4.json`. Each one is executed, not described.
- The new challenges widen the error classes the section actually teaches: missing names, reductions
  over empty arrays, `ndarray` having no `append`, impossible shape assignment, shape tuples added to
  numbers, `ndim` called as a method, zero-step `arange`, negative `linspace` counts, text passed to
  `eye`/`degrees`/`char.multiply`, unknown dtype names, ambiguous `bool()` of an array, out-of-bounds
  `take`/`delete`/`partition`/`reduceat`, string array indices, `AxisError` from `flip`/`cumsum`/
  `sort`/`count_nonzero`/`nansum`/`nancumsum`, negative padding, `broadcast_to` failures, in-place
  broadcast output mismatch, `quantile` above one, mismatched `select`/`where` branches, negative
  `resize`, writes into a read-only broadcast, `default_rng` with a text seed, negative `normal`
  scale, `binomial` probability above one, non-square `solve`, non-positive-definite `cholesky`,
  fractional `matrix_power`, unparsable `savetxt` formats, partial-element `frombuffer`, malformed
  `loadtxt`/`busday_count`/`is_busday`, over-deep `einsum`, three-input `add.outer`, length-mismatched
  `cov`, and empty `convolve`.
- Two drafts were rejected by execution rather than by reading: `np.roll` accepts a string shift and
  `np.interp` does not validate monotonic `xp`, so neither raised. Both were replaced with samples
  that genuinely raise, then re-filled.
- The recorded `error` text is the interpreter's own, and every fix is executed and required to run.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 240 | 1,000 | 760 |
| Debug | 200 | 1,000 | 800 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,660** | **10,000** | **7,340** |

### Per module

Every module ships **133 entries**: 12 Learn, 24 Interview, 25 Coding (all independent), 12 Logic,
10 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint (12 quizzes, 12
written with rubrics).

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids, duplicate debug titles per module and duplicate question text are rejected by the
  generator; task titles are also scanned across all banks.
- All 500 coding reference solutions and hidden checks are executed against real NumPy by the test
  suite and the fill script, on numpy 2.x and on the 1.26 build the browser runtime ships.
- All 200 debug challenges are executed on both runtimes: 193 raise, 7 are wrong-output lessons, and
  every fix runs.
- Every quiz offers three distinct real outputs; every written checkpoint has three real criteria.
- Written drafts and rubric ticks are stored per entry and survive a refresh.

## Remaining work (phases 14+)

1. Author the interview and defense banks to independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
2. Raise Debug from 10 to 20+ per module.
3. Raise authored topics beyond 12 per module and split the hardest modules.
4. Grow Mini Project and Project Lab beyond one record per module.
5. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
