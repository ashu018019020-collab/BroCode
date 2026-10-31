import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TTS_MAX_CHARS, TTS_VOICES, buildSsml, clampRate, createTtsEngine, escapeSsml, voiceFor,
  voiceMatchesLang, voiceOverrides,
} from '../../server/tts.mjs';

/** A fetch stub that records the request and answers with a tiny MP3-shaped body. */
function stubFetch({ status = 200, type = 'audio/mpeg', bytes = 8, onCall } = {}) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    onCall?.(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? type : null) },
      arrayBuffer: async () => new Uint8Array(bytes).fill(1).buffer,
    };
  };
  return { calls, impl };
}

/* --------------------------------- status --------------------------------- */

test('tts: the public status names the engine and voices, never the key or region', () => {
  const engine = createTtsEngine({ key: 'super-secret-key', region: 'centralindia' });
  const status = engine.status();
  assert.equal(status.configured, true);
  assert.equal(status.engine, 'azure');
  assert.deepEqual(status.langs, ['hi-IN', 'en-IN']);
  assert.equal(status.femaleOnly, true);
  assert.equal(status.maxChars, TTS_MAX_CHARS);
  const serialized = JSON.stringify(status);
  for (const secret of ['super-secret-key', 'centralindia']) {
    assert.equal(serialized.includes(secret), false, `the status must not leak ${secret}`);
  }
});

test('tts: with no key the engine is unconfigured and refuses to speak', async () => {
  const engine = createTtsEngine({ key: '', region: '', fetchImpl: async () => { throw new Error('never called'); } });
  assert.equal(engine.status().configured, false);
  await assert.rejects(() => engine.synthesize({ text: 'Namaste', lang: 'hi-IN' }), (error) => {
    assert.equal(error.code, 'TTS_NOT_CONFIGURED');
    assert.equal(error.status, 503);
    return true;
  });
});

/* ---------------------------------- SSML ---------------------------------- */

test('tts: the SSML uses the female Indian voice for each language', () => {
  assert.equal(voiceFor('hi-IN'), 'hi-IN-SwaraNeural');
  assert.equal(voiceFor('en-IN'), 'en-IN-NeerjaNeural');
  assert.equal(voiceFor('en-US'), null, 'a language we do not ship has no voice');

  const hi = buildSsml({ text: 'नमस्ते', lang: 'hi-IN' });
  assert.match(hi, /xml:lang="hi-IN"/);
  assert.match(hi, /<voice name="hi-IN-SwaraNeural">/);
  const en = buildSsml({ text: 'Welcome to BroCode.', lang: 'en-IN' });
  assert.match(en, /<voice name="en-IN-NeerjaNeural">/);
  assert.notEqual(TTS_VOICES['hi-IN'], TTS_VOICES['en-IN'], 'one voice cannot claim two languages');
});

test('tts: a learner’s text can never become markup', () => {
  assert.equal(escapeSsml('<b>a & b</b>'), '&lt;b&gt;a &amp; b&lt;/b&gt;');
  const ssml = buildSsml({ text: 'if a < b && c > d: print("<hi>")', lang: 'en-IN' });
  assert.equal(ssml.includes('<b'), false);
  assert.match(ssml, /&lt;/);
  // Exactly the wrapper's own tags survive: speak, voice, prosody.
  assert.equal((ssml.match(/<voice /g) ?? []).length, 1);
  assert.equal((ssml.match(/<\/voice>/g) ?? []).length, 1);
});

test('tts: speed is a signed prosody percentage, clamped to a sane range', () => {
  assert.equal(clampRate(1), 1);
  assert.equal(clampRate(0.5), 0.5);
  assert.equal(clampRate(9), 1.5);
  assert.equal(clampRate(0.01), 0.5);
  assert.equal(clampRate('nonsense'), 1);
  assert.match(buildSsml({ text: 'Hi', lang: 'en-IN', rate: 1 }), /rate="0%"/);
  assert.match(buildSsml({ text: 'Hi', lang: 'en-IN', rate: 1.25 }), /rate="\+25%"/);
  assert.match(buildSsml({ text: 'Hi', lang: 'en-IN', rate: 0.8 }), /rate="-20%"/);
});

/* ------------------------------- requests -------------------------------- */

test('tts: one request, the right endpoint, the key only in its own header', async () => {
  const { calls, impl } = stubFetch();
  const engine = createTtsEngine({ key: 'k-123', region: 'centralindia', fetchImpl: impl });
  const result = await engine.synthesize({ text: 'Python seekhte hain', lang: 'hi-IN', rate: 1 });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://centralindia.tts.speech.microsoft.com/cognitiveservices/v1');
  assert.equal(init.method, 'POST');
  assert.equal(init.headers['Ocp-Apim-Subscription-Key'], 'k-123');
  assert.equal(init.headers['Content-Type'], 'application/ssml+xml');
  assert.match(init.headers['X-Microsoft-OutputFormat'], /^audio-24khz-96kbitrate-mono-mp3$/);
  assert.match(init.body, /SwaraNeural/);

  assert.equal(result.contentType, 'audio/mpeg');
  assert.equal(result.voice, 'hi-IN-SwaraNeural');
  assert.equal(result.lang, 'hi-IN');
  assert.equal(result.audio.byteLength, 8);
});

test('tts: the key never appears in a thrown error', async () => {
  const { impl } = stubFetch({ status: 401 });
  const engine = createTtsEngine({ key: 'k-secret', region: 'centralindia', fetchImpl: impl });
  await assert.rejects(() => engine.synthesize({ text: 'Hi', lang: 'en-IN' }), (error) => {
    assert.equal(error.code, 'TTS_UPSTREAM_401');
    assert.equal(JSON.stringify(error.message).includes('k-secret'), false);
    return true;
  });
});

test('tts: an HTML 200 is not audio, and an empty body is not speech', async () => {
  const html = createTtsEngine({
    key: 'k', region: 'r', fetchImpl: stubFetch({ type: 'text/html' }).impl,
  });
  await assert.rejects(() => html.synthesize({ text: 'Hi', lang: 'en-IN' }), (error) => {
    assert.equal(error.code, 'TTS_NOT_AUDIO');
    return true;
  });

  const empty = createTtsEngine({ key: 'k', region: 'r', fetchImpl: stubFetch({ bytes: 0 }).impl });
  await assert.rejects(() => empty.synthesize({ text: 'Hi', lang: 'en-IN' }), (error) => {
    assert.equal(error.code, 'TTS_EMPTY_AUDIO');
    return true;
  });
});

test('tts: a dead network is a typed failure, not an unhandled rejection', async () => {
  const engine = createTtsEngine({
    key: 'k', region: 'r',
    fetchImpl: async () => { throw new TypeError('socket hang up: Ocp-Apim-Subscription-Key=k'); },
  });
  await assert.rejects(() => engine.synthesize({ text: 'Hi', lang: 'en-IN' }), (error) => {
    assert.equal(error.code, 'TTS_UNREACHABLE');
    assert.equal(error.status, 502);
    return true;
  });
});

/* -------------------------------- validation ------------------------------- */

test('tts: text and language are validated before any request is made', async () => {
  const { calls, impl } = stubFetch();
  const engine = createTtsEngine({ key: 'k', region: 'r', fetchImpl: impl });

  await assert.rejects(() => engine.synthesize({ text: '   ', lang: 'hi-IN' }), /Text is required/);
  await assert.rejects(() => engine.synthesize({ text: 'x'.repeat(TTS_MAX_CHARS + 1), lang: 'hi-IN' }), /at most/);
  await assert.rejects(() => engine.synthesize({ text: 'Hi', lang: 'fr-FR' }), /Choose one of/);
  assert.equal(calls.length, 0, 'nothing billable happens for a request that cannot succeed');
});

test('tts: an operator can pin another voice, and it is the voice the SSML really asks for', async () => {
  const { calls, impl } = stubFetch();
  const engine = createTtsEngine({ key: 'k', region: 'r', fetchImpl: impl, voices: { 'hi-IN': 'hi-IN-AnanyaNeural' } });
  const result = await engine.synthesize({ text: 'Namaste', lang: 'hi-IN' });
  assert.equal(result.voice, 'hi-IN-AnanyaNeural');
  assert.equal(engine.status().voices['hi-IN'], 'hi-IN-AnanyaNeural');
  // The reported id and the requested id must be the same voice, or the UI names a stranger.
  assert.match(calls[0].init.body, /<voice name="hi-IN-AnanyaNeural">/);
  // Pinning Hindi does not disturb English.
  assert.match(buildSsml({ text: 'Hi', lang: 'en-IN', voices: { 'hi-IN': 'hi-IN-AnanyaNeural' } }), /en-IN-NeerjaNeural/);
});

test('tts: a pin filed under the wrong language is dropped, never sent to the provider', () => {
  assert.deepEqual(voiceOverrides({ hi: 'en-IN-NeerjaNeural', en: '' }), {});
  assert.deepEqual(voiceOverrides({ hi: 'hi-IN-AnanyaNeural', en: 'en-IN-NeerjaNeural' }), {
    'hi-IN': 'hi-IN-AnanyaNeural',
    'en-IN': 'en-IN-NeerjaNeural',
  });
  assert.deepEqual(voiceOverrides({ hi: '  ', en: 'Neerja' }), {}, 'a name that is not a voice id is not a voice');
  assert.equal(voiceMatchesLang('hi-IN-SwaraNeural', 'hi-IN'), true);
  assert.equal(voiceMatchesLang('en-IN-SwaraNeural', 'hi-IN'), false);
  const engine = createTtsEngine({ key: 'k', region: 'r', voices: { 'hi-IN': 'en-IN-NeerjaNeural' } });
  assert.equal(engine.status().voices['hi-IN'], TTS_VOICES['hi-IN'], 'the matched default still speaks');
});

test('tts: Hinglish in Roman script is spoken by the Hindi voice, untouched', () => {
  const ssml = buildSsml({ text: 'Aaj hum Python ka function banayenge.', lang: 'hi-IN' });
  assert.match(ssml, /xml:lang="hi-IN"/);
  assert.match(ssml, />Aaj hum Python ka function banayenge\.</);
});
