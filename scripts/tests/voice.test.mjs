/**
 * Voice tutor tests — the spoken layer, not the microphone.
 *
 * The browser APIs (SpeechRecognition / speechSynthesis) cannot run under `node --test`, and the
 * project's test loader cannot import a `.tsx` file at all. So the split is: every decision that can
 * be wrong is pure and lives in `src/core/ai/voice.ts` (tested here), while the hook is only wiring.
 * What these tests protect:
 *
 *   1. The speech never reads markdown punctuation or a fenced block character by character.
 *   2. Nothing is dropped silently: the chunks a learner hears are the whole cleaned text, in order,
 *      each short enough for Chrome's ~15-second utterance cut-off.
 *   3. "Explain this screen" can only name a course/lesson/progress/error the caller actually passed
 *      in. With no context it says it cannot see the page — it never invents one.
 *   4. Reading the lesson uses the section's real concepts and recap.
 *   5. The voice UI lives INSIDE the existing assistant (so the footer AI dock gets it), and no
 *      navigation or route change ever starts speaking on its own.
 *
 * Zero dependencies: node:test plus the project's TS resolver hook.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

register('./_ts-resolve.mjs', import.meta.url);

const voice = await load('src/core/ai/voice.ts');

const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

/* ------------------------------- spoken text ------------------------------- */

test('voice: code is announced, not spelled character by character', () => {
  const spoken = voice.speakable('Run `print(x)` and compare.\n```python\nprint(1)\n```\nDone.');
  assert.match(spoken, /print\(x\)/, 'an inline identifier keeps its name — that is how it is said aloud');
  assert.match(spoken, /code example/);
  assert.ok(!spoken.includes('```'), 'fence markers must never be spoken');
  assert.ok(!spoken.includes('python'), 'the fence language tag is not part of the sentence');
});

test('voice: markdown emphasis, arrows and separators become words', () => {
  assert.equal(voice.speakable('**Loop** → `for` · done'), 'Loop to for, done');
  assert.equal(voice.speakable('- first\n- second'), 'first second');
  assert.ok(!voice.speakable('🎯 Focus 🔥').includes('🎯'));
});

test('voice: every chunk fits the utterance cap and nothing is lost', () => {
  const body = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} explains one small idea in plain words.`).join(' ');
  const chunks = voice.speechChunks(body, 180);
  assert.ok(chunks.length > 5, 'a long answer must be split, not handed to one utterance');
  for (const chunk of chunks) assert.ok(chunk.length <= 180, `chunk too long (${chunk.length}): ${chunk}`);
  assert.equal(squash(chunks.join(' ')), squash(voice.speakable(body)), 'the spoken text must be the whole text');
});

test('voice: an over-long sentence is cut at punctuation before a bare word', () => {
  const sentence = `${'alpha beta gamma delta, '.repeat(12)}the end.`;
  const chunks = voice.speechChunks(sentence, 120);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks.slice(0, -1)) {
    assert.match(chunk, /[,.]$/, `a cut should land on punctuation: ${chunk}`);
    assert.ok(chunk.length <= 120);
  }
  assert.equal(squash(chunks.join(' ')), squash(voice.speakable(sentence)));
});

test('voice: the cloud voice is sent whole sentences, not one utterance each', () => {
  const body = Array.from({ length: 30 }, (_, i) => `Sentence ${i + 1} explains one idea in plain words.`).join(' ');
  const cloud = voice.cloudChunks(body);
  const utterances = voice.speechChunks(body, 180);

  assert.ok(cloud.length < utterances.length,
    'a server request per utterance would be slower and choppier than packing sentences');
  assert.ok(cloud.length >= 2, 'a long answer is still several requests, not one oversized one');
  for (const chunk of cloud) assert.ok(chunk.length <= 460, `chunk too long (${chunk.length}): ${chunk}`);
  assert.equal(squash(cloud.join(' ')), squash(body), 'packing must not drop or reorder a sentence');

  // A single sentence over the bound still has to be cut — at punctuation, like the utterance path.
  const one = `${'alpha beta gamma delta, '.repeat(40)}end.`;
  for (const chunk of voice.cloudChunks(one)) assert.ok(chunk.length <= 460);
  assert.equal(voice.cloudChunks('').length, 0);
  assert.equal(voice.cloudChunks('   ').length, 0, 'silence is not a request');
});

test('voice: empty speech yields no utterance at all', () => {
  assert.deepEqual(voice.speechChunks(''), []);
  assert.deepEqual(voice.speechChunks('   \n  '), []);
  assert.equal(voice.spokenReply(''), '');
});

test('voice: a reply is bounded and says where the rest is', () => {
  const long = Array.from({ length: 60 }, (_, i) => `Point ${i + 1} is written on the screen below.`).join(' ');
  const spoken = voice.spokenReply(long, [{ title: 'Loops · for loop' }]);
  assert.ok(spoken.length < 900, `the spoken reply must stay short (${spoken.length})`);
  assert.match(spoken, /The rest is written on screen\./);
  assert.match(spoken, /Source: Loops · for loop\./);

  const short = voice.spokenReply('A tuple is immutable.', [{ title: 'Tuples' }]);
  assert.equal(short, 'A tuple is immutable. Source: Tuples.');
  assert.doesNotMatch(short, /rest is written/, 'a complete answer must not claim it was cut');
});

/* --------------------------------- controls -------------------------------- */

test('voice: speed is clamped to a speakable range and defaults safely', () => {
  assert.equal(voice.clampRate(0.1), 0.7);
  assert.equal(voice.clampRate(9), 1.4);
  assert.equal(voice.clampRate(1.25), 1.3, 'speed is rounded to one decimal for the slider');
  assert.equal(voice.clampRate('nonsense'), 1);
  assert.equal(voice.clampRate(undefined), 1);
});

test('voice: the spoken tag follows the script, so Roman Hinglish is not read as Devanagari', () => {
  assert.equal(voice.speechLangFor('hi-IN', 'नमस्ते! आज हम Python सीखेंगे।'), 'hi-IN');
  assert.equal(voice.speechLangFor('hi-IN', 'Chalo, let’s start the next Python interview question.'), 'en-IN');
  assert.equal(voice.speechLangFor('en-IN', 'नमस्ते'), 'en-IN', 'the English setting always wins');
});

test('voice: an unknown language falls back to English instead of a silent synthesiser', () => {
  assert.equal(voice.normalizeVoiceLang('hi-IN'), 'hi-IN');
  assert.equal(voice.normalizeVoiceLang('ta-IN'), 'en-IN');
  assert.equal(voice.normalizeVoiceLang(null), 'en-IN');
});

test('voice: the support note appears only when something is really missing', () => {
  assert.equal(voice.voiceSupportNote({ synthesis: true, recognition: true }), '');
  assert.match(voice.voiceSupportNote({ synthesis: true, recognition: false }), /no speech recognition/);
  assert.match(voice.voiceSupportNote({ synthesis: false, recognition: true }), /no speech synthesis/);
  assert.match(voice.voiceSupportNote({ synthesis: false, recognition: false }), /neither/);
});

test('voice: the status line never pretends to be idle while it talks', () => {
  assert.equal(voice.voiceStatusLabel('listening', 'en-IN'), 'Listening…');
  assert.equal(voice.voiceStatusLabel('speaking', 'en-IN'), 'Speaking…');
  assert.equal(voice.voiceStatusLabel('thinking', 'hi-IN'), 'Soch raha hoon…');
});

/* ------------------------------ screen briefing ----------------------------- */

test('voice: "explain this screen" narrates only the context it was given', () => {
  const spoken = voice.screenBriefing(
    {
      route: '/lesson/s04/learn',
      where: 'Python Basics · Loops · Lesson',
      pageTitle: 'Loops',
      progressSummary: '38% mastery across 1 section · 2 open mistakes',
      question: { text: 'What does range(3) produce?', model: '0 1 2' },
      error: 'IndentationError: line 4',
    },
    'en-IN',
  );
  assert.match(spoken, /You are on Python Basics · Loops · Lesson\./);
  assert.match(spoken, /38% mastery/);
  assert.match(spoken, /range\(3\)/);
  assert.match(spoken, /Fix this mistake/);
});

test('voice: with no page context it says so instead of inventing a page', () => {
  const english = voice.screenBriefing(undefined, 'en-IN');
  const hinglish = voice.screenBriefing({}, 'hi-IN');
  assert.match(english, /could not read this page/i);
  assert.doesNotMatch(english, /You are on/);
  assert.match(hinglish, /context nahi mila/);
});

test('voice: the Hinglish briefing keeps the real names and adds no numbers of its own', () => {
  const spoken = voice.screenBriefing({ where: 'Python Basics · Loops', progressSummary: '38% mastery' }, 'hi-IN');
  assert.match(spoken, /^Abhi tum Python Basics · Loops par ho\./);
  assert.match(spoken, /38% mastery/);
  assert.ok(!/\d+%/.test(spoken.replace('38% mastery', '')), 'no percentage that was not passed in');
});

/* -------------------------------- lesson read ------------------------------ */

const FIXTURE_SECTION = {
  id: 's04',
  no: 4,
  title: 'Loops',
  pages: { learn: [1], interview: [], code: [], logic: [], solved: [], mini: [], project: [], checkpoint: [] },
  learn: {
    concepts: [
      { title: 'for loop', body: 'A for loop walks a sequence one item at a time.', tip: 'Name the loop variable after the item.' },
      { title: 'while loop', body: 'A while loop repeats until its condition turns false.', tip: '' },
    ],
    recap: 'Use for over a sequence and while over a condition.',
    remember: ['Indent the body by four spaces.'],
    practice: [],
  },
  interview: [], coding: [], logic: [], solved: [],
  mini: { title: '', text: '' },
  projectLab: [], checkpoint: [],
};

test('voice: reading a lesson uses that section’s own concepts, tip and recap', () => {
  const spoken = voice.lessonScript(FIXTURE_SECTION, 'en-IN');
  assert.match(spoken, /Lesson: Loops\./);
  assert.match(spoken, /for loop, while loop/);
  assert.match(spoken, /walks a sequence one item at a time/);
  assert.match(spoken, /Tip: Name the loop variable after the item\./);
  assert.match(spoken, /Recap: Use for over a sequence and while over a condition\./);
});

test('voice: line-based curriculum prose gets a pause between its lines', () => {
  const spoken = voice.lessonScript(FIXTURE_SECTION, 'en-IN');
  assert.doesNotMatch(spoken, /\.\.(?!\.)/, 'a line that already ends in a full stop must not gain a second one');
  const recap = voice.lessonScript(
    { ...FIXTURE_SECTION, learn: { ...FIXTURE_SECTION.learn, recap: 'Variable = naam + value\nMain types: int, float, str' } },
    'en-IN',
  );
  assert.match(recap, /Recap: Variable = naam \+ value\. Main types: int, float, str\./);
});

test('voice: reading a REAL published section speaks its authored text', () => {
  const raw = JSON.parse(read('public/generated/curriculum/sections.json'));
  const sections = Array.isArray(raw) ? raw : raw.sections;
  const section = sections.find((item) => (item.learn?.concepts ?? []).some((concept) => concept.body && concept.body.trim()));
  assert.ok(section, 'the published curriculum must contain a teachable section');
  const concept = section.learn.concepts.find((c) => c.body && c.body.trim());
  const spoken = voice.lessonScript(section, 'en-IN');
  assert.ok(spoken.includes(section.title), 'the real section title is read');
  assert.ok(spoken.includes(concept.body.replace(/\s+/g, ' ').slice(0, 40)), 'the real concept text is read');
});

test('voice: with no lesson open it asks for one instead of reading a random section', () => {
  assert.match(voice.lessonScript(null, 'en-IN'), /No lesson is open right now/);
  assert.match(voice.lessonScript(undefined, 'hi-IN'), /koi lesson open nahi hai/);
});

test('voice: the spoken layer is pure — no browser API, no store, no React', () => {
  const src = read('src/core/ai/voice.ts');
  assert.doesNotMatch(src, /\bwindow\.|localStorage|document\./);
  assert.doesNotMatch(src, /from 'react'/);
  assert.doesNotMatch(src, /storage\/store/);
});

/* ---------------------------------- wiring --------------------------------- */

test('voice: the footer assistant IS the voice agent (one widget, not two)', () => {
  const card = read('src/components/shared/AssistantCard.tsx');
  const dock = read('src/components/shared/AiDock.tsx');
  assert.match(card, /const voice = useVoiceTutor\(busy\)/, 'the assistant owns the speech state');
  assert.match(card, /<VoiceBar[\s\S]{0,200}voice=\{voice\}/, 'the voice controls render inside the assistant');
  assert.match(card, /onExplainScreen=\{explainScreen\}/);
  assert.match(card, /onReadLesson=\{readLesson\}/);
  assert.match(dock, /<AssistantCard/, 'the footer dock renders the same assistant, so it inherits voice');
});

test('voice: nothing speaks on navigation — only a reply or an explicit action does', () => {
  const card = read('src/components/shared/AssistantCard.tsx');
  // Two explicit call sites, and no third: the answer path and the guided-step hand-off. Both only
  // run because the learner pressed something.
  const speakCalls = card.match(/voice\.speak\(/g) ?? [];
  assert.equal(speakCalls.length, 2, 'reply() and the guide hand-off — no other speaker');
  assert.match(card, /say: \(text\) => voice\.speak\(text\)/, 'the guide borrows the tutor’s voice');
  const effectBlock = card.slice(card.indexOf('useEffect(() => {'), card.indexOf('}, [log, logKey]);'));
  assert.doesNotMatch(effectBlock, /voice\.speak|spokenReply/, 'the log effect must not narrate');
  // Navigating away SILENCES the old page narration and closes the mic. It must stop, not start.
  assert.match(card, /useEffect\(\(\) => \{\s*voice\.stopSpeaking\(\);\s*voice\.stopListening\(\);[\s\S]{0,160}\}, \[location\.pathname, location\.search\]\);/);
});

test('voice: the speaking and listening states are visible, not implied', () => {
  const css = read('src/styles.css');
  assert.match(css, /\.voice-state\.listening > i/);
  assert.match(css, /\.voice-state\.speaking > i/);
  assert.match(css, /\.voice-chip\.mic\.on \{ animation: voice-pulse/);
  const bar = read('src/components/shared/VoiceBar.tsx');
  assert.match(bar, /aria-pressed=\{voice\.listening\}/, 'the mic is a toggle and says so');
  assert.match(bar, /aria-live="polite"/, 'the status is announced to screen readers');
  assert.match(bar, /aria-label="Stop the voice tutor"/, 'the learner can always stop the tutor');
  assert.match(bar, /type="range"/, 'narration speed is adjustable');
});

/* ------------------------------ the voice engine ------------------------------ */

test('voice: Google browser voices win their own language — the old localService pick cost quality', () => {
  const voices = [
    { name: 'Microsoft Harika Online (Natural) - Hindi (India)', lang: 'hi-IN', localService: true },
    { name: 'Google हिन्दी', lang: 'hi-IN', localService: false },
    { name: 'Microsoft Zira Desktop - English (United States)', lang: 'en-US', localService: true },
  ];
  const chosen = voice.pickVoiceFrom(voices, 'hi-IN');
  assert.equal(chosen?.name, 'Google हिन्दी',
    'preferring localService first is exactly what pushed learners onto robotic Windows voices');
});

test('voice: a plain local voice still beats a Google voice in the wrong language', () => {
  const voices = [
    { name: 'Google US English', lang: 'en-US', localService: false },
    { name: 'Microsoft Harika Desktop', lang: 'hi-IN', localService: true },
  ];
  assert.equal(voice.pickVoiceFrom(voices, 'hi-IN')?.name, 'Microsoft Harika Desktop');
  assert.equal(voice.pickVoiceFrom(voices, 'en-IN')?.name, 'Google US English',
    'en-US is the same language family for an en-IN request');
  assert.equal(voice.pickVoiceFrom(voices, 'fr-FR'), null, 'no match is null, not a random voice');
});

test('voice: ties break deterministically so the same install always speaks the same voice', () => {
  const voices = [
    { name: 'Google UK English Female', lang: 'en-GB', localService: false },
    { name: 'Google UK English Male', lang: 'en-GB', localService: false },
  ];
  assert.equal(voice.pickVoiceFrom(voices, 'en-IN')?.name, 'Google UK English Female');
});

test('voice: the engine note never promises a voice the deployment does not have', () => {
  const ready = (engine) => ({ state: 'ready', engine });
  // The engine is named, and so is WHERE it runs: the browser, so the line says exactly that.
  assert.match(voice.ttsEngineNote(null, ready('supertonic')), /Supertonic 3 .*Hindi \+ English .*runs in this browser/);
  assert.match(voice.ttsEngineNote('supertonic', ready('supertonic')), /runs in this browser/);
  assert.match(voice.ttsEngineNote('cloud', ready('google')), /Google Neural2/);
  assert.doesNotMatch(voice.ttsEngineNote(null, { state: 'checking', engine: null }), /runs in this browser/);
  assert.match(voice.ttsEngineNote(null, { state: 'checking', engine: null }), /Loading Supertonic 3/);
  // An engine that failed says so and points at the one action that can fix it, instead of claiming
  // a voice the browser does not have.
  assert.match(voice.ttsEngineNote(null, { state: 'unavailable', engine: 'none' }), /not loaded yet .*press Speak/);
  // A browser voice is reported as exactly that, never as the AI voice.
  assert.match(voice.ttsEngineNote('browser', ready('supertonic')), /did not answer/);
  assert.doesNotMatch(voice.ttsEngineNote('browser', ready('supertonic')), /runs in this browser/);
  assert.match(voice.ttsEngineNote('browser', { state: 'unavailable', engine: 'none' }), /Built-in browser voice/);
});

test('voice: the model lives in the worker, and the hook only asks it to speak', () => {
  const hook = read('src/components/shared/useVoiceTutor.ts');
  // No model code in the hook: the worker owns the graphs, so a re-render can never load weights.
  assert.doesNotMatch(hook, /onnxruntime|InferenceSession|loadSupertonic/);
  assert.match(hook, /createVoiceClient/, 'the hook talks to the engine through the client');
  assert.match(hook, /voiceStatus/, 'readiness and progress are first-class state');
  assert.match(hook, /refreshServerVoice/, 'Retry re-runs the real download and sessions');
  const row = read('src/components/shared/AiVoiceRow.tsx');
  assert.match(row, /Downloading Supertonic 3/, 'the first visit says what it is downloading');
  assert.match(row, /runs in this browser/, 'readiness names where the model actually runs');
  assert.match(row, /refreshServerVoice/);
});

test('voice: the hook probes the server key and speaks ONLY from it unless browser voice is chosen', () => {
  const hook = read('src/components/shared/useVoiceTutor.ts');
  assert.doesNotMatch(hook, /api\/voice\/status/, 'there is no server status probe to gate speech');
  assert.doesNotMatch(hook, /api\/voice\/tts/, 'audio is synthesised locally, not fetched from a route');
  assert.doesNotMatch(hook, /googleapis\.com/, 'the Google key and URL must never reach the client');
  assert.match(hook, /speakWithBrowser/, 'the browser engine survives as the learner\'s explicit choice');
  // The AI flow fails loudly instead of handing the answer to a robotic voice: with
  // `engine: 'ai'` and no server voice, speak() sets the error and returns before any browser path.
  assert.match(
    hook,
    /prefs\.engine === 'ai' && !client[\s\S]{0,160}setError\(/,
    'a missing engine is an error in the AI flow, never a substitution',
  );
  assert.doesNotMatch(hook, /handOffToBrowser/, 'a failed server chunk fails the answer; no mid-answer engine swap');
  // Stop aborts the request in flight: the worker drops a superseded answer instead of finishing
  // minutes of synthesis nobody will hear.
  assert.match(hook, /cloudAbort\.current\?\.abort\(\)/, 'Stop cancels the request in flight');
  assert.match(hook, /voiceRef\.current\?\.preload\(\)/, 'Retry starts the engine again');
  // Smoothness is a contract, not a preference: the cloud chunks are scheduled on ONE clock and
  // decoded once. Reloading a fresh <audio> element per sentence is exactly the stutter that was
  // replaced, so the absence of that pattern is asserted too.
  assert.match(hook, /createBufferSource\(\)/, 'chunks are scheduled, not restarted per sentence');
  assert.match(hook, /decodeAudioData/, 'each chunk is decoded once');
  assert.match(hook, /cloudChunks\(/, 'the cloud gets sentence-packed requests, not utterance-sized ones');
  assert.match(hook, /context\.suspend\(\)/, 'pause/stop freezes the graph instead of playing on');
  assert.doesNotMatch(hook, /new Audio\(/, 'no per-sentence audio element any more');
});

test('voice: the API key is server-side only and documented as such', () => {
  const env = read('.env.example');
  assert.match(env, /GOOGLE_TTS_API_KEY=/);
  assert.match(env, /NEVER carry a VITE_ prefix/);
  const index = read('server/index.mjs');
  assert.match(index, /process\.env\.GOOGLE_TTS_API_KEY/, 'the key is read from the server env');
  for (const file of ['src/core/ai/voice.ts', 'src/components/shared/useVoiceTutor.ts', 'src/components/shared/VoiceBar.tsx']) {
    assert.doesNotMatch(read(file), /GOOGLE_TTS_API_KEY/, `no client file may name the key: ${file}`);
  }
});

/* --------------------------- language preference --------------------------- */

test('voice: `auto` resolves per turn from what the learner actually wrote', () => {
  // Devanagari and Roman Hindi both mean Hindi; English stays English.
  assert.equal(voice.resolveVoiceLang('auto', 'decorators kaise kaam karte hain?'), 'hi-IN');
  assert.equal(voice.resolveVoiceLang('auto', 'नमस्ते, tuples क्या हैं?'), 'hi-IN');
  assert.equal(voice.resolveVoiceLang('auto', 'yeh kyun hota hai'), 'hi-IN');
  assert.equal(voice.resolveVoiceLang('auto', 'Why is a tuple immutable?'), 'en-IN');
  assert.equal(voice.resolveVoiceLang('auto', ''), 'en-IN', 'no input means no invention: default English');

  // An explicit choice is never overridden by detection.
  assert.equal(voice.resolveVoiceLang('en-IN', 'batao kya hua'), 'en-IN');
  assert.equal(voice.resolveVoiceLang('hi-IN', 'Explain decorators'), 'hi-IN');

  assert.equal(voice.normalizeVoicePref('en-IN'), 'en-IN');
  assert.equal(voice.normalizeVoicePref('nonsense'), 'auto', 'an unknown preference falls back to detection');
  assert.deepEqual(voice.VOICE_PREFS, ['auto', 'en-IN', 'hi-IN']);
});

/* ------------------------------ UI state ---------------------------------- */

test('voice: the announced state matches the real session, not an animation', () => {
  const base = { voice: 'off', realtime: 'off' };

  assert.equal(voice.mentorUiState(base), 'idle');
  assert.equal(voice.mentorUiState({ ...base, realtime: 'connecting' }), 'connecting');
  assert.equal(voice.mentorUiState({ ...base, realtime: 'connecting', ended: true }), 'reconnecting',
    'connecting after a stop is a reconnect');
  assert.equal(voice.mentorUiState({ ...base, micDenied: true }), 'permission-required',
    'a refused permission needs the fix, not a retry');
  assert.equal(voice.mentorUiState({ voice: 'listening', realtime: 'off' }), 'listening');
  assert.equal(voice.mentorUiState({ voice: 'speaking', realtime: 'off' }), 'speaking');
  assert.equal(voice.mentorUiState({ voice: 'thinking', realtime: 'off' }), 'thinking');
  assert.equal(voice.mentorUiState({ voice: 'off', realtime: 'off', busy: true }), 'thinking',
    'a retrieval in flight is thinking, not idle');
  assert.equal(voice.mentorUiState({ voice: 'listening', realtime: 'off', muted: true }), 'muted');
  assert.equal(voice.mentorUiState({ voice: 'off', realtime: 'connected' }), 'listening');
  assert.equal(voice.mentorUiState({ voice: 'off', realtime: 'connected', muted: true }), 'muted');
  assert.equal(voice.mentorUiState({ voice: 'off', realtime: 'error' }), 'error');
  assert.equal(voice.mentorUiState({ voice: 'off', realtime: 'unavailable' }), 'error');
  assert.equal(voice.mentorUiState({ ...base, ended: true }), 'ended');
  // A permission problem outranks a busy retrieval: the learner must see the blocker first.
  assert.equal(voice.mentorUiState({ voice: 'thinking', realtime: 'off', busy: true, micDenied: true }), 'permission-required');

  for (const state of ['idle', 'permission-required', 'connecting', 'listening', 'thinking', 'speaking', 'muted', 'reconnecting', 'error', 'ended']) {
    assert.ok(voice.mentorStateLabel(state, 'en-IN').trim(), `${state} needs an English label`);
    assert.notEqual(voice.mentorStateLabel(state, 'en-IN'), voice.mentorStateLabel(state, 'hi-IN'),
      `${state} must differ between languages`);
  }
});

test('voice: a blocked microphone is recognised as permission, not as a generic failure', () => {
  assert.equal(voice.micPermissionDenied('Microphone permission is blocked. Allow it in the address bar, then press the mic again.'), true);
  assert.equal(voice.micPermissionDenied('permission denied'), true);
  assert.equal(voice.micPermissionDenied('No microphone was found.'), false);
  assert.equal(voice.micPermissionDenied(null), false);
  assert.equal(voice.micPermissionDenied(undefined), false);
});
