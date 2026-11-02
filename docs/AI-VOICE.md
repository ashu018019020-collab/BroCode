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
| `src/core/voice/voice-engine.ts` | browser | The single queue over `speechSynthesis`: sentence utterances, real `onstart`/`onend`/`onerror` state, pause/resume, replay, stop, preview, and the legacy-cache purge. |
| `src/core/voice/speech-processor.ts` | pure | Markdown → speech, English digits → words, sentence segmentation, language detection. |
| `src/core/voice/mentor-voice.ts` | pure | The one state vocabulary (`ready … speaking … unsupported`) and the wording for it. |
| `src/components/shared/useMentorVoice.ts` | browser | The shared adapter: preferences, the microphone, the levels the orb reads, diagnostics. |
| `src/features/ai/studio/VoiceControlCenter.tsx` | UI | The two switch cards, transport buttons, voice picker with preview, and the diagnostics panel. |

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

## Language and voice selection

`resolveLocale()` follows the learner's choice (`Auto`, `English`, `Hindi / Hinglish`). On `Auto`,
Devanagari or Roman-Hindi words mean Hindi and everything else is English — per answer, from the text
itself.

`voicesForLocale()` never crosses languages: an excellent English voice never answers a Hindi
request. Within a language the accent chain is `en-IN → en-GB → en-US → …` and `hi-IN → hi`, then a
female-sounding name when the device actually has one (`Google UK English Female`, `Microsoft Heera`,
`Samantha`, `Aditi`, …). Browsers expose no gender field, so the panel says *preference*, never a
promise, and it lists the real installed names instead of invented presets.

The learner can pin a voice per language; the choice is stored by `voiceURI` (list order is not
stable) and is ignored if that voice is uninstalled or belongs to the other language. **Preview**
speaks a sample with the highlighted voice; **Test voice** does the same from the diagnostics panel.

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

1. Open `/#/ai-mentor`; the panel should list the voices the device reported and select one.
2. Press **Test voice** — you should hear the sample with the listed voice.
3. Ask an English question with Auto speak on; the answer should start speaking and the orb should
   pulse with word boundaries.
4. Ask `SQL join kaise kaam karta hai?` and confirm the Hindi voice (or the honest "no Hindi voice"
   notice if the device has none).
5. Pause, Resume, Replay, Stop, Voice off, and hands-free reopen after an answer.
6. Reload: the selected voices and switches must be remembered.
