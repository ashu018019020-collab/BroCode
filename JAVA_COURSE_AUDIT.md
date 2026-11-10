# Java Course Audit — BroCode

Audit date: 2026-11-10. Scope: the Java Programming course as it exists in this repository
(`content/java-programming/**` → `scripts/java-course.cjs` → `public/generated/java-course/**` →
`src/core/{learning,data}/jcourse.ts` → `src/features/java-programming/*`, routes `/java` and
`/java/:moduleId`).

This is a **content audit**, not a claim that the requested 13,500-entry target is met. The measured
numbers below show the real gap.

## 1. What exists (measured)

| Layer | Files | State |
|---|---|---|
| Authored content | `content/java-programming/course.json`, `modules/j01..j20.json`, `coding/01..04`, `debugging/01..02`, `interview/01..02`, `labs.json`, `projects.json`, `assessments.json`, `final.json` | Complete and validating |
| Generator | `scripts/java-course.cjs` (+ `--write`) | 20 modules, all lesson blocks, 100/50/80/20/15/20 minimums enforced |
| Compiler verification | `scripts/java-verify.cjs` | 410 run cases compile and match on a real JDK |
| Runtime data layer | `src/core/data/jcourse.ts` | Loaders + `runJava` (app proxy → keyless Judge0 CE, language 91) |
| Execution | `server/j-runner.mjs`, `api/java/execute.js`, `server/app.mjs` `/api/java/*` | Validation, 12/min budget, 40 KB source, 8 tests, single file, honest 503/504 |
| Pure rules | `src/core/learning/jcourse.ts` | progress, quiz/coding/debug tallies, certificate, keys |
| UI | `src/features/java-programming/{JCoursePage,JLessonPage,JNotebook}.tsx` | 10 hub tabs, full lesson, runnable notebook |
| Routes | `src/app/App.tsx` (`/java`, `/java/:moduleId`, both `<Protect>`) | Registered, allowlisted, in sitemap |

## 2. Course shape

- **20 modules**, not 27. The 27-module reference curriculum splits several existing chapters
  (install/setup, constructors/encapsulation, Maven/Gradle, REST/Spring, JVM internals, testing).
  Existing modules are preserved rather than renumbered.
- 143 topics, 40 examples, 60 practice prompts, 165 MCQs (incl. assessments/final), 120 interview
  entries (80 bank + 40 module), 100 coding questions, 50 debugging challenges, 40 labs
  (20 module + 20 practical), 15 projects, 103–138h depending on count method.
- Modules `j01`–`j20`; ids are stable and referenced by storage keys (`jquiz:`, `jlab:`,
  `jcoding:`, `jdebug:`, `jcourse:`).

## 3. Ten-section audit per module

Measured counts (read from the published artifacts; `scripts/java-coverage.cjs` reproduces this):

| Section | Source in the current course | Min / max per module | Required | Status |
|---|---|---:|---:|---|
| 01 Learn | topics + syntax + examples + mistakes + best + revision | 20 / 22 | 50 | below |
| 02 Interview | module `interview` + bank filtered by module | 2 / 20 | 50 | below |
| 03 Coding Lab | `coding` bank filtered by module | 0 / 16 | 50 | below |
| 04 Logic | — (no logic bank exists) | 0 / 0 | 50 | missing |
| 05 Debug | `debugging` bank + module `debug` | 1 / 7 | 50 | below |
| 06 Practice Solutions | module `practice` prompts | 3 / 3 | 50 | below |
| 07 Mini Project | `projects` filtered by module | 0 / 3 | 50 | below |
| 08 Project Lab | same projects (no separate track) | 0 / 3 | 50 | below |
| 09 Defense | advanced bank questions per module | 0 / 17 | 50 | below |
| 10 Checkpoint | 3 module MCQs + 4 assessment MCQs | 7 / 7 | 50 | below |

**Per-module totals: roughly 33–90 entries, never 500.** The requested 27 × 500 = 13,500 is not met.
No counts are inflated: every number above comes from authored content.

Modules with zero coding questions: j07 (Methods), j09 (OOP). Modules with zero projects: most.
There is no logic bank at all, and defense is a filtered view of the interview bank rather than its
own 50-item per-module bank.

## 4. Execution and quality evidence

- `node scripts/java-verify.cjs --only=examples` → 60/60 cases match.
- `--only=labs` → 85/85, `--only=coding` → 200/200, `--only=debug` → 50/50, `--only=projects` → 15/15.
- Compiler is Judge0 CE **JDK 17.0.6**, so all runnable code avoids Java 21-only runtime features.
  JDBC/Spring/Maven material is illustrative (`code` fields), never compiled.
- `npm run typecheck` clean; `npm test` 940 pass / 0 fail / 6 skipped; `npm run build` succeeds.

## 5. UI, progress, admin

- Hub tabs: Overview, Curriculum, Coding, Debugging, Labs, Projects, Interview, Tests, Final, Progress.
- Progress uses `checkpointKey`, `testKey`, `jQuizTally`, `codingTally`, `debugTally`; certificate
  requires all checkpoints plus the final pass mark. No percentage is derived from page views.
- Admin: the course is content-driven and appears in the shared Courses grid; there is no
  Java-specific admin CRUD screen, and content is not stored in Supabase (files + generated JSON).
  Idempotent import is therefore the generator (`--write` overwrites 9 artifacts deterministically).

## 6. Gap list (ordered)

1. A **Logic** bank: 50 predict-output/trace items per module (1,000 for 20 modules).
2. Per-module interview growth from 2–20 to 50 (bank + module-authored).
3. Per-module coding growth from 0–16 to 50.
4. Per-module debug growth from 1–7 to 50.
5. Per-module practice growth from 3 to 50 (with solutions).
6. 50 mini-projects **per module** and a separate 50-item project-lab track.
7. Defense bank separate from the interview bank, 50 per module.
8. Checkpoint growth from 7 to 50 per module.
9. Learn entries from ~21 to 50 per module (definitions, comparisons, dry runs, revision).
10. Reconcile 20 existing modules with the 27-module reference (split, do not renumber).

At 20 modules × 10 sections × 50 = **10,000 Java entries** minimum; at 27 modules it is 13,500. The
current course holds roughly 1,200–1,500 total entries across all sections.

## 7. Constraints for the build-out

- Every runnable Java sample must compile on JDK 17 and pass `java-verify`; no fake execution.
- Storage keys are immutable once learners have progress; new sections need new key families.
- `public/generated/**` is generator output; only `content/**` is authored.
- Route changes require `EXTRA_PATHS`/`PATH_ROUTE_ALLOWLIST`, sitemap regeneration and tests.
- Do not touch the Python curriculum or the C course while expanding Java.
