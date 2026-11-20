#!/usr/bin/env node
/**
 * Machine Learning — Zero to Professional pipeline.
 *
 * Authored source: `content/ml-mastery/course.mjs`.
 * Published artifact: `public/generated/ml-course/index.json`.
 *
 * The generator validates the authored course and expands each module into the SAME ten sections
 * the NumPy/Pandas mastery workspace renders. Every published record is a projection of authored
 * material — a topic body/code/output, a task, a debug challenge, an interview answer, a project
 * brief, a defense answer or a checkpoint question. `expansion-bank.mjs` raises every module to the
 * 500-record contract from six authored concept atoms and ten parameterised drill families; the
 * generated drill solutions are executed by `ml-course.test.mjs`. The published `stats` carry the
 * actual count, not a counter padded to the target.
 *
 * Dry run by default; `--write` publishes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'ml-mastery', 'course.mjs');
const OUT = path.join(ROOT, 'public', 'generated', 'ml-course');
const WRITE = process.argv.includes('--write');

const SECTIONS = [
  ['learn', 'Learn'], ['interview', 'Interview'], ['coding', 'Coding Lab'], ['logic', 'Logic'],
  ['debug', 'Debug'], ['practice', 'Practice Solutions'], ['miniProject', 'Mini Project'],
  ['projectLab', 'Project Lab'], ['defense', 'Defense'], ['checkpoint', 'Checkpoint'],
];
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const difficultyAt = (index) => DIFFICULTIES[index % DIFFICULTIES.length];
const seen = (set, value, where, problems) => {
  if (set.has(value)) problems.push(`${where}: duplicate "${value}"`);
  set.add(value);
};

function buildSections(module) {
  const topics = module.topics ?? [];
  const codeTopics = topics.filter((topic) => topic.code);
  const id = (section, index) => `${module.id}:${section}:${index}`;
  const learn = topics.map((topic, index) => ({
    id: id('learn', index),
    title: topic.title,
    body: topic.body,
    ...(topic.code ? { code: topic.code, output: topic.output } : {}),
    ...(topic.simple ? { simple: topic.simple } : {}),
    ...(topic.pro ? { pro: topic.pro } : {}),
    difficulty: difficultyAt(index),
  }));
  const interview = [
    ...(module.interview ?? []).map((item, index) => ({
      id: id('interview', `a${index}`), q: item.q, answer: item.answer, difficulty: difficultyAt(index),
    })),
    ...codeTopics.map((topic, index) => ({
      id: id('interview', `code${index}`),
      q: `What does this ${topic.title.toLowerCase()} snippet print, and why?`,
      code: topic.code,
      answer: topic.output,
      difficulty: difficultyAt(index + 1),
    })),
  ];
  const coding = (module.coding ?? []).map((task, index) => ({
    id: id('coding', `t${index}`),
    title: task.title,
    statement: task.statement,
    kind: 'task',
    starter: task.starter,
    solution: task.solution,
    expected: task.expected,
    hint: task.hint,
    difficulty: difficultyAt(index),
  }));
  const logic = [
    ...(module.logic ?? []).map((item, index) => ({
      id: id('logic', `a${index}`), q: item.q, answer: item.answer, difficulty: difficultyAt(index),
    })),
    ...codeTopics.map((topic, index) => ({
      id: id('logic', `code${index}`),
      q: `Predict the exact output of this ${topic.title.toLowerCase()} code before you run it.`,
      code: topic.code,
      answer: topic.output,
      difficulty: difficultyAt(index),
    })),
  ];
  const debug = (module.debug ?? []).map((item, index) => ({
    id: id('debug', index), title: item.title, code: item.broken, error: item.error,
    fix: item.fix, difficulty: difficultyAt(index),
  }));
  const practice = [
    ...(module.practice ?? []).map((item, index) => ({
      id: id('practice', `a${index}`), title: item.title, task: item.task,
      solution: item.solution, expected: item.expected, difficulty: difficultyAt(index),
    })),
    ...codeTopics.map((topic, index) => ({
      id: id('practice', `code${index}`),
      title: `Rebuild from memory: ${topic.title}`,
      task: topic.body,
      solution: topic.code,
      expected: topic.output,
      difficulty: difficultyAt(index),
    })),
  ];
  const miniProject = [{
    id: id('miniProject', 0), title: module.mini.title, body: module.mini.brief,
    steps: module.mini.steps, difficulty: 'medium',
  }];
  const projectLab = [{
    id: id('projectLab', 0), title: module.lab.title, body: module.lab.brief,
    steps: module.lab.milestones, difficulty: 'hard',
  }];
  const defense = (module.defense ?? []).map((item, index) => ({
    id: id('defense', `a${index}`), q: item.q, answer: item.answer, steps: item.steps,
    difficulty: difficultyAt(index),
  }));
  const checkpoint = (module.checkpoint ?? []).map((item, index) => ({
    id: id('checkpoint', index), q: item.q, format: item.format ?? 'mcq', answer: item.answer,
    ...(item.options ? { options: item.options } : {}),
    ...(item.code ? { code: item.code } : {}),
    ...(item.solution ? { solution: item.solution } : {}),
    ...(item.expected ? { expected: item.expected } : {}),
    ...(item.why ? { why: item.why } : {}),
    ...(item.rubric ? { rubric: item.rubric } : {}),
    difficulty: difficultyAt(index),
  }));
  return { learn, interview, coding, logic, debug, practice, miniProject, projectLab, defense, checkpoint };
}

async function build() {
  const source = await import(pathToFileURL(SRC).href);
  const course = source.course;
  const modules = source.modules;
  const problems = [];

  for (const key of ['id', 'slug', 'title', 'subtitle', 'tagline', 'description', 'standard', 'level', 'hours', 'tone', 'prerequisites', 'outcomes', 'modules']) {
    if (!course?.[key]) problems.push(`course: missing ${key}`);
  }
  if (course?.id !== 'ml-mastery') problems.push('course.id must be ml-mastery');
  if (!Array.isArray(modules) || modules.length !== 27) problems.push(`expected 27 modules, found ${modules?.length ?? 0}`);
  if (course?.modules?.length !== 27) problems.push('course.modules must list 27 ids');
  if (Array.isArray(course?.modules) && modules?.length === 27) {
    const expected = modules.map((module) => module.id);
    if (JSON.stringify(course.modules) !== JSON.stringify(expected)) problems.push('course.modules must equal the module order');
  }

  const { expandModule } = await import(pathToFileURL(path.join(ROOT, 'content', 'ml-mastery', 'expansion-bank.mjs')).href);
  const moduleIds = new Set();
  const moduleTitles = new Set();
  const courseText = new Set();
  const placeholder = /\b(?:TODO|TBD|lorem ipsum|placeholder|dummy question)\b/i;
  const published = modules.map((module, index) => {
    if (!/^ml\d{2}$/.test(module.id || '')) problems.push(`${module.id || index}: id must be mlNN`);
    if (module.id !== `ml${String(index + 1).padStart(2, '0')}`) problems.push(`${module.id}: id must be ml${String(index + 1).padStart(2, '0')}`);
    if (module.no !== index + 1) problems.push(`${module.id}: no must be ${index + 1}`);
    seen(moduleIds, module.id, 'modules', problems);
    seen(moduleTitles, module.title, 'module titles', problems);
    if (!module.goal) problems.push(`${module.id}: goal is required`);
    if (!['beginner', 'intermediate', 'advanced', 'professional'].includes(module.level)) problems.push(`${module.id}: bad level`);
    if (!(module.hours > 0)) problems.push(`${module.id}: hours must be positive`);
    if (!Array.isArray(module.topics) || module.topics.length < 2) problems.push(`${module.id}: needs 2+ topics`);
    for (const topic of module.topics ?? []) {
      if (!topic.title || !topic.body) problems.push(`${module.id}: every topic needs a title and body`);
      if (topic.code && !topic.output) problems.push(`${module.id}/${topic.title}: code needs a verified output`);
    }
    const sections = buildSections(module);
    const expansion = expandModule(module, sections);
    for (const [key] of SECTIONS) sections[key].push(...(expansion[key] ?? []));
    for (const [key, label] of SECTIONS) {
      if (!sections[key].length) problems.push(`${module.id}: ${label} is empty`);
      const ids = new Set();
      const questions = new Set();
      for (const entry of sections[key]) {
        seen(ids, entry.id, `${module.id}/${label} ids`, problems);
        const text = entry.q || entry.title || '';
        if (text) {
          seen(questions, text, `${module.id}/${label} questions`, problems);
          seen(courseText, text, `${module.id}/${label} course text`, problems);
          if (placeholder.test(text)) problems.push(`${entry.id}: placeholder text in title/question`);
        }
        for (const value of [entry.body, entry.answer, entry.task, entry.statement, entry.error, entry.fix, entry.expected, entry.hint, ...(entry.steps ?? [])]) {
          if (typeof value === 'string' && placeholder.test(value)) problems.push(`${entry.id}: placeholder text in content`);
        }
      }
    }
    for (const entry of sections.checkpoint) {
      if (!String(entry.answer ?? '').trim()) problems.push(`${entry.id}: checkpoint needs an answer`);
      if (!String(entry.why ?? '').trim()) problems.push(`${entry.id}: checkpoint needs an explanation`);
      if (entry.format === 'truefalse') {
        if (!Array.isArray(entry.options) || entry.options.length !== 2) problems.push(`${entry.id}: true/false needs 2 options`);
        if (Array.isArray(entry.options) && new Set(entry.options).size !== 2) problems.push(`${entry.id}: true/false options must be distinct`);
        if (Array.isArray(entry.options) && !entry.options.includes(entry.answer)) problems.push(`${entry.id}: true/false answer must be an option`);
      } else if (entry.format === 'blank') {
        if (!String(entry.code ?? '').includes('___')) problems.push(`${entry.id}: blank checkpoint needs a ___ in its code`);
        if (!entry.solution || !entry.expected) problems.push(`${entry.id}: blank checkpoint needs a solution and expected output`);
      } else if (entry.format === 'output') {
        if (!entry.code) problems.push(`${entry.id}: code-output checkpoint needs code`);
      } else if (entry.format === 'rubric') {
        if (!Array.isArray(entry.rubric) || entry.rubric.length !== 3) problems.push(`${entry.id}: written checkpoint needs 3 rubric lines`);
        if (Array.isArray(entry.rubric) && entry.rubric.some((line) => typeof line !== 'string' || !line.trim())) problems.push(`${entry.id}: rubric lines must be non-empty`);
      } else {
        if (!Array.isArray(entry.options) || entry.options.length !== 3) problems.push(`${entry.id}: MCQ checkpoint needs 3 options`);
        if (Array.isArray(entry.options) && new Set(entry.options).size !== 3) problems.push(`${entry.id}: checkpoint options must be distinct`);
        if (Array.isArray(entry.options) && !entry.options.includes(entry.answer)) problems.push(`${entry.id}: checkpoint answer must be one option`);
      }
    }
    for (const entry of sections.coding) {
      if (!entry.starter || !entry.solution || !entry.expected) problems.push(`${module.id}: coding task needs starter, solution and expected`);
    }
    for (const entry of sections.debug) {
      if (entry.fix === entry.code) problems.push(`${module.id}: debug fix equals broken code`);
    }
    const counts = Object.fromEntries(SECTIONS.map(([key]) => [key, sections[key].length]));
    return { ...module, sections, counts, entries: Object.values(counts).reduce((total, count) => total + count, 0) };
  });

  const bySection = Object.fromEntries(SECTIONS.map(([key, label]) => [
    label, published.reduce((total, module) => total + module.counts[key], 0),
  ]));
  const countBy = (list, key) => list.reduce((acc, entry) => {
    const value = entry[key] || 'unset';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
  const bankModules = {};
  for (const module of published) {
    const sections = module.sections;
    const all = Object.values(sections).flat();
    bankModules[module.id] = {
      total: all.length,
      categories: {
        concept: sections.interview.filter((entry) => !entry.code).length + sections.defense.length,
        output: sections.logic.length + sections.interview.filter((entry) => entry.code).length + sections.checkpoint.filter((entry) => entry.options?.length).length,
        coding: sections.coding.length,
        debugging: sections.debug.length,
        quiz: sections.checkpoint.filter((entry) => entry.options?.length).length,
        written: sections.checkpoint.filter((entry) => entry.rubric?.length).length,
        project: sections.miniProject.length + sections.projectLab.length,
        scenario: sections.interview.filter((entry) => entry.scenario).length,
      },
      difficulty: countBy(all, 'difficulty'),
    };
  }
  const total = published.reduce((sum, module) => sum + module.entries, 0);
  const targetPerModule = 500;
  const stats = {
    modules: published.length,
    entries: total,
    bySection,
    targetPerSection: 50,
    targetTotal: 13500,
    bank: {
      total,
      target: targetPerModule,
      perModule: published.length ? Math.round(total / published.length) : 0,
      shortPerModule: targetPerModule - (published.length ? Math.round(total / published.length) : 0),
      shortfall: published.length * targetPerModule - total,
      modules: bankModules,
    },
  };

  if (problems.length) {
    const error = new Error(`ml-course: ${problems.length} problem(s)`);
    error.problems = problems;
    throw error;
  }
  return { course, stats, modules: published };
}

async function main() {
  try {
    const artifact = await build();
    if (WRITE) {
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(artifact, null, 1)}\n`);
      console.log(`ml-course: published ${artifact.stats.modules} modules, ${artifact.stats.entries} entries → public/generated/ml-course/index.json`);
      for (const [label, count] of Object.entries(artifact.stats.bySection)) console.log(`  · ${label}: ${count}`);
    } else {
      console.log(`ml-course: valid — ${artifact.stats.modules} modules, ${artifact.stats.entries} entries (dry run; --write to publish)`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    for (const problem of error.problems ?? []) console.error(`  · ${problem}`);
    process.exit(1);
  }
}

module.exports = { build, SECTIONS };

if (require.main === module) main();
