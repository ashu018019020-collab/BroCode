# Java Course — Implementation (master-prompt checklist)

Status date: 2026-11-10. This is the phase-by-phase record for the 20-module Java Programming course.
It reflects what is actually published and verified; it does not claim a phase is done when it is not.

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 1 | Deep project audit (Python reference, content pipeline, storage, execution) | Done — content is file-published, progress is per-account in Supabase/local records |
| 2 | Java course identity and description | Done — hub hero, catalog card, search entry |
| 3 | 20-module curriculum with full topic sequence | Done — `j01`–`j20`, 143 topics |
| 4 | 20-section lesson structure (objectives → practice) | Done — objectives, prerequisites, definition, English + Hinglish, analogy, why, syntax, topics, code walkthrough, output, dry run, notes, mistakes, tips, revision, quiz, practice |
| 5 | 100+ coding questions | Done — 100 (30/40/30) with hidden tests, solutions, complexity, hints |
| 6 | 80+ interview questions | Done — 80-question bank (25/30/25) + 40 module questions |
| 7 | 50+ debugging challenges + Debug Mode | Done — 50 challenges with broken/fixed code, error, tests, hints |
| 8 | 20 practical labs | Done — 20 module labs + 20 practical labs (40 total) |
| 9 | 15 projects with full instructions | Done — 15 (5/5/5) with architecture, schema, steps, testing, errors, README |
| 10 | Java course UI | Done — Overview, Curriculum, Coding, Debugging, Labs, Projects, Interview, Tests, Final, Progress |
| 11 | Interactive editor and execution | Done — Monaco notebook, Run/Submit/Reset, stdin, real javac via `/api/java/execute` |
| 12 | Database and progress tracking | Done within the existing model — attempts are stored generically and counted by `practicedCount`/`doneRecords`, which sync to `progress_snapshots`; no Java-specific tables invented |
| 13 | Quality control | Done — 410 real compile/run cases, generator validation, acceptance test, typecheck/tests/build |
| 14 | Admin control | Partial — `/admin/content` now shows Java and C publishing counts and links; content editing remains generator-driven (as Python's does), not DB CRUD |
| 15 | Execution strategy and checkpoints | Done — documented in `JAVA_COURSE_AUDIT.md` and `JAVA_COURSE_IMPLEMENTATION_PROGRESS.md` |

## Acceptance checklist (master prompt)

- [x] Java course appears in the course catalog (`/courses` card, `/java` route).
- [x] Follows the Python course architecture (`content/` → generator → `public/generated/` → data loader → feature page).
- [x] All 20 modules available.
- [x] Lessons contain complete educational material (no placeholders).
- [x] At least 100 coding questions (exactly 100).
- [x] At least 80 interview questions (80 + 40 module-level).
- [x] At least 50 debugging challenges (50).
- [x] At least 20 practical labs (40 including module labs).
- [x] At least 15 projects (15).
- [x] Java editor works when the execution environment is configured (`JUDGE0_URL`); it reports honestly when not.
- [x] Java code compiles and is tested securely (proxy to Judge0, validation, budgets, timeouts).
- [x] Student progress saves (module checkpoints, quiz scores, coding/debug verdicts, final, certificate).
- [~] Admin can view/publish course status; lesson-level CRUD is not implemented for Java or Python.
- [x] Mobile layout covered by the existing overflow guard; all new blocks use clamped/grid widths.
- [x] Existing Python course unaffected (tests green).
- [x] No broken routes (registered, allowlisted, sitemap regenerated, route tests).
- [x] All applicable tests pass (`npm run typecheck`, `npm test`, `npm run build`).

## How to verify

```
npm run java-course                 # validate authored content
npm run java-course:write           # republish the 9 artifacts
npm run java:verify                 # real JDK compile/run of all runnable code
node --test scripts/tests/java-acceptance.test.mjs
npm run typecheck && npm test && npm run build
```

## Known limits (not hidden)

- Execution requires `JUDGE0_URL` on the server; without it the notebook says the compiler is not
  connected and never fakes a result. The app never executes learner code in-process.
- Content is not stored in Postgres. It is published files, identical to the Python/C courses; admin
  editing is therefore a generator + deploy workflow, not a per-row CRUD screen.
- Per-module expansion to 50 entries in all ten sections (the separate 500/module brief) is measured
  in `JAVA_COURSE_AUDIT.md`: 968 entries currently, with the batch plan to close it.
