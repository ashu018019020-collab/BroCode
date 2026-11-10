# C Course Audit — BroCode

Audit date: 2026-11-10. Scope: the existing C Programming course
(`content/c-programming/**` → `scripts/c-course.cjs` → `public/generated/c-course/**` →
`src/core/{learning,data}/ccourse.ts` → `src/features/c-programming/*`, routes `/c-programming`
and `/c-programming/:moduleId`).

The C course is **unchanged by this work**; it was audited read-only and its generator still passes.

## 1. Measured inventory

| Item | Count |
|---|---:|
| Modules | 20 (`c01`–`c20`) |
| Topics | 86 |
| Examples | 40 |
| Practice prompts | 60 |
| MCQs | 128 |
| Interview entries | 107 |
| Labs | 40 (20 module + 20 practical) |
| Projects | 15 |
| Hours | 103 |
| Authored content size | ~308 KB |
| Published artifacts | ~332 KB in `public/generated/c-course/` |

`npm run c-course` (dry run) prints: `20 modules, 86 topics, 40 labs, 15 projects, 107 interview Qs,
128 MCQs`. There is no separate 100-question coding bank, no logic bank, no per-module defense bank
and no per-module checkpoint of 50 questions.

## 2. Curriculum coverage vs the reference list

Present: introduction, syntax, compilation, variables, data types, operators, I/O, conditionals,
loops/patterns, functions, recursion, arrays, 2D arrays, strings, pointers and pointer arithmetic,
dynamic memory, structures, unions, enums, typedef, file handling, preprocessor/macros, storage
classes, data structures, searching/sorting, complexity.

Coverage to verify or add: pointer-to-pointer depth, command-line arguments, function pointers,
linked lists/stacks/queues/trees/graphs as their own modules. Some of these appear inside broader
modules rather than as standalone chapters.

## 3. Ten-section audit

Measured against the required ten sections (module labs counted once; banks are course-level):

| Section | Current state | Required per module | Status |
|---|---|---:|---|
| 01 Learn | topics + examples + practice per module (86 topics / 40 examples total) | 50 | below |
| 02 Interview | one 107-item course bank (not 50 per module) | 50 | below |
| 03 Coding Lab | module lab + practice prompts; no 50-item coding bank | 50 | below |
| 04 Logic | — | 50 | missing |
| 05 Debug | one `debug` exercise per module | 50 | below |
| 06 Practice Solutions | 60 prompts course-wide | 50 | below |
| 07 Mini Project | 15 projects course-wide, shared across modules | 50 | below |
| 08 Project Lab | same 15 projects; no separate milestones track | 50 | below |
| 09 Defense | — (no defense bank) | 50 | missing |
| 10 Checkpoint | 128 MCQs course-wide, not 50 per module | 50 | below |

At 20 modules × 500 the C target is **10,000 entries**; the course currently holds roughly 600–800
content entries total.

## 4. Execution, UI, storage

- Runtime: `/api/c/execute` + `server/c-runner.mjs`, public Judge0 C (GCC), same validation and
  budget shape as Java. No execution happens on the app server.
- UI: `CCoursePage` (Overview, Curriculum, Practice, Labs, Projects, Interview, Career, Tests,
  Progress), `CLessonPage` with a pinned `CNotebook`, `CLogo`.
- Progress: `ccourse:<module>:checkpoint`, `:test`, `cquiz:`, `clab:`, plus course-level tallies.
  Preserved untouched; the Python course is unaffected.

## 5. Gap list

1. Per-module Learn expansion to 50 (definitions, comparisons, dry runs, revision, output tracing).
2. Per-module interview sets of 50 (20/20/10), separate from the shared 107-item bank.
3. 50 coding-lab challenges per module with public + hidden tests, GCC-verified.
4. 50 logic/trace items per module.
5. 50 debug challenges per module with real compiler/runtime errors, including pointer and memory
   cases and undefined-behaviour explanations.
6. 50 practice exercises with complete solutions per module.
7. 50 mini-projects per module and a separate 50-milestone project lab.
8. 50 defense questions per module with rubrics.
9. 50 checkpoint questions per module with scoring, retry and history.
10. Preserve `c01`–`c20` ids, routes, storage keys and all existing content while adding the above.

## 6. Constraints

- C17/GCC only; no non-portable extensions taught as standard C.
- Every runnable example, solution and fix must compile and match output through the existing
  verifier (`scripts/c-verify.cjs`, if present) or an equivalent JDK/GCC check.
- Do not renumber or replace existing modules; do not touch Python or Java from C work.
