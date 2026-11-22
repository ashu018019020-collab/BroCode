'use strict';

/**
 * Content-diversity gate for the Pandas Mastery coding tasks.
 *
 * The hard gate is intentionally per module: the course repeats the same warm-up exercises across
 * modules on purpose, but a module's own task bank must not repeat itself. A module fails when two
 * tasks ask the same thing, when a title is only filler, or when two tasks use the same solution.
 */

/*
 * Titles made only of these words say nothing about the task. Keeping the list as tokens (instead of
 * one large regex) also catches bare prefixes such as "Warm up" or "Pandas" that the old pattern let
 * through, while a title like "Practice with groupby" keeps its meaningful word and passes.
 */
const TITLE_FILLER = new Set([
  'pandas', 'dataframe', 'frame', 'data', 'dataset', 'series', 'python',
  'coding', 'code', 'programming', 'mini', 'practice', 'quick', 'warm', 'warmup', 'up', 'bonus',
  'task', 'tasks', 'exercise', 'exercises', 'problem', 'problems', 'question', 'questions',
  'challenge', 'challenges', 'activity', 'activities', 'assignment', 'assignments',
  'lab', 'labs', 'project', 'projects', 'example', 'examples', 'demo', 'demos',
  'solution', 'solutions', 'answer', 'answers', 'untitled', 'todo', 'try', 'it', 'your', 'turn',
  'no', 'number', 'part', 'a', 'an', 'the', 'of', 'for', 'to', 'in', 'on', 'with', 'using', 'and', 'or', 'by', 'from',
]);

/** Case/whitespace-insensitive text key; trailing sentence punctuation is ignored. */
function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '')
    .trim();
}

/** Code key: collapse whitespace but preserve case, because column names are case-sensitive. */
function normalizeCode(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A title is generic when nothing remains after filler words, numbers, and a `(pNN)` suffix. */
function isGenericTitle(value) {
  const meaningful = normalizeText(value)
    .replace(/\(p\d{2}\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((word) => !/^\d+$/.test(word) && !/^p\d{2}$/.test(word) && !TITLE_FILLER.has(word));
  return meaningful.length === 0;
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
  const solutionOwners = new Map();

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

    const solutionKey = normalizeCode(task?.solution);
    if (solutionKey) {
      if (solutionOwners.has(solutionKey)) {
        problems.push(`${moduleId}: task ${at} repeats the solution of ${solutionOwners.get(solutionKey)}`);
      } else {
        solutionOwners.set(solutionKey, at);
      }
    }
  }

  return problems;
}

module.exports = { validateTaskDiversity };
