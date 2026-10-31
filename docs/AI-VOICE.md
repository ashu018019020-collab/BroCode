# The AI voice

The tutor speaks with a **female Indian voice generated on the server** and streamed to the browser
as MP3. Nothing is downloaded, no model runs in the tab, no GPU is involved and the key never leaves
the API process.

| Piece | Where | What it does |
| --- | --- | --- |
| `server/tts.mjs` | server | Azure AI Speech client: SSML, voice pair, validation, typed errors. The key lives only here. |
| `POST /api/voice/tts` | `server/app.mjs` | Same-origin, 30 requests/minute per address, 600 characters per request → `audio/mpeg`. |
| `GET /api/voice/status` | `server/app.mjs` | `{ configured, engine, langs, voices }`. Never the key. |
| `server/voice-handler.mjs` + `api/voice/*.js` | serverless | The same two routes as Vercel Functions, for the static deployment that has no long-running process. |
| `src/core/voice/tts.ts` | browser | The only client that talks to those routes; typed failures, never a silent fallback. |
| `src/components/shared/useVoiceTutor.ts` | browser | The queue: one `<audio>`, one chunk at a time, cancellation, pause/resume, replay. |
| `src/core/ai/voice.ts` | pure | `speakable()`, `speechChunks()`, `spokenReply()`, language resolution, device-voice ranking. |

## The voice

Two matched Indian female voices, so switching language changes the language and not the person:

| Language | Voice | Covers |
| --- | --- | --- |
| Hindi | `hi-IN-SwaraNeural` | Hindi and Hinglish (Roman Hindi is read the way it sounds) |
| English | `en-IN-NeerjaNeural` | English with Indian pronunciation of technical terms |

An operator may pin another female voice with `AZURE_SPEECH_VOICE_HI` / `AZURE_SPEECH_VOICE_EN`
without touching code; the server reports the id it will actually use in `/api/voice/status`, and the
mentor shows that name rather than a hardcoded one. A pin filed under the wrong language (an `en-IN`
id in the Hindi slot) is dropped before any request is made, so the matched default speaks instead of
the provider rejecting a billable call. The output format is 24 kHz MP3 at 96 kbps: the provider's own
sample rate at a bitrate that keeps consonants intact, which is where an Indian-English technical term
becomes unintelligible.

## Speaking an answer

1. `speakable()` strips code fences and markdown noise from the reply.
2. `speechChunks()` splits it into ≤180-character sentence pieces — small enough for the first sound
   to start quickly, large enough to keep a sentence's own intonation inside one request.
3. Each chunk is posted to `/api/voice/tts`; the next chunk is fetched while the current one plays.
4. One `<audio>` element plays them in order, so two answers can never overlap. `Stop` bumps a
   generation counter, pauses the element and revokes every blob URL; a late chunk cannot revive.
5. `Pause`/`Resume` pause the element itself, so the label matches the silence.

## When the server has no key

`POST /api/voice/tts` answers **503** with a sentence, and the mentor shows it. The tutor does **not**
quietly switch to a robot voice: the settings row offers **Use device voice** — the browser's own
`SpeechSynthesis`, ranked language-first with Google's voice preferred — and only the learner turns
it on. A browser without speech synthesis says so instead of pretending.

## What was removed

Supertonic 3 and its whole chain: `services/supertonic-tts/`, `server/voice-engine.mjs`,
`server/voice.mjs`, `server/vercel-voice.mjs`, `server/voice-diagnostics.mjs`, the old client stack
under `src/core/voice/`, `onnxruntime-web`, `public/ort`, the 380 MB first-run download, the
`/voice-health` operations page and the voice telemetry built to compare the two engines. The
`/api/voice/*` paths stay — they are this server's own routes now, and a page that still asks for an
ONNX graph gets nothing instead of a stale copy.

## Checking the real audio

Naming a voice proves nothing. Generate the acceptance sentences and listen:

```bash
AZURE_SPEECH_KEY=… AZURE_SPEECH_REGION=centralindia npm run voice:preview
# → artifacts/voice-preview/{hi-1,hi-2,en-1,en-2}.mp3 + manifest.json
```

And check the deployment the way a browser receives it — status, MP3 bytes for English, Roman-script
Hinglish and Hindi, plus the foreign-origin refusal:

```bash
npm run voice:check -- --public https://mybrocode.vercel.app
```

Set `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in the deployment's own environment (Vercel →
Settings → Environment Variables, or Render for the account API). They are server-only: never
`VITE_`-prefixed, never in the bundle. Without them the check prints `TTS_NOT_CONFIGURED`, which is
the honest answer — no model runs in the browser any more.
