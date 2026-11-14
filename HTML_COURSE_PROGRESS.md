# HTML Mastery — build ledger

The HTML course shipped through the same pipeline as C++, NumPy and Pandas:

```
content/html-mastery/**.json   authored source (the only place content is edited)
scripts/html-course.cjs        validates + projects the ten sections
public/generated/html-course/index.json   published artifact (generated; never hand-edited)
src/core/learning/htmlcourse.ts           pure rules, own `htmlmod:` storage family
src/core/data/htmlcourse.ts               loader for the artifact
src/features/html-mastery/                page, official HTML5 mark, sandboxed playground
```

## Published counts (counted from the artifact, 2026-11-14)

| Section | Records |
| --- | ---: |
| Learn | 60 |
| Interview | 100 |
| Coding Lab | 20 |
| Logic | 60 |
| Debug | 40 |
| Practice Solutions | 60 |
| Mini Project | 20 |
| Project Lab | 20 |
| Defense | 40 |
| Checkpoint | 236 |
| **Total** | **656** |

20 modules, 32–35 records each. Difficulty split: 209 easy, 286 medium, 161 hard.

Question-bank categories (an item can count in more than one, so these do not sum to 656):
concept 80, output 280, quiz 160, written 60, coding 20, debug 40, project 40.

Quiz composition: 40 authored MCQs, 60 true/false, 60 fill-in-the-blank, plus topic prediction
checkpoints. Written checkpoints carry a three-line self-assessment rubric.

## What was actually verified

- `node scripts/html-course.cjs` (dry run) and `--write`: 20 modules, 656 entries, no duplicate ids,
  no duplicate question text inside a section, no empty section, every MCQ answer is one of its four
  options, every coding task and debug fix carries an output.
- `npm run typecheck`: clean.
- `npm test`: 1089 pass, 0 fail (includes the one-h1 page contract and the route/path coverage test).
- `npm run build`: succeeds; `/html` and `/generated/html-course/index.json` return 200 on the dev server.
- Playground preview is a sandboxed iframe (`sandbox="allow-scripts"`, no `allow-same-origin`), so
  learner markup cannot read app storage/cookies or navigate the parent page.

**Not executed:** HTML has no compiler here. Every recorded `output`/`expected` is authored from the
markup in the lesson and reviewed by inspection, not produced by a compiler or headless browser run.
The C++ ledger's "compiled with g++" guarantee does **not** apply to this course. The playground is
the execution path for learners.

## Wiring

- Route `/html` (protected, lazy) and `/html?module=htmlNN&section=...`.
- Course card in `/courses`, rendered before the CSS and JavaScript cards.
- `PATH_ROUTE_ALLOWLIST` entry so the path-coverage test stays honest.
- `npm run html-course` / `html-course:write`.
- Own keys: `htmlmod:<module>:<section>`, `htmlans:<entry>` drafts, `htmllast` resume point.
- Shared AI tutor card receives the learner's document as context.

## Gaps against the full brief — honest list

1. **Coding labs: 20 shipped, 150 requested.** One independent lab per module; the growth layers have
   not been authored yet.
2. **Projects: 20 mini projects + 20 labs shipped, the 15 curated projects and the capstone rubric
   are not.** Module 20 teaches the capstone structure but no separate graded rubric page exists.
3. **Logic/Debug: 60 + 40 shipped, 100 + 100 requested.** Growth layers still open.
4. **Interview: 100 shipped**, which meets the "at least 100" target; the scenario and follow-up
   depth is one follow-up field, not the full nine-field interview card.
5. **Playground** covers editor, Run, Reset, Copy, Example, Clear, full-screen, responsive widths and
   per-module drafts. It does not compare learner output against a lab's expected result, and it has
   no HTML-specific starter templates beyond the default document and the semantic example.
6. **AI/voice tutor**: the existing assistant is reused with the document as context. There are no
   HTML-specific tutor prompts, and voice behaviour is whatever the global assistant provides.
7. **Admin**: no new admin surface. The course is a generated artifact like C++ and is not editable
   from the Owner Control Center; content changes go through `content/html-mastery/` + the generator.

## Next growth (in order)

1. `deepening-1.json`: one extra topic, one extra coding task and one extra debug pair for each of the
   20 modules (→ 40 labs, 80 debug).
2. `deepening-2.json`: 5 interview questions and 3 MCQs per module (→ 200 interview, 100 MCQ).
3. `deepening-3.json`: the 15 curated projects with requirements, starter, rubric and reference
   solution, surfaced as a Projects tab on the course page.
4. Playground: per-lab expected-output comparison and lab starter templates.
