# Java Workspace & Execution Fix

**Date:** 2026-11-10
**Scope:** Java topic pages, Java Code Bro playground, frontend-to-Judge0 execution.
**Rule:** every result below is from a command that was actually run. No compiler result is simulated.

---

## 1. Root cause of the failing Java boxes

The Java code boxes were not failing because of the browser, CSS or the run button. They were failing
**before compilation**, for a single-file reason:

> Judge0 saves every Java submission as `Main.java` and runs `Main`. The authored course contains
> complete classes with other names (for example `public class Student`) and bare statement snippets.
> A different public class fails with “class Student is public, should be declared in Student.java”,
> and a bare snippet fails at its first statement.

Evidence in the content:

- `public class Main` — 996 occurrences.
- `public class Student` — 2 occurrences (a public class Judge0 cannot compile in `Main.java`).
- Topic snippets such as `for (...) { ... }`, `List<String> names = ...` and
  `interface Discount { ... }` — not compilation units at all.

The old verifier only compiled examples, coding solutions, debug fixes, labs and projects; it never
compiled the `topics[].code` / `syntax[].code` snippets that the **Try this code** buttons send. That
is why the course could pass verification while those boxes failed for learners.

## 2. The permanent fix

`shared/java-source.mjs` (with `shared/java-source.d.mts`) prepares every submission once:

- a complete `Main` program is left byte-for-byte alone;
- a different public (or package-private) top-level type is renamed to `Main` with a token-aware
  scanner that does **not** rewrite comments, strings, chars or text blocks;
- a bare snippet is wrapped in `public class Main { public static void main(String[] args) { ... } }`,
  keeping leading imports and comments.

It is used by:

- `server/j-runner.mjs` — the Vercel/API path;
- `src/core/data/jcourse.ts` — the direct-Judge0 browser fallback, so both paths behave identically.

The JDK still compiles and runs the result. Invalid syntax still returns the real `Main.java`
diagnostic; the client never converts a compile error into a pass.

### Real execution proof

Run through the actual `createJavaExecutor` against `https://ce.judge0.com`:

| Case | Input | Result |
|------|-------|--------|
| `public class Student` with `Scanner` | `Ashu\n22` | `Accepted`; stdout `Name: Ashu\nAge: 22` |
| Bare loop snippet | none | `Accepted`; stdout `1 2 3` |
| Deliberately invalid Java | none | `Compilation Error`; real `Main.java:1: illegal start of expression` |

**3/3 probes passed.** This is real Judge0 execution, not a frontend simulation.

## 3. Topic Learning Workspace

`src/features/java-programming/JLessonPage.tsx` is now the ten-stage workspace, using the same shared
chrome as the Python lesson:

- `SectionHero`: section number, title, description, level/time, status, mastery ring and real counts
  (Learn Q&A, Interview, Coding Lab, Practice, total Q&A).
- `StageGrid`: all ten BroCode stages with real counts and measured progress:
  Learn, Interview, Coding Lab, Logic, Debug, Practice Solutions, Mini Project, Project Lab, Defense,
  Checkpoint.
- `StagePlan` (“Plan ahead”): the next real stages, the Next Best Action and the next module.
- `UtilityStrip`: Notes, Resources, AI Tutor, Progress, Goals, Review, Settings, Focus Mode, Timed Test.
- `LessonCoach`: Next Best Action, Today’s Goal, mistakes and AI Tutor.
- Topic notes are persisted through the existing `upsertNote`/`newNote` store; Resources link to
  dev.java and the Java 21 API.

Each stage renders authored content, not placeholders:

| Stage | Source |
|-------|--------|
| Learn | definition, explanations, Hinglish, syntax, topics, examples, mistakes, debug, best practices, revision |
| Interview | module interview answers plus the module’s bank questions, deduplicated |
| Coding Lab | module coding-bank questions, statement, constraints, hints, reference solution, runnable tests |
| Logic | module MCQs, recorded per question |
| Debug | module debugging-bank challenge, broken code, hints, fix, runnable expected output |
| Practice Solutions | authored prompts and hints |
| Mini Project | module/selected lab with tests and solution |
| Project Lab | module projects, features and starter |
| Defense | checkpoint checks and objectives |
| Checkpoint | knowledge check, module assessment, completion checklist |

Progress is written to real families: `jquiz:<module>:<i>`, `jcoding:<id>`, `jdebug:<id>`,
`jlab:<module>`, `jstage:<module>:<stage>`, `jcourse:<module>:test`,
`jcourse:<module>:checkpoint`. No page view marks a stage done; self-study stages require an explicit
“Mark studied” action.

## 4. Java Code Bro playground

`JNotebook.tsx` now has:

- Run all, Stop, Restart, Reset cells, Add cell, Download `.ipynb`.
- Multiple cells with per-cell Run, Reset, Copy, Save, delete, move up/down and Previous/Next navigation.
- A global **PROGRAM INPUT** box passed as stdin to every run.
- Separate compilation error, runtime error, stdout, tests and status/time panels.
- Session counter and the honest label **independent files** — Java cells do not share variables.
- Local persistence of cells and stdin; download as a notebook JSON file.
- AbortController-backed Stop. Judge0 has no cancel endpoint, so Stop stops this tab waiting and says
  the remote sandbox may finish; it is not presented as a remote kill.

The editor keeps Java 17 labels; no Python runtime badge is rendered.

## 5. Verification run

```
npm run typecheck                       → exit 0
npm test                               → 978 tests, 0 fail (after the aria-label fix)
npm run build                          → success
real Judge0 probes                     → 3/3
```

Focused tests added/updated:

- `scripts/tests/java-source.test.mjs` — 7 normalization cases.
- `scripts/tests/java-workspace.test.mjs` — ten stages, controls, execution wiring, mobile rules.
- `scripts/tests/jcourse.test.mjs` — existing content/rules contract.
- `scripts/tests/mobile-overflow.test.mjs` — Java containment class and editor label.

## 6. Remaining limitations (not claimed as done)

- **Browser/mobile visual testing was not performed.** There is no browser session in this
  environment; layout is guarded by source-level responsive tests, not screenshots.
- **No persistent Java kernel.** Java cells are independent compilations; JShell is not enabled, so
  variables do not survive from one cell to the next. The UI says so.
- **Hidden coding tests are still present in the published JSON.** The client filters nothing; a
  determined learner can read expected outputs. Moving evaluation server-side is a separate change.
- **Stop is abort-waiting, not remote cancellation** (Judge0 limitation, explained above).
- The course still has **20 modules**, not the 27-module brief; this work did not rename modules or
  orphan existing progress.
- Notes are stored in the learner’s BroCode state (the same store as the Notes page), not a new
  per-topic database table.
