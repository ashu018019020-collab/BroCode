# AI Mentor, Coding Coach & Spoken Interview

The AI section at **`/#/ai-mentor`** is one studio with four tabs. Everything except the optional
OpenAI Realtime voice works with **zero network**: answers come from the bundled curriculum, code
evidence comes from the existing Pyodide/JS runners, and interview scores come from deterministic
rubrics over the authored questions.

## Tabs and engines

| Tab | UI | Engine (pure, testable) | Evidence source |
| --- | --- | --- | --- |
| Voice Mentor | `src/features/ai/VoiceMentorPanel.tsx` | `src/core/ai/mentor.ts`, `src/core/ai/voice.ts` | Offline retrieval (`core/ai/assistant.ts`) over the generated curriculum |
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

### Default: browser speech loop (offline-friendly)

`src/components/shared/useVoiceTutor.ts` uses `SpeechRecognition` when the browser provides it and
`speechSynthesis` for output; optional Google Neural2 TTS (`GOOGLE_TTS_API_KEY`) upgrades the voice.
Chrome's speech recognition is itself a browser service — the settings note says so rather than
claiming the loop is fully offline. Text input always works, and every answer is readable.

#### Smooth playback (Google Neural2 path)

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
  was the stutter this replaced; there is no decoder re-init and no load gap.

`server/voice.mjs` sends multi-sentence text as **SSML** with a 220 ms `<break>` between authored
sentences (single sentences stay plain `text`), escapes XML metacharacters so a code sample can never
break the request, and asks for a FEMALE voice so the tutor sounds the same across deployments.
Pause/Stop call `AudioContext.suspend()`, which freezes the clock — already-scheduled sentences wait
instead of finishing under a "Paused" label. Without `GOOGLE_TTS_API_KEY` none of this runs and the
browser voice speaks, exactly as before.

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
- **Offline mentor (default).** `projectOverview()` in `src/core/ai/mentor.ts` answers platform
  questions ("what can I learn here?", "kitne sections hain", "syllabus batao") from the curriculum
  the page already loaded: the real count, one line per real section, and the real stage list. The
  spoken form names the count plus the first and last section, never 29 titles; the full list stays on
  screen. With no curriculum loaded it returns `null` and the normal retrieval answer runs instead.

No topic, number or route is generated: every one is read from a file that ships with the build.

## Provider setup

| Variable | Required | Purpose |
| --- | --- | --- |
| `OPENAI_API_KEY` | No | Enables realtime voice session minting. Server only. |
| `OPENAI_REALTIME_MODEL` | No | Defaults to `gpt-realtime`. |
| `OPENAI_REALTIME_VOICE` | No | Defaults to `coral`; allowlist lives in `server/realtime.mjs`. |
| `GOOGLE_TTS_API_KEY` | No | Better browser fallback voice (already documented in `.env.example`). |
| `GOOGLE_TTS_VOICE_EN` / `_HI` | No | Neural2 voice overrides. |

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
| `GET /api/voice/status` | Public | `{ configured: boolean }` for Google TTS. |
| `POST /api/voice/tts` | Same-origin + rate limit | Google TTS only; 480-character cap server-side. |
| `GET /api/voice/realtime/status` | Public | `{ configured: boolean }`; never names the key. |
| `POST /api/voice/realtime/session` | Signed-in, same-origin, rate-limited | Body `{ lang: 'en-IN' \| 'hi-IN' }`; returns only `clientSecret`, `expiresAt`, `model`, `voice`, `maxSessionSeconds`. |

- Identity comes from a Supabase-verified bearer token; the route never trusts a body/query user id.
- Foreign `Origin` headers are rejected (403); a request with no `Origin` is not treated as a browser.
- Unsupported languages are rejected before OpenAI is called (400).
- OpenAI failures map to 429 (rate limit), 502 (unavailable) or 503 (not configured), with copy that
  names the browser-voice fallback.
- The permanent key is never serialized into a response, an error message or the client bundle.

## Local development and deployment

```bash
npm install
npm run dev          # Vite on http://localhost:5173
npm run dev:api      # account API on http://localhost:8787 (Vite proxies /api)
```

1. Copy `.env.example` to `.env` and fill Supabase credentials; add `OPENAI_API_KEY` only if you want
   realtime voice.
2. Sign in — realtime session creation requires an account. The browser voice path works signed-out
   anywhere the page is reachable.
3. Upload in production is `npm run build`; serve `dist/` and run the Node API beside it with the same
   `WEB_ORIGIN`, `API_PORT` and provider keys. If the API is absent, the page detects that
   (`configured: false`) and stays on the browser voice.

## Tests

```bash
npm run typecheck
node --test scripts/tests/mentor.test.mjs
node --test scripts/tests/coding-coach.test.mjs
node --test scripts/tests/mock-interview.test.mjs
node --test scripts/tests/realtime-voice.test.mjs
npm test
```

The new suites cover: title/paragraph reshaping, bilingual intents, repetition, refusal instead of
invention; LCS diff line mapping, stale-patch refusal, real NameError/SyntaxError line attribution,
static-only findings, complexity disclaimers, hint ladders; seeded interview plans from real sections,
independent scoring dimensions, rubric-driven follow-ups, report consistency and history decoding;
and realtime session config, key non-disclosure, auth/origin/language/rate-limit behaviour on the HTTP
route.

## Reference repositories

| Repository | License | What was taken |
| --- | --- | --- |
| [`openai/openai-realtime-console`](https://github.com/openai/openai-realtime-console) | MIT | The WebRTC offer/answer exchange with the Realtime API, the `oai-events` data channel, streaming assistant transcript handling and barge-in/interruption — re-implemented in `src/components/shared/useRealtimeVoice.ts` + `server/realtime.mjs`. Deliberately different: the browser never holds a permanent key, the teaching instructions are built server-side, and the session is hard-capped at 5 minutes. |
| [`karanjot-gaidu/ai-mock-interviewer`](https://github.com/karanjot-gaidu/ai-mock-interviewer) | MIT | Workflow design only, no source files: one question at a time, the app owning phase/evidence while the conversation stays free, follow-ups aimed at the candidate's actual answer, and a scorecard grounded in what was really done (its "the model owns the conversation, the app owns the evidence" split). Its stack (Next.js + Vercel AI SDK + Judge0 + BYOK + Upstash) does not fit BroCode's Vite app and offline runners, so copying code would have duplicated frameworks. |

Both were read at their GitHub pages and LICENSE files before use; neither is vendored into this repo.

## Known limitations

- The gapless Neural2 player needs a funded `GOOGLE_TTS_API_KEY` on the API server to run at all;
  without one the browser voice speaks and the settings line says so. The unit tests cover the
  chunking, the SSML builder and the wiring, not real audio output.
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
