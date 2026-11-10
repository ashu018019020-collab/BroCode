# C Course — Implementation Progress

Last updated: 2026-11-10 (audit checkpoint; the C course itself was not modified).

## Honest status in one line

The C course is **intact, validating and untouched by the Java work**, with **20 modules and roughly
600–800 content entries total** — not 50 per section per module. Target: 20 × 500 = **10,000
entries**. None of the ten-section expansion has been authored yet.

## Verified current inventory

`npm run c-course` (dry run) → `20 modules, 86 topics, 40 labs, 15 projects, 107 interview Qs, 128 MCQs`.

| Item | Count |
|---|---:|
| Modules (`c01`–`c20`) | 20 |
| Topics | 86 |
| Examples | 40 |
| Practice prompts | 60 |
| MCQs | 128 |
| Interview entries | 107 |
| Labs | 40 |
| Projects | 15 |
| Hours | 103 |
| Authored content | ~308 KB |
| Published artifacts | ~332 KB |

Existing sections in the C UI: Overview, Curriculum, Practice, Labs, Projects, Interview, Career,
Tests, Progress. Existing storage: `ccourse:<module>:checkpoint|test`, `cquiz:`, `clab:`; routes
`/c-programming`, `/c-programming/:moduleId`; execution through `/api/c/execute` → Judge0 GCC. All
preserved.

## Ten-section gap (measured qualitatively; no per-section 50s exist)

| Section | Current source | Required | Status |
|---|---|---:|---|
| 01 Learn | 86 topics + 40 examples across 20 modules | 50/module | below |
| 02 Interview | 107-item course bank | 50/module | below |
| 03 Coding Lab | module labs + practice; no coding bank | 50/module | below |
| 04 Logic | — | 50/module | missing |
| 05 Debug | one exercise per module | 50/module | below |
| 06 Practice Solutions | 60 prompts course-wide | 50/module | below |
| 07 Mini Project | 15 projects course-wide | 50/module | below |
| 08 Project Lab | same projects, no milestone track | 50/module | below |
| 09 Defense | — | 50/module | missing |
| 10 Checkpoint | 128 MCQs course-wide | 50/module | below |

Rough total: 600–800 entries / 10,000 required.

## Completed work

1. Read-only audit of `content/c-programming/**`, `scripts/c-course.cjs`, generated artifacts,
   `src/core/{learning,data}/ccourse.ts`, `src/features/c-programming/*`, routes and storage keys.
2. Confirmed the generator still passes after all Java changes (no shared files were altered except
   the shared Courses grid, which adds a Java card and leaves the C card untouched).
3. Wrote `C_COURSE_AUDIT.md` with the coverage and gap analysis.
4. Confirmed Python and C runtime/progress code was not modified.

## Remaining work (planned batches)

Mirror the Java batches, module by module, starting with a reference module (proposed `c03`,
strings/arrays) to prove the pipeline before scaling. Each batch ends with a generator dry run, a
GCC verification pass for all runnable code, focused tests, and an updated count.

| Batch | Scope | New entries |
|---|---|---|
| C-B1 | Reference module: all ten sections at 50, fully verified | 500 |
| C-B2 | Logic bank, 50 trace items per module | 1,000 |
| C-B3 | Interview sets, 50 per module (20/20/10) | 1,000 |
| C-B4 | Coding Lab, 50 verified challenges per module | 1,000 |
| C-B5 | Debug, 50 per module (pointers, memory, UB, off-by-one) | 1,000 |
| C-B6 | Practice Solutions, 50 per module | 1,000 |
| C-B7 | Mini Projects, 50 per module | 1,000 |
| C-B8 | Project Lab, 50 milestones per module | 1,000 |
| C-B9 | Defense, 50 viva items per module with rubrics | 1,000 |
| C-B10 | Checkpoint, 50 items per module with scoring/history | 1,000 |
| C-B11 | Per-module 10-section UI, counts from artifacts | — |
| C-B12 | Full QA (GCC verify, typecheck, tests, build, mobile) | — |

Rules: C17/GCC only, no non-portable extensions taught as standard C, every runnable sample
compiles and matches output, existing module ids and learner progress preserved, Python and Java
untouched.
