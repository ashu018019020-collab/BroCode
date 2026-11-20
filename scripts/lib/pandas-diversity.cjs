'use strict';

/**
 * Content-diversity gate for the Pandas Mastery coding tasks.
 *
 * The gate is intentionally scoped to one module: the course repeats the same four warm-up
 * exercises in every module on purpose, but a module's own task bank should not repeat itself.
 * A module fails when two tasks ask the same thing, when a task title is a placeholder, or when
 * the tasks collapse onto only a handful of distinct solutions.
 */

const GENERIC_TITLE = /^(?:(?:pandas|dataframe|series|python|data|coding|code|mini|practice|quick|warm[\s-]?up|bonus)\s+)*(?:task|exercise|practice|problem|question|challenge|activity|assignment|lab|project|mini[\s-]?project|example|demo|solution|answer|untitled|todo|try[\s-]?it|your[\s-]?turn)(?:\s*(?:#|no\.?)?\s*\d+)?$/;

/** Case/whitespace-insensitive text key; trailing sentence punctuation is ignored. */
function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

/** A title is generic when it is only a placeholder word (plus optional numbering/module suffix). */
function isGenericTitle(value) {
  const cleaned = normalizeText(value)
    .replace(/\(p\d{2}\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return !cleaned || !/[a-z]/i.test(cleaned) || GENERIC_TITLE.test(cleaned);
}

/**
 * Return the diversity problems for one module's tasks. Empty means the bank is diverse enough.
 * @param {Array<{title?: string, statement?: string, solution?: string}>} tasks
 * @param {string} moduleId
 * @returns {string[]}
 */
function validateTaskDiversity(tasks, moduleId = 'module') {
  if (!Array.isArray(tasks)) return [`${moduleId}: tasks must be an array`];

  const problems = [];
  const statementOwners = new Map();
  const titleOwners = new Map();
  const solutions = [];

  for (const [index, task] of tasks.entries()) {
    const at = task?.title ? `"${task.title}"` : `task ${index + 1}`;

    const titleKey = normalizeText(task?.title).replace(/\s*\(p\d{2}\)\s*$/, '').trim();
    if (isGenericTitle(task?.title)) {
      problems.push(`${moduleId}: task ${at} has a generic title`);
    } else if (titleKey && titleOwners.has(titleKey)) {
      problems.push(`${moduleId}: task ${at} repeats the title of ${titleOwners.get(titleKey)}`);
    }
    if (titleKey) titleOwners.set(titleKey, at);

    const statementKey = normalizeText(task?.statement);
    if (statementKey) {
      if (statementOwners.has(statementKey)) {
        problems.push(`${moduleId}: task ${at} repeats the statement of ${statementOwners.get(statementKey)}`);
      } else {
        statementOwners.set(statementKey, at);
      }
    }

    const solutionKey = normalizeText(task?.solution);
    if (solutionKey) solutions.push({ at, key: solutionKey });
  }

  if (tasks.length >= 2) {
    const distinct = new Set(solutions.map((s) => s.key)).size;
    const required = Math.max(2, Math.ceil(tasks.length / 2));
    if (distinct < required) {
      problems.push(
        `${moduleId}: ${tasks.length} tasks use only ${distinct} distinct solution${distinct === 1 ? '' : 's'} (need ${required})`,
      );
    }
  }

  return problems;
}

module.exports = { validateTaskDiversity, isGenericTitle, normalizeText, GENERIC_TITLE };
