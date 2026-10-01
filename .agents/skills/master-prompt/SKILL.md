---
name: master-prompt
description: Starting any redesign, restructure, rebuild, audit or deep-testing work in ai-engineer-master-lab (BroCode) — read MASTER-PROMPT.md at the project root before planning, and AGENTS.md before touching src/ or scripts/.
---

Two files own the working agreement for this repository, and neither is restated here:

- **`MASTER-PROMPT.md`** (project root) — the merged master prompt: 18 roles, 12 rules, a 30-phase
  spine across 6 parts, per-phase GATE commands and done criteria, the canonical duplicate-merge
  algorithm, the decision framework, the evidence standard, and **Appendix A** (this repo's real
  facts: the gate commands, the test-loader ceiling, route/duplication couplings, data semantics that
  read one way and behave another, store/offline rules, local-serving quirks, brand surface).
- **`AGENTS.md`** (project root) — operational truth for the same facts. Where the two disagree,
  `AGENTS.md` wins.

Run the repo's own gate (`npm run typecheck`, `npm test`, `npm run build`) before claiming any phase
is done; the master prompt's Evidence Standard explains what counts as proof.
