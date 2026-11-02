# The AI voice

The mentor speaks with a **voice the device already has**, using the browser's own
`SpeechSynthesis` API. There is no model to download, no WASM runtime, no worker, no server route and
no API key. The audio the learner hears is produced by their platform — Chrome's own voices, the
Windows/macOS/Android system voices, or whatever the device has installed.

That is a deliberate, reversible trade: the previous browser model (Supertonic 3 + ONNX Runtime Web)
sounded different, but it needed a 379 MB download, a WebGPU/WASM backend and a same-origin WASM
runtime, and its failures ("no available backend found", `initWasm() failed`) were the most common
thing learners saw. A device voice starts instantly on every phone and laptop and cannot fail that
way.

| Piece | Where | What it does |
| --- | --- | --- |
| `src/core/voice/voice-discovery.ts` | pure | Which installed voice speaks which language: language first, then accent chain, then a female-sounding name, then Chrome/local/default, then name. Plus the honest "no Hindi voice" message. |
| `src/core/voice/voice-profile.ts` | pure | The single `BroCode Natural Voice` profile: the Hindi and English voices behind it, the per-sentence plan, and the honest "no Hindi voice" message. |
| `src/core/voice/voice-engine.ts` | browser | The single queue over `speechSynthesis`: sentence utterances, real `onstart`/`onend`/`onerror` state, pause/resume, replay, stop, preview, the four Chromium silent-playback repairs, and the legacy-cache purge. |
| `src/core/voice/speech-processor.ts` | pure | Markdown → speech, English digits → words, sentence segmentation, language detection. |
| `src/core/voice/mentor-voice.ts` | pure | The one state vocabulary (`ready … speaking … unsupported`) and the wording for it. |
| `src/components/shared/useMentorVoice.ts` | browser | The shared adapter: preferences, the microphone, the levels the orb reads, diagnostics. |
| `src/features/ai/studio/VoiceControlCenter.tsx` | UI | One profile card with Test voice, the two switch cards, transport buttons, language and speed, and the collapsed technical details. |

## Speaking an answer

1. `spokenReply()` bounds a long answer and says the rest is on screen; `speechText()` strips
   markdown, expands `e.g.`/`etc.`/`vs.`, turns `→`/`·`/`%` into words and reads digits in English
   (Devanagari text keeps its numerals).
2. `speechSegments()` cuts it into sentence-sized utterances (≤180 characters). Chrome stops a single
   long utterance after roughly 15 seconds, and short segments make **Stop** immediate.
3. Each utterance is spoken in order with the resolved voice, the learner's rate and the language tag
   of its own text. `Speaking` is published from `onstart` and `Finished speaking` from the last
   `onend` — never from the `speak()` call.
4. A new answer, **Stop**, or a language change cancels the queue and bumps a run id, so a late
   `onend` from a cancelled utterance cannot revive it. Pause/resume use the platform's own
   pause/resume; where a browser cannot resume mid-utterance the current sentence restarts, and no
   progress percentage is invented.

## One profile, two languages

The learner chooses a **language**, never a voice: `Auto`, `English` or `Hindi / Hinglish`. On screen
there is one card, **BroCode Natural Voice — Hindi + English — Automatic language selection**, and a
**Test voice** button. No dropdown, no device voice name and no raw language tag is shown in the
panel; those live only in the collapsed **Voice details** block.

Underneath, `naturalVoices()` resolves the best installed Hindi voice and the best installed English
voice, and `planSpeech()` decides **per sentence** which one reads it: Devanagari is Hindi, Roman
Hinglish is Hindi (its `hain`/`kya`/`matlab` words), everything else is English. An explicit
English/Hindi choice applies to every sentence, including a Devanagari one. A single mixed answer can
therefore move between the two voices sentence by sentence — the alternative, one accent reading
both scripts, is what sounds broken.

The profile says "one voice" only when the platform reported the **same `voiceURI`** for both
languages (`naturalVoices().shared`); otherwise the details say "two voices behind one profile". No
stored voice name survives a reload: the profile re-resolves on every load, so an uninstalled or
wrong-language pick cannot stick.

Within a language the accent chain is `en-IN → en-GB → en-US → …` and `hi-IN → hi`, then a
female-sounding name when the device actually has one (`Google UK English Female`, `Microsoft Heera`,
`Samantha`, `Aditi`, …). Browsers expose no gender field, so that is a *preference*, never a promise.

## Why a device voice goes silent (and the four repairs)

Each of these produces the same symptom — a panel that says Ready and an answer that makes no sound —
and each is handled in `voice-engine.ts` rather than blamed on the voice:

1. **`cancel()` then `speak()` in the same task.** Chromium drops the new utterance. When the
   platform was playing or paused, the first sentence now starts one task later (`CANCEL_GAP_MS`).
2. **An unreferenced utterance is garbage-collected** mid-sentence. The engine holds the live
   utterance in `current` until it ends.
3. **`speechSynthesis.paused` is page-global and survives `cancel()`.** A platform left paused queues
   everything and plays nothing, so a paused platform is resumed before the first sentence.
4. **`speak()` accepted but never started.** A bounded watchdog checks whether the platform really
   began, re-issues the same sentence once, and only then reports an actionable failure.

A cancellation error that arrives for an utterance the engine still wants is re-issued once as well;
only a second one becomes `The browser interrupted the voice… Press Replay`.

## Language detection

`resolveLocale()` follows the learner's choice (`Auto`, `English`, `Hindi / Hinglish`). On `Auto`,
Devanagari or Roman-Hindi words mean Hindi and everything else is English — per sentence, from the
text itself. `voicesForLocale()` never crosses languages: an excellent English voice never answers a
Hindi request, and when the device has no Hindi voice the panel says so before the answer instead of
silently substituting an English one.

## The two switches

- **Auto speak** reads every completed answer.
- **Hands-free** reopens the microphone after the voice finishes. It is wired to the engine's real
  `onEnd`, so it never reopens after **Stop** or an error, and `startListening()` stops the voice
  before opening the mic — the recogniser cannot transcribe the tutor.

They are `role="switch"` cards with their own state line, not a shared checkbox row.

## Microphone

Recognition is unchanged: Chromium's `SpeechRecognition`, language fallback chain
(`hi-IN → en-IN → en-US`), a 20-second ceiling on one press, and a clear "permission blocked" state
instead of a silent mic. The orb's microphone pulse is a real `AnalyserNode` reading; its speaking
pulse comes from the platform's `boundary` events, so it only moves while an utterance is advancing.

## What is deliberately NOT here

- No Supertonic 3, ONNX Runtime, WASM, `tts.worker.ts`, model styles or HuggingFace checkpoint.
- No `/api/voice/tts` dependency for the mentor. The interview room keeps its optional server voice
  and its device-voice option; the mentor does not use either.
- No "server voice is not configured" message anywhere in the studio.
- No invented voice names, no "neural" claim, and no promise that a system voice is offline: a voice
  with `localService: false` may be served by the operating system's speech service.
- No claim that "speaking" happened without an `onstart`.

## Checking the real audio

Audio cannot be verified from a headless shell. In a real browser:

1. Open `/#/ai-mentor`; the panel should show one card, **BroCode Natural Voice**, with a status
   (`Ready`, `Limited voices` or `Voice unavailable`) and no device voice names.
2. Press **Test voice** — you should hear the sample. If nothing plays, open **Voice details** and read
   *Last error*; the four silent-playback cases above are what it names.
3. Ask an English question with Auto speak on; the answer should start speaking and the orb should
   pulse with word boundaries.
4. Ask the Hindi sample `नमस्ते! आपका स्वागत है। आज हम Python programming सीखेंगे।` and the Hinglish
   sample `Chalo aaj Python programming seekhte hain. Main tumhe step by step guide karunga.`; the
   first must use the Hindi voice, and the honest "no Hindi voice" notice must appear on a device
   without one rather than an English voice reading Devanagari.
5. Pause, Resume, Replay, Stop, Mute, and hands-free reopen after an answer; then send a second
   question while the first is speaking and confirm there is no overlap and no interrupted repeat.
6. Reload: language, speed and the two switches must be remembered.
