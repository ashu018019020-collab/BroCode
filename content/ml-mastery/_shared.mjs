/** Tiny constructors keep the authored ML source readable; the generator owns the schema. */
export const t = (title, body) => ({ title, body });
export const c = (title, body, code, output) => ({ title, body, code, output });
export const q = (q, answer) => ({ q, answer });
export const k = (title, statement, starter, solution, expected, hint) => ({ title, statement, starter, solution, expected, hint });
export const d = (title, broken, error, fix) => ({ title, broken, error, fix });
export const m = (q, options, answer, why) => ({ q, options, answer, why });
export const p = (title, task, solution, expected) => ({ title, task, solution, expected });
export const mini = (title, brief, steps) => ({ title, brief, steps });
export const lab = (title, brief, milestones) => ({ title, brief, milestones });
export const def = (q, answer, steps) => ({ q, answer, steps });
