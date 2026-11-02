/**
 * The AI Mentor voice — the pure selection rules, the engine's queue, the state vocabulary, the
 * speech text and the Smart Tools registry.
 *
 * These are the parts where a lie would be invisible on screen: a state that says "Speaking" while
 * nothing plays, a voice chosen across the wrong language, a sentence the voice never reads, a tool
 * that looks functional and does nothing. The suite pins each of them, plus the removal of the old
 * model engine (the whole point of this migration).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

register('./_ts-resolve.mjs', import.meta.url);

const voice = await load('src/core/voice/mentor-voice.ts');
const discovery = await load('src/core/voice/voice-discovery.ts');
const profile = await load('src/core/voice/voice-profile.ts');
const engineModule = await load('src/core/voice/voice-engine.ts');
const tools = await load('src/core/ai/smart-tools.ts');

/* --------------------------------- states --------------------------------- */

test('mentor voice: a missing engine is a fact, and an error outranks playback', () => {
  assert.equal(voice.mentorVoiceState({ unsupported: true, playing: 'speaking' }), 'unsupported');
  assert.equal(voice.mentorVoiceState({ playing: 'speaking', error: 'the voice stopped' }), 'error');
  assert.equal(voice.mentorVoiceState({ playing: 'error' }), 'error');
});

test('mentor voice: speaking is only reported for real playback', () => {
  // A retrieval in flight is thinking, not speaking — the mistake that animated the orb to silence.
  assert.equal(voice.mentorVoiceState({ playing: 'idle', thinking: true }), 'thinking');
  assert.equal(voice.mentorVoiceState({ playing: 'idle' }), 'ready');
  assert.equal(voice.mentorVoiceState({ playing: 'speaking' }), 'speaking');
  assert.equal(voice.mentorVoiceState({ playing: 'paused' }), 'paused');
  assert.equal(voice.mentorVoiceState({ playing: 'completed' }), 'completed');
});

test('mentor voice: the microphone is announced as listening, before any synthesis', () => {
  assert.equal(voice.mentorVoiceState({ playing: 'idle', listening: true }), 'listening');
  assert.equal(voice.mentorVoiceState({ playing: 'idle', permissionRequired: true }), 'permission-required');
});

test('mentor voice: every state has a label and a hint, with no download or model language', () => {
  const states = [
    'idle', 'ready', 'listening', 'thinking', 'speaking', 'paused', 'completed', 'error',
    'unsupported', 'permission-required',
  ];
  for (const state of states) {
    for (const locale of ['en', 'hi']) {
      const label = voice.mentorVoiceLabel(state, locale);
      const hint = voice.mentorVoiceHint(state, locale);
      assert.ok(label.length > 2, `${state}/${locale} has a label`);
      assert.ok(hint.length > 5, `${state}/${locale} has a hint`);
      assert.doesNotMatch(label + hint, /supertonic|onnx|wasm|download|model\b|server/i,
        `${state}/${locale} must not describe a model or a server`);
    }
  }
});

/* ------------------------------ speech text ------------------------------- */

test('speech text: markdown becomes a sentence a person would say', () => {
  const spoken = voice.speechText('## Decorators\n\nA **decorator** wraps `fn`. See [the lesson](/lesson/s12).\n\n```py\ndef f(): pass\n```');
  assert.ok(!/[*#`]/.test(spoken), 'no markdown emphasis survives');
  assert.ok(spoken.includes('Decorators'));
  assert.ok(/decorator wraps fn/i.test(spoken), 'inline code keeps its identifier');
  assert.ok(spoken.includes('the lesson'), 'a link keeps its text, not its URL');
  assert.ok(spoken.includes('code example'), 'a fenced block is announced, not read');
});

test('speech text: symbols that are punctuation on screen become words in the ear', () => {
  assert.equal(voice.speechText('Python → SQL'), 'Python to SQL');
  assert.ok(voice.speechText('a · b').includes('a, b'));
  assert.ok(voice.speechText('50% faster').includes('fifty percent faster'), 'digits are read aloud');
  assert.ok(voice.speechText('e.g. tuples').includes('for example'));
  assert.ok(voice.speechText('list vs. tuple').includes('versus'));
});

test('speech text: English digits are read aloud, Devanagari numerals are left alone', () => {
  assert.equal(voice.numberWords(0), 'zero');
  assert.equal(voice.numberWords(21), 'twenty-one');
  assert.equal(voice.numberWords(105), 'one hundred five');
  assert.equal(voice.numberWords(2026), 'two thousand twenty-six');
  assert.equal(voice.verbalizeNumbers('epochs 3'), 'epochs three');
  assert.equal(voice.verbalizeNumbers('loss 1.5'), 'loss one point five');
  assert.equal(voice.verbalizeNumbers('सवाल 2'), 'सवाल 2');
});

test('speech text: empty input never produces a sentence', () => {
  assert.equal(voice.speechText(''), '');
  assert.equal(voice.speechText('   '), '');
  assert.deepEqual(voice.speechSegments('   '), []);
});

test('speech segments: every word survives, and no segment exceeds the limit', () => {
  const answer = 'A tuple is immutable. It cannot change after creation, which is why it can be a dict key. '
    + 'A list can change, so it cannot.';
  const segments = voice.speechSegments(answer, 60);
  assert.ok(segments.length > 1, 'a long answer is split');
  const joined = segments.join(' ').replace(/\s+/g, ' ');
  const source = voice.speechText(answer).replace(/\s+/g, ' ');
  assert.equal(joined, source, 'no word is dropped or duplicated');
  for (const segment of segments) assert.ok(segment.length <= 60, `"${segment}" fits`);
});

test('speech language: Devanagari is Hindi, Latin is English, Roman Hinglish follows the choice', () => {
  assert.equal(voice.speechLanguage('यह क्या है?'), 'hi');
  assert.equal(voice.speechLanguage('What is a tuple?'), 'en');
  assert.equal(voice.speechLanguage('SQL join kaise kaam karta hai', 'auto'), 'hi');
  assert.equal(voice.speechLanguage('SQL join kaise kaam karta hai', 'en'), 'en');
  assert.equal(voice.speechLanguage('tuple kya hai', 'hi'), 'hi');
});

/* ---------------------------- voice discovery ----------------------------- */

const V = (name, lang, localService = true, voiceURI = name) => ({
  name, lang, voiceURI, localService, default: false,
});

test('discovery: language comes before quality — an English beauty never answers Hindi', () => {
  const voices = [
    V('Google UK English Female', 'en-GB', false),
    V('Microsoft Harika Desktop', 'hi-IN', true),
  ];
  assert.equal(discovery.resolveVoice(voices, 'hi')?.name, 'Microsoft Harika Desktop');
  assert.equal(discovery.resolveVoice(voices, 'en')?.name, 'Google UK English Female');
  assert.equal(discovery.resolveVoice([V('Google US English', 'en-US', false)], 'hi'), null,
    'no Hindi voice is null, not a random English one');
});

test('discovery: the regional accent chain wins, then a female-sounding name', () => {
  const voices = [
    V('Microsoft Zira Desktop', 'en-US'),
    V('Google UK English Male', 'en-GB', false),
    V('Google UK English Female', 'en-GB', false),
    V('Google हिन्दी', 'hi-IN', false),
  ];
  const english = discovery.voicesForLocale(voices, 'en');
  assert.equal(english[0]?.name, 'Google UK English Female', 'the female voice wins the en-GB tie');
  assert.ok(
    english.findIndex((v) => v.name === 'Google UK English Male')
      < english.findIndex((v) => v.name === 'Microsoft Zira Desktop'),
    'a regional en-GB voice outranks a same-language en-US one',
  );
  assert.equal(discovery.resolveVoice(voices, 'hi')?.name, 'Google हिन्दी');
});

test('discovery: a stored voice is honoured only while it is installed and speaks the language', () => {
  const voices = [V('Google हिन्दी', 'hi-IN', false, 'uri-hi'), V('Google US English', 'en-US', false, 'uri-en')];
  assert.equal(discovery.resolveVoice(voices, 'hi', 'uri-hi')?.name, 'Google हिन्दी');
  // The stored English voice must not answer a Hindi sentence.
  assert.equal(discovery.resolveVoice(voices, 'hi', 'uri-en')?.name, 'Google हिन्दी');
  assert.equal(discovery.resolveVoice(voices, 'hi', 'uri-gone')?.name, 'Google हिन्दी',
    'an uninstalled pick falls back instead of failing');
});

test('discovery: no installed voice produces an honest message, not a silent wrong language', () => {
  const englishOnly = [V('Google US English', 'en-US', false)];
  assert.equal(discovery.availabilityMessage(englishOnly, 'en'), '', 'a present voice says nothing');
  const missing = discovery.availabilityMessage(englishOnly, 'hi');
  assert.match(missing, /no hindi voice/i);
  assert.match(missing, /english voice/i, 'it names the fallback consequence');
  assert.equal(discovery.availabilityMessage([V('Google हिन्दी', 'hi-IN', false)], 'hi'), '');
});

test('discovery: auto resolves per answer from the text itself', () => {
  assert.equal(discovery.resolveLocale('auto', 'decorators kaise kaam karte hain?'), 'hi');
  assert.equal(discovery.resolveLocale('auto', 'नमस्ते, tuples क्या हैं?'), 'hi');
  assert.equal(discovery.resolveLocale('auto', 'Why is a tuple immutable?'), 'en');
  assert.equal(discovery.resolveLocale('auto', ''), 'en', 'no text invents nothing');
  assert.equal(discovery.resolveLocale('hi', 'Why is a tuple immutable?'), 'hi', 'an explicit choice wins');
});

test('discovery: the note names the real voice and does not promise an offline service', () => {
  const voices = [V('Google UK English Female', 'en-GB', false)];
  const note = discovery.voiceEngineNote(voices, 'en', voices[0]);
  assert.match(note, /Google UK English Female/);
  assert.match(note, /may be online/i, 'a remote voice is described honestly');
  const local = discovery.voiceEngineNote([V('Microsoft Heera', 'hi-IN', true)], 'hi', null);
  assert.match(local, /installed on this device/i);
  assert.doesNotMatch(note + local, /supertonic|neural|download/i);
});

/* ------------------------------- the engine -------------------------------- */

const settle = (ms = 170) => new Promise((resolve) => { setTimeout(resolve, ms); });

function fakeWorld(voices, options = {}) {
  const spoken = [];
  const synth = {
    speaking: false,
    paused: false,
    pending: false,
    getVoices: () => voices,
    speak: (utterance) => { spoken.push(utterance); },
    cancel: () => {},
    pause: () => { synth.paused = true; },
    resume: () => { synth.paused = false; },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const engine = new engineModule.VoiceEngine({
    synthesis: synth,
    startTimeoutMs: options.startTimeoutMs,
    createUtterance: (text) => ({
      text,
      lang: '',
      voice: null,
      rate: 1,
      pitch: 1,
      onstart: null,
      onend: null,
      onerror: null,
      onpause: null,
      onresume: null,
      onboundary: null,
    }),
  });
  return { engine, synth, spoken };
}

test('engine: an answer is spoken sentence by sentence, and completed only after the last end', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  let ended = 0;
  engine.speak('A tuple cannot change. A list can change.', { onEnd: () => { ended += 1; } });
  assert.equal(spoken.length, 1, 'one utterance at a time');
  assert.equal(engine.getSnapshot().state, 'idle', 'nothing is "speaking" before onstart');
  assert.equal(spoken[0].voice.name, 'Google UK English Female', 'the resolved voice is used');

  spoken[0].onstart();
  assert.equal(engine.getSnapshot().state, 'speaking');
  spoken[0].onend();
  assert.equal(spoken.length, 2, 'the next sentence follows the first');
  spoken[1].onstart();
  spoken[1].onend();
  assert.equal(ended, 1, 'onEnd runs exactly once, after the final sentence');
  assert.equal(engine.getSnapshot().state, 'completed');
});

test('engine: stop cancels the queue and never runs the hands-free callback', async () => {
  const { engine, spoken } = fakeWorld([V('Google हिन्दी', 'hi-IN', false)]);
  await engine.initialize(40);
  let ended = 0;
  engine.speak('One sentence. Another sentence.', { onEnd: () => { ended += 1; } });
  spoken[0].onstart();
  engine.stop();
  assert.equal(engine.getSnapshot().state, 'idle');
  assert.equal(ended, 0, 'hands-free must not reopen after Stop');
  // A late event from the cancelled utterance cannot restart the old queue.
  spoken[0].onend?.();
  assert.equal(spoken.length, 1);
});

test('engine: a new answer supersedes the previous one instead of overlapping it', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  engine.speak('First answer.');
  spoken[0].onstart();
  engine.speak('Second answer.');
  // The platform was playing, so the new sentence starts one task later (see CANCEL_GAP_MS).
  await settle();
  assert.equal(spoken.length, 2);
  spoken[0].onend?.();
  assert.equal(spoken.length, 2, 'the superseded utterance does not advance the new run');
  assert.equal(spoken[1].text, 'Second answer.');
});

test('engine: pause and resume publish the platform state, and replay re-speaks the last text', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  engine.speak('A single sentence.');
  spoken[0].onstart();
  engine.pause();
  assert.equal(engine.getSnapshot().state, 'paused');
  engine.resume();
  assert.equal(engine.getSnapshot().state, 'speaking');
  engine.replay();
  await settle();
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1].text, 'A single sentence.');
});

test('engine: a real error is reported as a failure, not as a completed answer', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  let ended = 0;
  engine.speak('This will fail.', { onEnd: () => { ended += 1; } });
  spoken[0].onerror?.({ error: 'network' });
  assert.equal(engine.getSnapshot().state, 'error');
  assert.match(engine.getSnapshot().lastError, /network/);
  assert.equal(ended, 0);
});

test('engine: preview uses the named voice without becoming the last answer', async () => {
  const { engine, spoken } = fakeWorld([
    V('Google UK English Female', 'en-GB', false, 'uri-en'),
    V('Google हिन्दी', 'hi-IN', false, 'uri-hi'),
  ]);
  await engine.initialize(40);
  engine.preview('Namaste, yeh ek sample hai.', { locale: 'hi' });
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].voice.name, 'Google हिन्दी');
  engine.replay();
  assert.equal(spoken.length, 1, 'a preview is not remembered as the answer to replay');
});

test('engine: with no speech synthesis the surface says so instead of pretending', async () => {
  const engine = new engineModule.VoiceEngine({ synthesis: null });
  await engine.initialize(40);
  assert.equal(engine.getSnapshot().supported, false);
  engine.speak('Anything.');
  assert.equal(engine.getSnapshot().state, 'error');
  assert.match(engine.getSnapshot().lastError, /no speech synthesis/i);
});

/* --------------------------- the one voice profile -------------------------- */

test('profile: one name, and two real voices behind it — never one voice claimed as two', () => {
  const both = [V('Microsoft Kalpana', 'hi-IN'), V('Microsoft Heera', 'en-IN')];
  const pair = profile.naturalVoices(both);
  assert.equal(pair.hi.name, 'Microsoft Kalpana');
  assert.equal(pair.en.name, 'Microsoft Heera');
  assert.equal(pair.shared, false, 'two different voices are not called the same speaker');
  const one = profile.naturalVoices([
    V('Google हिन्दी', 'hi-IN', true, 'uri-google'),
    V('Google हिन्दी', 'en-IN', true, 'uri-google'),
  ]);
  assert.equal(one.shared, true, 'the same reported voice for both tags may be called one voice');
  assert.equal(profile.NATURAL_VOICE.name, 'BroCode Natural Voice');
  assert.match(profile.NATURAL_VOICE.subtitle, /Hindi \+ English/);
});

test('profile: a half-installed device says what will actually happen', () => {
  const enOnly = [V('Microsoft Heera', 'en-IN')];
  assert.equal(profile.profileStatus(enOnly, 'auto'), 'partial');
  assert.equal(profile.profileStatus(enOnly, 'en'), 'ready');
  assert.match(profile.profileMessage(enOnly, 'auto'), /No Hindi voice is installed/);
  assert.match(profile.profileMessage(enOnly, 'auto'), /may sound wrong/);
  assert.equal(profile.profileMessage(enOnly, 'en'), '');
  assert.equal(profile.profileStatus([], 'auto'), 'unavailable');
  assert.match(profile.profileMessage([], 'auto'), /No speech voice is installed/);
});

test('profile: every sentence goes to a voice that can read it, and an explicit choice wins', () => {
  const hindi = profile.planSpeech('नमस्ते! आज हम Python सीखेंगे।', 'auto');
  assert.equal(hindi.lang, 'hi');
  assert.ok(hindi.segments.every((segment) => segment.lang === 'hi'));

  const mixed = profile.planSpeech('A tuple cannot change. यह ज़रूरी है.', 'auto');
  assert.equal(mixed.lang, 'en', 'the dominant language is the longer one');
  assert.equal(mixed.segments[0].lang, 'en');
  assert.equal(mixed.segments[1].lang, 'hi', 'the Devanagari sentence keeps the Hindi voice');

  const forced = profile.planSpeech('A tuple cannot change. यह ज़रूरी है.', 'en');
  assert.ok(forced.segments.every((segment) => segment.lang === 'en'), 'explicit English is not overridden');

  const hinglish = profile.planSpeech('Chalo aaj Python seekhte hain.', 'auto');
  assert.equal(hinglish.lang, 'hi', 'Roman Hinglish is Hindi, not English');
});

/* --------------------------- playback repairs ----------------------------- */

test('engine: a platform that was playing gets one task before the new sentence', async () => {
  const { engine, synth, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  engine.speak('First answer.');
  synth.speaking = true;
  spoken[0].onstart();
  engine.speak('Second answer.');
  assert.equal(spoken.length, 1, 'the new sentence waits out the cancel');
  await settle();
  assert.equal(spoken.length, 2);
  assert.equal(spoken[1].text, 'Second answer.');
});

test('engine: a platform left paused is resumed before anything is queued', async () => {
  const { engine, synth, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  synth.paused = true; // another tab, or an earlier Pause, left the page-global flag on
  engine.speak('Speak anyway.');
  assert.equal(synth.paused, false, 'the stuck pause is cleared');
  await settle();
  assert.equal(spoken.length, 1);
});

test('engine: an interrupted utterance is re-issued once instead of dying silently', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  engine.speak('Interrupted answer.');
  spoken[0].onerror({ error: 'interrupted' });
  assert.equal(spoken.length, 2, 'the same sentence is tried again');
  assert.equal(spoken[1].text, 'Interrupted answer.');
  spoken[1].onerror({ error: 'interrupted' });
  assert.equal(engine.getSnapshot().state, 'error');
  assert.match(engine.getSnapshot().lastError, /Replay/);
});

test('engine: a start that never happens is retried, then reported as a failure', async () => {
  const { engine } = fakeWorld([V('Google UK English Female', 'en-GB', false)], { startTimeoutMs: 20 });
  await engine.initialize(40);
  let ended = 0;
  engine.speak('Never starts.', { onEnd: () => { ended += 1; } });
  await settle(120);
  assert.equal(engine.getSnapshot().state, 'error');
  assert.match(engine.getSnapshot().lastError, /did not start/);
  assert.equal(ended, 0, 'a failure is not a completion');
});

test('profile: the microphone starts in the language the learner is likely to speak', () => {
  assert.equal(profile.recognitionLocale('auto', 'A tuple cannot change.'), 'en-IN');
  assert.equal(profile.recognitionLocale('auto', 'नमस्ते, Python क्या है?'), 'hi-IN');
  assert.equal(profile.recognitionLocale('hi'), 'hi-IN');
  assert.equal(profile.recognitionLocale('en', 'नमस्ते'), 'en-IN', 'an explicit choice is not overridden');
});

test('engine: a click primes the queue without becoming the answer', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  engine.prime();
  assert.equal(spoken.length, 1, 'one silent utterance unlocks the platform');
  assert.equal(spoken[0].volume, 0, 'the unlock is silent');
  assert.notEqual(engine.getSnapshot().state, 'speaking', 'a prime is not an answer');
  engine.replay();
  assert.equal(spoken.length, 1, 'a prime is never remembered for replay');
});

test('engine: Test voice is heard even while the mentor is muted', async () => {
  const { engine, spoken } = fakeWorld([V('Google UK English Female', 'en-GB', false)]);
  await engine.initialize(40);
  engine.setEnabled(false);
  engine.preview('Sample sentence.', { locale: 'en' });
  assert.equal(spoken.length, 1, 'mute silences answers, not an explicit test');
  engine.speak('An answer.');
  assert.equal(spoken.length, 1, 'answers stay muted');
});

/* ------------------------------ the surface ------------------------------- */

test('surface: voice input and manual replay do not depend on Auto speak', () => {
  const studio = read('src/features/ai/studio/MentorStudio.tsx');
  assert.match(studio, /voice\.prime\(\)/, 'a click unlocks speech before the async answer');
  assert.match(studio, /const toggleMic/, 'the microphone has one guarded entry point');
  assert.match(studio, /const speakLast/, 'Speak reads the newest answer');
  assert.match(studio, /speakFinal\(text, \[\], false\)/, 'a manual replay ignores the Auto speak switch');
  assert.match(studio, /role === 'mentor'/, 'Speak is enabled by the answer, not by a prior spoken one');
});

test('surface: one profile on screen — no dropdown and no device voice names', () => {
  const center = read('src/features/ai/studio/VoiceControlCenter.tsx');
  assert.doesNotMatch(center, /<select/, 'the voice dropdown is gone');
  assert.doesNotMatch(center, /selectVoice|previewVoice|availableVoices/, 'no per-voice picker callbacks');
  assert.match(center, /profile\.name/);
  assert.match(center, /Test voice/);
  const hook = read('src/components/shared/useMentorVoice.ts');
  assert.doesNotMatch(hook, /setSelection|selectVoice|previewVoice/, 'the hook exposes no voice list');
  assert.doesNotMatch(hook, /voices: VoiceSelection/, 'no stored per-language voice picks');
});

/* ------------------------------- smart tools ------------------------------ */

test('smart tools: every action is real and uniquely identified', () => {
  const ids = tools.SMART_TOOLS.map((tool) => tool.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate tool ids');
  assert.equal(tools.SMART_TOOLS.length, 14);
  for (const tool of tools.SMART_TOOLS) {
    assert.ok(tool.label.trim().length > 2);
    assert.ok(tool.note.trim().length > 2, `${tool.id} says what it does`);
    assert.equal(tools.smartTool(tool.id)?.id, tool.id);
  }
});

test('smart tools: an ask tool needs a topic and never invents one', () => {
  assert.equal(tools.smartToolPrompt('explain-simple', {}), null);
  assert.equal(tools.smartToolPrompt('deep-explanation', { topic: '   ' }), null);
  const prompt = tools.smartToolPrompt('explain-simple', { topic: 'decorators' });
  assert.ok(prompt.includes('decorators'));
});

test('smart tools: code tools refuse to run without code', () => {
  assert.equal(tools.smartToolPrompt('debug-code', { topic: 'python' }), null);
  assert.equal(tools.smartToolPrompt('code-review', { topic: 'python', code: '  ' }), null);
  const withCode = tools.smartToolPrompt('debug-code', { code: 'print(x)' });
  assert.ok(withCode.includes('print(x)'), 'the learner code travels in the prompt');
});

test('smart tools: a route tool opens the surface that really owns the job', () => {
  assert.equal(tools.smartToolRoute('interview'), '/ai-mentor?tab=interview');
  assert.equal(tools.smartToolRoute('project'), '/projects');
  assert.equal(tools.smartToolRoute('plan'), '/courses');
  assert.equal(tools.smartToolRoute('practice', { sectionId: 's12' }), '/questions?section=s12');
  assert.equal(tools.smartToolRoute('practice'), '/practice');
  assert.equal(tools.smartToolRoute('explain-simple'), '', 'an ask tool has no route');
});

/* --------------------------------- wiring -------------------------------- */

test('studio: one studio, one voice adapter, one control center', () => {
  const hub = read('src/features/ai/MentorHub.tsx');
  assert.ok(hub.includes("from './studio/MentorStudio'"), 'MentorHub hands the section to the studio');
  assert.doesNotMatch(hub, /Supertonic/);

  const studio = read('src/features/ai/studio/MentorStudio.tsx');
  assert.ok(studio.includes('useMentorVoice'), 'the studio uses the shared adapter');
  assert.ok(studio.includes('<VoiceControlCenter'), 'the control center is the one voice surface');
  assert.ok(studio.includes('<SmartToolsPanel'), 'the smart tools are wired');
  assert.ok(studio.includes('MockInterviewPanel'), 'the interview tab mounts the existing engine');

  const hook = read('src/components/shared/useMentorVoice.ts');
  assert.ok(hook.includes('getVoiceEngine'), 'the adapter talks to the one engine');
  assert.ok(!/createVoiceClient|tts\.worker/.test(hook), 'there is no model worker any more');

  const cards = read('src/features/ai/studio/VoiceControlCenter.tsx');
  assert.match(cards, /role="switch"/, 'the switches are switches');
  assert.match(cards, /aria-checked=\{checked\}/, 'and they announce their state');
  assert.match(cards, /Auto speak/);
  assert.match(cards, /Hands-free/);
  assert.match(cards, /Test voice/, 'the diagnostics panel can speak a real sample');
  assert.doesNotMatch(cards, /Supertonic|Download model|ONNX|WASM/i);
});

test('studio: the dark studio is scoped, token-driven and honours reduced motion', () => {
  const css = read('src/features/ai/studio/studio.css');
  for (const token of ['--ms-bg', '--ms-cyan', '--ms-violet', '--ms-radius', '--ms-shadow', '--ms-fast']) {
    assert.ok(css.includes(token), `${token} is declared`);
  }
  assert.ok(css.includes('.mentor-studio'), 'the palette is scoped to the studio');
  assert.ok(css.includes('prefers-reduced-motion'), 'motion can be switched off');
  assert.ok(css.includes('@media (max-width: 720px)'), 'the layout has a phone breakpoint');
  assert.ok(css.includes('.toggle-card'), 'the switch cards have their own layout');
  assert.ok(!css.includes('.voice-progress'), 'no model-download progress bar survives');
});

test('studio: no stale server-voice warning is shown to the learner', () => {
  for (const file of ['ConversationPanel.tsx', 'VoiceControlCenter.tsx', 'SmartToolsPanel.tsx', 'MentorStudio.tsx']) {
    const source = read(`src/features/ai/studio/${file}`);
    assert.ok(!/not configured/i.test(source), `${file} carries no server-voice warning`);
  }
});

test('migration: the Supertonic engine, its runtime and its assets are gone', () => {
  for (const gone of [
    'src/workers/tts.worker.ts',
    'src/core/voice/assets.ts',
    'src/core/voice/client.ts',
    'src/core/voice/engine.ts',
    'src/core/voice/protocol.ts',
    'src/core/voice/style.ts',
    'src/core/voice/text.ts',
    'scripts/ort-copy.mjs',
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, gone)), false, `${gone} is removed`);
  }
  assert.equal(fs.existsSync(path.join(ROOT, 'public/ort')), false, 'no ORT runtime is published');

  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.dependencies?.['onnxruntime-web'], undefined, 'the ONNX runtime is not a dependency');
  assert.equal(pkg.scripts?.prebuild, undefined, 'no ORT copy hook runs before the build');
  assert.equal(pkg.scripts?.predev, undefined, 'no ORT copy hook runs before dev');
});

test('migration: no source file names the retired model runtime', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      // The engine's cache purge is the one place that may NAME the retired caches: it is what
      // deletes them from a returning learner's browser, so it cannot be written without the words.
      if (path.basename(full) === 'voice-engine.ts') continue;
      const source = fs.readFileSync(full, 'utf8');
      if (/supertonic|onnxruntime|ort-wasm|initWasm|tts\.worker/i.test(source)) {
        offenders.push(path.relative(ROOT, full));
      }
    }
  };
  walk(path.join(ROOT, 'src'));
  assert.deepEqual(offenders, [], 'the bundle cannot load a removed runtime');
  // ...and the only surviving mention is the cleanup that removes the old caches.
  assert.match(read('src/core/voice/voice-engine.ts'), /purgeLegacyVoiceCaches[\s\S]*supertonic/i);
});
