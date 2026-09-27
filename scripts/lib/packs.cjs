/**
 * packs.cjs (library) — shape rules and verified execution for the 16-part topic packs.
 *
 * A pack is the authored workspace for ONE section: intro, theory, syntax, examples,
 * real-world cases, interview Q&A, 5-level practice, coding tasks (with working solutions),
 * debugging tasks (broken code that really breaks), the 5-rung challenge ladder, three
 * projects with a Version 1→4 improvement path, project questions, interview-based
 * practical tasks and a revision checklist.
 *
 * Two jobs live here so the CLI and the tests share one definition:
 *   validatePack(pack)  — pure shape check (no I/O, no execution).
 *   verifyPack(pack)    — executes every snippet and returns the processed pack + problems.
 *
 * Honesty rules:
 *   · runnable snippets must actually run; their stored `output` is real stdout;
 *   · a debugging task must FAIL on `broken` and SUCCEED on `correct` — a "broken" snippet
 *     that runs fine is a lie about the bug, and a "fix" that raises is not a fix;
 *   · a snippet needing a bundled-only module keeps its documented output and is marked
 *     `verified: false` instead of pretending it ran;
 *   · nothing is returned as processed while any problem remains, so the writer can refuse
 *     to save half-verified content.
 */
const { runSnippet, squash } = require('./runpy.cjs');

/** The 16 rows of the learning structure, in the order a learner walks them. */
const PARTS = [
  { key: 'intro', label: 'Topic Introduction' },
  { key: 'theory', label: 'Concepts / Theory' },
  { key: 'syntax', label: 'Syntax' },
  { key: 'examples', label: 'Simple Examples' },
  { key: 'realWorld', label: 'Real-World Examples' },
  { key: 'interview', label: 'Interview Questions' },
  { key: 'practice', label: 'Practice Questions' },
  { key: 'coding', label: 'Coding Practice' },
  { key: 'debugging', label: 'Debugging Questions' },
  { key: 'challenges', label: 'Challenges' },
  { key: 'project-simple', label: 'Simple Project' },
  { key: 'project-medium', label: 'Medium Project' },
  { key: 'project-hard', label: 'Hard / Advanced Project' },
  { key: 'improvements', label: 'Project Improvement Tasks' },
  { key: 'interviewTasks', label: 'Interview-Based Practical Tasks' },
  { key: 'revision', label: 'Revision Checklist' },
];

const PRACTICE_LEVELS = ['beginner', 'intermediate', 'advanced', 'interview', 'realworld'];
const PRACTICE_MIN = 3;
const CHALLENGE_KINDS = ['quick', 'coding', 'advanced', 'interview', 'build'];
const PROJECT_LEVELS = ['simple', 'medium', 'advanced'];
const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
const EXAMPLE_LEVELS = ['basic', 'intermediate', 'advanced'];

const str = (v) => typeof v === 'string' && v.trim().length > 0;
const arr = (v, n = 1) => Array.isArray(v) && v.length >= n;

/** Pure shape validation. Returns a list of human-readable problems (empty = valid). */
function validatePack(pack, at = pack?.section ?? '(pack)') {
  const p = [];
  const need = (v, name) => { if (!str(v)) p.push(`${at}: missing "${name}"`); };
  const needList = (v, name, n = 1) => { if (!arr(v, n)) p.push(`${at}: "${name}" needs at least ${n} item(s)`); };

  if (!/^s\d{2}$/.test(String(pack?.section))) p.push(`${at}: section must look like "s07"`);
  need(pack?.topic, 'topic');
  need(pack?.intro, 'intro');
  needList(pack?.theory, 'theory', 3);
  needList(pack?.syntax, 'syntax', 2);
  needList(pack?.realWorld, 'realWorld', 2);
  needList(pack?.revision, 'revision', 5);

  // ---- examples: all three levels, each with code and a line-by-line reading
  if (!arr(pack?.examples, 3)) p.push(`${at}: "examples" needs at least 3 items`);
  else {
    const levels = new Set();
    pack.examples.forEach((ex, i) => {
      levels.add(ex?.level);
      if (!EXAMPLE_LEVELS.includes(ex?.level)) p.push(`${at}: example ${i} bad level "${ex?.level}"`);
      if (!str(ex?.code)) p.push(`${at}: example ${i} has no code`);
      if (!arr(ex?.explain, 1)) p.push(`${at}: example ${i} needs a line-by-line explanation`);
    });
    for (const l of EXAMPLE_LEVELS) if (!levels.has(l)) p.push(`${at}: examples missing the "${l}" level`);
  }

  // ---- interview: questions WITH answers (the spec's "answers bhi do")
  if (!arr(pack?.interview, 4)) p.push(`${at}: "interview" needs at least 4 Q&A`);
  else pack.interview.forEach((q, i) => {
    if (!str(q?.q)) p.push(`${at}: interview ${i} has no question`);
    if (!str(q?.a)) p.push(`${at}: interview ${i} has no answer`);
  });

  // ---- practice: five difficulty levels, each with enough non-repeating questions
  const practice = pack?.practice ?? {};
  for (const level of PRACTICE_LEVELS) {
    if (!arr(practice[level], PRACTICE_MIN)) p.push(`${at}: practice.${level} needs at least ${PRACTICE_MIN} questions`);
    else practice[level].forEach((item, i) => {
      if (!str(item?.q)) p.push(`${at}: practice.${level}[${i}] has no question`);
      if (!str(item?.a)) p.push(`${at}: practice.${level}[${i}] has no answer`);
    });
  }
  const withCode = PRACTICE_LEVELS.flatMap((l) => practice[l] ?? []).filter((x) => str(x?.code)).length;
  if (withCode < 6) p.push(`${at}: practice needs at least 6 questions carrying real code (found ${withCode})`);

  // ---- coding: the fixed 12-field format, every solution present
  if (!arr(pack?.coding, 6)) p.push(`${at}: "coding" needs at least 6 tasks`);
  else pack.coding.forEach((t, i) => {
    for (const f of ['difficulty', 'question', 'build', 'input', 'expected', 'hint', 'concept', 'solution', 'explanation', 'time', 'space', 'better', 'followUp']) {
      if (!str(t?.[f])) p.push(`${at}: coding ${i} missing "${f}"`);
    }
    if (str(t?.difficulty) && !DIFFICULTIES.includes(t.difficulty)) p.push(`${at}: coding ${i} bad difficulty "${t.difficulty}"`);
  });

  // ---- debugging: broken → error → why → fix → correct → lesson
  if (!arr(pack?.debugging, 4)) p.push(`${at}: "debugging" needs at least 4 tasks`);
  else pack.debugging.forEach((d, i) => {
    for (const f of ['difficulty', 'broken', 'error', 'why', 'fix', 'correct', 'lesson']) {
      if (!str(d?.[f])) p.push(`${at}: debugging ${i} missing "${f}"`);
    }
    if (d?.mode !== undefined && !['raise', 'logic'].includes(d.mode)) p.push(`${at}: debugging ${i} bad mode "${d.mode}"`);
    if (str(d?.broken) && squash(d.broken) === squash(d.correct)) p.push(`${at}: debugging ${i} "correct" is identical to "broken"`);
  });

  // ---- challenges: the whole ladder
  if (!arr(pack?.challenges, 5)) p.push(`${at}: "challenges" needs 5 rungs`);
  else {
    const kinds = new Set(pack.challenges.map((c) => c?.kind));
    for (const k of CHALLENGE_KINDS) if (!kinds.has(k)) p.push(`${at}: challenges missing the "${k}" rung`);
    pack.challenges.forEach((c, i) => {
      if (!str(c?.prompt)) p.push(`${at}: challenge ${i} has no prompt`);
      if (!Number.isFinite(c?.minutes) || c.minutes <= 0) p.push(`${at}: challenge ${i} needs minutes`);
    });
  }

  // ---- projects: simple / medium / advanced, with the Version 1→4 improvement path
  if (!arr(pack?.projects, 3)) p.push(`${at}: "projects" needs simple + medium + advanced`);
  else {
    const levels = new Set();
    pack.projects.forEach((pr, i) => {
      levels.add(pr?.level);
      for (const f of ['level', 'name', 'problem', 'objective', 'structure', 'code', 'explanation', 'testing', 'errors', 'realWorld', 'resume']) {
        if (!str(pr?.[f])) p.push(`${at}: project ${i} missing "${f}"`);
      }
      for (const [f, n] of [['features', 3], ['concepts', 2], ['steps', 3], ['improvements', 3], ['advanced', 3], ['interview', 3], ['readme', 3]]) {
        if (!arr(pr?.[f], n)) p.push(`${at}: project ${i} "${f}" needs at least ${n}`);
      }
      (pr?.interview ?? []).forEach((q, j) => {
        if (!str(q?.q) || !str(q?.a)) p.push(`${at}: project ${i} interview ${j} needs q + a`);
      });
    });
    for (const l of PROJECT_LEVELS) if (!levels.has(l)) p.push(`${at}: projects missing the "${l}" level`);
  }

  // ---- project questions: understanding / coding / advanced / interview
  const pq = pack?.projectQuestions ?? {};
  for (const group of ['understanding', 'coding', 'advanced', 'interview']) {
    if (!arr(pq[group], 3)) p.push(`${at}: projectQuestions.${group} needs at least 3 questions`);
  }

  // ---- interview-based practical tasks
  if (!arr(pack?.interviewTasks, 4)) p.push(`${at}: "interviewTasks" needs at least 4 tasks`);
  else pack.interviewTasks.forEach((t, i) => {
    if (!str(t?.q)) p.push(`${at}: interviewTask ${i} has no prompt`);
    if (!str(t?.a)) p.push(`${at}: interviewTask ${i} has no model answer`);
  });

  // ---- no repeated question text inside one pack (topic purity starts at home)
  const seen = new Map();
  const texts = [
    ...(pack?.interview ?? []).map((x) => x?.q),
    ...PRACTICE_LEVELS.flatMap((l) => (practice[l] ?? []).map((x) => x?.q)),
    ...(pack?.coding ?? []).map((x) => x?.question),
    ...((pack?.projects ?? []).flatMap((x) => (x?.interview ?? []).map((q) => q?.q))),
    ...(pack?.interviewTasks ?? []).map((x) => x?.q),
  ].filter(str);
  for (const t of texts) {
    const k = squash(t).toLowerCase();
    if (seen.has(k)) p.push(`${at}: duplicate question text: "${t.slice(0, 60)}"`);
    else seen.set(k, true);
  }

  return p;
}

/**
 * Execute every snippet in the pack and return { pack, problems }.
 * On any problem the returned pack is the ORIGINAL one — callers must not write it.
 */
function verifyPack(pack) {
  const at = pack.section;
  const problems = [];
  const processed = JSON.parse(JSON.stringify(pack));

  /** Runs a snippet that must succeed. Returns the stamped output, or null on failure. */
  const mustRun = (code, where, target, field = 'output', verifiedField = 'verified') => {
    const r = runSnippet(code);
    if (r.state === 'ok') { target[field] = r.output ?? ''; target[verifiedField] = true; return true; }
    if (r.state === 'unrunnable') { target[field] = target[field] ?? ''; target[verifiedField] = false; return true; }
    problems.push(`${at}: ${where} raised (${r.kind || 'error'}): ${r.reason}`);
    return false;
  };

  processed.examples.forEach((ex, i) => { if (ex?.code) mustRun(ex.code, `example ${i} (${ex.level})`, ex); });

  for (const level of PRACTICE_LEVELS) {
    (processed.practice?.[level] ?? []).forEach((item, i) => {
      if (item?.code) mustRun(item.code, `practice.${level}[${i}]`, item);
    });
  }

  processed.coding.forEach((t, i) => { if (t?.solution) mustRun(t.solution, `coding ${i} solution`, t); });

  processed.debugging.forEach((d, i) => {
    // Two honest kinds of bug, both checked by running the code:
    //   mode 'raise' (default) — the broken code must actually crash, and the fix must run;
    //   mode 'logic'           — the broken code runs but produces the WRONG output (the spec
    //                            asks for logic errors too, and those do not raise), and the
    //                            fix must produce different, correct output.
    const mode = d?.mode === 'logic' ? 'logic' : 'raise';
    d.mode = mode;
    if (d?.broken) {
      const r = runSnippet(d.broken);
      if (mode === 'raise') {
        if (r.state === 'raised') { d.errorKind = r.kind ?? d.errorKind; }
        else if (r.state === 'ok') problems.push(`${at}: debugging ${i} "broken" did NOT fail — it runs cleanly, so it is not a bug (use mode \"logic\" if the bug is wrong output)`);
        else problems.push(`${at}: debugging ${i} "broken" could not be executed (${r.reason})`);
      } else {
        if (r.state === 'ok') { d.brokenOutput = r.output ?? ''; }
        else if (r.state === 'raised') problems.push(`${at}: debugging ${i} is mode "logic" but "broken" crashed (${r.kind}) — use the default mode for a crash`);
        else problems.push(`${at}: debugging ${i} "broken" could not be executed (${r.reason})`);
      }
    }
    // And the fix must work — producing different output when the bug was a logic bug.
    if (d?.correct && mustRun(d.correct, `debugging ${i} fix`, d)) {
      if (mode === 'logic' && d.brokenOutput === d.output) {
        problems.push(`${at}: debugging ${i} "correct" output is identical to "broken" — the fix changes nothing`);
      }
    }
  });

  processed.projects.forEach((pr, i) => { if (pr?.code) mustRun(pr.code, `project ${i} (${pr.level}) code`, pr); });

  return { pack: processed, problems };
}

/** Which of the 16 structure rows a rendered section actually satisfies. */
function partCoverage(section) {
  const t = section?.topic;
  const has = {
    intro: str(t?.intro),
    theory: arr(t?.theory, 3),
    syntax: arr(t?.syntax, 2),
    examples: arr(t?.examples, 3),
    realWorld: arr(t?.realWorld, 2),
    interview: arr(t?.interview, 4),
    practice: PRACTICE_LEVELS.every((l) => arr(t?.practice?.[l], PRACTICE_MIN)),
    coding: arr(t?.coding, 6),
    debugging: arr(t?.debugging, 4),
    challenges: CHALLENGE_KINDS.every((k) => (t?.challenges ?? []).some((c) => c?.kind === k)),
    'project-simple': (t?.projects ?? []).some((p) => p?.level === 'simple'),
    'project-medium': (t?.projects ?? []).some((p) => p?.level === 'medium'),
    'project-hard': (t?.projects ?? []).some((p) => p?.level === 'advanced'),
    improvements: (t?.projects ?? []).some((p) => arr(p?.improvements, 3) && arr(p?.advanced, 3)),
    interviewTasks: arr(t?.interviewTasks, 4),
    revision: arr(t?.revision, 5),
  };
  const present = PARTS.filter((p) => has[p.key]).map((p) => p.key);
  const missing = PARTS.filter((p) => !has[p.key]).map((p) => p.key);
  return { present, missing, complete: missing.length === 0, done: present.length, total: PARTS.length };
}

module.exports = {
  PARTS, PRACTICE_LEVELS, PRACTICE_MIN, CHALLENGE_KINDS, PROJECT_LEVELS, DIFFICULTIES,
  validatePack, verifyPack, partCoverage,
};
