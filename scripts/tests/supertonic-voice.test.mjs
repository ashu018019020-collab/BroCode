/**
 * The server voice contract, and the guarantee that no model reaches the browser.
 *
 * The Python service is tested with pytest (`services/supertonic-tts/tests`) because Node cannot
 * import it. What this file pins is everything AROUND it that the browser really runs:
 *
 *   · the presets are the checkpoint's own names, and a stale choice is corrected rather than sent;
 *   · the phase machine never says "speaking" without audio and never says "loading" forever;
 *   · `POST /api/voice/tts` failures map to codes the UI branches on, so Retry is offered only where
 *     pressing it can help;
 *   · no ONNX Runtime, worker, WASM or checkpoint download exists in the client at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

register('./_ts-resolve.mjs', import.meta.url);

const presets = await import('../../src/core/voice/presets.ts');
const protocol = await import('../../src/core/voice/protocol.ts');
const state = await import('../../src/core/voice/state.ts');
const server = await import('../../src/core/voice/server.ts');
const text = await import('../../src/core/voice/text.ts');

/* -------------------------------- presets --------------------------------- */

test('voice presets: only the checkpoint’s real voice names are offered', () => {
  assert.deepEqual([...presets.FEMALE_PRESETS], ['F1']);
  assert.deepEqual([...presets.MALE_PRESETS], ['M1']);
  assert.equal(presets.VOICE_PRESETS.length, 2, 'one female, one male — nothing else is exposed');
  assert.equal(presets.DEFAULT_PRESET, 'F1', 'the female tutor voice is the default');
  assert.equal(presets.voiceLabel('F1'), 'Female');
  assert.equal(presets.voiceLabel('M1'), 'Male');
  assert.equal(presets.genderOf('M1'), 'male');
  assert.equal(presets.isVoicePreset('F2'), false, 'a preset the product no longer offers is rejected');
  assert.equal(presets.isVoicePreset('M1'), true);
  assert.equal(presets.isVoicePreset(7), false);
});

test('voice presets: the selector narrows to what the backend reported', () => {
  assert.deepEqual([...presets.availablePresets(['F1', 'M1'])], ['F1', 'M1']);
  assert.deepEqual([...presets.availablePresets(['F1'])], ['F1'], 'only what the service reports');
  assert.deepEqual([...presets.availablePresets(['F2', 'M1'])], ['M1'], 'unknown ids are dropped');
  assert.deepEqual([...presets.availablePresets(null)], ['F1', 'M1'], 'a slow status call keeps both');
});

test('voice presets: a stale stored voice is corrected instead of sent as a 400', () => {
  assert.equal(presets.resolvePreset('M1', ['F1']), 'F1', 'a voice the service dropped is replaced');
  assert.equal(presets.resolvePreset('F1', ['M1']), 'M1');
  assert.equal(presets.resolvePreset('M1', null), 'M1');
  assert.equal(presets.resolvePreset('F1', []), 'F1');
});

/* -------------------------------- protocol -------------------------------- */

test('voice phases: the ten real states, each with copy', () => {
  const phases = ['idle', 'connecting', 'preparing', 'generating', 'speaking', 'paused', 'completed', 'disconnected', 'error'];
  for (const phase of phases) {
    assert.equal(typeof protocol.PHASE_COPY[phase], 'string', `${phase} needs copy`);
    assert.ok(protocol.PHASE_COPY[phase].trim(), `${phase} copy must not be blank`);
  }
  // There is deliberately no `downloading` phase: the browser no longer downloads a model.
  assert.equal(protocol.PHASE_COPY.downloading, undefined);
  assert.match(protocol.PHASE_COPY.connecting, /Connecting/);
  assert.match(protocol.PHASE_COPY.speaking, /Speaking/);
  assert.equal(protocol.clamp01(2), 1);
  assert.equal(protocol.clamp01(-1), 0);
  assert.equal(protocol.clamp01(Number.NaN), 0);
});

test('voice phases: "ready" is never true for a dead deployment', () => {
  assert.equal(protocol.isVoiceReady({ phase: 'idle' }), true);
  assert.equal(protocol.isVoiceReady({ phase: 'generating' }), true, 'an accepted request is not "offline"');
  assert.equal(protocol.isVoiceReady({ phase: 'disconnected' }), false);
  assert.equal(protocol.isVoiceReady({ phase: 'error' }), false);

  assert.equal(protocol.isVoicePreparing({ phase: 'connecting' }), true);
  assert.equal(protocol.isVoicePreparing({ phase: 'preparing' }), true);
  assert.equal(protocol.isVoicePreparing({ phase: 'speaking' }), false);

  assert.equal(protocol.isVoiceActive({ phase: 'speaking' }), true);
  assert.equal(protocol.isVoiceActive({ phase: 'paused' }), true);
  assert.equal(protocol.isVoiceActive({ phase: 'completed' }), false);
});

/* ------------------------------ the state machine -------------------------- */

const READY = { configured: true, ready: true, engine: 'supertonic', engineLabel: 'Supertonic 3 (server)', reason: null, voices: ['F1'] };
const LOADING = { configured: false, ready: false, engine: 'supertonic', engineLabel: 'Supertonic 3 (server)', reason: 'the model is still loading', voices: [] };
const ABSENT = { configured: false, ready: false, engine: 'none', engineLabel: 'no server voice', reason: 'No server voice is configured on this deployment.', voices: [] };

test('voice state: playback is the only thing allowed to claim "speaking"', () => {
  assert.equal(state.deriveVoiceStatus({ server: READY, failure: null, playback: 'idle' }).phase, 'idle');
  assert.equal(state.deriveVoiceStatus({ server: READY, failure: null, playback: 'generating' }).phase, 'generating');
  assert.equal(state.deriveVoiceStatus({ server: READY, failure: null, playback: 'speaking' }).phase, 'speaking');
  assert.equal(state.deriveVoiceStatus({ server: READY, failure: null, playback: 'paused' }).phase, 'paused');
  assert.equal(state.deriveVoiceStatus({ server: READY, failure: null, playback: 'completed' }).phase, 'completed');

  // A service that is ready but silent is idle — not speaking.
  assert.notEqual(state.deriveVoiceStatus({ server: READY, failure: null, playback: 'idle' }).phase, 'speaking');
});

test('voice state: a slow first boot says "preparing", never "loading" forever', () => {
  const connecting = state.deriveVoiceStatus({ server: null, failure: null, playback: 'idle' });
  assert.equal(connecting.phase, 'connecting');
  assert.match(connecting.message, /Connecting/);

  const preparing = state.deriveVoiceStatus({ server: LOADING, failure: null, playback: 'idle' });
  assert.equal(preparing.phase, 'preparing');
  assert.match(preparing.detail ?? '', /still loading/, 'the service’s own reason is carried through');
});

test('voice state: "no voice configured" is a calm offline state, not a Retry loop', () => {
  const absent = state.deriveVoiceStatus({ server: ABSENT, failure: null, playback: 'idle' });
  assert.equal(absent.phase, 'disconnected');
  assert.equal(absent.code, 'voice-unconfigured');
  assert.match(absent.detail ?? '', /No server voice is configured/);
});

test('voice state: a real fault keeps the route’s code so the UI can explain it', () => {
  const failure = server.voiceFailure('voice-unavailable', 502);
  const derived = state.deriveVoiceStatus({ server: READY, failure, playback: 'idle' });
  assert.equal(derived.phase, 'error');
  assert.equal(derived.code, 'voice-unavailable');
  assert.match(derived.detail ?? '', /temporarily unavailable/);

  // An intentional stop is not an error to show the learner.
  const aborted = state.deriveVoiceStatus({ server: READY, failure: server.voiceFailure('voice-aborted'), playback: 'idle' });
  assert.equal(aborted.phase, 'idle');

  // An unreachable host reads as offline, which is the state with a Retry.
  const offline = state.deriveVoiceStatus({ server: null, failure: server.voiceFailure('voice-offline'), playback: 'idle' });
  assert.equal(offline.phase, 'disconnected');
});

/* --------------------------------- the client ------------------------------ */

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('server client: a ready deployment is reported as ready, with its real presets', async () => {
  const client = server.createServerVoice({
    base: './api/voice',
    fetchImpl: async () => jsonResponse({ configured: true, ready: true, engine: 'supertonic', engineLabel: 'Supertonic 3 (server)', langs: ['en-IN', 'hi-IN'], voices: ['F1', 'F2'] }),
  });
  const status = await client.status();
  assert.equal(status.ready, true);
  assert.equal(status.engine, 'supertonic');
  assert.deepEqual(status.voices, ['F1', 'F2']);
  assert.equal(status.reason, null);
});

test('server client: "no voice" and a broken body both read as not-ready, never as a crash', async () => {
  const absent = server.createServerVoice({ fetchImpl: async () => jsonResponse({ configured: false, ready: false, engine: 'none', reason: 'No server voice is configured on this deployment.' }) });
  const a = await absent.status();
  assert.equal(a.ready, false);
  assert.equal(a.configured, false);
  assert.match(a.reason, /No server voice/);

  const garbage = server.createServerVoice({ fetchImpl: async () => new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } }) });
  const b = await garbage.status();
  assert.equal(b.ready, false, 'an HTML page is not a voice');
  assert.equal(b.engine, 'none');

  // The status route answers 503 while the model loads: that is an ANSWER, not a transport failure.
  const loading = server.createServerVoice({ fetchImpl: async () => jsonResponse({ configured: false, ready: false, engine: 'supertonic', reason: 'the model is still loading' }, 503) });
  const c = await loading.status();
  assert.equal(c.ready, false);
  assert.equal(c.engine, 'supertonic', 'a configured service still names itself while warming');
});

test('server client: speak posts the text and returns the WAV plus the engine that produced it', async () => {
  const seen = [];
  const client = server.createServerVoice({
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return new Response(new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]), {
        status: 200,
        headers: { 'content-type': 'audio/wav', 'x-voice-engine': 'supertonic', 'x-sample-rate': '44100' },
      });
    },
  });
  const audio = await client.speak({ text: '  नमस्ते, चलिए शुरू करें.  ', lang: 'hi-IN', rate: 1.1, voice: 'F1' });
  assert.equal(seen[0].url, './api/voice/tts');
  assert.deepEqual(seen[0].body, { text: 'नमस्ते, चलिए शुरू करें.', lang: 'hi-IN', rate: 1.1, voice: 'F1' }, 'text is trimmed, nothing else is rewritten');
  assert.equal(audio.engine, 'supertonic');
  assert.equal(audio.sampleRate, 44100);
  assert.equal(audio.wav.byteLength, 8);
});

test('server client: every failure becomes a code the UI can act on', async () => {
  const failing = (status, body) => server.createServerVoice({ fetchImpl: async () => jsonResponse(body, status) });

  const busy = await failing(429, { code: 'VOICE_RATE_LIMITED' }).speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(busy.code, 'voice-rate-limited');
  assert.equal(busy.retryable, true, 'a busy voice is worth another press');

  const misconfigured = await failing(503, { code: 'VOICE_NOT_CONFIGURED' }).speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(misconfigured.code, 'voice-unconfigured');
  assert.equal(misconfigured.retryable, false, 'Retry cannot configure a deployment');

  const secret = await failing(502, { code: 'VOICE_AUTH_FAILED' }).speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(secret.code, 'voice-auth-failed');
  assert.equal(secret.retryable, false);

  const slow = await failing(504, { code: 'VOICE_TIMEOUT' }).speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(slow.code, 'voice-timeout');

  const notAudio = await server.createServerVoice({
    fetchImpl: async () => jsonResponse({ ok: true }, 200),
  }).speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(notAudio.code, 'voice-invalid-audio', 'a 200 that is not audio must not reach decodeAudioData');

  const offline = await server.createServerVoice({
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  }).speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(offline.code, 'voice-offline');
  assert.equal(offline.retryable, true);
});

test('server client: an aborted request is cancellation, not a failure', async () => {
  const controller = new AbortController();
  controller.abort();
  const client = server.createServerVoice({
    fetchImpl: async (_url, init) => {
      if (init.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return jsonResponse({ ok: true });
    },
  });
  const error = await client.speak({ text: 'hi', lang: 'en-IN', rate: 1, signal: controller.signal }).catch((e) => e);
  assert.equal(error.code, 'voice-aborted');
  assert.equal(error.retryable, false);
});

test('server client: a hanging service times out instead of holding the answer forever', async () => {
  const client = server.createServerVoice({
    speakTimeoutMs: 25,
    fetchImpl: (_url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  const error = await client.speak({ text: 'hi', lang: 'en-IN', rate: 1 }).catch((e) => e);
  assert.equal(error.code, 'voice-timeout');
});

test('server client: empty text and an unknown language never leave the page', async () => {
  let called = false;
  const client = server.createServerVoice({ fetchImpl: async () => { called = true; return jsonResponse({}); } });
  await assert.rejects(() => client.speak({ text: '   ', lang: 'en-IN', rate: 1 }), /refused that text/);
  await assert.rejects(() => client.speak({ text: 'hello', lang: 'fr-FR', rate: 1 }), /refused that text/);
  assert.equal(called, false, 'nothing was sent');
});

/* --------------------------- language of a chunk --------------------------- */

test('voice text: Devanagari is Hindi, Latin is English, and Roman Hinglish is the learner’s call', () => {
  assert.deepEqual(text.languageForChunk('नमस्ते दोस्तों', 'en'), { lang: 'hi', decided: true });
  assert.deepEqual(text.languageForChunk('Welcome to BroCode', 'hi'), { lang: 'en', decided: true });
  // Romanised Hindi is Latin script: guessing would read it as English and change the pronunciation.
  assert.deepEqual(text.languageForChunk('chalo shuru karein', 'hi'), { lang: 'en', decided: true });
  assert.deepEqual(text.languageForChunk('12345', 'hi'), { lang: 'hi', decided: false });
});

/* -------------------------- the browser is model-free --------------------- */

test('architecture: no ONNX Runtime, worker, WASM or checkpoint download in the client', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['onnxruntime-web'], undefined, 'the browser runtime is gone');
  assert.equal(pkg.devDependencies?.['onnxruntime-node'], undefined);

  for (const gone of [
    'src/workers/tts.worker.ts',
    'src/core/voice/engine.ts',
    'src/core/voice/client.ts',
    'src/core/voice/assets.ts',
    'src/core/voice/style.ts',
    'scripts/ort-copy.mjs',
    'public/ort',
  ]) {
    assert.equal(exists(gone), false, `${gone} must not come back`);
  }

  for (const file of [
    'src/components/shared/useVoiceTutor.ts',
    'src/components/shared/AiVoiceRow.tsx',
    'src/core/ai/voice.ts',
    'src/core/voice/server.ts',
    'src/features/ai/VoiceMentorPanel.tsx',
  ]) {
    assert.doesNotMatch(read(file), /onnxruntime/i, `${file} must not name the runtime`);
    assert.doesNotMatch(read(file), /TOTAL_MODEL_BYTES|downloadModel|bytesProgressLabel/, `${file} must not measure a download that no longer happens`);
  }
});

test('architecture: the hook speaks through the deployment, and the routes are the ones we ship', () => {
  const hook = read('src/components/shared/useVoiceTutor.ts');
  assert.match(hook, /createServerVoice/, 'speech-out goes through the API client');
  assert.doesNotMatch(hook, /speechSynthesis|SpeechSynthesisUtterance/, 'no robotic fallback voice survives');
  assert.doesNotMatch(hook, /new Worker\(/, 'no worker');

  const client = read('src/core/voice/server.ts');
  assert.match(client, /\$\{root\}\/status/);
  assert.match(client, /\$\{root\}\/tts/);
  assert.doesNotMatch(client, /googleapis\.com/, 'no third-party URL in the client');
  assert.doesNotMatch(client, /Authorization|process\.env/, 'the client carries no credential and reads no server env');

  // ONE speak route and ONE status route: a second spelling is how deployments drift.
  assert.equal(exists('api/voice/tts.js'), true);
  assert.equal(exists('api/voice/status.js'), true);
  assert.equal(exists('api/voice/speak.js'), false, 'the speak route is /api/voice/tts, not a duplicate');
});
