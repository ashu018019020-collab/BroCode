/**
 * The scoped tutor — "ask about THIS step / THIS build", grounded in authored content.
 *
 * The failure mode is not a crash: it is a prompt that names a topic the step does not teach, a
 * briefing that says "undefined", or a tutor context that forgets which build is open so the answer
 * drifts to another chapter. None of those throw, so the rules are driven here with fixtures and
 * the two pages are checked for handing the real authored fields in.
 *
 * Zero dependencies — node:test, `npm test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./_ts-resolve.mjs', import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

const {
  buildBriefing, buildTutorContext, buildTutorPrompts,
  stepBriefing, stepTutorContext, stepTutorPrompts,
} = await load('src/core/ai/step-tutor.ts');

const step = (over = {}) => ({
  no: 12,
  title: 'APIs and Requests',
  courseTitle: 'Python Foundations',
  goal: 'Call a real HTTP API and handle its errors',
  topics: ['requests', 'status codes'],
  route: '/course/python/12?tab=lesson',
  ...over,
});

const build = (over = {}) => ({
  name: 'Agentic AI Automation Workflow',
  sectionTitle: 'Automation with n8n',
  tier: 'Real Project',
  what: 'Automate a multi-step workflow',
  files: 'workflow.json',
  architecture: 'Webhook → agent → action',
  buildTarget: 'A duplicate webhook does not double-charge',
  edgeCases: ['duplicate webhook delivery'],
  steps: [{ no: 1, label: 'What you build', detail: 'Automate a workflow' }],
  defenseQuestion: 'How do you prove the manual work dropped?',
  route: '/lesson/s18/project',
  ...over,
});

test('scoped tutor: a step prompt names the step and its real topic, never a guess', () => {
  const prompts = stepTutorPrompts(step());

  assert.equal(prompts.length, 4, 'four starters, no menu of ten');
  assert.match(prompts[0], /APIs and Requests/, 'the first question quotes the real step title');
  assert.match(prompts[1], /requests/, 'the concept prompt uses the authored topic');
  assert.match(prompts[2], /Call a real HTTP API/, 'the done-check quotes the authored goal');
  assert.ok(prompts.every((p) => !/undefined|null|\[object/.test(p)), 'no empty field leaks into a prompt');
});

test('scoped tutor: a step with no authored goal or topics still gets honest generic prompts', () => {
  const thin = step({ goal: '', topics: [] });
  const prompts = stepTutorPrompts(thin);

  assert.equal(prompts.length, 4, 'the same four starters');
  assert.ok(prompts.every((p) => p.trim().length > 12), 'each is a usable question');
  assert.ok(prompts.every((p) => !/undefined/.test(p)), 'nothing interpolates a missing field');
  assert.match(prompts[1], /main idea/, 'the concept prompt falls back to the step itself');
  assert.doesNotMatch(prompts.join(' '), /requests|HTTP API/, 'no topic is invented for a thin step');
});

test('scoped tutor: the step briefing states the step, course, goal and topics', () => {
  const brief = stepBriefing(step());
  assert.match(brief, /^Step 12 · Python Foundations · APIs and Requests\./);
  assert.match(brief, /Goal: Call a real HTTP API/);
  assert.match(brief, /Topics: requests, status codes/);

  const thin = stepBriefing(step({ goal: '', topics: [] }));
  assert.equal(thin, 'Step 12 · Python Foundations · APIs and Requests. This page lists the step\'s own material.');
});

test('scoped tutor: the step context carries the route, the title and the first real topic', () => {
  const ctx = stepTutorContext(step());

  assert.equal(ctx.route, '/course/python/12?tab=lesson', 'the tutor can cite the page it is on');
  assert.equal(ctx.pageTitle, 'APIs and Requests');
  assert.equal(ctx.chapterTitle, 'APIs and Requests', 'the card header reads the step, not a stale section');
  assert.equal(ctx.courseTitle, 'Python Foundations');
  assert.equal(ctx.topic, 'requests', 'retrieval is biased toward the authored topic');
  assert.match(ctx.where, /Step 12 · Python Foundations · APIs and Requests/);
});

test('scoped tutor: build prompts come from the files, the edge case and the defense question', () => {
  const prompts = buildTutorPrompts(build());

  assert.equal(prompts.length, 4);
  assert.match(prompts[1], /workflow\.json/, 'the file question is the authored file list');
  assert.match(prompts[2], /duplicate webhook delivery/, 'the test question is the authored edge case');
  assert.equal(prompts[3], 'How do you prove the manual work dropped?', 'the defense prompt IS the authored question');
  assert.ok(prompts.every((p) => !/undefined|null/.test(p)));
});

test('scoped tutor: a build with no edge cases or defense asks something answerable instead', () => {
  const prompts = buildTutorPrompts(build({ edgeCases: [], defenseQuestion: '', files: '' }));

  assert.equal(prompts.length, 4);
  assert.match(prompts[1], /files should I create first/, 'no empty file name');
  assert.match(prompts[2], /test this build/, 'no empty edge case');
  assert.match(prompts[3], /defend this build/, 'no empty defense question');
});

test('scoped tutor: the build briefing lists what the brief actually authored', () => {
  const brief = buildBriefing(build());
  assert.match(brief, /^Agentic AI Automation Workflow · Real Project · Automation with n8n\./);
  assert.match(brief, /Files: workflow\.json/);
  assert.match(brief, /Architecture: Webhook → agent → action/);
  assert.match(brief, /Done when: A duplicate webhook does not double-charge/);
  assert.match(brief, /1 build steps/, 'the authored step count is stated');
});

test('scoped tutor: the build context names the section and the real route', () => {
  const ctx = buildTutorContext(build());
  assert.equal(ctx.route, '/lesson/s18/project');
  assert.equal(ctx.pageTitle, 'Agentic AI Automation Workflow');
  assert.equal(ctx.lessonTitle, 'Automation with n8n');
  assert.match(ctx.where, /Build · Automation with n8n · Real Project/);
});

test('scoped tutor: both pages hand the real authored fields to the tutor', () => {
  const stepPage = fs.readFileSync(path.join(ROOT, 'src/features/courses/StepPage.tsx'), 'utf8');
  const projectPage = fs.readFileSync(path.join(ROOT, 'src/features/projects/ProjectLab.tsx'), 'utf8');
  const component = fs.readFileSync(path.join(ROOT, 'src/components/shared/ScopeTutor.tsx'), 'utf8');

  // The step page must build its scope from the roadmap entry and the course it is showing.
  assert.match(stepPage, /stepTutorContext\(/, 'the step page builds the tutor context');
  assert.match(stepPage, /stepTutorPrompts\(/, 'and the step starters');
  assert.match(stepPage, /goal: meta\?\.goal|goal: meta\.goal/, 'the goal is the authored roadmap goal');
  assert.match(stepPage, /topics: meta\?\.topics|topics: meta\.topics/, 'the topics are the authored ones');

  // The project page must build its scope from the brief it already renders.
  assert.match(projectPage, /buildTutorContext\(/, 'the project page builds the tutor context');
  assert.match(projectPage, /buildTutorPrompts\(/, 'and the build starters');
  assert.match(projectPage, /edgeCases: p\.edgeCases/, 'the edge cases come from the brief');
  assert.match(projectPage, /defenseQuestion: p\.defenseQuestion/, 'the defense question comes from the brief');

  // One tutor implementation: the component wraps the existing AssistantCard and seeds it.
  assert.match(component, /AssistantCard/, 'the scoped tutor reuses the app assistant');
  assert.match(component, /seed=/, 'a prompt is asked through the card seed');
  assert.doesNotMatch(component + stepPage + projectPage, /fetch\(/, 'the tutor never reaches the network');
});

test('scoped tutor: the dock carries the page scope, so the entry needs no scroll', () => {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const store = read('src/components/shared/tutorScope.ts');
  const dock = read('src/components/shared/AiDock.tsx');
  const card = read('src/components/shared/AssistantCard.tsx');
  const stepPage = read('src/features/courses/StepPage.tsx');
  const projectPage = read('src/features/projects/ProjectLab.tsx');

  // One published scope, guarded so an unmounting surface cannot clear a newer one.
  assert.match(store, /if \(current\?\.id !== id\) return;/, 'only the publisher clears its own scope');
  assert.match(store, /useSyncExternalStore/, 'the dock subscribes to the same store');

  // The dock hands the published scope to the ONE assistant card.
  assert.match(dock, /useTutorScope\(\)/, 'the dock reads the published scope');
  assert.match(dock, /tutor=\{scope \?\? undefined\}/, 'and passes it to the card');

  // The card shows the authored briefing and starters, through its own ask path.
  assert.match(card, /tutor\.prompts\.map/, 'the entry renders the page starters');
  assert.match(card, /void ask\(prompt\);/, 'a starter takes the same path as a typed question');
  assert.match(card, /ai-tutor-brief/, 'the authored briefing is shown, not summarised');

  // Both surfaces publish exactly what their page block already builds.
  assert.match(stepPage, /usePublishTutorScope\(/, 'the step page publishes its scope');
  assert.match(stepPage, /kind: 'step'/, 'as a step');
  assert.match(projectPage, /usePublishTutorScope\(/, 'the project page publishes its scope');
  assert.match(projectPage, /kind: 'build'/, 'as a build');
  assert.match(projectPage, /buildTutorContext\(buildScope\(/, 'from the same brief builder the block uses');
});

test('scoped tutor: a build carries its section, so retrieval stays on its own material', () => {
  assert.equal(buildTutorContext({ ...build(), sectionId: 's18' }).sectionId, 's18');
  assert.equal(buildTutorContext(build()).sectionId, undefined, 'no section means no invented one');
});
