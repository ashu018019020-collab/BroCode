/**
 * The project brief — what the LIVE voice agent is told about this deployment.
 *
 * The claim under test is a grounding claim, and it is the whole point of the feature: the online
 * agent must describe BroCode's REAL curriculum instead of guessing, and it must be able to say
 * "that topic is not in the course" rather than inventing a section. So the tests read the actual
 * generated curriculum file and assert the brief contains the actual titles.
 *
 * Two boundaries matter as much as the content:
 *
 *   1. A missing or broken curriculum file yields an EMPTY brief — the session is still minted and
 *      the plain teaching contract still applies, so online voice never depends on this module.
 *   2. The brief is derived. Nothing in it may be a topic the file does not contain, so a learner is
 *      never sent looking for a lesson that does not exist.
 *
 * Zero dependencies: node:test, node:http, and injected fakes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createAuthServer } from '../../server/app.mjs';
import {
  APP_AREAS,
  buildProjectBrief,
  projectBrief,
  resetProjectBriefCache,
  summarizeCurriculum,
} from '../../server/project-brief.mjs';
import { buildRealtimeSessionConfig, realtimeInstructions } from '../../server/realtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CURRICULUM_FILE = path.join(ROOT, 'public', 'generated', 'curriculum', 'sections.json');
const realSections = JSON.parse(fs.readFileSync(CURRICULUM_FILE, 'utf8'));

const ORIGIN = 'http://localhost:5173';

/* ------------------------------ the curriculum ------------------------------ */

test('project brief: the real curriculum is described with its real titles and count', () => {
  const brief = projectBrief();
  assert.ok(brief.length > 200, 'a brief that names nothing would be worse than none');

  const sections = Array.isArray(realSections) ? realSections : realSections.sections;
  assert.match(brief, new RegExp(`The curriculum has ${sections.length} sections`),
    'the count comes from the file, not from a constant');

  for (const section of sections.slice(0, 4)) {
    assert.ok(brief.includes(section.title), `a real section title must reach the agent: ${section.title}`);
  }
  // The later AI-oriented sections are the ones a learner asks about by name.
  for (const title of ['NLP + Transformers', 'Generative AI, LLMs & RAG', 'Agentic AI + LangChain + n8n']) {
    if (sections.some((section) => section.title === title)) assert.ok(brief.includes(title));
  }
});

test('project brief: only names that exist, and the stages the app really has', () => {
  const brief = projectBrief();
  for (const area of APP_AREAS) assert.ok(brief.includes(area), `a real app area is missing: ${area}`);
  assert.match(brief, /learn, interview, code, logic, solved, mini, project, checkpoint/);
  assert.match(brief, /use only these real names and numbers/,
    'the model is told this list is the boundary, not a starting point');
  assert.doesNotMatch(brief, /undefined|NaN|\[object/, 'a broken entry must be skipped, never spoken');
});

test('project brief: a missing or broken file is empty, never fatal', () => {
  assert.equal(buildProjectBrief('not json at all'), '');
  assert.equal(buildProjectBrief('{"sections": []}'), '');
  assert.equal(buildProjectBrief(JSON.stringify([])), '');
  assert.equal(buildProjectBrief(JSON.stringify({ sections: [{ no: 1 }] })), '',
    'sections without titles cannot be described');

  resetProjectBriefCache();
  const fromMissingFile = projectBrief(path.join(ROOT, 'public', 'generated', 'does-not-exist.json'));
  assert.equal(fromMissingFile, '', 'an unreadable file means "no brief", not a crash');
  resetProjectBriefCache();
  assert.ok(projectBrief().length > 0, 'the cache recovers on the real file');
});

test('project brief: the summary is bounded, so a huge curriculum cannot flood the prompt', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({ no: i + 1, title: `Section number ${i + 1}` }));
  const summary = summarizeCurriculum(many, { limit: 300 });
  assert.ok(summary.length < 340, `bounded summary expected, got ${summary.length}`);
  assert.match(summary, /…/, 'truncation is shown, not silent');
  assert.match(summary, /The curriculum has 400 sections/, 'the real count survives the cut');

  // A number that is not a number is skipped rather than printed as NaN.
  assert.equal(summarizeCurriculum([{ title: '' }, null, { no: 2, title: 'Real' }]),
    'The curriculum has 1 sections: 2. Real.');
});

/* ------------------------- the instructions actually sent ------------------------- */

test('project brief: the live instructions carry the brief, and stay unchanged without one', () => {
  const brief = projectBrief();
  const withBrief = realtimeInstructions('en-IN', brief);
  const without = realtimeInstructions('en-IN');

  assert.ok(withBrief.includes(brief), 'the agent is given the real curriculum text');
  assert.ok(withBrief.length > without.length);
  assert.match(withBrief, /answer from that list, name the real section, and say plainly when a topic is not in it yet/);
  // The product rules survive: the brief is appended, never a replacement prompt.
  assert.match(withBrief, /Never say you ran, tested, compiled or verified code/);
  assert.match(withBrief, /Do not judge accent, voice, fluency or personality/);

  assert.doesNotMatch(without, /This deployment’s own curriculum/);
  assert.match(realtimeInstructions('hi-IN', brief), /Never use Devanagari script/,
    'the language rule is not displaced by the brief');
});

test('project brief: the session config sends the grounded instructions to the model', () => {
  const brief = projectBrief();
  const config = buildRealtimeSessionConfig({ lang: 'en-IN', brief });
  assert.ok(config.session.instructions.includes(brief));
  assert.equal(config.session.audio.output.voice, 'coral', 'one female-sounding voice');
});

/* ------------------------------- the route wiring ------------------------------- */

const store = {
  name: 'brief-test-store',
  async health() {},
  async getProfile(id) { return id === 'user-1' ? { id, status: 'active', role: 'learner' } : null; },
};
const supabaseAuth = {
  auth: {
    async getUser(token) {
      return token === 'good-token'
        ? { data: { user: { id: 'user-1' } }, error: null }
        : { data: { user: null }, error: { status: 401 } };
    },
  },
};

let server;
let port;
const minted = [];

before(async () => {
  server = createAuthServer({
    store,
    supabaseAuth,
    supabaseAdmin: {},
    allowedOrigin: ORIGIN,
    logger: { error() {}, warn() {} },
    openaiRealtimeKey: 'sk-secret',
    createRealtimeSecret: async (options) => {
      minted.push(options);
      return { value: 'ek_brief_secret', expiresAt: 42, model: 'gpt-realtime', voice: 'coral', maxSessionSeconds: 300 };
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(() => server?.close());

function send(pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const call = httpRequest({ host: '127.0.0.1', port, path: pathname, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    call.on('error', reject);
    if (body !== undefined) call.write(body);
    call.end();
  });
}

test('project brief route: the minted session is given the real curriculum brief', async () => {
  minted.length = 0;
  const response = await send('/api/voice/realtime/session', {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', Authorization: 'Bearer good-token' },
    body: JSON.stringify({ lang: 'en-IN', consent: true }),
  });
  assert.equal(response.status, 200, response.text);
  assert.equal(minted.length, 1);

  const brief = minted[0].brief;
  assert.ok(typeof brief === 'string' && brief.length > 0, 'the brief reaches the secret minting call');
  assert.match(brief, /The curriculum has \d+ sections/);
  assert.ok(!response.text.includes(brief), 'the brief is server-side prompt material, not a response field');
});
