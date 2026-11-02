# The AI voice

The mentor speaks with **Supertonic 3 running in the browser**. Nothing is sent anywhere: the ONNX
graphs, the tokenizer and the flow-matching loop all run inside a module worker on the learner's own
machine, and the audio is played from memory. No key, no server route, no per-character cost.

| Piece | Where | What it does |
| --- | --- | --- |
| `src/workers/tts.worker.ts` | browser worker | Owns the four ONNX sessions, the voice-style cache and synthesis. Reports real download progress. |
| `src/core/voice/engine.ts` | pure | The inference pipeline, ported from `supertonic/core.py` 1.3.1: duration → text encoder → vector estimator steps → vocoder. |
| `src/core/voice/text.ts` | pure | The model's `UnicodeProcessor`: NFKD, symbol table, `<hi>`/`<en>` wrapper, `unicode_indexer.json` lookup. |
| `src/core/voice/style.ts` | pure | `voice_styles/F1.json` → `style_ttl` `[1,50,256]` and `style_dp` `[1,8,16]`, shape-checked. |
| `src/core/voice/assets.ts` | pure + fetch | The pinned checkpoint (`Supertone/supertonic-3` @ `3cadd1e`), Cache Storage, byte-accurate progress. |
| `src/core/voice/client.ts` | browser | One worker per page; status events and finished PCM. |
| `src/components/shared/useMentorVoice.ts` | browser | The shared adapter: playback, pause/resume, the sentence queue, the microphone, the amplitude the orb reads. |
| `src/core/voice/mentor-voice.ts` | pure | The one state vocabulary (`idle … speaking … error`) plus speech-text preparation. |

## The model

379 MB across four graphs plus `unicode_indexer.json` and `tts.json`, downloaded **once** from a
revision-pinned URL and stored in Cache Storage under the revision's name. `Clear cache` in the voice
panel removes exactly that cache. The first answer costs the download; every later answer loads from
the browser cache. `scripts/ort-copy.mjs` publishes ONNX Runtime Web's WASM pair into `public/ort/` at
build time, so the runtime is same-origin and the site keeps working under a strict CSP.

WebGPU is requested first (`webgpu`, then `wasm`); a browser without an adapter runs the WASM build,
which is the path the engine was verified on.

## Speaking an answer

1. `spokenReply()` bounds a long answer and says that the rest is on screen; `speechText()` strips
   markdown, expands `e.g.`/`etc.`/`vs.`, turns `→`/`·`/`%` into words and reads digits in English
   (Devanagari text keeps its numerals).
2. `speechSegments()` cuts it into sentence-sized requests — quick first sound, and a boundary
   `Interrupt` can cut on.
3. Each sentence is synthesised in order by the worker; the page decodes the PCM into an
   `AudioBuffer` and plays it through one `AudioBufferSourceNode` and an `AnalyserNode`.
4. There is a 120 ms breath between sentences and never two sources at once. `Pause` stops the node
   and remembers the offset; `Resume` starts a new node at that offset; `Interrupt` bumps the run id,
   drops the queue and cancels the worker generation, so a late buffer cannot revive.

`Speaking` is shown only when a source actually starts, and `Finished speaking` only when the last
sentence's `ended` event fires. The orb's waveform reads the real output amplitude, so it cannot
animate to silence.

## Language

`speechLanguage()` decides the model's own token: Devanagari is Hindi, Latin is English, and Roman
Hinglish follows the learner's explicit *Hindi / Hinglish* choice instead of pretending the script
decides it. English technical terms inside a Hinglish sentence keep their Latin spelling. The
selector's `Auto detect` resolves per answer.

## What is deliberately NOT here

No device speech synthesis as a silent fallback: if the model cannot load, the panel says so and offers
`Download model now`. No external TTS provider, no server key, no separate inference service. The old
`/api/voice/*` routes still exist for the interview room's optional server voice, but the AI Mentor
does not depend on them and shows no "server voice is not configured" message.

## Checking the real audio

Audio output cannot be verified from a headless shell. In a real browser:

1. Open `/#/ai-mentor`, press **Download model now** in the voice panel and watch the byte progress.
2. Ask an English question with Auto speak on — the answer should start speaking after synthesis.
3. Ask a Hindi/Hinglish question (`SQL join kaise kaam karta hai?`) and confirm the Hindi voice.
4. Pause, Resume, Replay, Interrupt, Mute, and hands-free mic reopen.
5. Reload the page: the second answer must not download the model again.
