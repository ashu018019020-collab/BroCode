# C++ Mastery — implementation progress

Honest ledger for the C++ course. Counts are **records that shipped**, not targets.

## Shipped

| Measure | Value |
|---|---|
| Course page | `/cpp` (own route, `Protect`-wrapped, in the sitemap) |
| Course card | `/courses` grid, own C++ mark, beside C, Java, NumPy and Pandas |
| Modules | 26 (`cpp01`…`cpp26`), ten learning sections each |
| Published entries | **2,498** |
| Authored topics | 260 — ten per module, every program compiled and run with g++ 13.3 (`-std=c++17`) |
| Debug challenges | 130 — five per module (broken program + real compiler/runtime error or declared wrong output + executed fix) |
| Independent coding tasks | 131 — at least five per module (expected output executed) |
| Interview bank | 260 verified-output questions beside 261 authored Q&A — **20+ per module** |
| MCQ bank | 52, four distinct options each with an answer in them |
| Defense bank | 52 authored Q&A with steps |
| Mini projects / Project Labs | 26 / 26 |

Published section counts: Learn 260, Interview 521, Coding Lab 131, Logic 260, Debug 130,
Practice Solutions 260, Mini Project 26, Project Lab 26, Defense 52, Checkpoint 832.
Per module: **Learn 10, Logic 10, Practice 10, Interview 20+**, Coding 5, Debug 5, MCQ 2,
Defense 2.

## Architecture (same as NumPy and Pandas Mastery, separate records)

- `content/cpp-mastery/` is the only authored source: `course.json` + `modules-*.json`.
- `scripts/cpp-fill-outputs.cjs` compiles every topic, every debug fix and every task solution with
  `g++ -std=c++17 -pthread` in a throwaway directory and stores what the binary actually printed. A
  debug entry must fail to compile, fail at runtime, or print a declared wrong result whose fix
  prints something different.
- `scripts/cpp-course.cjs` validates the source and publishes ONE artifact,
  `public/generated/cpp-course/index.json`; `--write` publishes, the default is a dry run.
- `src/core/learning/cppcourse.ts` owns the rules (`cppmod:<module>:<section>` progress, report,
  search); `src/core/data/cppcourse.ts` is the loader; `src/features/cpp-mastery/` holds the page and
  the mark. The `pmod:` and `nmod:` families are untouched, so no C++ record can complete a Pandas or
  NumPy module.

## Regenerating

```
node scripts/cpp-fill-outputs.cjs     # recompile every sample → outputs
npm run cpp-course:write              # validate + publish the artifact
npm run cpp-course                    # dry run only
```

## Not done (stated, not hidden)

1. **Question volume is below the brief.** The brief asks for 7 sections × 50 questions × 26
   modules = 9,100 items plus a 1,000-question Interview Masterclass. The artifact is now 2,338
   entries (90 per module): layer 1 added 52 compiled topics, 52 interview answers and 52 MCQs;
   layer 2 added 79 compiled coding tasks and 52 debug pairs; layer 3 added **132 compiled topics**,
   which raised **Learn, Logic and Practice to 10 per module (260 each)**; layer 4 added **78 compiled
   interview snippets plus 82 Q&A**, bringing **Interview to 20+ per module (521 total)**. Coding Lab
   and Debug are at the **5 per module minimum (131 / 130)**. Every section is still far from 50, and
   the artifact records `targetPerSection` so the page prints the shortfall instead of implying
   completeness.
2. **No C++ execution in the browser lab.** The samples were verified with a local g++ 13.3; the
   shipped Pyodide runtime cannot compile C++, so the Playground still runs Python only. Wiring a
   real isolated C++ compiler service is a separate piece of infrastructure and was not faked.
3. **No 20 visualisers.** The course has no pointer, stack/heap, inheritance or algorithm visualiser
   yet; the existing NumPy/Pandas tools are untouched.
4. **AI Tutor and Voice Tutor still resolve NumPy/Pandas context**, not this course.
5. **No project library beyond the 26 mini/lab briefs**, no CMake/multi-file starter project, no
   Hinglish/English level toggle for these topics, and no C-to-C++ bridge route.
6. **No per-course test suite for C++.** The generator validates the artifact; `npm test` does not
   yet load this course's rules under fixtures the way the NumPy course is tested.

## Verification

`npm run typecheck` clean · `npm test` 1089 pass, 0 fail · `npm run build` ok (`CppCoursePage-*.js`
emitted) · `npm run sitemap:write` → 161 URLs · every topic, debug fix and task executed by
`scripts/cpp-fill-outputs.cjs` against g++ 13.3.
