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

### Default: Supertonic 3 in the browser (ONNX Runtime Web)

The AI Mentor speaks with the real Supertonic 3 model running **in the visitor's browser**. There is
no inference service to host, no API key and no server env var: `https://mybrocode.vercel.app/` works
on a deployment with nothing configured, which is precisely what the previous server-backed design
could not do.

How it fits together:

| Piece | File | What it does |
| --- | --- | --- |
| Inference | `src/core/voice/engine.ts` | The four ONNX graphs in the SDK's order: duration predictor → text encoder → flow-matching loop over the vector estimator → vocoder. Runtime-agnostic (`Session` is a two-line interface). |
| Tokenizer | `src/core/voice/text.ts` | A faithful port of the SDK's `UnicodeProcessor`: NFKD, symbol table, `<lang>…</lang>` wrapper, `unicode_indexer.json` lookup, sentence chunking. |
| Voice styles | `src/core/voice/style.ts` | `voice_styles/<preset>.json` → `[1,50,256]` / `[1,8,16]` tensors, shape-checked so a bad file is an error rather than nonsense audio. |
| Weights | `src/core/voice/assets.ts` | Revision-pinned URLs, Cache Storage keyed by revision, progress from real bytes, retry on failure, `clearVoiceCache()`. |
| Worker | `src/workers/tts.worker.ts` | Owns ONNX Runtime Web, downloads the checkpoint, builds the sessions, synthesises. WebGPU preferred, WASM fallback. |
| Client | `src/core/voice/client.ts` | The page's only handle: status events + finished PCM. Parses worker messages, drops anything unrecognised. |

- **Model**: `Supertone/supertonic-3` pinned to revision `3cadd1ee6394adea1bd021217a0e650ede09a323`
  (OpenRAIL-M, `supertonic` SDK 1.3.1 semantics). Weights come from that revision's Hugging Face URLs —
  379 MB across `duration_predictor`, `text_encoder`, `vector_estimator` (244.7 MB) and `vocoder` —
  never from a branch, never from a CDN that could change under us.
- **Caching**: one Cache Storage bucket per revision, written only after a complete, length-verified
  body. A returning visitor downloads nothing; `Clear voice cache` in the settings row deletes that
  bucket and nothing else (no `localStorage`, no IndexedDB, no learner record).
- **Runtime**: `onnxruntime-web` 1.22 with its WASM files published to `public/ort/` by
  `scripts/ort-copy.mjs` at build time (a `prebuild`/`predev` hook), so nothing is fetched from a
  third-party CDN at runtime. WebGPU is used when the browser exposes an adapter; WASM otherwise.
- **Cost**: the first Speak press costs the download; every later one is local inference. There is no
  per-character billing, no rate limit and no cold start beyond the browser itself.

**Measured on the pinned checkpoint** (ONNX Runtime Web's WASM build, one thread, 8 steps, preset `F1`,
44.1 kHz) — the same code path the worker runs:

| Case | Predicted | Audio | Synthesis |
| --- | --- | --- | --- |
| Hindi, 3 sentences | 10.044 s | 10.101 s | 16.0 s |
| English, 2 sentences | 7.782 s | 7.802 s | 11.6 s |
| Hindi, 1 sentence | 5.139 s | 5.155 s | 8.2 s |
| English, 1 sentence | 3.601 s | 3.622 s | 6.4 s |

The duration predictor is deterministic, which is what makes these a correctness check: the browser
engine's predicted durations match the official Python SDK's for the same text (5.4 s ÷ 1.05 speed =
5.14 s, 3.78 ÷ 1.05 = 3.60 s). A drifting tokenizer would move them immediately.

**Honest limits.** WASM synthesis runs at roughly 1.5× real time on one thread, so the first sentence
of a long answer is heard a few seconds after the press; WebGPU is materially faster where it exists.
The checkpoint is 379 MB, which is real bandwidth on a mobile connection — the panel reports the
percentage rather than hiding it, and the cache means it is paid once per browser. A device that cannot
hold the sessions reports the engine's error code instead of pretending to speak.

### Legacy: the server voice (kept, unused by the client)

`services/supertonic-tts/`, `api/voice/*` and `server/voice*.mjs` still exist and still pass their own
tests — they are a working server-side implementation of the same contract, kept because deleting a
tested subsystem is a separate decision. The page no longer calls them: `useVoiceTutor` asks the worker,
and `scripts/tests/supertonic-voice.test.mjs` fails if the hook ever fetches `/api/voice/*` again.

### Default: the server voice (no download, no model in the browser)

The tutor's voice is **Supertonic 3** (`Supertone/supertonic-3`), a 99M-parameter ONNX TTS model that
runs on the **server**, in `services/supertonic-tts/` (see its README for deploy steps). The browser
sends text and receives audio:

```
browser ──POST /api/voice/tts──▶ Vercel function ──▶ services/supertonic-tts (CPU) ──▶ audio/wav
        ◀──────────────────────── audio ──────────┘
```

Nothing model-shaped is shipped to, cached by, or executed in the browser. The browser receives only
the audio for the sentence it is about to hear. The 398 MB checkpoint lives on the inference server
(`services/supertonic-tts/`, Python) and is cached on that host's persistent disk; a static deployment
reaches it through the Vercel functions in `api/voice/`. Without a configured backend the AI flow
**says so and stays silent** — it never substitutes a robotic voice and never starts a model download.

| | |
| --- | --- |
| Model | `Supertone/supertonic-3`, pinned to revision `724fb5a…` (never `main`) |
| Graphs | `duration_predictor` · `text_encoder` · `vector_estimator` (×8 denoising steps) · `vocoder` |
| Runtime | Python `supertonic==1.3.1` (`supertonic[serve]`), ONNX Runtime CPU |
| Output | 44.1 kHz mono 16-bit WAV |
| Voice preset | `F1` (`F1–F5` female / `M1–M5` male), `SUPERTONIC_STYLE` or per request as `voice` |
| Code | `services/supertonic-tts/app.py` (HTTP, auth, readiness), `api/voice/*` (Vercel proxy), `server/voice-engine.mjs` (engine selection) |

**Language policy.** The model takes a language tag per chunk (`<hi>…</hi>` / `<en>…</en>`).
BroCode's `hi-IN` setting means "Hindi voice, Hinglish explanations", and Hinglish is usually Roman
script — tagging Roman text `hi` asks the model to read Latin letters as Hindi. So the tag follows the
script on the page: Devanagari → `hi`, everything else → `en`. The setting still decides whether a
Hindi answer is *spoken* in Hindi; it never rewrites the answer. `speechLangFor()` in
`src/core/ai/voice.ts` applies this rule per chunk before the request, and the Python service maps the
UI tags (`hi-IN`/`en-IN`) to the model's `hi`/`en` without changing the text.

**Time to first audio.** Every request produces one complete WAV; the client splits a long answer
into sentence-packed requests (`cloudChunks`, ≤460 characters each) and starts playback as soon as
the FIRST chunk decodes, while later chunks are still being generated. The service serializes
inference on CPU (ONNX sessions are not thread-safe), so concurrent learners wait in a bounded queue
rather than racing. There is no in-process audio cache: a repeated request re-runs inference. This is
chunk-level, not token-level streaming, and it is not described as streaming anywhere in the UI.

Measured against the real cached checkpoint on a Linux CPU container (8 steps, style `F1`,
44.1 kHz): Hindi 5.14 s of audio in 1.42 s, English 4.31 s in 1.22 s, and Roman Hinglish 3.39 s in
1.15 s. First boot downloads the 398 MB checkpoint once; later starts load it from
`SUPERTONIC_CACHE_DIR`. These are one-machine measurements, not a guarantee for every CPU.

**A failure is an error, not a downgrade.** `/api/voice/status` names the engine and whether it is
ready; "Server-powered" is printed only for `ready`, which the server only reports after its
inference service answered a health check. With the default `engine: 'ai'` preference the AI voice is
the ONLY source of speech: a missing service, an unreachable one, a rejected request or a chunk that
never arrived stops the answer, says why, and offers Retry — which re-probes the deployment and
re-issues the request. It is deliberately *not* finished by the browser's synthesiser. Swapping in a
robotic voice mid-answer is what made a broken deployment look healthy, and two engines in one
answer talk over each other. The browser voice still exists behind the learner's own explicit
`engine: 'browser'` choice in the voice settings.

### Voice presets — measured, not guessed

All ten documented presets were run through the real cached checkpoint (8 steps, 44.1 kHz) in both
languages; every one returned valid WAV audio, and the median fundamental frequency separates them
cleanly:

| Preset | Hindi F0 | English F0 | | Preset | Hindi F0 | English F0 |
| --- | --- | --- | --- | --- | --- | --- |
| **F1** | **184 Hz** | **186 Hz** | | M1 | 129 Hz | 128 Hz |
| F2 | 197 Hz | 174 Hz | | M2 | 98 Hz | 92 Hz |
| F3 | 170 Hz | 163 Hz | | M3 | 98 Hz | 97 Hz |
| F4 | 215 Hz | 189 Hz | | M4 | 120 Hz | 115 Hz |
| F5 | 168 Hz | 159 Hz | | M5 | 90 Hz | 85 Hz |

`F1` is the default because it is a female preset whose pitch is the most *consistent across the two
languages* (184/186 Hz — F4 swings 26 Hz between them), which is what keeps one tutor sounding like
one person whether it answers in Hindi or English. Naturalness is a listening judgement, not
something this repository can assert: change `SUPERTONIC_STYLE` (or send `voice` per request) to
compare presets by ear without touching code.

To verify the model for real on a development machine (downloads the pinned weights once, writes WAVs):

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r services/supertonic-tts/requirements-dev.txt
python -m pytest services/supertonic-tts/tests -q

TTS_SERVICE_SECRET=dev SUPERTONIC_CACHE_DIR="$PWD/.freebuff/supertonic3" \
  uvicorn app:app --app-dir services/supertonic-tts --host 127.0.0.1 --port 8000
```

The unit suite uses a fake engine, so it proves the HTTP/auth contract without a checkpoint. The
real WAV check is `npm run voice:check` against the running container (or the deployed service): it
posts Hindi and English text, verifies RIFF audio and checks the production status route.

### Engines and the fallback chain

| Engine | Selected when | Billable? |
| --- | --- | --- |
| `supertonic` | `TTS_SERVICE_URL` + `TTS_SERVICE_SECRET` point at a healthy `services/supertonic-tts/` | No (your container) |
| `google` | No service URL, or the service failed and `GOOGLE_TTS_API_KEY` exists | Yes, per character |
| `none` | Neither is configured | — nothing is spoken; the UI says so and offers Retry |

The response header `X-Voice-Engine` names the engine that produced the audio, so the UI's label is
evidence rather than an assumption. A configured-but-unreachable service is reported as unavailable —
never silently replaced by Google without that header changing.

### Opt-in: the browser speech loop

`src/components/shared/useVoiceTutor.ts` keeps `speechSynthesis` for the case where the learner
chooses it explicitly (`engine: 'browser'`). It is never reached from the default AI preference, and
when it is used it is labelled as the built-in browser voice — never described as AI audio. Chrome's
speech recognition is itself a browser service — the settings note says so rather than claiming every
path is local. Text input always works, and every answer is readable, so a deployment with no voice
is a quiet tutoring session rather than a broken page.

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
| `TTS_SERVICE_URL` | No | Base URL of `services/supertonic-tts/` (Supertonic 3 on CPU). Preferred voice. |
| `TTS_SERVICE_SECRET` | with the URL | Shared bearer token between the account API and the service. Server only. |
| `SUPERTONIC_TTS_BASE_URL` / `SUPERTONIC_TTS_API_KEY` | No | Accepted **aliases** of the pair above, for hosting guides that use those names. The `TTS_SERVICE_*` spelling wins when both are set, so a half-migrated deployment never calls two services. |
| `TTS_SERVICE_TIMEOUT_MS` | No | Per-chunk budget, default 20000. |
| `GOOGLE_TTS_API_KEY` | No | Alternative server engine (Google Cloud Text-to-Speech). Server only. |
| `GOOGLE_TTS_VOICE_EN` / `_HI` | No | Neural2 voice overrides. |
| `SUPERTONIC_CACHE_DIR` / `_MODEL_REVISION` / `_STYLE` / `_STEPS` | No | Read by `services/supertonic-tts/`, not by the website. |
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
| `GET /api/voice/health` | Public | Operator diagnostics: `code`, `engine`, `ready`, `verified`, whether each variable is `set`/`missing` (names only) and the next step. 200 only when the engine really answered, so it works as an uptime check. |

### Voice health dashboard (`/voice-health`)

A signed-in operator page that answers "is the voice working right now?" without reading logs. It
shows two halves and never blends them:

- **Deployment** — the live `/api/voice/health` answer: engine, `VOICE_*` code, whether the engine
  *really* answered, the variables present (names only), the probe's round-trip time, and the
  server's `requestId` to quote in the function logs.
- **This browser** — which engine actually spoke for every answer read aloud here, time to first
  audio (p50/p95 over the last 40 requests), the browser-fallback share, and failure counts by code
  (`tts-503`, `tts-not-audio`, …). Counted after real playback in `useVoiceTutor`'s `finish()` and
  stored per device (`aiml:voice:telemetry`), cleared by the page's Clear button.

There is deliberately **no site-wide total**: each Vercel function keeps its own memory, so a
server-side counter would be a number that looks authoritative and means nothing. A real aggregate
needs a store (D1/Redis) — `core/platform/voice-telemetry.ts` is the pure aggregation, ready to be
posted there when one exists. The page prints `—`, not `0%`, when nothing has been spoken yet.
| `POST /api/voice/tts` | Same-origin + rate limit | `{ text, lang, rate }` → audio. 480-character cap server-side. `X-Voice-Engine` says who spoke. |
| `GET /api/voice/realtime/status` | Public | `{ configured, enabled }`; never names the key. |
| `POST /api/voice/realtime/session` | Signed-in, same-origin, rate-limited | Body `{ lang: 'en-IN' \| 'hi-IN' }`; returns only `clientSecret`, `expiresAt`, `model`, `voice`, `maxSessionSeconds`. |

- Identity comes from a Supabase-verified bearer token; the route never trusts a body/query user id.
- Foreign `Origin` headers are rejected (403); a request with no `Origin` is not treated as a browser.
- Unsupported languages and oversized text are rejected before any provider is called (400).
- Provider failures map to 429 (rate limit), 502 (unavailable) or 503 (not configured), with copy that
  states that nothing was spoken — no response promises a substitute engine.
- The inference service's shared secret is read from the server environment, sent only to
  `services/supertonic-tts/`, and never serialized into a response, an error message or the client
  bundle. The service binds a constant-time bearer check and serves 503 rather than synthesizing
  without a configured secret.

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
3. For the AI voice locally: install the Python service (`services/supertonic-tts/README.md`) and run
   `TTS_SERVICE_SECRET=dev SUPERTONIC_CACHE_DIR="$PWD/.freebuff/supertonic3" uvicorn app:app --app-dir services/supertonic-tts --port 8000`.
   Set `TTS_SERVICE_URL=http://localhost:8000` and `TTS_SERVICE_SECRET=dev` for `npm run dev:api` or
   the Vercel project. The first boot downloads the checkpoint once; `/healthz` is 503 until ready.
4. Upload in production is `npm run build`; serve `dist/` and run the Node API beside it with the same
   `WEB_ORIGIN`, `API_PORT` and provider keys. A PaaS host that injects `PORT` is honoured too; `API_PORT`
   still wins when both are set.

### Render: both long-running services in one blueprint

`render.yaml` declares BOTH services, so one **Blueprints → New Blueprint Instance → Apply** creates
the pair:

| Service | Runtime | What it is |
| --- | --- | --- |
| `brocode-voice` | Docker (`services/supertonic-tts/Dockerfile`) | Supertonic 3 on CPU, checkpoint cached on a 10 GB disk at `/models` |
| `brocode-account` | Node (`node server/index.mjs`) | The account API the site calls for sign-in verification and progress history |

The blueprint wires them itself: `brocode-account` reads `TTS_SERVICE_URL` from `brocode-voice`'s
`RENDER_EXTERNAL_URL` and takes the SAME generated `TTS_SERVICE_SECRET`, so the shared token is typed
nowhere. The only values Render asks for at Apply time are `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` (`sync: false`); `DATABASE_URL` stays optional and
`npm run db:deploy` is still the only thing that migrates production data.

Then, in the **Vercel** project (Production), set the pair the functions need — the same two values:

```
TTS_SERVICE_URL=https://brocode-voice.onrender.com     # the Render service URL, no trailing slash
TTS_SERVICE_SECRET=<the secret Render generated>       # copy from brocode-voice → Environment
```

Redeploy the Vercel project (a push does it) and gate the result with the operator check, which prints
nothing secret and exits non-zero until BOTH halves are live:

```bash
TTS_SERVICE_URL=https://brocode-voice.onrender.com TTS_SERVICE_SECRET=... npm run voice:check
```

`https://mybrocode.vercel.app/api/voice/status` must answer
`{"configured":true,"engine":"supertonic","ready":true,…}`. While it answers `engine: "none"` the
deployment has no server voice and the settings row says `built-in browser voice` — the site is not
broken, it is simply speaking with the browser, and no model weight is downloaded to say so.

### Vercel: the two voice routes as functions

The Vercel deployment does not need the account API host for voice. `api/voice/status.js` and
`api/voice/tts.js` are Vercel Functions that reuse the SAME engine selection as `server/`
(`server/vercel-voice.mjs` → `server/voice-engine.mjs`):

| Variable | Effect on Vercel |
| --- | --- |
| `TTS_SERVICE_URL` + `TTS_SERVICE_SECRET` | Functions proxy to `services/supertonic-tts/`; Supertonic speaks |
| `GOOGLE_TTS_API_KEY` (only) | Functions call Google directly; no extra host at all |
| neither | Status answers `engine: none`; the built-in browser voice reads answers |

**The checkpoint still cannot run inside a function.** 398 MB of weights plus the native runtime is
far past a serverless bundle, and a cold start that downloads the model would time out. `services/supertonic-tts/`
remains a container with a volume; Google is the zero-infrastructure alternative. Both routes are
same-origin only, rate-limited per client (best-effort per warm instance), validate text/language
before spending anything, return `X-Voice-Engine` with the audio, and map failures to 400/429/502/503
without leaking a URL, a key or an upstream body. `vercel.json` raises the TTS function's
`maxDuration` to 60 s for a cold inference service. `scripts/tests/vercel-voice.test.mjs` pins the
contract; the routes are live at `https://<site>/api/voice/status` and `/api/voice/tts`.

## Tests

```bash
npm run typecheck
node --test scripts/tests/voice.test.mjs
node --test scripts/tests/voice-server.test.mjs
node --test scripts/tests/voice-service.test.mjs
node --test scripts/tests/supertonic-backend.test.mjs
node --test scripts/tests/realtime-voice.test.mjs
python -m pytest services/supertonic-tts/tests -q
npm test
```

### Why the AI voice says "unavailable on this deployment"

The one cause is configuration, never the client: `GET /api/voice/status` answers `engine: "none"`
when the deployment has neither `TTS_SERVICE_URL` + `TTS_SERVICE_SECRET` nor `GOOGLE_TTS_API_KEY`.
Diagnose it with the health route instead of guessing:

```bash
curl -s https://mybrocode.vercel.app/api/voice/health
# 503 {"code":"VOICE_NOT_CONFIGURED","engine":"none",
#      "env":{"TTS_SERVICE_URL":"missing","TTS_SERVICE_SECRET":"missing","GOOGLE_TTS_API_KEY":"missing"},
#      "hints":["Set GOOGLE_TTS_API_KEY … or TTS_SERVICE_URL + TTS_SERVICE_SECRET …", …]}
```

| `code` | Meaning | What fixes it |
| --- | --- | --- |
| `VOICE_READY` | The engine answered (200) | — |
| `VOICE_NOT_CONFIGURED` | No provider set on this deployment | set one variable pair, then REDEPLOY |
| `VOICE_PROVIDER_UNAVAILABLE` | The service URL is set but unreachable / still loading | start it, or check its `/healthz` |
| `VOICE_TIMEOUT` | The health probe or a synthesis ran past its budget | scale the service, or retry (transient) |
| `VOICE_AUTH_FAILED` | The service is up and refused our shared secret | make `TTS_SERVICE_SECRET` identical on both sides |
| `VOICE_RATE_LIMITED` | Per-client limit, or the provider's | retry after the window |
| `VOICE_INVALID_AUDIO` | The engine returned no playable bytes | check the service, retry once |
| `VOICE_INVALID_REQUEST` / `VOICE_FORBIDDEN` | Bad text/language, or a foreign `Origin` | client bug — never retried by the UI |

A key present is not a working voice: with only `GOOGLE_TTS_API_KEY`, the report says `verified: false`
and the first spoken answer is what proves the key, because the check never spends a character.
`TTS_SERVICE_URL` with a missing secret reports `VOICE_NOT_CONFIGURED`, not “busy” — retrying cannot
fix a missing token.

The suites cover: engine selection and the fallback chain, the secret never leaving the server, status
shapes, validation before any provider call, the browser voice never being described as AI audio,
chunking and packing, one AudioContext with gapless scheduling, and realtime session config,
key non-disclosure and rate limiting. The model itself is verified by the Python service's pytest
suite (fake engine contract) and by `npm run voice:check` (real WAVs from the deployed service).

## Reference repositories

| Repository | License | What was taken |
| --- | --- | --- |
| [`openai/openai-realtime-console`](https://github.com/openai/openai-realtime-console) | MIT | The WebRTC offer/answer exchange with the Realtime API, the `oai-events` data channel, streaming assistant transcript handling and barge-in/interruption — re-implemented in `src/components/shared/useRealtimeVoice.ts` + `server/realtime.mjs`. Deliberately different: the browser never holds a permanent key, the teaching instructions are built server-side, and the session is hard-capped at 5 minutes. |
| [`karanjot-gaidu/ai-mock-interviewer`](https://github.com/karanjot-gaidu/ai-mock-interviewer) | MIT | Workflow design only, no source files: one question at a time, the app owning phase/evidence while the conversation stays free, follow-ups aimed at the candidate's actual answer, and a scorecard grounded in what was really done. Its stack does not fit BroCode's Vite app, so copying code would have duplicated frameworks. |
| [`Supertone/supertonic-3`](https://huggingface.co/Supertone/supertonic-3) | OpenRAIL-M | The model checkpoint, its text-tag contract and voice presets. Inference runs through the official `supertonic` Python SDK in `services/supertonic-tts/app.py`. |

All were read at their pages and LICENSE files before use; none is vendored into this repo.

## Known limitations

- The AI voice needs `services/supertonic-tts/` deployed (or a Google key). Without either, the browser voice
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
