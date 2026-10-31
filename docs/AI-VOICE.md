# The AI mentor's voice

BroCode speaks with the **browser's own speech synthesiser**. There is no model to download, no
inference server, no API key and no audio route: the page builds utterances and the browser says them.

## Why this shape

The voice has to work on the free deployment, on a phone, on a slow connection, and without a paid
TTS provider. `SpeechSynthesis` is the one engine that satisfies all four, and Chromium/Edge/Safari
ship good Hindi and English voices on every desktop and Android device.

It also cannot fail the way a model download can: there is no 380 MB checkpoint, no WASM runtime and
no cold start. If a browser has no compatible voice, the UI says so instead of pretending to speak.

## The pieces

| File | Owns |
| --- | --- |
| `src/core/ai/voice.ts` | Pure text + voice logic: `speakable()`, `speechChunks()`, `spokenReply()`, language resolution (`auto`/`en-IN`/`hi-IN`), and `pickVoiceFrom()` — the female-first ranking. |
| `src/components/shared/useVoiceTutor.ts` | The only place that touches `SpeechRecognition` and `speechSynthesis`: speak, stop, pause/resume, rate, mute, language, the female voice choice, and the speech-in half (mic). |
| `src/components/shared/VoiceBar.tsx`, `AiVoiceRow.tsx` | The controls and the honest status line. |
| `src/features/ai/VoiceMentorPanel.tsx` | The AI Mentor's conversation: asks, then speaks the answer. |
| `src/features/interview/InterviewMode.tsx` | The interview room's voice, same engine. |

## Choosing the voice

`pickVoiceFrom(voices, lang)` ranks what the browser actually has:

1. a voice whose language matches the requested one (`hi-IN`, then `hi`; `en-IN`, then `en-GB`/`en-US`/`en`),
2. preferring a **female** name (`female`, `woman`, `zira`, `heera`, `kalpana`, `swara`, `samantha`, …)
   over a male or neutral one,
3. preferring a **local** voice (no network round-trip) over a remote one,
4. falling back to the browser default when nothing matches — and the row says which voice spoke.

A learner can pin a specific installed voice with `voiceName`; the picker only ever lists voices the
browser reports, so a stored name that disappeared falls back to the ranking instead of silence.

## Speaking an answer

1. `spokenReply()` trims an answer to the sentences worth hearing (Markdown stripped, code fences
   collapsed to "code example", long answers cut with "The rest is written on screen.").
2. `speechChunks()` splits it into utterance-sized pieces (≤ ~180 characters, split at punctuation
   first) so the synthesiser does not truncate a long line mid-word.
3. Utterances are queued in order on one synthesiser. Speak again supersedes the previous answer
   (the queue is cleared first), so two answers can never overlap.
4. `onend` runs only for a queue that really finished — Stop, a barge-in or a navigation never fires
   it, which is what lets the mentor reopen the mic after a hands-free turn.

## Controls

**Speak** (manual, always available) · **Stop** (clears the queue immediately) · **Replay** (says the
last answer again) · **Voice on/off** (auto-speak, on by default) · **Speed** (0.7×–1.4×) ·
**Language** (`auto` decides per message: Devanagari or Roman Hindi ⇒ `hi-IN`, otherwise `en-IN`) ·
**Mic** (push-to-talk; in the mentor it stays open for a hands-free turn). A new question stops the
previous answer before retrieval, so the old voice never talks over the new one.

## Failure, honestly

- **No speech synthesis in this browser** → the controls say the voice is unavailable and the answer
  stays on screen. No robotic substitute is synthesised by us.
- **No voice for the language** → the row names the voice that will actually be used.
- **Mic permission refused** → a message that says how to allow it, not a silent no-op.
- **Autoplay blocked** → the press that started the answer is the gesture; a rejected `speak()`
  surfaces as an error state rather than a stuck "Speaking…".

## What was removed

The Supertonic 3 integration (on-device ONNX worker, then a Python inference service with a Vercel
proxy) is gone: `src/workers/tts.worker.ts`, `src/core/voice/*`, `services/supertonic-tts/`,
`api/voice/{tts,status,health}.js`, `server/voice*.mjs`, `render.yaml`'s voice host, the
`onnxruntime-web` dependency, the `/voice-health` operator page, and the `TTS_SERVICE_*` /
`SUPERTONIC_*` variables. Nothing in the app requests a model, a `.wasm` file or an inference URL.
