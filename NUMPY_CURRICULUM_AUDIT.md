# NumPy course — audit against the 18-module brief

Measured from the shipped artifact (`public/generated/numpy-course/index.json`), the generator
(`scripts/numpy-course.cjs`), the pure rules (`src/core/learning/ncourse.ts`) and the workspace UI,
not from memory. Where the brief asks for more than the pack holds, the gap is stated as a number.

## 1. What exists today

| Measure | Value |
|---|---|
| Modules | 20 (brief asks 18; the pack splits indexing/slicing, copies/memory, masked arrays into their own modules) |
| Sections per module | 10 — Learn, Interview, Coding Lab, Logic, Debug, Practice Solutions, Mini Project, Project Lab, Defense, Checkpoint |
| Entries per module | 139 |
| Total entries | 2,780 |
| Learn topics per module | 14 (brief's modules list 20–40 topics each) |
| Coding tasks per module | 25, all independent, reference solutions and hidden checks executed |
| Debug challenges per module | 10, all executed on two runtimes |
| Interview / Defense per module | 23 / 9, disjoint from Learn bodies |
| Checkpoint per module | 14 quizzes + 14 written short answers with 3 rubric criteria each |
| Projects per module | 1 Mini Project + 1 Project Lab |

## 2. Module mapping (brief → pack)

| Brief module | Pack module(s) |
|---|---|
| 01 Fundamentals | n01 NumPy Introduction and Fundamentals, n02 ndarray Fundamentals |
| 02 Creation and attributes | n03 Array Creation and Initialization |
| 03 Data types | n04 Data Types and Type Conversion, n17 Advanced Data Types and Special Arrays |
| 04 Indexing and slicing | n05 Array Indexing and Selection, n06 Slicing and Array Views |
| 05 Boolean masking | n11 Boolean Indexing and Filtering |
| 06 Math and ufuncs | n08 Array Operations and Universal Functions |
| 07 Broadcasting | n09 Broadcasting |
| 08 Reshaping and manipulation | n07 Array Reshaping and Manipulation |
| 09 Aggregation and statistics | n10 Aggregation and Statistics |
| 10 Random numbers | n14 Random Number Generation |
| 11 Missing values | n18 Masked Arrays and Numerical Robustness |
| 12 Sorting, searching, sets | n12 Sorting, Searching and Set Operations |
| 13 Linear algebra | n15 Linear Algebra |
| 14 File I/O | n16 NumPy File Input and Output |
| 15 Performance and memory | n19 Performance and Vectorization, n13 Copies, Views, Strides and Memory |
| 16 Advanced toolbox | n17, n18 |
| 17 Projects | n20 NumPy Ecosystem and Real-World Applications (plus mini project/lab per module) |
| 18 Interview and mastery | Interview, Defense and Checkpoint sections in every module |

All 18 brief areas are covered; the pack's 20-module split is finer, so nothing is missing between
them.

## 3. Interactive tools (implemented, computed live)

Shared by every module from the module page (`NTools.tsx`), with the arithmetic in the pure
`src/core/learning/numpy-tools.ts` and driven by `scripts/tests/numpy-tools.test.mjs`:

| Tool | What it actually does |
|---|---|
| Array visualizer | Parses a 1–4D shape, prints ndim, size and C-order strides, draws the index grid |
| Broadcasting simulator | Applies the trailing-dimension rule, shows each axis decision, or the exact failure |
| Statistics playground | Population mean/median/std/var, min/max/ptp and p25/p50/p75 (linear interpolation) |
| Matrix lab | Parses `A` and `B`, computes `A @ B` and `A.T`, refuses incompatible shapes |

The existing Code Bro cell panel, quiz cards and rubric-graded short answers are unchanged and remain
part of the same module page.

## 4. Gaps against the brief (real numbers, not marketing)

| Brief item | Status | Gap |
|---|---|---|
| 18 modules | Covered by 20 modules | none in coverage, 2 extra modules |
| 500 unique items per module | Not met | 139 per module; 361 short per module, 7,220 across the course |
| 20–40 topics per module | Not met | 14 authored topics per module (2 added in phase 19) |
| 18 named interactive components | 4 implemented | 14 still missing (slicing, masking, axis, reshape, copy/view, RNG, missing values, linalg, performance, …) |
| Hinglish + English toggle | Partially | course copy is English with Hinglish explanations in authored bodies; no locale switch |
| Voice/AI tutor on the course page | Not wired | platform AI tutor exists elsewhere in the app; no NumPy-context hook yet |
| 12-part lesson format per topic | Partially | topic has intro, code, output, steps; no separate analogy/visual/revision blocks |
| 20 named projects | 1 mini + 1 lab per module = 40 project records | brief's project catalogue not authored one-for-one |

No section displays "500+" or any count it does not have: the UI prints the real per-section record
count, and the progress ledger (`NUMPY_COURSE_IMPLEMENTATION_PROGRESS.md`) tracks the remainder.

## 5. Verification

- `npm run typecheck`, `npm test` (adds the tools suite) and `npm run build` are the gate; there is no CI.
- Every published code/output pair is executed by `scripts/numpy-fill-outputs.cjs`, not hand-typed.
- The live deployment is checked by artifact counts plus byte-identical lazy chunk comparison.
