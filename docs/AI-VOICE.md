# AI Mentor, Coding Coach & Spoken Interview

The AI section at **`/#/ai-mentor`** is one studio with four tabs. Everything except the optional
hosted services (account, the server AI voice, OpenAI Realtime, AI evaluation) runs in the browser:
answers come from the bundled curriculum, code evidence comes from the existing Pyodide/JS runners,
and interview scores come from deterministic rubrics over the authored questions.

## Tabs and engines

| Tab | UI | Engine (pure, testable) | Evidence source |
| --- | --- | --- | --- |
| Voice Mentor | `src/features/ai/VoiceMentorPanel.tsx` | `src/core/ai/mentor.ts`, `src/core/ai/voice.ts` | Local retrieval (`core/ai/assistant.ts`) over the generated curriculum |
| Coding Coach | `src/features/ai/CodingCoachPanel.tsx` | `src/core/ai/coding-coach.ts`, `src/core/platform/diff.ts` | Real runner traceback/stdout, real editor text, Program Input |
| Mock Interview | `src/features/ai/MockInterviewPanel.tsx` | `src/core/assessment/mock-interview.ts` | Authored `interview`, `coding`, `logic` and project items in `sections.json` |
| Reports | same panel, `?tab=reports` | `sanitizeReports` / `buildMockReport` | The per-account store (`MOCK_HISTORY_KEY`) |

The page is registered at `/ai-mentor` in the route table, NAV, command palette and learning-path
allowlist. The Playground embeds the coach beside the editor (`Coach panel`), so a failing run can be
diagnosed without leaving the lab.

## What each engine refuses to do

These are product rules, not prompt suggestions, and the tests enforce them:

- **The mentor reshapes, never authors.** It splits a retrieved passage into *simple → why → example →
  where*. A missing reason or example becomes an explicit refusal; the model is never asked to fill the
  gap. A bold title is treated as a title, not spoken as the explanation. A retrieved **practice item**
  (`Question:` with no authored `Answer:`) is named as a practice question and refused as a lesson —
  the question is never read aloud as if it were the explanation — while a `Question:/Answer:` passage
  is taught from its answer and titled with its question.
- **A repeated ask gets the short version.** "samjha nahi aaya", "repeat", or the same question twice
  returns only the simple block, not the same wall of text.
- **The coach separates runtime from static evidence.** Only a real traceback may say a line is
  broken. Static rules (`== None`, bare `except:`, mutable defaults, `range(len(...))`, JS `var`, loose
  equality) are labelled `static`. `ran` is true only when the caller's runner returned for that exact
  code, and even then "no error" is not "tests passed".
- **Patches are opt-in and stale-safe.** A one-line repair is offered only when it is deterministic
  from the text. It is shown as a diff; nothing touches the editor until **Apply**. If the learner
  edited that line after the preview, `applyLinePatch` returns `null` and the UI asks to regenerate.
- **Interview questions are real.** JavaScript, C and C++ are listed as unavailable because the bundled
  curriculum has no bank for them — no questions are invented to fill a topic.
- **Four independent dimensions.** Technical (keyword rubric), reasoning (cause/example/edge-case
  signals), communication (word/sentence structure only) and coding (recorded run evidence). There is
  no audio input to the scorer, so accent or voice can never affect a score. An unanswered question is
  `null`, not zero.
- **Follow-ups target the gap.** The authored follow-up is used when present; otherwise the exact
  missing rubric group is asked about.
- **The report is a second read, not a second scoring pass.** Totals average the same per-question
  numbers the candidate saw, and the revision plan links to `/lesson/<id>/learn`.

## Voice paths

### Default: the server voice (no download, no model in the browser)

The tutor's voice is **Supertonic 3** (`Supertone/supertonic-3`), a 99M-parameter ONNX TTS model that
runs on the **server**, in `voice-service/` (see its README for deploy steps). The browser sends text
and receives audio:

```
browser ──POST /api/voice/tts──▶ account API ──▶ voice-service (ONNX Runtime, CPU) ──▶ audio/wav
        ◀──────────────────────── audio ─────────┘
```

Nothing model-shaped is shipped to, cached by, or executed in the browser any more. The previous
build ran the model on-device through ONNX Runtime Web; that path, its Cache API bucket, its WASM files
and its "Download 398 MB (one time)" control are gone. `scripts/tests/supertonic.test.mjs` fails if a
model host, a weight size or an on-device loader reappears in the client.

| | |
| --- | --- |
| Model | `Supertone/supertonic-3`, pinned to revision `724fb5a…` (never `main`) |
| Graphs | `duration_predictor` · `text_encoder` · `vector_estimator` (×8 denoising steps) · `vocoder` |
| Runtime | `onnxruntime-node`, CPU execution provider |
| Output | 44.1 kHz mono 16-bit WAV |
| Voice preset | `F1` (`F1–F5` female / `M1–M5` male), `SUPERTONIC_STYLE` |
| Code | `server/supertonic-tts.mjs` (engine), `voice-service/` (HTTP service), `core/ai/supertonic.ts` (pure model contract, shared with the tests) |

**Language policy.** The model takes a language tag per chunk (`<hi>…</hi>` / `<en>…</en>`).
BroCode's `hi-IN` setting means "Hindi voice, Hinglish explanations", and Hinglish is usually Roman
script — tagging Roman text `hi` asks the model to read Latin letters as Hindi. So the tag follows the
script on the page: Devanagari → `hi`, everything else → `en`. The setting still decides whether a
Hindi answer is *spoken* in Hindi; it never rewrites the answer. The server applies exactly this rule
(`supertonicLang`) per chunk, so a mixed answer is tagged sentence by sentence.

**Time to first audio.** The server synthesizes the first chunk with a deliberately shorter cap
(90 characters, then 220), and the account API's route returns the whole answer as one WAV; the client
splits long answers into sentence-packed requests (`cloudChunks`, ≤460 characters each) and starts
playback as soon as the FIRST chunk decodes. The engine also warms all four graphs at boot, so the
learner never pays WebAssembly/kernel start-up on the first sentence. Measured on the container used
for verification, 8 steps, style `F1`: warm-up 2.3 s once; English 4.56 s of audio in 1.8 s; Hindi
5.14 s in 1.8 s; Hinglish 3.39 s in 1.3 s (≈2.5–3× realtime). A repeat request is served from a small
in-process cache in 0 ms. This is chunk-level, not token-level streaming, and it is not described as
streaming anywhere in the UI.

**Failure is a fallback, not a dead end.** `/api/voice/status` names the engine and whether it is
ready; "Server-powered" is printed only for `ready`, which the server only reports after its
inference service answered a health check. A failed chunk hands the unheard remainder to the browser
voice, the settings line says which engine actually spoke, and Retry re-probes the server. The rest of
BroCode keeps working with no voice at all.

To verify the model for real on a development machine (downloads the pinned weights once, writes WAVs,
prints latency and loudness):

```bash
npm install --no-save onnxruntime-node
node tools/supertonic-check.mjs            # --steps=4 --only=hi --style=F2
```

`onnxruntime-node` is deliberately NOT a dependency of the web app: only `voice-service/` needs it, and
the website must never carry a 100 MB native runtime. The unit suite drives the same inference core
with fake sessions, so it proves the tensor wiring, not the voice.

### Engines and the fallback chain

| Engine | Selected when | Billable? |
| --- | --- | --- |
| `supertonic` | `TTS_SERVICE_URL` + `TTS_SERVICE_SECRET` point at a healthy `voice-service/` | No (your container) |
| `google` | No service URL, or the service failed and `GOOGLE_TTS_API_KEY` exists | Yes, per character |
| `none` | Neither is configured | — the browser voice speaks, and the UI says so |

The response header `X-Voice-Engine` names the engine that produced the audio, so the UI's label is
evidence rather than an assumption. A configured-but-unreachable service is reported as unavailable —
never silently replaced by Google without that header changing.

### Last resort: browser speech loop

`src/components/shared/useVoiceTutor.ts` uses `SpeechRecognition` when the browser provides it and
`speechSynthesis` for output when no server voice answered. This path is always labelled as the
built-in browser voice: it is never described as AI audio, and the settings line separates "this
deployment has no AI voice" from "the AI voice did not answer". Chrome's speech recognition is itself a
browser service — the settings note says so rather than claiming every path is local. Text input
always works, and every answer is readable.

#### Smooth playback (server path)

The spoken answer is not one request per utterance. Three details produce the natural feel, and each
is a deliberate choice rather than a default:

- **Sentence packing.** `cloudChunks()` (`src/core/ai/voice.ts`) packs whole sentences into requests
  of up to 460 characters, so a long answer is 2 calls instead of 5. The browser's own synthesiser
  keeps the small chunks (`speechChunks`) because Chrome cuts a single utterance after ~15 s.
- **Pipelined start.** Every request is fired at once, but playback begins as soon as the FIRST
  chunk is decoded — the old path waited for `Promise.all`, so the learner sat in silence for as long
  as the slowest request took.
- **Gapless scheduling.** Chunks are decoded with `decodeAudioData` and scheduled on ONE
  `AudioContext` clock with a 180 ms breath between them. Reloading an `<audio>` element per sentence
  was the stutter this replaced.

Pause/Stop call `AudioContext.suspend()`, which freezes the clock — already-scheduled sentences wait
instead of finishing under a "Paused" label. Stopping also aborts the in-flight fetches, so the server
stops synthesizing audio nobody will hear.

### Optional: OpenAI Realtime over WebRTC

Adapted from **`openai/openai-realtime-console`** (MIT): the WebRTC offer/answer, the `oai-events`
data channel, streaming assistant transcript and barge-in/interruption handling. What is deliberately
different:

- the browser never sees a permanent key — it asks BroCode's API for an **ephemeral client secret**;
- the teaching instructions live on the server, so the browser cannot rewrite them;
- a hard 5-minute timer and full teardown run even when the network dies;
- a user transcript is displayed only after a completed transcription event.

The hook is `src/components/shared/useRealtimeVoice.ts`; the provider code is `server/realtime.mjs`.

### Project grounding — what the agent knows about BroCode

A realtime model with no context answers "what can I learn here?" with generic topics. Two paths fix
that, and both are derived from the repository rather than written by hand:

- **Live voice (online).** `server/project-brief.mjs` reads
  `public/generated/curriculum/sections.json` once and builds a bounded brief: the real section count,
  every real number + title, the eight stages each section has, and the app's real areas. It is
  appended to the server-side teaching contract (`realtimeInstructions(lang, brief)`), so the model
  names real sections and is told to say plainly when a topic is not in the course. A missing or
  unreadable file yields an empty brief — the session still mints and the old contract applies.
- **Local mentor (default).** `projectOverview()` in `src/core/ai/mentor.ts` answers platform
  questions ("what can I learn here?", "kitne sections hain", "syllabus batao") from the curriculum
  the page already loaded: the real count, one line per real section, and the real stage list. The
  spoken form names the count plus the first and last section, never 29 titles; the full list stays on
  screen. With no curriculum loaded it returns `null` and the normal retrieval answer runs instead.

No topic, number or route is generated: every one is read from a file that ships with the build.

## Provider setup

| Variable | Required | Purpose |
| --- | --- | --- |
| `TTS_SERVICE_URL` | No | Base URL of `voice-service/` (Supertonic 3 on CPU). Preferred voice. |
| `TTS_SERVICE_SECRET` | with the URL | Shared bearer token between the account API and the service. Server only. |
| `TTS_SERVICE_TIMEOUT_MS` | No | Per-chunk budget, default 20000. |
| `GOOGLE_TTS_API_KEY` | No | Alternative server engine (Google Cloud Text-to-Speech). Server only. |
| `GOOGLE_TTS_VOICE_EN` / `_HI` | No | Neural2 voice overrides. |
| `SUPERTONIC_MODEL_DIR` / `_STYLE` / `_STEPS` / `_AUTO_FETCH` | No | Read by `voice-service/`, not by the website. |
| `OPENAI_API_KEY` | No | Enables realtime voice session minting. Server only. |
| `OPENAI_REALTIME_MODEL` / `_VOICE` | No | Defaults `gpt-realtime` / `coral`; allowlist in `server/realtime.mjs`. |

Put these in `.env` (never `.dev.vars`), and in the hosting provider's **server-side** secret store in
production. Do not prefix any of them with `VITE_`: Vite inlines `VITE_*` into the browser bundle.

The OpenAI project needs access to the Realtime API. The server calls
`POST https://api.openai.com/v1/realtime/client_secrets` with a `session` object that includes the
voice, semantic VAD for natural turn-taking, `gpt-4o-mini-transcribe` input transcription (so the
learner can read what was heard) and the teaching contract built by `realtimeInstructions()`.

Cost note: realtime sessions are billed by OpenAI per audio token. That is why the path is optional,
capped at 5 minutes, and limited to **6 sessions per 10 minutes per account + address**. No other
feature depends on it.

## API routes and security

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /api/voice/status` | Public | `{ configured, engine, engineLabel, ready, langs, reason }`. Never names a URL, a key or a token. |
| `POST /api/voice/tts` | Same-origin + rate limit | `{ text, lang, rate }` → audio. 480-character cap server-side. `X-Voice-Engine` says who spoke. |
| `GET /api/voice/realtime/status` | Public | `{ configured, enabled }`; never names the key. |
| `POST /api/voice/realtime/session` | Signed-in, same-origin, rate-limited | Body `{ lang: 'en-IN' \| 'hi-IN' }`; returns only `clientSecret`, `expiresAt`, `model`, `voice`, `maxSessionSeconds`. |

- Identity comes from a Supabase-verified bearer token; the route never trusts a body/query user id.
- Foreign `Origin` headers are rejected (403); a request with no `Origin` is not treated as a browser.
- Unsupported languages and oversized text are rejected before any provider is called (400).
- Provider failures map to 429 (rate limit), 502 (unavailable) or 503 (not configured), with copy that
  names the browser-voice fallback.
- The `voice-service/` shared secret is read from the server environment, sent only to the inference
  service, and never serialized into a response, an error message or the client bundle. The service
  itself binds a bearer check (constant-time), rejects bodies over 8 kB and refuses to start without a
  secret.

## Local development and deployment

```bash
npm install
npm run dev          # Vite on http://localhost:5173
npm run dev:api      # account API on http://localhost:8787 (Vite proxies /api)
```

1. Copy `.env.example` to `.env` and fill Supabase credentials; add the voice variables only if you
   want the hosted AI voice.
2. Sign in — realtime session creation requires an account. The browser voice path works signed-out
   anywhere the page is reachable.
3. For the AI voice locally: `npm run voice:model`, then run
   `TTS_SERVICE_SECRET=dev PORT=8080 node voice-service/server.mjs` and set
   `TTS_SERVICE_URL=http://localhost:8080`, `TTS_SERVICE_SECRET=dev` for `npm run dev:api`.
4. Upload in production is `npm run build`; serve `dist/` and run the Node API beside it with the same
   `WEB_ORIGIN`, `API_PORT` and provider keys. The inference service is a separate container (the
   website host cannot run it). If the API is absent, the page detects that (`configured: false`) and
   stays on the browser voice.

## Tests

```bash
npm run typecheck
node --test scripts/tests/voice.test.mjs
node --test scripts/tests/voice-server.test.mjs
node --test scripts/tests/voice-service.test.mjs
node --test scripts/tests/supertonic.test.mjs
node --test scripts/tests/realtime-voice.test.mjs
npm test
```

The suites cover: engine selection and the fallback chain, the secret never leaving the server, status
shapes, validation before any provider call, the browser voice never being described as AI audio,
chunking and packing, one AudioContext with gapless scheduling, and realtime session config,
key non-disclosure and rate limiting. The model itself is verified by
`tools/supertonic-check.mjs` (real graphs, real WAVs) and by the `voice-service/` health check.

## Reference repositories

| Repository | License | What was taken |
| --- | --- | --- |
| [`openai/openai-realtime-console`](https://github.com/openai/openai-realtime-console) | MIT | The WebRTC offer/answer exchange with the Realtime API, the `oai-events` data channel, streaming assistant transcript handling and barge-in/interruption — re-implemented in `src/components/shared/useRealtimeVoice.ts` + `server/realtime.mjs`. Deliberately different: the browser never holds a permanent key, the teaching instructions are built server-side, and the session is hard-capped at 5 minutes. |
| [`karanjot-gaidu/ai-mock-interviewer`](https://github.com/karanjot-gaidu/ai-mock-interviewer) | MIT | Workflow design only, no source files: one question at a time, the app owning phase/evidence while the conversation stays free, follow-ups aimed at the candidate's actual answer, and a scorecard grounded in what was really done. Its stack does not fit BroCode's Vite app, so copying code would have duplicated frameworks. |
| [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) | OpenRAIL-M | The model checkpoint, its text-tag contract and voice presets. Inference wiring is ours; the model contract lives in `core/ai/supertonic.ts` and runs server-side. |

All were read at their pages and LICENSE files before use; none is vendored into this repo.

## Known limitations

- The AI voice needs `voice-service/` deployed (or a Google key). Without either, the browser voice
  speaks and the settings line says exactly that — the product is fully usable, just plainer.
- The service runs requests **sequentially** on CPU. One instance is enough for a class, not for
  thousands of simultaneous listeners; scale out rather than turning the queue into a race.
- Audio is synthesized per chunk, not streamed token-by-token. The first chunk starts early; the rest
  follows.
- The project brief names the curriculum that was generated at build time. It is regenerated when
  `content/` is rebuilt; a deployment that ships a stale `sections.json` describes that older course.
- Speech recognition quality depends on the browser and the microphone; the app never records or
  uploads raw audio itself.
- The realtime path needs WebRTC, a signed-in account and a funded OpenAI project.
- Interview scoring is a deterministic keyword/structure estimate, not a language model. It cannot
  judge architectural taste, and it says so in the report disclaimer.
- JavaScript, C and C++ interview banks are not bundled; the UI lists them as unavailable rather than
  fabricating questions.
- The coach reads the bundled Python/JS runners' evidence; a language it cannot run gets an explanation
  only, never a claimed result.
