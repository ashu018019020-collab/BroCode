# NumPy Mastery — implementation progress

Honest ledger. Counts below are **records that shipped**, not targets. The target from the brief is
50 entries per section (500 per module, 10,000 total). Phases 1–7 delivered the architecture, two
depth passes, a grader, independent task banks and a verified debug lab.

## Shipped so far

| Measure | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 6 | Phase 7 (now) |
|---|---|---|---|---|---|---|---|
| Modules | 20 | 20 | 20 | 20 | 20 | 20 | 20 |
| Sections per module | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| Entries published | 620 | 1,540 | 2,260 | 2,260 | 2,340 | 2,600 | **2,360** |
| Authored topics | 60 | 160 | 240 | 240 | 240 | 240 | 240 |
| Debug challenges | 40 | 60 | 60 | 60 | 60 | 140 | 140 |
| Independent coding tasks | 0 | 0 | 0 | 0 | 80 | 260 | **260** |
| Guided (copyable) coding entries | 60 | 160 | 240 | 240 | 240 | 240 | **0** |
| Coding Lab entries | 60 | 160 | 240 | 240 | 320 | 500 | **260** |
| Coding Lab graded by hidden check | 0 | 0 | 0 | 0 | 80 | 260 | **260 (all)** |
| Debug challenges executed and checked | no | no | no | no | no | yes | yes — 140 |
| Generator validation | passes | passes | passes | passes | passes | passes | passes |

Depth lives in `content/numpy-mastery/deepening*.json`, applied in phase order by the generator.
`scripts/numpy-fill-outputs.cjs` executes every sample, every task solution plus hidden check, and
every debug challenge (broken must raise, fix must run).

### Phase 7 — no copyable coding entries

- The 240 guided coding entries were **removed**, not hidden. Each one was a projection of a taught
  topic, so pasting the lesson passed it. The lesson itself still ships in Learn, Practice, Logic and
  Checkpoint — Coding Lab is now purely independent work.
- Coding Lab is **260 tasks, 13 per module**, every one with its own data and a hidden check the
  grader runs in the learner's kernel namespace. A copied snippet defines nothing the check asserts,
  so it fails.
- Entry count moved from 2,600 to 2,360. That is deliberate: the missing 240 were duplicates of
  lesson content that could be passed without writing code.

### Per section (course total)

| Section | Entries | Target | Remaining |
|---|---|---|---|
| Learn | 240 | 1,000 | 760 |
| Interview | 480 | 1,000 | 520 |
| Coding Lab | 260 | 1,000 | 740 |
| Logic | 240 | 1,000 | 760 |
| Debug | 140 | 1,000 | 860 |
| Practice Solutions | 240 | 1,000 | 760 |
| Mini Project | 20 | 1,000 | 980 |
| Project Lab | 20 | 1,000 | 980 |
| Defense | 240 | 1,000 | 760 |
| Checkpoint | 480 | 1,000 | 520 |
| **Total** | **2,360** | **10,000** | **7,640** |

### Per module

Every module ships **118 entries**: 12 Learn, 24 Interview, 13 Coding (all independent), 12 Logic,
7 Debug, 12 Practice, 1 Mini Project, 1 Project Lab, 12 Defense, 24 Checkpoint.

## What is real today

- Every entry is module-specific and projected from authored material.
- Duplicate ids and duplicate question text are rejected by the generator per section.
- All 260 coding reference solutions and hidden checks are executed against real NumPy by the test
  suite whenever Python is present; a skip is reported when it is not, never a pass.
- Every debug challenge is executed: 133 raise, 7 are wrong-output lessons, and every fix runs.
- Coding Lab grades a real run against a hidden check. Progress needs all ten sections.

## Remaining work (phases 8+)

1. Raise independent coding tasks from 13 to 25+ per module now that Coding Lab has no filler.
2. Author the interview and defense banks to 50 independent answers per module. They are still derived
   from topics, so one topic body reappears in Learn, Interview, Practice and Defense.
3. Raise Debug from 7 to 20+ per module; each new one is execution-verified the same way.
4. Add multi-choice distractors to Checkpoint instead of only "predict the output".
5. Raise authored topics beyond 12 per module and split the hardest modules.
6. Wire per-module notebooks for Code Bro when a lab needs a starter file.

No section is marked "50+" in the UI: it prints the real count.
