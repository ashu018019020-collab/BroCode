#!/usr/bin/env node
/**
 * playbook.cjs — import the "AI Engineer Master Systems + Interview Playbook (V15)" into the
 * per-section question banks.
 *
 *   node scripts/playbook.cjs --pdf="<path-to.pdf>"            # dry run: report only
 *   node scripts/playbook.cjs --pdf="<path>" --write           # write the expansion file + chapter index
 *   node scripts/playbook.cjs --fresh                          # ignore the cached layout text
 *
 * This is a SECOND source document next to the V10 "Senior Visual Answer Edition". It is not a
 * replacement and it does not overwrite anything: it produces an expansion file that
 * `npm run questions:playbook` then appends into each section's bank, with the global duplicate
 * guard doing the dedupe. Nothing here writes to a bank directly, so a bad parse can never touch
 * live content.
 *
 * What the document actually contains, measured rather than assumed:
 *   · 449 `Sawal - / Jawaab -` pairs, each carrying a `Level:` band. Every pair carries the
 *     document's own answer; the 51 checkpoint prompts share its "answer verbally first"
 *     instruction and the 40 production-scenario prompts share its "isolate, then collect evidence"
 *     method line. Those answers are reproduced VERBATIM — they are what the document says — and
 *     tagged `method-answer` so nobody later mistakes a rubric for a model answer.
 *   · 12 coding labs (chapter 15), 7 mini-project blueprints + 8 named capstones (chapter 17),
 *     chapter 16's DSA complexity table (7 rows) and its logic-pattern checklist.
 *
 * Section routing is deterministic and reviewable: an explicit heading → section table first, then
 * a keyword score, then the chapter's own default. Nothing is invented; every record's `question`
 * and `answer` come from the document, and every record keeps `pb:<chapter>` so the Playbook page
 * can show the same item under the chapter it came from.
 *
 * House rules (same as the other importers): `pdftotext -layout` only, layout text cached in
 * .freebuff/ (gitignored), DRY RUN by default, and every drop is reported.
 */
const fs = require('fs');
const path = require('path');
const { norm } = require('./lib/validate.cjs');
const { extractLayout } = require('./lib/pdfqa.cjs');
const { loadSections } = require('./lib/banks.cjs');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(ROOT, '.freebuff', 'playbook-layout.txt');
const OUT = path.join(ROOT, 'content', 'questions', 'expansion', 'playbook-v15.json');
const INDEX = path.join(ROOT, 'public', 'playbook', 'manifest.json');

const arg = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : undefined; };
const WRITE = process.argv.includes('--write');
const FRESH = process.argv.includes('--fresh');
const PDF = arg('pdf');
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => console.log(`\x1b[31m✕\x1b[0m ${m}`);
const warn = (m) => console.log(`\x1b[33m⚠\x1b[0m ${m}`);
const dim = (m) => `\x1b[2m${m}\x1b[0m`;

/* ============================== routing table ============================== */

/**
 * Heading → section, for the headings the document actually uses. A heading is a topic the
 * document itself declares, so it beats any keyword guess: "MCP" is s23 no matter which words
 * appear inside the question.
 */
const HEADING_SECTION = {
  'LLM & Transformers': 's21',
  'RAG': 's22',
  'Prompt + Context + Structured Output': 's22',
  'Advanced prompt interview topics': 's22',
  'LangChain + LangGraph': 's23',
  'Agents + Agentic AI': 's23',
  'MCP': 's23',
  'Agentic AI interview Q&A': 's23',
  'Agentic AI practice Q&A': 's23',
  'LangGraph/MCP interview Q&A': 's23',
  'Data Science + Analysis': 's20',
  'Data Scientist interview Q&A': 's20',
  'Data Scientist interview Q&A - advanced': 's20',
  'Data Scientist - Interview Set': 's20',
  'Data Engineering': 's19',
  'Data Engineer interview Q&A': 's19',
  'Data Engineer interview Q&A - advanced': 's19',
  'Data Engineer - Interview Set': 's19',
  'Big Data interview Q&A': 's19',
  'Data Analyst interview Q&A': 's25',
  'Data Analyst interview examples': 's25',
  'Data Analyst - Interview Set': 's25',
  'System Design': 's24',
  'Production + Security': 's24',
  'Production system design Q&A': 's24',
  'Advanced Cross-Role Questions': 's27',
  'Project defense questions': 's29',
  'AI Engineer - Interview Set': 's27',
};

/** Chapter → section, used when a question has no mapped heading (e.g. the checkpoint list). */
const CHAPTER_SECTION = {
  '01': 's27', '02': 's21', '03': 's22', '04': 's22', '05': 's23', '06': 's23', '07': 's23', '08': 's23',
  '09': 's23', '10': 's20', '11': 's19', '12': 's26', '13': 's22', '14': 's24', '15': 's28', '16': 's28',
  '17': 's29', '18': 's27', '19': 's29', '20': 's27', '21': 's25', '22': 's20', '23': 's19', '24': 's23',
  '25': 's27', '26': 's27', '27': 's24', '28': 's27', '29': 's25', '30': 's20', '31': 's19', '32': 's19',
  '33': 's23', '34': 's23', '35': 's24', '36': 's27',
};

/**
 * Keyword fallback, used only for questions with no mapped heading — the 51 cross-topic checkpoint
 * prompts, which name their own topic in the question text ("RAG me chunking…" → s22).
 * Longer phrases score higher, so `machine learning` beats a stray `model`.
 */
const SECTION_KEYWORDS = {
  s19: ['sql', 'database', 'warehouse', 'lakehouse', 'etl', 'elt', 'kafka', 'streaming', 'partition', 'big data', 'data engineering', 'spark', 'dbt', 'index', 'joins'],
  s20: ['machine learning', 'scikit', 'regression', 'classification', 'cross-validation', 'feature engineering', 'a/b test', 'hypothesis', 'statistics', 'data scientist', 'model metric', 'overfitting'],
  s21: ['tokeniz', 'embedding', 'attention', 'transformer', 'self-attention', 'nlp', 'softmax', 'language model', 'bert', 'positional'],
  s22: ['rag', 'retriev', 'chunk', 'rerank', 'vector', 'prompt injection', 'prompt', 'context window', 'structured output', 'groundedness', 'hallucinat', 'fine-tun', 'temperature', 'top-k', 'top-p', 'guardrail', 'citation', 'genai'],
  s23: ['langgraph', 'langchain', 'mcp', 'multi-agent', 'agentic', 'agent', 'tool call', 'tool schema', 'planner', 'autonomous', 'orchestrat', 'memory'],
  s24: ['api', 'fastapi', 'flask', 'endpoint', 'rest', 'system design', 'latency', 'throughput', 'rate limit', 'gateway', 'load balanc', 'production', 'sla', 'scalab'],
  s25: ['power bi', 'dashboard', 'kpi', 'funnel', 'cohort', 'data analyst', 'storytelling', 'visuali'],
  s26: ['mlops', 'llmops', 'docker', 'kubernetes', 'ci/cd', 'observability', 'monitor', 'rollback', 'drift', 'tracing', 'eval suite', 'evaluation set', 'aws', 'logging'],
  s27: ['interview', 'cross-role', 'behavioral', 'star', 'salary', 'career', 'hiring'],
  s28: ['big-o', 'complexity', 'algorithm', 'dynamic programming', 'graph', 'tree', 'sorting', 'hash map'],
  s29: ['capstone', 'portfolio', 'resume story'],
};

/** `Level:` band → difficulty, and → bank type when the band is not a plain interview answer. */
const LEVEL_DIFFICULTY = { Basic: 'easy', 'Basic -> Advanced': 'medium', Normal: 'medium', Advanced: 'hard', Scenario: 'hard', Checkpoint: 'medium', Defense: 'hard' };

/** Bands whose answer is the document's own method line rather than a question-specific answer. */
const METHOD_ANSWER = /^(Answer verbally first|Pehle problem ko isolate karo)/i;

/* ================================ parsing ================================= */

/** Split the layout text into pages, keeping the document's own page furniture out of the way. */
function pages(text) {
  const p = text.split('\f');
  // `pdftotext` emits one trailing form feed, which would count as a final empty page (95 for the
  // document's 94) and make every "page N of M" read wrong.
  while (p.length && !p[p.length - 1].trim()) p.pop();
  return p;
}

// The chapter title may start with a digit — "26 30-DAY REVISION + ROLE CHECKLISTS" — which a
// `[A-Z]`-only first character silently dropped, losing chapter 26 from the index entirely.
const CHAPTER_RE = /^([0-9]{2}) ([A-Z0-9][A-Z0-9 +:,/&().'-]+)$/;
/** The index page's own heading is not one of the document's 36 chapters. */
const isChapter = (no) => no !== '00';
const isFurniture = (t) =>
  !t || /^AI ENGINEER MASTER \|/.test(t) || /^\s*\d+\s*$/.test(t) || /^\s*Version \d/.test(t);

/** The document's chapters, with the 1-based page each one starts on. */
function chapters(pageTexts) {
  const out = [];
  pageTexts.forEach((pt, i) => {
    for (const line of pt.split('\n')) {
      const t = line.trim();
      const m = t.match(CHAPTER_RE);
      if (m && t.length < 92) out.push({ no: m[1], title: m[2].trim(), page: i + 1 });
    }
  });
  // The master index repeats every chapter title on one page; the real chapter starts later.
  const seen = new Map();
  for (const c of out) if (!seen.has(c.no)) seen.set(c.no, c);
  return [...seen.values()].sort((a, b) => a.page - b.page);
}

/**
 * Every layout line, flattened and tagged with its 1-based page.
 *
 * The pair scan cannot run page by page: 11 pairs have their `Jawaab` pushed onto the next page
 * by the page break, so a per-page scan sees a question with no answer at all (and `pdftotext`
 * puts the page number and the running header between the two lines). Scanning one flat list and
 * dropping the document's furniture lines finds those answers without inventing anything.
 */
function flatLines(pageTexts) {
  const out = [];
  pageTexts.forEach((pt, i) => {
    for (const line of pt.split('\n')) out.push({ t: line.trim(), page: i + 1 });
  });
  return out;
}

/**
 * `Sawal - …` / `Jawaab - …` / `Level: …` triples with the nearest preceding short heading.
 * A heading is tracked rather than taken from the chapter, because chapter 18 groups its 205
 * questions under sub-headings ("RAG", "MCP", …) and those are the real topics.
 */
function parsePairs(pageTexts) {
  const lines = flatLines(pageTexts);
  const pairs = [];
  let heading = null, chapter = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].t;
    if (isFurniture(t)) continue;
    const ch = t.match(CHAPTER_RE);
    if (ch && t.length < 92) { chapter = ch[1]; continue; }
    if (/^Sawal\s*[-–]\s*/.test(t)) {
      const question = t.replace(/^Sawal\s*[-–]\s*/, '').trim();
      const answerLines = [];
      let level = null;
      for (let j = i + 1; j < Math.min(i + 16, lines.length); j++) {
        const s = lines[j].t;
        if (!s || isFurniture(s)) continue;
        if (/^Jawaab\s*[-–]\s*/.test(s)) {
          answerLines.push(s.replace(/^Jawaab\s*[-–]\s*/, '').trim());
          for (let k = j + 1; k < Math.min(j + 12, lines.length); k++) {
            const s2 = lines[k].t;
            if (!s2 || isFurniture(s2)) continue;
            if (/^(Jawaab|Sawal)\s*[-–]/.test(s2) || /^Level:/.test(s2)) break;
            if (CHAPTER_RE.test(s2) && s2.length < 92) break;
            answerLines.push(s2);
          }
          break;
        }
        if (/^(Sawal|Level)\b/.test(s)) break;
      }
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        const lv = lines[j].t.match(/^Level:\s*(.+)$/);
        if (lv) { level = lv[1].trim(); break; }
        if (/^Sawal\s*[-–]/.test(lines[j].t)) break;
      }
      pairs.push({ chapter, heading, question, answer: answerLines.join(' ').replace(/\s+/g, ' ').trim(), level, page: lines[i].page });
      continue;
    }
    // A heading: short, starts with a letter, no sentence punctuation, not boilerplate.
    if (t && t.length < 46 && /^[A-Za-z]/.test(t) && !/[.?,;]$/.test(t)
      && !/^(Sawal|Jawaab|Level|Practice|Note|Version|AI ENGINEER)/i.test(t)
      && !/^\d/.test(t) && !/^[A-Z ]{6,}$/.test(t)) heading = t;
  }
  return pairs;
}

/** Chapter 15's `Lab NN - title` blocks: the code, and the document's own practice line. */
function parseLabs(pageTexts) {
  const labs = [];
  pageTexts.forEach((pt, pageIdx) => {
    const lines = pt.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].trim().match(/^Lab\s+(\d+)\s*[-–]\s*(.+)$/);
      if (!m) continue;
      const code = [];
      let practice = '';
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
        const s = lines[j].trim();
        if (/^Lab\s+\d+\s*[-–]/.test(s)) break;
        if (/^Practice:/.test(s)) { practice = s.replace(/^Practice:\s*/, '').trim(); break; }
        if (s && !isFurniture(s)) code.push(lines[j].replace(/\s+$/, ''));
      }
      labs.push({ no: m[1].padStart(2, '0'), title: m[2].trim(), code: code.join('\n').replace(/\n{3,}/g, '\n\n').trim(), practice, page: pageIdx + 1 });
    }
  });
  return labs;
}

/** Chapter 17's `NN Project name` blueprints, with their labelled lines. */
function parseProjects(pageTexts, fromPage, toPage) {
  const projects = [];
  const lines = [];
  for (let p = fromPage - 1; p < toPage - 1; p++) lines.push(...(pageTexts[p] ?? '').split('\n'));
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].trim().match(/^(\d{2})\s+([A-Z][A-Za-z0-9 +\-&/().']{4,60})$/);
    if (!m) continue;
    const fields = {};
    for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
      const s = lines[j].trim();
      if (!s) continue;
      if (/^\d{2}\s+[A-Z]/.test(s)) break;
      const f = s.match(/^(Architecture|Key stack|Must-have demo|Evaluation set|Security|Defense|Practice|Problem|Users):\s*(.+)$/);
      if (f) fields[f[1]] = f[2].trim();
    }
    if (Object.keys(fields).length >= 2) projects.push({ no: m[1], name: m[2].trim(), fields });
  }
  return projects;
}

/**
 * Chapter 16's complexity table → reference rows (a row the document itself states).
 *
 * The columns are read by splitting on the 2+ spaces `-layout` puts between them, not by one
 * regex: `O((V+E) log V)` contains spaces of its own, so a pattern that treats the complexity
 * column as space-free silently loses the Dijkstra row.
 */
function parseComplexityTable(text) {
  const rows = [];
  const block = text.split(/Complexity quick table/i)[1]?.split(/Logic pattern/i)[0] ?? '';
  for (const line of block.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const cols = t.split(/\s{2,}/).map((c) => c.trim()).filter(Boolean);
    // A data row's second column is a complexity; the header row's is the word "Complexity".
    if (cols.length < 2 || !/^O\(/.test(cols[1])) continue;
    rows.push({ topic: cols[0], complexity: cols[1], note: cols[2] ?? '' });
  }
  return rows;
}

/**
 * Chapter 16's numbered "Logic pattern" checklist. The document states one method, already
 * ordered, so it is imported as ONE item carrying all of its steps rather than one item per step
 * with a fabricated answer. Takes the LAST occurrence: the master index names the section too.
 */
function parseLogicChecklist(text) {
  const after = text.split(/Logic pattern/i).pop() ?? '';
  const steps = [];
  for (const line of after.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const m = t.match(/^\d+\.\s*(.+)$/);
    if (!m) break;   // the checklist is one contiguous block
    steps.push(m[1].trim());
  }
  return steps;
}

/**
 * The 8 capstones chapter 17's intro names but gives no blueprint of its own. They are kept as
 * their own seeds because the naming line is ALL the document says about them: writing an
 * architecture for each would be inventing content.
 */
function parseCapstones(text) {
  const m = text.match(/Source capstone list me ([^.]+?) included hain/i);
  if (!m) return [];
  return m[1].split(/,|\saur\s/).map((s) => s.trim()).filter((s) => s.length > 3);
}

/* ================================ routing ================================= */

function route(pair, chaptersByNo) {
  const heading = pair.heading;
  if (heading && HEADING_SECTION[heading]) return HEADING_SECTION[heading];
  // No declared heading (the checkpoint list): score the question text by keyword.
  const q = ` ${pair.question.toLowerCase()} `;
  let best = null, bestScore = 0;
  for (const [sid, words] of Object.entries(SECTION_KEYWORDS)) {
    let score = 0;
    for (const w of words) if (q.includes(w)) score += w.length;
    if (score > bestScore) { best = sid; bestScore = score; }
  }
  void chaptersByNo;
  return best ?? CHAPTER_SECTION[pair.chapter] ?? 's27';
}

/* ================================== main ================================== */

function main() {
  let layout;
  try {
    layout = extractLayout(PDF, { cacheFile: CACHE, fresh: FRESH });
  } catch (err) {
    bad(err.message);
    console.log('   usage: node scripts/playbook.cjs --pdf="<path-to.pdf>" [--write] [--fresh]');
    process.exit(2);
  }

  const pageTexts = pages(layout.text);
  const chs = chapters(pageTexts);
  const pairs = parsePairs(pageTexts);
  const labs = parseLabs(pageTexts);

  const ch17 = chs.find((c) => c.no === '17');
  const ch18 = chs.find((c) => c.no === '18');
  const projects = ch17 ? parseProjects(pageTexts, ch17.page, ch18 ? ch18.page : ch17.page + 6) : [];
  const capstones = parseCapstones(layout.text);
  const logicSteps = parseLogicChecklist(layout.text);
  const complexity = parseComplexityTable(layout.text);

  console.log(`\n— Playbook V15 → question banks ${WRITE ? '\x1b[1m(write)\x1b[0m' : '(dry run)'} —\n`);
  console.log(`  source     : ${layout.fromCache ? `${CACHE} ${dim('(cached layout text)')}` : PDF}`);
  console.log(`  pages      : ${pageTexts.length}`);
  console.log(`  chapters   : ${chs.length}${chs.some((c) => !isChapter(c.no)) ? ' (including the index page)' : ''}`);
  console.log(`  Q&A pairs  : ${pairs.length}  ${dim(`${pairs.filter((p) => METHOD_ANSWER.test(p.answer)).length} carry the document's method answer, not a model answer`)}`);
  console.log(`  coding labs: ${labs.length}`);
  console.log(`  projects   : ${projects.length} blueprints + ${capstones.length} named capstones (chapter 17)`);
  console.log(`  table rows : ${complexity.length} ${dim('(chapter 16 complexity quick table)')}`);
  console.log(`  logic steps: ${logicSteps.length} ${dim('(chapter 16 logic pattern checklist)')}`);

  /* ------------------------------- banks items ------------------------------ */
  const seen = new Map();
  const records = [];
  const dropped = { noAnswer: 0, tooShort: 0, repeated: 0 };
  const sanitize = (s) => s.replace(/\s+/g, ' ').trim();

  for (const p of pairs) {
    const question = sanitize(p.question);
    const answer = sanitize(p.answer);
    if (!answer) { dropped.noAnswer++; continue; }
    if (question.length < 8) { dropped.tooShort++; continue; }
    const key = norm(question);
    if (seen.has(key)) { dropped.repeated++; continue; }
    seen.set(key, true);
    const sid = route(p, chs);
    const isCheckpoint = p.level === 'Checkpoint';
    const isDefense = p.level === 'Defense' || /defense/i.test(p.heading ?? '');
    records.push({
      sectionId: sid,
      type: isCheckpoint ? 'checkpoint' : isDefense ? 'defense' : 'interview',
      difficulty: LEVEL_DIFFICULTY[p.level] ?? 'medium',
      importance: p.level === 'Advanced' ? 'interview_critical' : p.level === 'Basic' ? 'high_value' : 'advanced',
      question,
      answer,
      explanation: METHOD_ANSWER.test(answer)
        ? 'Is sawaal ka answer bol kar do — phir apne section se verify karo (source me model answer ki jagah yahi method diya gaya hai).'
        : '',
      tags: ['playbook', `pb:${p.chapter}`, ...(METHOD_ANSWER.test(answer) ? ['method-answer'] : [])],
      heading: p.heading,
      chapter: p.chapter,
      page: p.page,
    });
  }

  for (const lab of labs) {
    const question = sanitize(`Coding Lab ${lab.no}: ${lab.title} implement karo.`);
    const key = norm(question);
    if (seen.has(key)) { dropped.repeated++; continue; }
    seen.set(key, true);
    records.push({
      // Every lab lives in ONE section so it can be practised in one place; a lab is a build task,
      // not a topic, so keyword-routing it into the topic sections would scatter the set.
      sectionId: 's28',
      type: 'coding',
      difficulty: 'medium',
      importance: 'high_value',
      question,
      answer: lab.code || '(lab me code block nahi mila)',
      explanation: lab.practice || 'Is lab ko apne project ke ek real use-case se connect karo — error path aur test case bhi likho.',
      tags: ['playbook', 'pb:15', 'lab'],
      chapter: '15',
      page: lab.page,
    });
  }

  for (const pr of projects) {
    const question = sanitize(`Mini Project: ${pr.name} end-to-end build karo.`);
    const key = norm(question);
    if (seen.has(key)) { dropped.repeated++; continue; }
    seen.set(key, true);
    records.push({
      // The `mini-project` tag is what routes a `coding` item to the MINI PROJECT stage rather than
      // the Coding Lab (see STAGE_QNA in src/data/questions.ts) — the item type alone cannot say it.
      sectionId: 's29',
      type: 'coding',
      difficulty: 'hard',
      importance: 'interview_critical',
      question,
      answer: ['Architecture', 'Key stack', 'Must-have demo', 'Evaluation set', 'Security', 'Defense']
        .filter((k) => pr.fields[k]).map((k) => `${k}: ${pr.fields[k]}`).join('\n'),
      explanation: 'Happy path ke saath ek failure path bhi demo karo; 90-second explanation aur architecture diagram taiyar rakho.',
      tags: ['playbook', 'pb:17', 'mini-project'],
      chapter: '17',
      page: pr.page,
    });
  }

  // Chapter 17 names 8 more capstones in its intro without a blueprint. The document's own naming
  // line is the answer; the explanation asks for the chapter's blueprint format instead of faking one.
  const capstoneList = capstones.join(', ');
  for (const name of capstones) {
    const question = sanitize(`Mini Project: ${name.charAt(0).toUpperCase()}${name.slice(1)} build karo (blueprint khud likho).`);
    const key = norm(question);
    if (seen.has(key)) { dropped.repeated++; continue; }
    seen.set(key, true);
    records.push({
      sectionId: 's29',
      type: 'coding',
      difficulty: 'hard',
      importance: 'high_value',
      question,
      answer: `Source capstone list me ${capstoneList} included hain.`,
      explanation: 'Is capstone ka detailed blueprint document me nahi diya gaya — chapter 17 ke 7 numbering blueprints ka format use karo: Architecture, Key stack, Must-have demo, Evaluation set, Security, Defense.',
      tags: ['playbook', 'pb:17', 'mini-project', 'capstone-name'],
      chapter: '17',
    });
  }

  for (const row of complexity) {
    const question = sanitize(`${row.topic} — complexity kya hai?`);
    const key = norm(question);
    if (seen.has(key)) { dropped.repeated++; continue; }
    seen.set(key, true);
    records.push({
      sectionId: 's28',
      type: 'theory',
      difficulty: 'medium',
      importance: 'high_value',
      question,
      answer: `${row.complexity}${row.note ? ` — ${row.note}` : ''}`,
      explanation: 'Chapter 16 ke complexity quick table se, jaisa document me likha hai.',
      tags: ['playbook', 'pb:16', 'table'],
      chapter: '16',
    });
  }

  if (logicSteps.length) {
    const question = 'Logic pattern: interview me problem dekh kar kis order me sochna hai?';
    const key = norm(question);
    if (!seen.has(key)) {
      seen.set(key, true);
      records.push({
        sectionId: 's28',
        type: 'logic',
        difficulty: 'medium',
        importance: 'must_know',
        question,
        answer: logicSteps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
        explanation: 'Chapter 16 ka Logic pattern checklist — document ke apne order me.',
        tags: ['playbook', 'pb:16', 'logic-pattern'],
        chapter: '16',
      });
    }
  }

  /* -------------------------------- report --------------------------------- */
  const bySection = {};
  const byType = {};
  for (const r of records) {
    bySection[r.sectionId] = (bySection[r.sectionId] ?? 0) + 1;
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }
  const known = new Set(loadSections().map((s) => s.id));
  const unknown = Object.keys(bySection).filter((s) => !known.has(s));
  console.log(`\n  records    : ${records.length} (${Object.entries(byType).map(([t, n]) => `${t} ${n}`).join(', ')})`);
  console.log(`  dropped    : ${dropped.noAnswer} without an answer, ${dropped.tooShort} too short, ${dropped.repeated} repeated in the document`);
  console.log('\n  SECTION  TOPIC                              NEW');
  const sections = loadSections();
  for (const [sid, n] of Object.entries(bySection).sort()) {
    const s = sections.find((x) => x.id === sid);
    console.log(`  ${sid}     ${String(s ? s.title : '??').slice(0, 32).padEnd(33)}${n}`);
  }
  const chaptersUsed = {};
  for (const r of records) chaptersUsed[r.chapter] = (chaptersUsed[r.chapter] ?? 0) + 1;
  console.log(`\n  chapters with items: ${Object.keys(chaptersUsed).sort().join(' ')}`);
  if (unknown.length) { bad(`unknown section id(s): ${unknown.join(', ')}`); process.exit(1); }

  const index = {
    generatedAt: new Date().toISOString(),
    source: path.basename(PDF ?? 'Ahetesham_AI_Engineer_Master_Full_Hinglish_Advanced_2026_FINAL.pdf'),
    pages: pageTexts.length,
    totals: {
      items: records.length,
      byType,
      bySection,
      // What the document calls its own parts, so the page can label them the same way.
      labs: labs.length,
      miniProjectBlueprints: projects.length,
      miniProjectCapstones: capstones.length,
      complexityRows: complexity.length,
      logicSteps: logicSteps.length,
      methodAnswers: records.filter((r) => (r.tags ?? []).includes('method-answer')).length,
    },
    // The document's own chapter order, not page order: chapter 28 (Sources) really does sit near
    // the back of the file, and showing the index in reading order would look like a parse bug.
    chapters: chs.filter((c) => isChapter(c.no)).sort((a, b) => a.no.localeCompare(b.no)).map((c) => {
      const own = records.filter((r) => r.chapter === c.no);
      const bySection = own.reduce((a, r) => { a[r.sectionId] = (a[r.sectionId] ?? 0) + 1; return a; }, {});
      // A chapter's items are spread over several sections (chapter 18's 205 answers land in 11 of
      // them), so the chapter keeps the whole distribution and names the biggest recipient as its
      // own section — a single first-item guess would send the reader to the wrong lesson.
      const [topSection] = Object.entries(bySection).sort((a, b) => b[1] - a[1])[0] ?? [];
      return {
        no: c.no,
        title: c.title,
        pdfPage: c.page,
        sectionId: topSection ?? CHAPTER_SECTION[c.no] ?? 's27',
        sections: bySection,
        items: own.length,
        byType: own.reduce((a, r) => { a[r.type] = (a[r.type] ?? 0) + 1; return a; }, {}),
      };
    }),
  };

  if (!WRITE) {
    console.log('\nDry run — nothing written. Apply with --write, then: npm run questions:playbook -- --write');
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.mkdirSync(path.dirname(INDEX), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ source: index.source, generatedAt: index.generatedAt, items: records }, null, 1));
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 1));
  ok(`wrote ${records.length} item(s) → content/questions/expansion/playbook-v15.json`);
  ok(`chapter index → public/playbook/manifest.json (${index.chapters.length} chapters, ${index.chapters.filter((c) => c.items).length} of them with imported items)`);
}

main();
