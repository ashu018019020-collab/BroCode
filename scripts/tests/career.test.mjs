/**
 * The career engine — "what do I do next, and am I job-ready?", answered from real records.
 *
 * The Career pillar's failure mode is not a crash: it is a page that still renders while telling
 * the learner something false — a percentage with no denominator, a "next step" pointing at a page
 * that does not exist, a target role whose skills are not tracks, a portfolio trio that disagrees
 * with the Project Lab's own. None of those throw, so the pure rules are driven with fixtures here,
 * AND against the real registries (paths.ts, the router, TRACK_DEFS, the one achievements list).
 *
 * `achievements.ts` pulls the engine graph (keys → career → defense), so the project's resolver is
 * registered exactly like labs.test.mjs / coverage.test.mjs. Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

// Every one of these is pure (no React, no store, no fetch) — that is what makes them loadable here.
const career = await load('src/core/learning/career.ts');
const paths = await load('src/core/learning/paths.ts');
const ach = await load('src/core/platform/achievements.ts');
const defense = await load('src/core/assessment/defense.ts');

const appSrc = read('src/app/App.tsx');
const ROUTES = new Set([...appSrc.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]));
const defsBlock = appSrc.slice(appSrc.indexOf('export const TRACK_DEFS'), appSrc.indexOf('];', appSrc.indexOf('export const TRACK_DEFS')));
const TRACK_IDS = [...defsBlock.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);

/** A learner who has done nothing, with no manifest loaded yet. Overrides are partial. */
const cold = (over = {}) => ({
  sections: 29, learningPct: 0, mastered: 0, miniDone: 0, projectGates: 0, buildsDone: 0,
  defenseGates: 0, resumeAnswers: 0, resumeTotal: 30, mockDone: 0, mockTotal: 0,
  bankPractised: 0, bankTotal: null, notebookCells: 0, notebookCellsTotal: null,
  interviewAnswers: 0, checklist: {}, ...over,
});

/* ------------------------------- the checklist ------------------------------ */

test('career: the checklist is the 16 items paths.JOB_PREP_ITEMS declares', () => {
  assert.equal(career.CAREER_CHECKLIST.length, paths.JOB_PREP_ITEMS);
  const ids = career.CAREER_CHECKLIST.map((it) => it.id);
  assert.equal(new Set(ids).size, ids.length, 'two checklist items share an id — a tick would double-count');
  const phases = new Set(career.CHECKLIST_PHASES.map((p) => p.id));
  assert.equal(career.CHECKLIST_PHASES.length, 4);
  for (const it of career.CAREER_CHECKLIST) {
    assert.ok(phases.has(it.phase), `${it.id} names phase "${it.phase}", which the page never renders`);
    assert.ok(it.to.startsWith('/'), `${it.id} must link somewhere inside the app`);
    assert.ok(it.weight > 0, `${it.id} has no weight, so it would never move readiness`);
  }
  // The two ticks the GitHub/LinkedIn row reads must be real items.
  for (const id of career.PROFILE_IDS) assert.ok(ids.includes(id), `${id} is not a checklist item`);
});

test('career: readiness is weighted, and a full checklist is exactly 100%', () => {
  const zero = career.checklistReadiness({});
  assert.equal(zero.pct, 0);
  assert.equal(zero.done, 0);
  assert.equal(zero.total, career.CAREER_CHECKLIST.length);
  assert.equal(zero.byPhase.length, 4);
  assert.equal(zero.byPhase.reduce((a, p) => a + p.total, 0), career.CAREER_CHECKLIST.length);

  const all = Object.fromEntries(career.CAREER_CHECKLIST.map((it) => [it.id, true]));
  assert.equal(career.checklistReadiness(all).pct, 100);
  assert.equal(career.checklistReadiness(all).done, career.CAREER_CHECKLIST.length);

  // Weighted, not a plain count: ticking only the heaviest item is not the same as 1/16 of the work.
  const heaviest = [...career.CAREER_CHECKLIST].sort((a, b) => b.weight - a.weight)[0];
  const totalW = career.CAREER_CHECKLIST.reduce((a, it) => a + it.weight, 0);
  assert.equal(career.checklistReadiness({ [heaviest.id]: true }).pct, Math.round((heaviest.weight / totalW) * 100));
});

/* ------------------------- no link leaves the app -------------------------- */

test('career: every link the engine hands out is a registered route', () => {
  const wants = [
    career.nextCareerAction(cold()),
    // A learner deep in the flow still gets a real destination at every gate.
    career.nextCareerAction(cold({ learningPct: 40 })),
    career.nextCareerAction(cold({ learningPct: 40, buildsDone: 1, projectGates: 1 })),
    career.nextCareerAction(cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1 })),
    career.nextCareerAction(cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4 })),
    career.nextCareerAction(cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4, mockDone: 2, mockTotal: 40, checklist: { github: true, linkedin: true } })),
    career.nextCareerAction(cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4, mockDone: 2, mockTotal: 40, checklist: Object.fromEntries(career.CAREER_CHECKLIST.map((it) => [it.id, true])) })),
  ];
  for (const tile of career.careerRoadmap(cold())) assert.ok(ROUTES.has(tile.to), `roadmap tile ${tile.id} links ${tile.to}`);
  for (const row of career.jobReadiness(cold())) assert.ok(ROUTES.has(row.to), `readiness row ${row.id} links ${row.to}`);
  for (const w of wants) assert.ok(ROUTES.has(w.to), `next action "${w.title}" links ${w.to}`);
  assert.ok(wants.every((w) => career.CAREER_FLOW.includes(w.phase)), 'a next action names a phase outside the flow');
});

/* --------------------------------- the NBA --------------------------------- */

test('career: the next action walks LEARN → BUILD → PROVE → PRESENT → PREPARE → APPLY → INTERVIEW → GET HIRED', () => {
  const all = Object.fromEntries(career.CAREER_CHECKLIST.map((it) => [it.id, true]));
  const steps = [
    [cold(), 'LEARN'],
    [cold({ learningPct: 40 }), 'BUILD'],
    [cold({ learningPct: 40, buildsDone: 1, projectGates: 1 }), 'PROVE'],
    [cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1 }), 'PRESENT'],
    [cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4 }), 'PREPARE'],
    [cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4, mockDone: 2, mockTotal: 40 }), 'APPLY'],
    [cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4, mockDone: 2, mockTotal: 40, checklist: all }), 'INTERVIEW'],
    [cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1, resumeAnswers: 4, mockDone: 2, mockTotal: 40, interviewAnswers: 6, checklist: all }), 'GET HIRED'],
  ];
  let last = -1;
  for (const [input, phase] of steps) {
    const action = career.nextCareerAction(input);
    assert.equal(action.phase, phase);
    assert.ok(action.title.length > 4 && action.reason.length > 10, `${phase} must say what to do and why`);
    // The reason quotes the real number whenever the gate has one.
    if (phase === 'LEARN') assert.match(action.reason, /40%|0%/);
    const at = career.CAREER_FLOW.indexOf(phase);
    assert.ok(at > last, `${phase} came out of order`);
    last = at;
  }
  // …and the strip agrees with the gate that produced it.
  const flow = career.careerFlow(cold({ learningPct: 40, buildsDone: 1, projectGates: 1, defenseGates: 1 }));
  assert.equal(flow.find((f) => f.state === 'current').phase, 'PRESENT');
  assert.equal(flow.filter((f) => f.state === 'done').length, 3);
});

test('career: a phase already started never blocks the next one', () => {
  // 7/30 pitches written: PRESENT is not "done", but it must not hold the learner hostage either.
  const started = cold({ learningPct: 60, buildsDone: 2, projectGates: 1, miniDone: 1, defenseGates: 3, resumeAnswers: 7, mockDone: 0 });
  assert.equal(career.nextCareerAction(started).phase, 'PREPARE');
  // A partial resume still shows its real number in the readiness rows, not a verdict.
  const row = career.jobReadiness(started).find((r) => r.id === 'resume');
  assert.equal(row.done, 7);
  assert.equal(row.total, 30);
  assert.equal(row.state, 'started');
});

/* ------------------------------- the tiles --------------------------------- */

test('career: roadmap tiles carry real denominators, never an invented percentage', () => {
  const tiles = career.careerRoadmap(cold({ sections: 29, learningPct: 62, mastered: 8, projectGates: 5, defenseGates: 2, resumeAnswers: 9, checklist: { github: true } }));
  const by = Object.fromEntries(tiles.map((t) => [t.id, t]));
  assert.equal(by.learn.pct, 62);
  assert.equal(by.build.pct, Math.round((5 / 29) * 100));
  assert.equal(by.prove.pct, Math.round((2 / 29) * 100));
  assert.equal(by.resume.pct, 30);
  assert.equal(by.profile.pct, 50);        // 1 of the 2 profile ticks
  assert.equal(by.apply.pct, 0);           // no application tick yet
  assert.equal(by.apply.total, career.CAREER_CHECKLIST.filter((it) => it.phase === 'apply').length);
  assert.equal(tiles.length, 6, 'the roadmap is Learn/Build/Prove/Resume/Profile/Apply');
});

test('career: progress bars go null — not 0% — where no denominator exists', () => {
  const lines = Object.fromEntries(career.careerProgress(cold()).map((l) => [l.id, l]));
  // No bank manifest, no notebook manifest, no mock set loaded: facts only.
  assert.equal(lines.practice.pct, null);
  assert.equal(lines.labs.pct, null);
  assert.equal(lines.interview.pct, null);
  // These three have a denominator the curriculum itself provides.
  assert.equal(lines.learning.pct, 0);
  assert.equal(lines.projects.pct, 0);
  assert.equal(lines.portfolio.pct, 0);

  const full = Object.fromEntries(career.careerProgress(cold({ bankPractised: 100, bankTotal: 400, notebookCells: 13, notebookCellsTotal: 131, mockDone: 20, mockTotal: 40 })).map((l) => [l.id, l]));
  assert.equal(full.practice.pct, 25);
  assert.equal(full.labs.pct, 10);
  assert.equal(full.interview.pct, 50);
});

test('career: a row with nothing done reads empty, and fills in as the record grows', () => {
  assert.equal(career.readinessState(null), 'empty');
  assert.equal(career.readinessState(0), 'empty');
  assert.equal(career.readinessState(1), 'started');
  assert.equal(career.readinessState(50), 'building');
  assert.equal(career.readinessState(99), 'building');
  assert.equal(career.readinessState(100), 'ready');
  const rows = career.jobReadiness(cold({ mockDone: 0, mockTotal: 0 }));
  assert.equal(rows.length, 6);
  assert.equal(rows.find((r) => r.id === 'interview').pct, null, 'an empty mock set has no percentage');
  assert.equal(rows.find((r) => r.id === 'portfolio').pct, 0, 'the 3-project portfolio rule has a real denominator');
});

/* ------------------------------ skills & roles ----------------------------- */

test('career: mastery averages the sections in range, and an empty range is 0 — not ready', () => {
  const tracks = [
    { id: 'python', label: 'Python Core', from: 1, to: 2 },
    { id: 'ghost', label: 'Ghost Track', from: 90, to: 99 },
  ];
  const skills = career.trackMastery([{ no: 1, masterPct: 90 }, { no: 2, masterPct: 40 }, { no: 5, masterPct: 100 }], tracks);
  assert.equal(skills[0].pct, 65);
  assert.equal(skills[0].status, 'building');
  assert.equal(skills[1].pct, 0);
  assert.equal(skills[1].status, 'missing');
  // The thresholds themselves: 75 ready, 40 building.
  const at = (pct) => career.trackMastery([{ no: 1, masterPct: pct }], [tracks[0]])[0].status;
  assert.equal(at(career.SKILL_READY), 'ready');
  assert.equal(at(career.SKILL_READY - 1), 'building');
  assert.equal(at(career.SKILL_BUILDING), 'building');
  assert.equal(at(career.SKILL_BUILDING - 1), 'missing');
});

test('career: every role names only real tracks, and its readiness follows mastery', () => {
  assert.ok(career.TARGET_ROLES.length >= 3, 'the role catalog must offer real choices');
  assert.equal(new Set(career.TARGET_ROLES.map((r) => r.id)).size, career.TARGET_ROLES.length, 'two roles share an id');
  for (const role of career.TARGET_ROLES) {
    for (const id of role.tracks) assert.ok(TRACK_IDS.includes(id), `role ${role.id} needs "${id}", which is not a track`);
  }

  const skills = career.trackMastery([], TRACK_IDS.map((id, i) => ({ id, label: id, from: i + 1, to: i + 1 })));
  const role = career.TARGET_ROLES[0];
  const view = career.roleSkills(role, skills.map((s, i) => ({ ...s, pct: i === 0 ? 10 : 90, status: i === 0 ? 'missing' : 'ready' })));
  assert.equal(view.skills.length, role.tracks.length);
  assert.equal(view.weakest.pct, 10, 'Fix Skill Gaps must open the lowest-mastery skill');
  assert.equal(view.ready, role.tracks.length - 1);

  // A role naming a track that does not exist yet loses that row instead of crashing.
  const trimmed = career.roleSkills({ id: 'x', label: 'X', emoji: '🧪', blurb: '', tracks: ['python', 'not-a-track'] }, skills);
  assert.equal(trimmed.skills.length, 1);

  // The default pick is the closest role, not a hardcoded one.
  const best = career.bestRole([...skills].map((s, i) => ({ ...s, pct: i === TRACK_IDS.indexOf('genai') ? 90 : 5, status: 'missing' })));
  assert.ok(best.tracks.includes('genai'), 'the closest role should be the one whose skills are strongest');
});

/* ------------------------------ the trio rule ------------------------------ */

test('career: the portfolio trio is done-first, then strongest, and only three', () => {
  const cards = [
    { key: 'a', name: 'A', done: false, pct: 99 },
    { key: 'b', name: 'B', done: true, pct: 10 },
    { key: 'c', name: 'C', done: true, pct: 80 },
    { key: 'd', name: 'D', done: false, pct: 50 },
  ];
  const trio = career.portfolioTrio(cards);
  assert.deepEqual(trio.map((c) => c.key), ['c', 'b', 'a']);
  assert.equal(trio.length, 3);
  // The input must not be reordered in place — both callers map over their own list afterwards.
  assert.deepEqual(cards.map((c) => c.key), ['a', 'b', 'c', 'd']);
  assert.deepEqual(career.portfolioTrio([]), []);
});

/* ------------------------------ the badges --------------------------------- */

test('career: the career badges live in the ONE achievements list and read the career records', () => {
  const ids = new Set(ach.ACHIEVEMENTS.map((a) => a.id));
  for (const id of ['first-project', 'defended', 'resume-ready', 'checklist-half', 'mock-1', 'code-10']) {
    assert.ok(ids.has(id), `the career panel expects badge "${id}", which ACHIEVEMENTS does not define`);
  }

  const section = (over = {}) => ({
    id: 's01', no: 1, title: 'Variables',
    pages: { learn: [], interview: [], code: [], logic: [], solved: [], mini: [], project: [], checkpoint: [] },
    learn: { concepts: [], recap: '', remember: [], practice: [] },
    interview: [], coding: [], logic: [], solved: [], mini: {}, projectLab: [], checkpoint: [],
    ...over,
  });
  const state = {
    version: 1, profile: { name: '', goal: '', level: '', dailyMinutes: 60, onboarded: true },
    xp: 0, streak: { current: 0, last: '' }, attempts: {}, bookmarks: [], mistakes: [], review: {},
    interviewAnswers: {}, defenseAnswers: {}, savedCode: {}, settings: { reduceMotion: false },
    activity: {}, study: {}, notes: [], jobPrep: {}, readNotifs: [],
  };
  const withAttempts = { ...state, attempts: { 'st:s01:project': { done: true }, 'st:s02:defense': { score: 80 } }, defenseAnswers: { 'resume:chatbot:0': 'x' }, jobPrep: { github: true } };
  const sections = [section({ id: 's01' }), section({ id: 's02', no: 2 })];

  // The counts the badges read are the same records the Career hub reads.
  const ctx = ach.context(withAttempts, sections);
  assert.equal(ctx.projectGates, 1);
  assert.equal(ctx.defenseGates, 1);
  assert.equal(ctx.resumeAnswers, 1);
  assert.equal(ctx.checklistTicks, 1);

  const earned = ach.earnedAchievements(withAttempts, sections);
  assert.equal(earned.find((a) => a.id === 'first-project').earned, true);
  assert.equal(earned.find((a) => a.id === 'defended').earned, true);
  assert.equal(earned.find((a) => a.id === 'resume-ready').earned, false, 'one pitch is not a finished resume');
  assert.equal(earned.find((a) => a.id === 'resume-ready').need, defense.RESUME_ANSWER_TOTAL, 'the resume denominator is every question of every project');

  // …and the career panel shows the subset, still from that one list.
  const subset = ach.careerAchievements(withAttempts, sections);
  assert.ok(subset.length > 0 && subset.length < ach.ACHIEVEMENTS.length, 'the career subset must be a slice of the whole list');
  assert.ok(subset.every((a) => earned.some((e) => e.id === a.id)), 'a career badge is not in ACHIEVEMENTS');
});

/* ------------------------------- the surface ------------------------------- */

test('career: the hub renders the engine and links every pillar it depends on', () => {
  const hub = read('src/features/career/CareerHub.tsx');
  // The rules live in the engine; the page must not re-derive them.
  for (const call of ['nextCareerAction', 'careerRoadmap', 'jobReadiness', 'careerProgress', 'careerFlow', 'careerAchievements']) {
    assert.match(hub, new RegExp(`${call}\\(`), `the hub must use the engine's ${call}`);
  }
  // The pillars this one stands on, as the page itself spells them. (The routes the engine hands
  // out — /courses, /mock-interviews, /interview-mode — are pinned by the link test above, since
  // the hub renders them through `to={tile.to}` rather than as literals.)
  for (const to of ['/projects', '/labs', '/defense', '/job-prep', '/progress', '/playbook']) {
    assert.ok(hub.includes(`"${to}"`) || hub.includes(`'${to}'`), `the hub never links ${to}`);
  }
  assert.match(hub, /\/practice\?subject=/, 'the skill-gap fix must open practice on that subject');
  assert.match(hub, /\/questions\?type=interview/, 'the interview/HR bank must be reachable from career');
});
