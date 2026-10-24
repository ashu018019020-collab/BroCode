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

test('voice: the engine note never promises a Google voice the server does not have', () => {
  assert.match(voice.ttsEngineNote('cloud', true), /Google Neural2/);
  assert.match(voice.ttsEngineNote(null, false), /no Google voice configured/);
  assert.match(voice.ttsEngineNote(null, null), /Checking/);
  assert.match(voice.ttsEngineNote('browser', true), /busy/,
    'a mid-session fallback is REPORTED, not hidden');
  assert.match(voice.ttsEngineNote('browser', false), /Browser voice/);
});

test('voice: the hook probes the server key and falls back — cloud is an upgrade, never a dependency', () => {
  const hook = read('src/components/shared/useVoiceTutor.ts');
  assert.match(hook, /\.\/api\/voice\/status/, 'the status probe is the only key check');
  assert.match(hook, /\.\/api\/voice\/tts/, 'audio is fetched, never a Google URL in the browser');
  assert.doesNotMatch(hook, /googleapis\.com/, 'the Google key and URL must never reach the client');
  assert.match(hook, /speakWithBrowser/, 'the browser engine is the fallback path');
  assert.match(hook, /cloudFails\.current >= 2/, 'two consecutive failures abandon the cloud for the session');
  assert.match(hook, /URL\.revokeObjectURL/, 'object URLs are released');
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
