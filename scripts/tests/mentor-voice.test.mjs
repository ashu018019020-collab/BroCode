/**
 * The AI Mentor studio — the pure voice vocabulary, the speech text and the Smart Tools registry.
 *
 * These are the parts where a lie would be invisible on screen: a state that says "Speaking" while
 * nothing plays, a sentence the voice never reads, a tool that looks functional and does nothing.
 * The suite pins each of them, plus the wiring that makes the studio use ONE voice adapter.
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
const tools = await load('src/core/ai/smart-tools.ts');

/* --------------------------------- states --------------------------------- */

test('mentor voice: a real failure outranks everything else', () => {
  const state = voice.mentorVoiceState({
    phase: 'speaking', speaking: true, listening: true, error: 'the model did not load',
  });
  assert.equal(state, 'error');
  assert.equal(voice.mentorVoiceState({ phase: 'error' }), 'error');
});

test('mentor voice: speaking is only reported for real playback', () => {
  // A request in flight is generating, not speaking — the mistake that animated the orb to silence.
  assert.equal(voice.mentorVoiceState({ phase: 'generating', generating: true }), 'generating');
  assert.equal(voice.mentorVoiceState({ phase: 'speaking' }), 'speaking');
  assert.equal(voice.mentorVoiceState({ phase: 'speaking', paused: true }), 'paused');
  assert.equal(voice.mentorVoiceState({ phase: 'ready' }), 'ready');
  assert.equal(voice.mentorVoiceState({ phase: 'downloading' }), 'loading');
  assert.equal(voice.mentorVoiceState({ phase: 'initializing' }), 'preparing');
  assert.equal(voice.mentorVoiceState({ phase: 'idle' }), 'idle');
});

test('mentor voice: the microphone is announced as listening, before any synthesis', () => {
  assert.equal(voice.mentorVoiceState({ phase: 'idle', listening: true }), 'listening');
});

test('mentor voice: every state has a label and a hint, and none mentions a server', () => {
  const states = ['idle', 'loading', 'preparing', 'ready', 'listening', 'generating', 'speaking', 'paused', 'completed', 'error'];
  for (const state of states) {
    for (const locale of ['en', 'hi']) {
      const label = voice.mentorVoiceLabel(state, locale);
      const hint = voice.mentorVoiceHint(state, locale);
      assert.ok(label.length > 2, `${state}/${locale} has a label`);
      assert.ok(hint.length > 5, `${state}/${locale} has a hint`);
      assert.ok(!/server/i.test(label + hint), `${state}/${locale} must not mention a server`);
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
  // A Hindi sentence keeps its numerals: the Hindi voice reads them.
  assert.equal(voice.verbalizeNumbers('2 plus 2'), 'two plus two');
  assert.equal(voice.verbalizeNumbers('सवाल 2'), 'सवाल 2');
});

test('speech text: empty input never produces a sentence', () => {
  assert.equal(voice.speechText(''), '');
  assert.deepEqual(voice.speechSegments('   '), []);
  assert.equal(voice.speechText('   '), '');
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
  // Roman Hindi is Latin text: only an explicit choice makes it Hindi.
  assert.equal(voice.speechLanguage('SQL join kaise kaam karta hai', 'auto'), 'hi');
  assert.equal(voice.speechLanguage('SQL join kaise kaam karta hai', 'en'), 'en');
  assert.equal(voice.speechLanguage('tuple kya hai', 'hi'), 'hi');
});

test('speech engine note names the real engine and preset', () => {
  const note = voice.speechEngineNote('F1');
  assert.ok(/Supertonic 3/.test(note));
  assert.ok(/F1/.test(note));
  assert.ok(/browser/i.test(note), 'the note says where the audio is generated');
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
  // The real question bank when a section is open, the practice index otherwise.
  assert.equal(tools.smartToolRoute('practice', { sectionId: 's12' }), '/questions?section=s12');
  assert.equal(tools.smartToolRoute('practice'), '/practice');
  assert.equal(tools.smartToolRoute('explain-simple'), '', 'an ask tool has no route');
});

/* --------------------------------- wiring -------------------------------- */

test('studio: the mentor hub renders one studio, and the studio uses one voice adapter', () => {
  const hub = read('src/features/ai/MentorHub.tsx');
  assert.ok(hub.includes("from './studio/MentorStudio'"), 'MentorHub hands the section to the studio');
  assert.ok(!/VoiceMentorPanel/.test(hub), 'no second mentor panel is mounted');

  const studio = read('src/features/ai/studio/MentorStudio.tsx');
  assert.ok(studio.includes('useMentorVoice'), 'the studio uses the shared Supertonic adapter');
  assert.ok(studio.includes('<VoiceControlCenter'), 'the control center is the one voice surface');
  assert.ok(studio.includes('<SmartToolsPanel'), 'the smart tools are wired');
  assert.ok(studio.includes('MockInterviewPanel'), 'the interview tab mounts the existing engine');

  const hook = read('src/components/shared/useMentorVoice.ts');
  assert.ok(hook.includes("createVoiceClient"), 'the adapter talks to the existing TTS worker');
  assert.ok(!/speechSynthesis/.test(hook), 'the mentor never falls back to the device voice');
});

test('studio: the dark studio is scoped, token-driven and honours reduced motion', () => {
  const css = read('src/features/ai/studio/studio.css');
  for (const token of ['--ms-bg', '--ms-cyan', '--ms-violet', '--ms-radius', '--ms-shadow', '--ms-fast']) {
    assert.ok(css.includes(token), `${token} is declared`);
  }
  assert.ok(css.includes('.mentor-studio'), 'the palette is scoped to the studio');
  assert.ok(css.includes('prefers-reduced-motion'), 'motion can be switched off');
  assert.ok(css.includes('@media (max-width: 720px)'), 'the layout has a phone breakpoint');
});

test('studio: no stale server-voice warning is shown to the learner', () => {
  for (const file of ['ConversationPanel.tsx', 'VoiceControlCenter.tsx', 'SmartToolsPanel.tsx', 'MentorStudio.tsx']) {
    const source = read(`src/features/ai/studio/${file}`);
    assert.ok(!/not configured/i.test(source), `${file} carries no server-voice warning`);
  }
});

test('voice: the browser engine is published with the build', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['onnxruntime-web'], 'onnxruntime-web is a dependency');
  assert.equal(pkg.scripts.prebuild, 'node scripts/ort-copy.mjs');
  assert.ok(fs.existsSync(path.join(ROOT, 'scripts/ort-copy.mjs')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src/workers/tts.worker.ts')));
  for (const asset of ['assets.ts', 'engine.ts', 'text.ts', 'style.ts', 'client.ts']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'src/core/voice', asset)), `${asset} exists`);
  }
});
