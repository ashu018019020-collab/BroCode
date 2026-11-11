# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–12 delivered the architecture, two
depth passes, a grader, independent task banks, a verified debug lab, interactive checkpoints and
written checkpoints with rubrics.

## Shipped so far

| Measure | Phase 0 | Phase 2 | Phase 8 | Phase 9 | Phase 10 | Phase 11 | Phase 12 (now) |
|---|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 2,260 | 2,440 | 2,440 | 2,440 | 2,440 | **2,600** |
| Independent coding tasks | 0 | 0 | 340 | 340 | 340 | 340 | **500** |
| Coding tasks per module | 0 | 0 | 17 | 17 | 17 | 17 | **25** |
| Debug challenges executed and checked | no | no | yes | yes | yes | yes | yes — 140 |
| Checkpoint quizzes (3 options) | 0 | 0 | 0 | 240 | 240 | 240 | 240 |
| Written checkpoints with rubrics | 0 | 0 | 0 | 0 | 240 | 240 | 240 |
| Written drafts persisted per entry | no | no | no | no | no | yes | yes |
| Generator validation | passes | passes | passes | passes | passes | passes | passes |

### Phase 12 — 25 independent tasks per module

- Coding Lab grew from 17 to **25 tasks per module (500 total)**, adding 8 per module. Every task has
  its own data and its own hidden check; none reuses a lesson snippet.
- The new 160 deliberately cover APIs the bank had not used: `repeat`/`multiply`, `iinfo`/`finfo`/
  `can_cast`/`promote_types`, `eye`/`tri`/`indices`/`fromfunction`, `put`/`delete`/`insert`/`compress`/
  `extract`/`flatnonzero`, `flip`/`roll`/`pad`/`hsplit`/`tile`, `atleast_2d`/`broadcast_to`/`dstack`/
  `moveaxis`, `hypot`/`modf`/`copysign`/`spacing`/`log2`/`arctan2`, `broadcast_arrays`/
  `broadcast_shapes`, `quantile`/`argmax(axis)`/`maximum.accumulate`, `select`/`place`/`putmask`/
  `isin`/`masked_where`, `searchsorted(side)`/`lexsort`/`partition`/`argpartition`,
  `shares_memory`/`flags`/strides/`resize`, `choice(p=)`/`uniform`/`binomial`/`poisson`/`shuffle`,
  `matrix_power`/`qr`/`cholesky`/`slogdet`/`cond`/`pinv`/`lstsq`, `genfromtxt`/`savez_compressed`/
  `fromiter`/savetxt formats/`frombuffer`, `char.add`/`count`/`startswith`/`multiply`,
  `busday_count`/`is_busday`/timedelta division/`rec.fromarrays`, `isfinite`/`nanstd`/`nansum`/
  `nanmedian`/`nancumsum`/`nanpercentile`, `add.outer`/`multiply.outer`/`reduceat`/`logical_or.reduce`,
  and `interp`/`convolve`/`gradient`/`diff(prepend)`/`corrcoef`/`cov`/`polyfit`.
- Three defects were caught by executing the new tasks rather than by reading them: a missing
  `> 10` comparison, an expected `lexsort` order that was simply wrong, and a `genfromtxt` column that
  returns a scalar for a single row. All three were fixed in the authored source, then filled again.
- A cross-file title scan reports **0 duplicate task titles** across all five task banks.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 500 | 1,000 | 500 |
| Logic | 240 | 1,000 | 760 |
| Debug | 140 | 1,000 | 860 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,600** | **10,000** | **7,400** |

### Per module

Every module ships **130 entries**: 12 Learn, 24 Interview, 25 Coding (all independent), 12 Logic,
7 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint (12 quizzes, 12
written with rubrics).

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids and duplicate question text are rejected by the generator per section; task titles are
  scanned across all banks.
- All 500 coding reference solutions and hidden checks are executed against real NumPy by the test
  suite and by the fill script, on both numpy 2.x and the 1.26 build the app ships in Pyodide.
- Every debug challenge is executed: 133 raise, 7 are wrong-output lessons, and every fix runs.
- Every quiz offers three distinct real outputs; every written checkpoint has three real criteria.
- Written drafts and rubric ticks are stored per entry and survive a refresh.

## Remaining work (phases 13+)

1. Author the interview and defense banks to independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
2. Raise Debug from 7 to 20+ per module; each new one is execution-verified the same way.
3. Raise authored topics beyond 12 per module and split the hardest modules.
4. Grow Mini Project and Project Lab beyond one record per module.
5. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
