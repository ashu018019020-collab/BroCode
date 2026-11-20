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
const CAPSTONE = path.join(ROOT, 'content', 'ml-mastery', 'capstone.json');
const LABS = path.join(ROOT, 'content', 'ml-mastery', 'labs.json');
const DATASETS = path.join(ROOT, 'content', 'datasets', 'ml', 'datasets.json');
const NOTEBOOKS = path.join(ROOT, 'content', 'notebooks');
const COLAB = path.join(ROOT, 'content', 'colab-ml');
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

  /*
   * The course-level capstone is one assessable project, separate from ml27's project lab. Its
   * rubric is the evidence checklist the UI ticks, so the weights must total 100 and every row
   * needs evidence a reviewer could actually inspect.
   */
  let capstone = null;
  try {
    capstone = JSON.parse(fs.readFileSync(CAPSTONE, 'utf8'));
  } catch (error) {
    problems.push(`capstone: could not read content/ml-mastery/capstone.json (${error.message})`);
  }
  if (capstone) {
    if (!String(capstone.title || '').trim() || !String(capstone.brief || '').trim() || !String(capstone.dataset || '').trim()) {
      problems.push('capstone: title, brief and dataset are required');
    }
    if (!capstone.starter?.code || !capstone.starter?.output) problems.push('capstone: starter code and executed output are required');
    if (!Array.isArray(capstone.tiers) || capstone.tiers.length !== 3) problems.push('capstone: three tiers are required');
    for (const tier of capstone.tiers ?? []) {
      if (!tier.name || !tier.goal) problems.push('capstone: every tier needs a name and a goal');
      if (!Array.isArray(tier.requirements) || tier.requirements.length < 3) problems.push(`capstone: ${tier.name || 'tier'} needs three requirements`);
      if (!Array.isArray(tier.deliverables) || !tier.deliverables.length) problems.push(`capstone: ${tier.name || 'tier'} needs a deliverable`);
      if (!Array.isArray(tier.stretch) || !tier.stretch.length) problems.push(`capstone: ${tier.name || 'tier'} needs a stretch goal`);
    }
    if (!Array.isArray(capstone.milestones) || capstone.milestones.length < 4) problems.push('capstone: four milestones are required');
    if (!Array.isArray(capstone.rubric) || !capstone.rubric.length) problems.push('capstone: rubric is required');
    const weights = (capstone.rubric ?? []).reduce((sum, row) => sum + (row.weight || 0), 0);
    if (weights !== 100) problems.push(`capstone: rubric weights sum to ${weights}, expected 100`);
    const criteria = new Set();
    for (const row of capstone.rubric ?? []) {
      if (!row.criterion || !row.evidence) problems.push('capstone: every rubric row needs a criterion and evidence');
      if (criteria.has(row.criterion)) problems.push(`capstone: duplicate rubric criterion ${row.criterion}`);
      criteria.add(row.criterion);
    }
    if (!capstone.assessment?.pass || !capstone.assessment?.excellent) problems.push('capstone: pass and excellent assessment notes are required');
  }

  /*
   * Labs are the runnable middle layer between a lesson and the capstone. NumPy labs must stay
   * inside the offline kernel; Colab packs are separate downloadable files, never app-runtime
   * notebooks. Both point at real authored files and canonical datasets, so a dead link or a
   * missing dependency fails the build instead of reaching the learner.
   */
  let labs = null;
  let colabPacks = null;
  let datasets = null;
  try {
    labs = JSON.parse(fs.readFileSync(LABS, 'utf8'));
    datasets = JSON.parse(fs.readFileSync(DATASETS, 'utf8'));
  } catch (error) {
    problems.push(`labs: could not read labs.json or datasets.json (${error.message})`);
  }
  const datasetIds = new Set((datasets ?? []).map((dataset) => dataset.id));
  const datasetFiles = new Set((datasets ?? []).map((dataset) => dataset.file));
  const datasetManifestPath = path.join(ROOT, 'public', 'datasets', 'ml', 'manifest.json');
  const datasetManifest = fs.existsSync(datasetManifestPath) ? JSON.parse(fs.readFileSync(datasetManifestPath, 'utf8')) : { datasets: [] };
  const datasetDetails = new Map((datasetManifest.datasets ?? []).map((dataset) => [dataset.id, dataset]));
  datasets = (datasets ?? []).map((dataset) => ({ ...dataset, ...(datasetDetails.get(dataset.id) ?? {}) }));
  if (!Array.isArray(datasets) || datasets.length < 4) problems.push('datasets: at least four canonical datasets are required');
  for (const dataset of datasets ?? []) {
    if (!dataset.id || !dataset.file || !dataset.title || !dataset.description) problems.push('datasets: every entry needs id, file, title and description');
    if (!dataset.source || !dataset.license) problems.push(`datasets: ${dataset.id || '?'} needs source and licence`);
    if (!['classification', 'regression'].includes(dataset.task)) problems.push(`datasets: ${dataset.id || '?'} has an invalid task`);
    if (!fs.existsSync(path.join(ROOT, 'content', 'datasets', 'ml', dataset.file))) problems.push(`datasets: ${dataset.file} is missing`);
  }

  const notebookFiles = new Set(fs.existsSync(NOTEBOOKS) ? fs.readdirSync(NOTEBOOKS) : []);
  const colabFiles = new Set(fs.existsSync(COLAB) ? fs.readdirSync(COLAB) : []);
  const labIds = new Set();
  const referencedDatasets = new Set();
  if (!Array.isArray(labs?.labs) || labs.labs.length < 4) problems.push('labs: at least four NumPy labs are required');
  for (const lab of labs?.labs ?? []) {
    if (!lab.id || !lab.title || !lab.notebook || !lab.description) problems.push('labs: every lab needs id, title, notebook and description');
    if (labIds.has(lab.id)) problems.push(`labs: duplicate id ${lab.id}`);
    labIds.add(lab.id);
    if (lab.runtime !== 'offline') problems.push(`labs: ${lab.id} must declare runtime "offline"`);
    if (!notebookFiles.has(lab.notebook)) problems.push(`labs: ${lab.id} points at missing notebook ${lab.notebook}`);
    if (!modules.some((module) => module.id === lab.module)) problems.push(`labs: ${lab.id} points at unknown module ${lab.module}`);
    for (const dataset of lab.datasets ?? []) {
      if (!datasetIds.has(dataset)) problems.push(`labs: ${lab.id} points at unknown dataset ${dataset}`);
      referencedDatasets.add(dataset);
    }
    if (notebookFiles.has(lab.notebook)) {
      const notebook = JSON.parse(fs.readFileSync(path.join(NOTEBOOKS, lab.notebook), 'utf8'));
      const source = notebook.cells.filter((cell) => cell.cell_type === 'code').map((cell) => (cell.source ?? []).join('')).join('\n');
      if (/^\s*(?:import|from)\s+(?:sklearn|xgboost)\b/m.test(source)) problems.push(`labs: ${lab.id} imports sklearn/xgboost; offline labs must use NumPy only`);
    }
  }

  if (!Array.isArray(labs?.colabPacks) || labs.colabPacks.length < 2) problems.push('labs: at least two Colab packs are required');
  for (const pack of labs?.colabPacks ?? []) {
    if (!pack.id || !pack.title || !pack.file || !pack.description) problems.push('colab: every pack needs id, title, file and description');
    if (!colabFiles.has(pack.file)) problems.push(`colab: ${pack.id} points at missing pack ${pack.file}`);
    if (!Array.isArray(pack.requirements) || !pack.requirements.some((req) => /^scikit-learn==/.test(req)) || !pack.requirements.some((req) => /^xgboost==/.test(req))) {
      problems.push(`colab: ${pack.id} must pin scikit-learn and xgboost`);
    }
    for (const dataset of pack.datasets ?? []) {
      if (!datasetIds.has(dataset)) problems.push(`colab: ${pack.id} points at unknown dataset ${dataset}`);
      referencedDatasets.add(dataset);
    }
  }
  for (const dataset of datasetIds) {
    if (!referencedDatasets.has(dataset)) problems.push(`datasets: ${dataset} is not used by any lab or pack`);
  }
  for (const file of datasetFiles) {
    if (!fs.existsSync(path.join(ROOT, 'public', 'datasets', 'ml', file))) problems.push(`datasets: public copy of ${file} is missing — run npm run ml:datasets:write`);
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
  return {
    course,
    stats,
    modules: published,
    ...(capstone ? { capstone } : {}),
    ...(labs ? { labs: labs.labs, colabPacks: labs.colabPacks } : {}),
    ...(datasets ? { datasets } : {}),
  };
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
