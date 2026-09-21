#!/usr/bin/env node
/**
 * PDF → curriculum extraction pipeline (final).
 * Requires: pdftotext (xpdf). Run: node tools/extract.mjs "<path-to-pdf>"
 * Output: public/curriculum/{sections,meta}.json
 *
 * Attribution strategy (the PDF has 3 layout passes with overlapping/renumbered content):
 *  1. Every spread page is classified by explicit markers (PROJECT NN/SECTION, PROJECT LAB NN,
 *     LAB headers, SOLVED PRACTICE, MINI PROJECT, checkpoint) and resolved to a canonical
 *     section via fuzzy title match (aliases cover short header forms).
 *  2. Lab-page headers carry NO title, so the most recent unresolved unit heading
 *     (forward resolution) fills the gap.
 *  3. Learn pages use SECTION title headers; numbering is cross-checked when valid.
 *  4. Condensed re-print of units 14-29 is merged into canonical sections and deduped.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PDF = process.argv[2];
if (!PDF) { console.error('usage: node tools/extract.mjs <pdf>'); process.exit(1); }
const OUT = path.resolve('public/curriculum');
fs.mkdirSync(OUT, { recursive: true });

const raw = execFileSync('pdftotext', [PDF, '-'], { maxBuffer: 256 * 1024 * 1024 }).toString();
const PAGES = raw.split('\f');
console.log('pages:', PAGES.length - 1);

// ---------- helpers ----------
const clean = (s) => s
  .replace(/\r/g, '')
  .split('\n')
  .map((l) => l.replace(/\s+/g, ' ').trim())
  .filter((l) => l.length > 0)
  .filter((l) => !/^Ahetesham Khan/.test(l))
  .filter((l) => !/^Python Complet/i.test(l))
  .filter((l) => !/Hinglish.*Edition$/.test(l))
  .filter((l) => !/^(Hinglish|VP5\.D1F)/.test(l))
  .filter((l) => !/^PDF p\. \d+$/.test(l) && !/^\d+ PDF p\. \d+$/.test(l) && !/^PDF p\. [\d ]+$/.test(l))
  .filter((l) => !/Rebuilt Master V3\.0/.test(l))
  .filter((l) => !/Smart Section Rebuild V4\.0/.test(l))
  .join('\n');

const norm = (x) => x.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const rawPage = (n) => PAGES[n - 1] ?? '';
const page = (n) => clean(rawPage(n));

// ---------- canonical titles + aliases ----------
const CANON = [
  'Variables & Data Types', 'Operators', 'Input & Output', 'Strings', 'String Methods',
  'if / elif / else', 'for & while Loops', 'Lists', 'List Methods', 'Tuples', 'Sets',
  'Dictionaries', 'OOP (Object Oriented Programming)', 'Functions & Reusable Python',
  'Exceptions, Files & Modules', 'Advanced Python & Performance', 'NumPy for AI & Data Science',
  'Pandas for Data Science', 'SQL + Databases', 'Machine Learning + scikit-learn',
  'NLP + Transformers', 'Generative AI, LLMs & RAG', 'Agentic AI + LangChain + n8n',
  'APIs, Flask/FastAPI & Production Python', 'Data Analytics + Power BI',
  'MLOps + Docker + Git + AWS', 'AI Engineer + Data Scientist Interview Mastery',
  'Coding Patterns, Projects & Final Practice', 'Resume Project Interview Labs',
];
const ALIASES = {
  4: ['strings and methods'],
  14: ['functions python core', 'functions', 'python functions core'],
  16: ['advanced python performance', 'advanced python'],
  17: ['numpy for ai data', 'numpy for ai data science', 'numpy ai data'],
  18: ['pandas for data', 'pandas data science'],
  19: ['sql databases'],
  20: ['machine learning scikit learn', 'machine learning'],
  22: ['genai llm rag', 'generative ai llm rag'],
  23: ['agentic ai langchain n8n', 'agentic ai automation', 'agentic ai langchain n8n automation'],
  24: ['apis flask fastapi production python', 'flask rest apis', 'apis flask fastapi'],
  25: ['data analytics power bi'],
  26: ['mlops docker git aws'],
  27: ['ai engineer data scientist interview mastery'],
  28: ['coding patterns projects final practice'],
  29: ['resume project interview labs'],
};
function matchSection(text) {
  const t = norm(text);
  if (t.length < 4) return null;
  let best = null, bestLen = 0;
  for (let i = 0; i < CANON.length; i++) {
    const c = norm(CANON[i]);
    const ok = t === c || (t.length >= 6 && (t.startsWith(c) || c.startsWith(t)));
    if (ok) { const l = Math.min(t.length, c.length); if (l > bestLen) { best = i + 1; bestLen = l; } }
  }
  if (!best) {
    for (const [no, list] of Object.entries(ALIASES)) {
      for (const a of list) {
        if (t.startsWith(a) || a.startsWith(t)) { const l = Math.min(t.length, a.length); if (l > bestLen) { best = +no; bestLen = l; } }
      }
    }
  }
  return best;
}

// ---------- page classification ----------
// The PDF has three layout passes: first (p8-190, units 1-13), condensed (p191-292,
// units 14-29 renumbered), final (p293-449, units 14-29 in V5 format). Rule:
//   units 1-13 -> first pass; units 14-29 -> final pass, falling back to condensed
//   for kinds the final pass lacks (learn/solved/mini for some units).
const sec = new Map(); // no -> {pages:{learn,interview,code,logic,solved,mini,project,checkpoint}}
const getSec = (no) => {
  if (!sec.has(no)) sec.set(no, { pages: { learn: [], interview: [], code: [], logic: [], solved: [], mini: [], project: [], checkpoint: [] } });
  return sec.get(no);
};
const checkpointPages = [];
const pendingLearn = []; // condensed learn pages awaiting their unit (resolved by next "PROJECT NN" page)
const SECT = /S\s?E\s?C\s?T\s?I\s?O\s?N/g;

for (let p = 8; p <= PAGES.length - 1; p++) {
  const t0 = rawPage(p);
  if (!clean(t0)) continue;
  const t = t0.replace(SECT, 'SECTION');

  if (/Question Checkp/.test(t)) { checkpointPages.push(p); continue; }

  // mini project + solved practice pages: "PROJECT NN / SECTION" (also resolves pending learn pages)
  const pn = t.match(/PROJECT (\d{1,2}) \/ SECTION/);
  if (pn) {
    const no = parseInt(pn[1], 10);
    if (no >= 1 && no <= 29) {
      if (/SOLVED PRACTICE/.test(t)) getSec(no).pages.solved.push(p);
      else if (/MINI PROJECT - /.test(t)) getSec(no).pages.mini.push(p);
      if (pendingLearn.length) { pendingLearn.forEach((lp) => getSec(no).pages.learn.push(lp)); pendingLearn.length = 0; }
      continue;
    }
  }

  // learn pages: "PYTHON COMPLETE GUIDE" then "NN TITLE" or title line
  const lm = t.match(/PYTHON COMPLETE GUIDE\s*\n\s*(?:0?(\d{1,2})\s+)?([A-Z][^\n]+)/);
  if (lm) {
    let no = lm[1] ? parseInt(lm[1], 10) : null;
    const mTitle = matchSection(lm[2]);
    if (mTitle) no = mTitle; // title is authoritative; header numbers are unreliable in the condensed pass
    if (no && no >= 1 && no <= 29) {
      const okRange = no <= 13 ? p <= 190 : p >= 191;
      if (okRange) { getSec(no).pages.learn.push(p); continue; }
    }
  }

  // project lab pages: "PROJECT LAB NN"
  const pl = t.match(/PROJECT LAB (\d{1,2})/);
  if (pl) {
    const no = parseInt(pl[1], 10);
    if (no >= 1 && no <= 29) { getSec(no).pages.project.push(p); continue; }
  }

  // spread headers
  const sp = t.match(/INTERVIEW LAB \uFFFD ([^\n]+)/) || t.match(/INTERVIEW LAB \/ ([^\n]+)/);
  if (sp) { const no = matchSection(sp[1]); if (no) { getSec(no).pages.interview.push(p); continue; } }
  const cl = t.match(/CODING LAB \uFFFD ([^\n]+)/) || t.match(/CODING LAB \/ ([^\n]+)/);
  if (cl && !/LOGIC \+ DEBUG/.test(t)) { const no = matchSection(cl[1]); if (no) { getSec(no).pages.code.push(p); continue; } }
  const ll = t.match(/LOGIC(?: \+ DEBUG)? LAB \uFFFD ([^\n]+)/) || t.match(/LOGIC(?: \+ DEBUG)? LAB \/ ([^\n]+)/);
  if (ll) { const no = matchSection(ll[1]); if (no) { getSec(no).pages.logic.push(p); continue; } }

  // final-pass learn pages: "TITLE \uFFFD Learn N" header (MODULE numbering is not the section number)
  if (p >= 293 && /\uFFFD Learn \d+/.test(t)) {
    const tl = t.split('\n').find((l) => /\uFFFD Learn \d+/.test(l)) ?? '';
    const no = matchSection(tl.split('\uFFFD')[0].trim());
    if (no) { getSec(no).pages.learn.push(p); continue; }
  }

  // unit heading with title ("SECTION NN\nTitle")
  const head = t.match(/SECTION (\d{1,2})\s*\n\s*([A-Z][^\n]+)/);
  if (head) {
    const mTitle = matchSection(head[2]);
    if (mTitle) {
      const okRange = mTitle <= 13 ? p <= 190 : p >= 191;
      if (okRange) { getSec(mTitle).pages.learn.push(p); continue; }
    }
  }

  // condensed learn page without a usable title -> resolved by the next "PROJECT NN" page
  if (p >= 191 && p <= 292 && /PYTHON COMPLETE GUIDE/.test(t) && /SECTION \d{1,2}/.test(t)) pendingLearn.push(p);
}

// ---------- parsers (same as validated) ----------
function parseLearn(secPages) {
  const out = { concepts: [], recap: '', remember: [], practice: [] };
  let cur = null;
  for (const p of secPages) {
    // final-pass learn pages are two-column study sheets: preserve as one notes block per page
    if (p >= 293) {
      const ls = page(p).split('\n');
      const t = (ls[1] ?? '').replace(/ \uFFFD Learn \d+$/, '');
      const start = ls.findIndex((l) => /Easy Hinglish/.test(l));
      out.concepts.push({ title: `${t} - study notes (p.${p})`, level: 'notes', body: ls.slice(start + 1).join(' ').trim(), code: '', output: '', tip: '' });
      continue;
    }
    const lines = page(p).split('\n');
    let inCode = false, codeBuf = [], outBuf = null, afterPractice = false;
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      if (/QUICK RECAP/.test(L)) { out.recap = collectBullets(lines, i); continue; }
      if (/^YAAD RAKHO|^REMEMBER/.test(L)) { out.remember.push(lines[i + 1] ?? ''); i++; continue; }
      if (/PRACTICE TIME/.test(L)) { afterPractice = true; continue; }
      if (afterPractice) {
        const q = L.match(/^(EASY|MEDIUM|HARD)\s*(Q\d+)?[.\s:]*(.+)$/);
        if (q && q[3] && q[3].length > 5) out.practice.push({ difficulty: q[1].toLowerCase(), text: q[3].trim() });
        continue;
      }
      const cm = L.match(/^(\d{1,2}\.\d{1,2})\s+(.+)$/);
      if (cm && cm[2].length > 3) {
        cur = { title: cm[2].trim(), level: /ADVANCED/.test(lines[i - 1] ?? '') ? 'advanced' : 'core', body: [], code: '', output: '', tip: '' };
        out.concepts.push(cur); codeBuf = []; inCode = false; outBuf = null;
        continue;
      }
      if (!cur) continue;
      if (/main\.py/.test(L)) { inCode = true; outBuf = null; codeBuf = []; continue; }
      if (/^OUTPUT$/.test(L) && inCode) { cur.code = codeBuf.join('\n'); codeBuf = []; outBuf = 'output'; inCode = false; continue; }
      if (/^TIP:?|^YAAD RAKHO/.test(L)) { cur.tip = lines[i + 1] ?? cur.tip; i++; inCode = false; outBuf = null; continue; }
      if (inCode) codeBuf.push(L);
      else if (outBuf === 'output') cur.output += (cur.output ? ' | ' : '') + L;
      else cur.body.push(L);
    }
    if (cur && codeBuf.length && !cur.code) cur.code = codeBuf.join('\n');
  }
  out.concepts.forEach((c) => { if (Array.isArray(c.body)) c.body = c.body.join(' ').trim(); });
  return out;
}
function collectBullets(lines, i) {
  const parts = [];
  for (let j = i + 1; j < lines.length; j++) {
    const L = lines[j];
    if (/(PRACTICE TIME|YAAD RAKHO)/.test(L) || /^(EASY|MEDIUM|HARD)$/.test(L)) break;
    parts.push(L.replace(/^[\u2022\-\u2713\)\d.]+\s*/, ''));
  }
  return parts.join(' ');
}

function parseInterview(secPages) {
  const qs = [];
  for (const p of secPages) {
    const lines = page(p).split('\n');
    let cur = null, mode = null;
    const startQ = (text) => { if (cur) qs.push(cur); cur = { q: text, a: '', tip: '', fu: '' }; mode = null; };
    for (let i = 0; i < lines.length; i++) {
      const L = lines[i];
      const mSame = L.match(/^Q0?(\d{1,2})\s*\uFFFD?\s*(.+)$/);
      if (mSame && mSame[2] && mSame[2].length > 2 && !/KEY/.test(L)) { startQ(mSame[2].trim()); continue; }
      if (/^Q0?\d{1,2}$/.test(L)) { startQ((lines[i + 1] ?? '').trim()); i++; continue; }
      if (!cur) continue;
      if (/BEST ANSWER|SMART ANSWER|MODEL ANSWER/.test(L)) {
        const rest = L.replace(/^(BEST|SMART|MODEL) ANSWER/, '').trim();
        if (rest) { splitInline(rest, cur); mode = null; } else mode = 'a';
        continue;
      }
      if (/^FOLLOW-UP|^TIP:|^FOLLOW UP/.test(L)) {
        const inline = L.replace(/^FOLLOW-UP \/ TIP|^FOLLOW-UP|^FOLLOW UP|^TIP:/, '').trim();
        mode = /TIP/.test(L) ? 'tip' : 'fu';
        if (inline) cur[mode] += (cur[mode] ? ' ' : '') + inline;
        continue;
      }
      if (/^SPEAK:/.test(L)) { cur.tip += (cur.tip ? ' ' : '') + L; continue; }
      if (mode === 'a') { splitInline(L, cur); mode = null; }
      else if (mode === 'tip') cur.tip += (cur.tip ? ' ' : '') + L;
      else if (mode === 'fu') cur.fu += (cur.fu ? ' ' : '') + L;
    }
    if (cur) qs.push(cur);
  }
  return qs.filter((x) => x.q && x.a && x.q.length > 2);
}
function splitInline(L, cur) {
  const fu = L.indexOf('FOLLOW-UP');
  const tip = L.indexOf('TIP:');
  const speak = L.indexOf('SPEAK:');
  const firstIdx = [fu, tip, speak].filter((x) => x >= 0).sort((a, b) => a - b)[0];
  if (firstIdx === undefined) { cur.a += (cur.a ? ' ' : '') + L; return; }
  cur.a += (cur.a ? ' ' : '') + L.slice(0, firstIdx).trim();
  const rest = L.slice(firstIdx);
  const fuM = rest.match(/FOLLOW-UP(?: \/ TIP)?[:]? (.*?)(?=TIP:|SPEAK:|$)/);
  const tipM = rest.match(/TIP: (.*?)(?=FOLLOW-UP|SPEAK:|$)/);
  const spM = rest.match(/SPEAK: (.*?)(?=FOLLOW-UP|TIP:|$)/);
  if (fuM && fuM[1].trim()) cur.fu += (cur.fu ? ' ' : '') + fuM[1].trim();
  if (tipM && tipM[1].trim()) cur.tip += (cur.tip ? ' ' : '') + tipM[1].trim();
  if (spM && spM[1].trim()) cur.tip += (cur.tip ? ' ' : '') + spM[1].trim();
}

function parseCode(secPages) {
  const tasks = [];
  for (const p of secPages) {
    const lines = page(p).split('\n');
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      let text = buf.join(' ');
      const ans = text.indexOf(' ANSWER ');
      const chk = text.indexOf(' CHECK ');
      const task = { difficulty: '', text: '', solution: '', check: '' };
      let rest = text;
      const dm = rest.match(/^(EASY|MEDIUM|HARD|DEBUG|INTERVIEW CODE)\s*(\uFFFD PRACTICE)?\s*/);
      if (dm) { task.difficulty = dm[1].toLowerCase(); rest = rest.slice(dm[0].length); }
      if (ans >= 0 && (chk < 0 || ans < chk)) {
        task.text = rest.slice(0, ans).trim();
        const afterAns = rest.slice(ans + 8);
        const c2 = afterAns.indexOf(' CHECK ');
        if (c2 >= 0) { task.solution = afterAns.slice(0, c2).trim(); task.check = afterAns.slice(c2 + 7).trim(); }
        else task.solution = afterAns.trim();
      } else if (chk >= 0) {
        task.text = rest.slice(0, chk).trim(); task.check = rest.slice(chk + 7).trim();
      } else task.text = rest.trim();
      if (task.text.length > 3) tasks.push(task);
      buf = [];
    };
    for (const L of lines) {
      const dm = L.match(/^(EASY|MEDIUM|HARD|DEBUG|INTERVIEW CODE)(\s*\uFFFD PRACTICE)?\s*$/);
      if (dm) { flush(); buf.push(L); continue; }
      const dmInline = L.match(/^(EASY|MEDIUM|HARD|DEBUG|INTERVIEW CODE)\s*(\uFFFD PRACTICE)?\s+(.+)$/);
      if (dmInline && !/LAB/.test(L)) { flush(); buf.push(dmInline[1]); buf.push(dmInline[3]); continue; }
      if (/^WRITE CODE$|^STARTER KIT|^3-STEP DEBUG LOOP|^Interview coding line|^CODING INTERVIEW LINE/.test(L)) { flush(); continue; }
      buf.push(L);
    }
    flush();
  }
  return tasks;
}

const LOGIC_KINDS = ['PREDICT', 'Predict', 'TRACE', 'Trace', 'THINK', 'Think', 'WHY', 'Why', 'FIX', 'Fix', 'EXPLAIN', 'Explain', 'DESIGN', 'TRADE-OFF'];
function parseLogic(secPages) {
  const cards = [];
  for (const p of secPages) {
    const lines = page(p).split('\n');
    let cur = null, mode = null;
    for (const L of lines) {
      const kind = LOGIC_KINDS.find((k) => L === k || L.startsWith(k + ' '));
      if (kind && L.replace(kind, '').trim().length < 220 && !/MASTER CHECK/.test(L)) {
        if (cur) cards.push(cur);
        cur = { kind: kind.toLowerCase().replace('-', ''), text: L.replace(kind, '').trim(), answer: '' };
        mode = null; continue;
      }
      if (!cur) continue;
      if (/CHECK|^ANSWER/.test(L)) {
        // final-pass generic pages embed the question before "CHECK / ANSWER" on one line
        if (cur.text === '' && L.includes('CHECK / ANSWER')) {
          const [q, ...rest] = L.split('CHECK / ANSWER');
          cur.text = q.trim(); cur.answer += rest.join(' ').trim(); mode = 'ans'; continue;
        }
        mode = 'ans';
        const rest = L.replace(/^CHECK ?\/ ?ANSWER|^CHECK|^ANSWER/, '').trim();
        if (rest) cur.answer += rest + ' ';
        continue;
      }
      if (/^5 COMMON MISTAKES|^Mastery check|^Master check/.test(L)) { if (cur) { cards.push(cur); cur = null; } mode = null; continue; }
      if (mode === 'ans') cur.answer += L + ' ';
      else cur.text += ' ' + L;
    }
    if (cur) cards.push(cur);
  }
  return cards.map((c) => ({ ...c, text: c.text.trim(), answer: c.answer.trim() })).filter((c) => c.text.length > 2);
}

function parseSolved(secPages) {
  const items = [];
  for (const p of secPages) {
    const lines = page(p).split('\n');
    let cur = null, mode = null;
    const start = (diff, text) => { if (cur) items.push(cur); cur = { difficulty: diff, text, solution: '', result: '' }; mode = 'sol'; };
    for (const L of lines) {
      const dm = L.match(/^(EASY|MEDIUM|HARD|DEBUG|INTERVIEW CODE)\s*(\uFFFD PRACTICE)?\s*$/);
      if (dm) { start(dm[1].toLowerCase(), (lines[lines.indexOf(L) + 1] ?? '').trim()); continue; }
      const dmInline = L.match(/^(EASY|MEDIUM|HARD|DEBUG|INTERVIEW CODE)\s*(\uFFFD PRACTICE)?\s+(.+)$/);
      if (dmInline && !/LAB|HABIT/.test(L)) { start(dmInline[1].toLowerCase(), dmInline[3].trim()); continue; }
      if (!cur) continue;
      if (/^EXPECTED RESULT/.test(L)) { mode = 'res'; const r = L.replace(/^EXPECTED RESULT/, '').trim(); if (r) cur.result += r + ' '; continue; }
      if (/PRACTICE HABIT|Practice rule/.test(L)) { if (cur) { items.push(cur); cur = null; } continue; }
      if (mode === 'res') cur.result += L + ' ';
      else if (mode === 'sol') cur.solution += L + '\n';
      else cur.text += ' ' + L;
    }
    if (cur) items.push(cur);
  }
  return items
    .map((t) => ({ ...t, text: t.text.trim(), solution: t.solution.trim(), result: t.result.trim() }))
    .filter((t) => t.text.length > 3);
}

function parseMini(secPages) {
  const mp = { name: '', what: '', use: '', architecture: '', files: '', buildTarget: '', output: '', code: '', explanation: '', interview: '', edgeCases: [] };
  let mode = null, codeBuf = [];
  for (const p of secPages) {
    const lines = page(p).split('\n');
    for (const L of lines) {
      const nm = L.match(/MINI PROJECT - (.+)$/);
      if (nm) { mp.name = mp.name || nm[1].trim(); continue; }
      if (/YE KYA KARTA HAI|What does it do/.test(L)) { mode = 'what'; const r = L.replace(/^.*?YE KYA KARTA HAI\??|^.*?What does it do\??/, '').trim(); if (r) mp.what += r; continue; }
      if (/KIS KAAM AATA HAI/.test(L)) { mode = 'use'; const r = L.replace(/^.*?KIS KAAM AATA HAI\??/, '').trim(); if (r) mp.use += r; continue; }
      if (/^ARCHITECTURE/.test(L)) { mode = 'architecture'; continue; }
      if (/^FILES/.test(L)) { mode = 'files'; const r = L.replace(/^FILES:?/, '').trim(); if (r) mp.files += r; continue; }
      if (/^BUILD TARGET/.test(L)) { mode = 'buildTarget'; const r = L.replace(/^BUILD TARGET:?/, '').trim(); if (r) mp.buildTarget += r; continue; }
      if (/EXPECTED OUTPUT|SAMPLE OUTPUT/.test(L)) { mode = 'output'; continue; }
      if (/INTERVIEW DEFENSE|INTERVIEW EXPLANATION/.test(L)) { mode = 'interview'; continue; }
      if (/EDGE CASE/.test(L)) { mode = 'edge'; continue; }
      if (/PROJECT EXPLANATION/.test(L)) { mode = 'explanation'; continue; }
      if (/^main\.py$|^app\.py$/.test(L)) { if (mode === 'code' && codeBuf.length) mp.code += (mp.code ? '\n' : '') + codeBuf.join('\n'); mode = 'code'; codeBuf = []; continue; }
      if (/MINI PROJECT RULE|PROJECT RULE|Master check|Mastery check/.test(L)) { mode = null; continue; }
      if (mode === 'code') { codeBuf.push(L); continue; }
      if (mode === 'edge') { mp.edgeCases.push(L); continue; }
      if (mode && mp[mode] !== undefined) mp[mode] += (mp[mode] ? ' ' : '') + L;
    }
    if (mode === 'code' && codeBuf.length) mp.code += (mp.code ? '\n' : '') + codeBuf.join('\n');
    codeBuf = [];
  }
  for (const k of ['what', 'use', 'architecture', 'files', 'buildTarget', 'output', 'explanation', 'interview']) mp[k] = mp[k].trim();
  mp.code = mp.code.trim();
  if (!mp.what && mp.use) mp.what = mp.use;
  if (!mp.what && mp.architecture) mp.what = `Runnable mini build: ${mp.architecture}`;
  return mp;
}

function parseProjectLab(secPages) {
  const tiers = {};
  let cur = null, mode = null;
  for (const p of secPages) {
    const lines = page(p).split('\n');
    for (const L of lines) {
      const tm = L.match(/^(SIMPLE|MEDIUM|HARD)\s*\|\s*(.+)$/);
      if (tm) {
        const tier = tm[1].toLowerCase();
        cur = tiers[tier] ?? (tiers[tier] = { tier, name: tm[2].trim(), what: '', use: '', architecture: '', files: '', buildTarget: '', code: '', defense: '', debugCue: '', followUp: '' });
        mode = null; continue;
      }
      if (!cur) continue;
      const fieldMatch = [
        [/^Kya karta hai/, 'what'], [/^Kis kaam aata hai/, 'use'], [/^Architecture/, 'architecture'],
        [/^Files/, 'files'], [/^Build target/, 'buildTarget'], [/^Debug cue/, 'debugCue'], [/^Follow-up/, 'followUp'],
      ].find(([re]) => re.test(L));
      if (fieldMatch) {
        mode = fieldMatch[1];
        const r = L.replace(/^[^:]+:\s*/, '').trim();
        if (r) cur[mode] += r;
        continue;
      }
      if (/^INTERVIEW DEFENSE/.test(L)) { mode = 'defense'; const r = L.replace(/^INTERVIEW DEFENSE\s*(Project answer:)?/, '').trim(); if (r) cur.defense += r; continue; }
      if (/SELF-CHECK|Project rule/.test(L)) { mode = null; continue; }
      if (mode && cur[mode] !== undefined) cur[mode] += (cur[mode] ? ' ' : '') + L;
      else if (mode === null && /^[a-zA-Z_@].*(=|def |print\(|\.)/.test(L) && !/Kya karta|Kis kaam|Architecture|Build target|Debug cue|Follow-up/.test(L)) cur.code += L + '\n';
    }
  }
  const list = Object.values(tiers);
  list.forEach((t) => { for (const k of ['what', 'use', 'architecture', 'files', 'buildTarget', 'defense', 'debugCue', 'followUp']) t[k] = t[k].trim(); t.code = t.code.trim(); });
  return list;
}

function parseCheckpoint(pagesList) {
  const items = [];
  for (const p of pagesList) {
    const lines = page(p).split('\n');
    let cur = null, mode = null;
    for (const L of lines) {
      const qm = L.match(/^(\d{1,2})\s+(.+)$/);
      if (qm && !/KEY/.test(L) && parseInt(qm[1], 10) >= 1 && parseInt(qm[1], 10) <= 20 && qm[2].length > 8) {
        if (cur) items.push(cur);
        cur = { q: qm[2].trim(), key: '' }; mode = null; continue;
      }
      if (!cur) continue;
      if (/^KEY:/.test(L)) { mode = 'key'; const r = L.replace(/^KEY:/, '').trim(); if (r) cur.key += r + ' '; continue; }
      if (/SCORE RULE/.test(L)) { mode = null; continue; }
      if (mode === 'key') cur.key += L + ' ';
    }
    if (cur) items.push(cur);
  }
  return items;
}

// ---------- assemble ----------
function dedupe(items, keyOf) {
  const seen = new Set();
  return items.filter((it) => {
    const k = keyOf(it);
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}
const qKey = (s) => norm(s.q ?? s.text ?? '').slice(0, 60);
const tKey = (s) => norm(s.text ?? '').slice(0, 60);
const cKey = (s) => norm(s.title ?? '');
const tierKey = (s) => s.tier;

function pickPages(unit, list) {
  if (unit <= 13) return list.filter((p) => p <= 190);
  const final = list.filter((p) => p >= 293);
  return final.length ? final : list.filter((p) => p >= 191 && p <= 292);
}
function pickLearn(unit, list) {
  if (unit <= 13) return list.filter((p) => p <= 190);
  const final = list.filter((p) => p >= 293);
  return final.length ? final : list;
}

const result = CANON.map((title, i) => {
  const no = i + 1;
  const raw = sec.get(no)?.pages ?? { learn: [], interview: [], code: [], logic: [], solved: [], mini: [], project: [], checkpoint: [] };
  const p = {
    learn: pickLearn(no, raw.learn), interview: pickPages(no, raw.interview), code: pickPages(no, raw.code),
    logic: pickPages(no, raw.logic), solved: pickPages(no, raw.solved), mini: pickPages(no, raw.mini),
    project: pickPages(no, raw.project), checkpoint: raw.checkpoint,
  };
  const learn = parseLearn(p.learn);
  return {
    id: `s${String(no).padStart(2, '0')}`,
    no, title, pages: p,
    learn: { ...learn, concepts: dedupe(learn.concepts, cKey) },
    interview: dedupe(parseInterview(p.interview), qKey),
    coding: dedupe(parseCode(p.code), tKey),
    logic: dedupe(parseLogic(p.logic), tKey),
    solved: dedupe(parseSolved(p.solved), tKey),
    mini: parseMini(p.mini),
    projectLab: parseProjectLab(p.project),
    checkpoint: [],
  };
});

for (const p of checkpointPages) {
  const line = (rawPage(p).split('\n').map((l) => l.trim()).find((l) => /Question Checkp/.test(l)) ?? '');
  const titlePart = line.split('\uFFFD')[0].trim();
  const no = matchSection(titlePart);
  if (no) result[no - 1].checkpoint = parseCheckpoint([p]);
}

// ---------- back matter: final mock interview + interview intensive ----------
function parseBackMatter() {
  const rounds = [];
  const intensive = [];
  let round = null, cat = '', cur = null, mode = null, pendingQ = '';
  const push = () => {
    if (!cur || !cur.q || !cur.a) { cur = null; return; }
    if (round) round.questions.push(cur); else intensive.push(cur);
    cur = null;
  };
  const scan = (p) => {
    const t = rawPage(p);
    const rm = t.match(/Round (\d{1,2}) - Questions/);
    if (rm) { push(); round = { round: parseInt(rm[1], 10), questions: [] }; rounds.push(round); mode = null; }
    for (const L of clean(t).split('\n')) {
      if (/^Round \d/.test(L)) continue;
      const qm = L.match(/^(\d{1,2})\.\s+(.+)$/);
      if (qm && parseInt(qm[1], 10) <= 40 && qm[2].length > 6) { push(); cur = { cat, q: qm[2].trim(), a: '' }; mode = 'a'; pendingQ = ''; continue; }
      if (/^MODEL ANSWER/.test(L)) { mode = 'a2'; const r = L.replace(/^MODEL ANSWER:?/, '').trim(); if (cur && r) cur.a += (cur.a ? ' ' : '') + r; continue; }
      if (L.includes('SMART ANSWER')) {
        const i = L.indexOf('SMART ANSWER');
        const q = L.slice(0, i).trim() || pendingQ;
        push(); cur = { cat, q, a: L.slice(i + 12).trim() }; mode = 'a2'; pendingQ = ''; continue;
      }
      if (L === 'SMART' || L === 'ANSWER') { if (!cur && pendingQ) { cur = { cat, q: pendingQ, a: '' }; pendingQ = ''; } mode = 'a2'; continue; }
      if (/^FINAL INTERVIEW INTENSIVE|^INTERVIEW MASTER LAB|^Answer aloud|^FINAL MOCK/.test(L)) { mode = null; pendingQ = ''; continue; }
      if (L.length <= 14 && /^[A-Z][A-Za-z +]{1,13}$/.test(L)) {
        if (cur && !cur.a) { cur.cat = L.trim(); continue; }
        push(); cat = L.trim(); mode = null; pendingQ = ''; continue;
      }
      if (cur && mode === 'a2') cur.a += (cur.a ? ' ' : '') + L;
      else if (cur && mode === 'a' && !/^\d/.test(L)) cur.q += ' ' + L;
      else if (!cur) pendingQ += (pendingQ ? ' ' : '') + L;
    }
  };
  for (let p = 429; p <= 438; p++) scan(p); // Final Interview Intensive (SMART ANSWER format)
  for (let p = 450; p <= 453; p++) scan(p); // Final Mock Interview rounds 1-4
  push();
  return { mockInterview: rounds.filter((r) => r.questions.length), intensive };
}
const back = parseBackMatter();
fs.writeFileSync(path.join(OUT, 'extras.json'), JSON.stringify(back));

fs.writeFileSync(path.join(OUT, 'sections.json'), JSON.stringify(result));
fs.writeFileSync(path.join(OUT, 'meta.json'), JSON.stringify({
  generatedFrom: path.basename(PDF),
  sections: result.map((s) => ({ id: s.id, no: s.no, title: s.title, pages: s.pages })),
  counts: {
    concepts: result.reduce((a, s) => a + s.learn.concepts.length, 0),
    interview: result.reduce((a, s) => a + s.interview.length, 0),
    coding: result.reduce((a, s) => a + s.coding.length, 0),
    logic: result.reduce((a, s) => a + s.logic.length, 0),
    solved: result.reduce((a, s) => a + s.solved.length, 0),
    miniProjects: result.filter((s) => s.mini.what).length,
    projectLabs: result.reduce((a, s) => a + s.projectLab.length, 0),
    checkpoints: result.reduce((a, s) => a + s.checkpoint.length, 0),
    practice: result.reduce((a, s) => a + s.learn.practice.length, 0),
  },
}, null, 1));
console.log('sections:', result.length);
console.log(JSON.stringify(JSON.parse(fs.readFileSync(path.join(OUT, 'meta.json'))).counts));
