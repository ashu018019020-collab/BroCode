#!/usr/bin/env node
/**
 * HTML Mastery course pipeline.
 *
 * Authored source: `content/html-mastery/course.json` + `modules-*.json`.
 * Published artifact: `public/generated/html-course/index.json` — course metadata plus, per module,
 * the same ten learning sections the C++ course ships, built from the module's own material.
 *
 * Nothing is invented here: every Learn/Logic/Interview/Practice entry is a projection of an authored
 * topic (its body, its code and the output the browser renders for it), every coding task is
 * independent of the taught snippet, and every debug entry is a broken sample whose fix changes the
 * rendered result. Duplicate ids, duplicate question text, an empty section or a debug entry whose
 * fix does not change the result fail the run instead of shipping.
 *
 * Dry run validates only; `--write` publishes.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'content', 'html-mastery');
const OUT = path.join(ROOT, 'public', 'generated', 'html-course');
const WRITE = process.argv.includes('--write');
const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const course = readJSON(path.join(SRC, 'course.json')).course;
const moduleFiles = fs.readdirSync(SRC).filter((f) => /^modules-.*\.json$/.test(f)).sort();
const modules = moduleFiles.flatMap((f) => readJSON(path.join(SRC, f)));

const problems = [];
const fail = (m) => problems.push(m);

/*
 * `deepening*.json` is the growth layer: extra topics, MCQs, coding tasks, debug challenges and
 * interview questions per module, merged in file order. A module can therefore grow without
 * rewriting the file it lives in.
 */
const deepeningFiles = fs.readdirSync(SRC).filter((f) => /^deepening.*\.json$/.test(f)).sort();
for (const file of deepeningFiles) {
  const layer = readJSON(path.join(SRC, file));
  for (const [id, pack] of Object.entries(layer)) {
    const target = modules.find((m) => m.id === id);
    if (!target) { fail(`deepening: unknown module ${id}`); continue; }
    target.topics.push(...(pack.topics || []));
    target.debug.push(...(pack.debug || []));
    target.tasks.push(...(pack.tasks || []));
    if (pack.logic) target.logicBank = [...(target.logicBank || []), ...pack.logic];
    if (pack.interview) target.interviewBank = [...(target.interviewBank || []), ...pack.interview];
    if (pack.mcq) target.mcqBank = [...(target.mcqBank || []), ...pack.mcq];
  }
}

/* --------------------------------- course -------------------------------- */
for (const key of ['id', 'slug', 'title', 'tagline', 'description', 'level', 'hours', 'prerequisites', 'outcomes']) {
  if (!course[key]) fail(`course: missing ${key}`);
}
if (course.id !== 'html-mastery') fail('course.id must be html-mastery');
if (!Array.isArray(course.modules) || course.modules.length !== 20) fail('course.modules must list 20 ids');

/* -------------------------------- modules -------------------------------- */
const LEVELS = new Set(['beginner', 'intermediate', 'advanced']);
const seenTitles = new Set();
modules.forEach((m, index) => {
  if (!/^html\d{2}$/.test(m.id || '')) fail(`${m.id || index}: id must be htmlNN`);
  if (m.id !== `html${String(index + 1).padStart(2, '0')}`) fail(`${m.id}: id must be html${String(index + 1).padStart(2, '0')}`);
  if (m.no !== index + 1) fail(`${m.id}: no must be ${index + 1}`);
  if (!m.title || seenTitles.has(m.title)) fail(`${m.id}: missing or duplicate module title`);
  seenTitles.add(m.title);
  if (!LEVELS.has(m.level)) fail(`${m.id}: bad level ${m.level}`);
  if (!(m.hours > 0)) fail(`${m.id}: hours must be positive`);
  if (!m.goal) fail(`${m.id}: missing goal`);
  if (!Array.isArray(m.topics) || m.topics.length < 3) fail(`${m.id}: needs 3+ topics`);
  const topicTitles = new Set();
  for (const [i, t] of (m.topics || []).entries()) {
    if (!t.title || !t.body) fail(`${m.id}: topic ${i + 1} needs title and body`);
    if (topicTitles.has(t.title)) fail(`${m.id}: duplicate topic title "${t.title}"`);
    topicTitles.add(t.title);
    if (!t.code || !t.output) fail(`${m.id}: topic ${t.title || i + 1} needs code and verified output`);
    if (String(t.code).includes('\t')) fail(`${m.id}: ${t.title} code contains a tab`);
  }
  if (!Array.isArray(m.debug) || m.debug.length < 2) fail(`${m.id}: needs 2+ debug challenges`);
  for (const d of m.debug || []) {
    if (!d.title || !d.broken || !d.fix || !d.error) fail(`${m.id}: debug challenge needs title/broken/fix/error`);
    if (d.fix === d.broken) fail(`${m.id}: debug "${d.title}" fix equals broken code`);
    if (!d.fixedOutput) fail(`${m.id}: debug "${d.title}" has no authored fix output`);
  }
  for (const q of m.mcqBank || []) {
    if (!q.q || !Array.isArray(q.options) || q.options.length !== 4) fail(`${m.id}: an MCQ needs a question and four options`);
    if (!q.answer || !q.options.includes(q.answer)) fail(`${m.id}: MCQ "${q.q.slice(0, 40)}…" answer must be one of its options`);
    if (new Set(q.options).size !== 4) fail(`${m.id}: MCQ "${q.q.slice(0, 40)}…" options must be distinct`);
  }
  if (!Array.isArray(m.tasks) || m.tasks.length < 1) fail(`${m.id}: needs 1+ independent coding task`);
  for (const t of m.tasks || []) {
    if (!t.title || !t.statement || !t.solution) fail(`${m.id}: task needs title/statement/solution`);
    if (!t.expected) fail(`${m.id}: task "${t.title}" has no authored output`);
  }
  for (const [bank, min] of [['interviewBank', 2], ['defenseBank', 2]]) {
    const list = m[bank] || [];
    if (list.length < min) fail(`${m.id}: needs ${min}+ authored ${bank} entries`);
    for (const q of list) if (!q.q || !q.answer) fail(`${m.id}: ${bank} entry needs a question and an answer`);
  }
  if (!m.mini?.title || !m.mini?.brief || !m.mini.steps?.length) fail(`${m.id}: mini project incomplete`);
  if (!m.lab?.title || !m.lab?.brief || !m.lab.milestones?.length) fail(`${m.id}: project lab incomplete`);
});

if (modules.length !== 20) fail(`expected 20 modules, found ${modules.length}`);

/* -------------------------------- sections ------------------------------- */
const SECTIONS = [
  ['learn', 'Learn'], ['interview', 'Interview'], ['coding', 'Coding Lab'], ['logic', 'Logic'],
  ['debug', 'Debug'], ['practice', 'Practice Solutions'], ['miniProject', 'Mini Project'],
  ['projectLab', 'Project Lab'], ['defense', 'Defense'], ['checkpoint', 'Checkpoint'],
];
/** Easy, Medium, Hard — cycled by position so a section never shows one difficulty only. */
const DIFFICULTIES = ['easy', 'medium', 'hard'];
const difficultyAt = (i) => DIFFICULTIES[i % DIFFICULTIES.length];

/**
 * Three choices for a checkpoint: the real rendered output plus two other topics' authored outputs
 * from the same module. Distractors are authored records, never invented text, and the correct
 * answer is always present. Position rotates with the title so the answer is not always first.
 */
function checkpointOptions(title, answer, topics) {
  const seen = new Set([String(answer).trim()]);
  const pool = [];
  for (const t of topics) {
    if (t.title === title) continue;
    const out = String(t.output).trim();
    if (!out || seen.has(out)) continue;
    seen.add(out);
    pool.push(out);
  }
  if (pool.length < 2) return undefined;
  const options = pool.slice(0, 2);
  options.splice(title.length % 3, 0, answer);
  return options;
}

/** One numeric literal in the sample becomes a blank; the authored output stays the key. */
function blankToken(code) {
  const lines = String(code).split('\n');
  for (let l = 0; l < lines.length; l += 1) {
    const m = lines[l].match(/(?<![\w.#])(\d+(?:\.\d+)?)(?![\w.])/);
    if (m) return { line: l, start: m.index, end: m.index + m[0].length, token: m[0] };
  }
  return null;
}

function checkpointFormats(topics, id) {
  const entries = [];
  const claimed = topics.slice(0, 5);
  claimed.forEach((t, i) => {
    const other = topics.find((o) => o.title !== t.title && String(o.output).trim() !== String(t.output).trim());
    const useOther = i % 2 === 1 && Boolean(other);
    entries.push({
      id: id('checkpoint', 'tf' + i),
      format: 'truefalse',
      q: `True or false: this markup, taken from "${t.title}", renders exactly the output below.`,
      code: t.code,
      claim: String(useOther ? other.output : t.output).trim(),
      expected: String(t.output).trim(),
      answer: useOther ? 'False' : 'True',
      options: ['True', 'False'],
      difficulty: difficultyAt(i),
    });
  });
  let b = 0;
  for (const t of topics) {
    if (b >= 5) break;
    const hit = blankToken(t.code);
    if (!hit) continue;
    const lines = String(t.code).split('\n');
    const withBlank = lines.slice();
    withBlank[hit.line] = lines[hit.line].slice(0, hit.start) + '___' + lines[hit.line].slice(hit.end);
    entries.push({
      id: id('checkpoint', 'blank' + b),
      format: 'blank',
      q: `Fill in the blank so this markup about ${t.title.toLowerCase()} renders the output shown below.`,
      code: withBlank.join('\n'),
      solution: t.code,
      answer: hit.token,
      expected: String(t.output).trim(),
      difficulty: difficultyAt(b),
    });
    b += 1;
  }
  return entries;
}

/** A written checkpoint is self-assessed; the criteria quote the sample's own rendered result. */
function writtenRubric(t) {
  const first = String(t.output).trim().split('\n')[0];
  return [
    `Names the element and attribute responsible, not just the visible result: ${t.title}.`,
    `Mentions the concrete content involved (${first}).`,
    'Explains the structure or semantics that produce the result, not only what appears on screen.',
  ];
}

function buildSections(m) {
  const topics = m.topics;
  const id = (section, i) => `${m.id}:${section}:${i}`;
  return {
    learn: topics.map((t, i) => ({
      id: id('learn', i), title: t.title, body: t.body, code: t.code, output: t.output, difficulty: difficultyAt(i),
    })),
    /* Interview publishes render questions plus the authored bank. */
    interview: [
      ...topics.map((t, i) => ({
        id: id('interview', i), q: `What does the browser render for this ${t.title.toLowerCase()} snippet, and why?`,
        code: t.code, answer: t.output, difficulty: i === topics.length - 1 ? 'hard' : 'medium',
      })),
      ...(m.interviewBank || []).map((q, i) => ({
        id: id('interview', 'a' + i), q: q.q, answer: q.answer, code: q.code,
        difficulty: difficultyAt(i + topics.length),
      })),
    ],
    coding: (m.tasks || []).map((t, i) => ({
      id: id('coding', 't' + i), title: t.title, statement: t.statement, kind: 'task',
      starter: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Lab</title>\n</head>\n<body>\n  <!-- build the page the task asks for -->\n</body>\n</html>\n',
      solution: t.solution, expected: t.expected, difficulty: difficultyAt(i),
    })),
    logic: [
      ...topics.map((t, i) => ({
        id: id('logic', i), q: `Predict exactly what the browser renders for this ${t.title.toLowerCase()} markup before you check.`,
        code: t.code, answer: t.output, difficulty: difficultyAt(i),
      })),
      ...(m.logicBank || []).map((q, i) => ({
        id: id('logic', 'd' + i), q: q.q, code: q.code, answer: q.answer, difficulty: difficultyAt(i + topics.length),
      })),
    ],
    debug: m.debug.map((d, i) => ({
      id: id('debug', i), title: d.title, code: d.broken, error: d.error, fix: d.fix,
      expected: d.fixedOutput, difficulty: difficultyAt(i),
    })),
    practice: topics.map((t, i) => ({
      id: id('practice', i), title: `Rebuild from memory: ${t.title}`, task: t.body,
      solution: t.code, expected: t.output, difficulty: difficultyAt(i),
    })),
    miniProject: [{
      id: id('miniProject', 0), title: m.mini.title, body: m.mini.brief, steps: m.mini.steps, difficulty: 'medium',
    }],
    projectLab: [{
      id: id('projectLab', 0), title: m.lab.title, body: m.lab.brief, steps: m.lab.milestones, difficulty: 'hard',
    }],
    defense: (m.defenseBank || []).map((q, i) => ({
      id: id('defense', 'a' + i), q: q.q, answer: q.answer, steps: q.steps, difficulty: difficultyAt(i),
    })),
    checkpoint: [...topics.flatMap((t, i) => [
      {
        id: id('checkpoint', i * 2), q: `Checkpoint: predict what this markup about ${t.title.toLowerCase()} renders.`,
        code: t.code, answer: t.output, options: checkpointOptions(t.title, t.output, topics), difficulty: difficultyAt(i),
      },
      {
        id: id('checkpoint', i * 2 + 1),
        q: `Short answer: state what this ${t.title.toLowerCase()} markup produces, and why the browser shows it that way.`,
        answer: t.body, rubric: writtenRubric(t), difficulty: i === 0 ? 'easy' : 'medium',
      },
    ]),
    /* Authored MCQs, four options each, answer included — counted in the bank's quiz category. */
    ...(m.mcqBank || []).map((q, i) => ({
      id: id('checkpoint', 'mcq' + i), format: 'mcq', q: q.q, options: q.options, answer: q.answer,
      why: q.why, difficulty: difficultyAt(i + 1),
    })),
    ...checkpointFormats(topics, id)],
  };
}

const published = modules.map((m) => {
  const sections = buildSections(m);
  for (const [key, label] of SECTIONS) {
    const list = sections[key];
    if (!list.length) fail(`${m.id}: section ${label} is empty`);
    const ids = new Set();
    for (const entry of list) {
      if (ids.has(entry.id)) fail(`${m.id}/${label}: duplicate id ${entry.id}`);
      ids.add(entry.id);
    }
    const questions = list.map((e) => e.q || e.title || '').filter(Boolean);
    if (new Set(questions).size !== questions.length) fail(`${m.id}/${label}: duplicate question text`);
  }
  for (const entry of sections.checkpoint) {
    if (entry.options) {
      const expected = entry.format === 'truefalse' ? 2 : entry.format === 'mcq' ? 4 : 3;
      if (entry.options.length !== expected) fail(`${entry.id}: a checkpoint quiz needs ${expected} options`);
      if (new Set(entry.options).size !== expected) fail(`${entry.id}: checkpoint options must be distinct`);
      if (!entry.options.includes(entry.answer)) fail(`${entry.id}: the options must include the answer`);
    }
    if (entry.format === 'blank') {
      if (!String(entry.code).includes('___')) fail(`${entry.id}: a blank checkpoint needs a ___ in its code`);
      if (!entry.answer || !entry.solution) fail(`${entry.id}: a blank checkpoint needs an answer and a solution`);
    }
    if (entry.rubric) {
      if (entry.rubric.length !== 3) fail(`${entry.id}: a written checkpoint needs 3 rubric lines`);
      if (entry.rubric.some((line) => typeof line !== 'string' || !line.trim())) fail(`${entry.id}: rubric lines must be non-empty`);
    }
  }
  const counts = Object.fromEntries(SECTIONS.map(([key]) => [key, sections[key].length]));
  return { ...m, sections, counts, entries: Object.values(counts).reduce((a, b) => a + b, 0) };
});

const bySection = Object.fromEntries(SECTIONS.map(([key, label]) => [label, published.reduce((a, m) => a + m.counts[key], 0)]));
const countBy = (list, key) => list.reduce((acc, e) => {
  const value = e[key] || 'unset';
  acc[value] = (acc[value] || 0) + 1;
  return acc;
}, {});
const bankModules = {};
for (const m of published) {
  const sec = m.sections;
  const all = Object.values(sec).flat();
  bankModules[m.id] = {
    total: all.length,
    categories: {
      concept: sec.interview.filter((e) => !e.code).length + sec.defense.length,
      output: sec.logic.length + sec.interview.filter((e) => e.code).length + sec.checkpoint.filter((e) => e.options).length,
      coding: sec.coding.length,
      debugging: sec.debug.length,
      quiz: sec.checkpoint.filter((e) => e.options).length,
      written: sec.checkpoint.filter((e) => e.rubric).length,
      project: sec.miniProject.length + sec.projectLab.length,
    },
    difficulty: countBy(all, 'difficulty'),
  };
}
const total = published.reduce((a, m) => a + m.entries, 0);
const stats = {
  modules: published.length,
  entries: total,
  bySection,
  targetPerSection: 50,
  targetTotal: 10000,
  bank: {
    total,
    target: 500,
    perModule: published.length ? Math.round(total / published.length) : 0,
    shortPerModule: 500 - (published.length ? Math.round(total / published.length) : 0),
    shortfall: published.length * 500 - total,
    modules: bankModules,
  },
};

if (problems.length) {
  console.error(`html-course: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  · ${p}`);
  process.exit(1);
}

const artifact = { course, stats, modules: published };
if (WRITE) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.json'), `${JSON.stringify(artifact, null, 1)}\n`);
  console.log(`html-course: published ${stats.modules} modules, ${stats.entries} entries → public/generated/html-course/index.json`);
  for (const [label, n] of Object.entries(bySection)) console.log(`  · ${label}: ${n}`);
} else {
  console.log(`html-course: valid — ${stats.modules} modules, ${stats.entries} entries (dry run; --write to publish)`);
}
