# BroCode Voice Tutor & Reengineering Audit

**Date:** 2026-11-10
**Scope:** student-facing site, AI Tutor, AI Voice Tutor, realtime voice deployment.
**Rule followed:** nothing below is reported as heard, seen or deployed unless a command or a live
response proved it. Browser audio, microphone capture and visual layout were **not** exercised in this
headless environment and are labelled accordingly.

---

## 1. Root cause of the voice failure

The voice engine was not the failing part: 107 existing voice tests passed before this pass. The
failures were in **deployment configuration and deployment surface**.

| # | Finding | Evidence | Effect |
|---|---------|----------|--------|
| 1 | Premium server TTS has no Azure key in production | `GET https://mybrocode.vercel.app/api/voice/status` → `200 {"configured":false,...}` | `/api/voice/tts` cannot synthesize; the learner hears the browser voice, not the premium Indian female voice |
| 2 | Realtime voice was never deployed to Vercel | `GET /api/voice/realtime/status` → `404`; the route existed only in `server/app.mjs` (the Render account server) | `useRealtimeVoice` treated 404 as "not configured", so the online voice upgrade was unreachable on the public site |
| 3 | OpenAI key absent from Vercel | same 404 + no `OPENAI_API_KEY` in the function environment | even with the route, no session could be minted |
| 4 | Browser TTS voices load asynchronously | `getVoices()` returns `[]` until `voiceschanged` in Chromium | the code already listens for `voiceschanged` and re-reads; not the failure here |
| 5 | Audio cannot be proven from a shell | no speaker, no microphone, no browser session | all "does it sound right?" claims are marked NOT TESTED |

### What was fixed in this pass

- Added `GET /api/voice/realtime/status` and `POST /api/voice/realtime/session` as Vercel Functions:
  - `server/realtime-handler.mjs` — same-origin check, Supabase token verification, explicit consent
    and language validation, six-sessions-per-ten-minutes budget keyed by account **and** address,
    boolean-only status, typed 401/403/429/503/502 errors.
  - `api/voice/realtime/status.js`, `api/voice/realtime/session.js` — thin wrappers.
  - `scripts/tests/realtime-functions.test.mjs` — 10 tests: key never echoed, status booleans, foreign
    origin 403, missing account 401, disabled/unconfigured 503, consent/language 400, budget 429,
    success shape, provider-rate-limit 429 and generic 502.
- The permanent `OPENAI_API_KEY` remains server-only; the browser receives only the short-lived
  `clientSecret`, `expiresAt`, `model`, `voice` and `maxSessionSeconds`.

### Still required to make premium audio work

Set these on the Vercel project (server-side, never `VITE_`-prefixed), then redeploy:

| Variable | Purpose |
|----------|---------|
| `AZURE_SPEECH_KEY` | premium TTS |
| `AZURE_SPEECH_REGION` | e.g. `centralindia` |
| `AZURE_SPEECH_VOICE_EN` (optional) | default `en-IN-NeerjaNeural` |
| `AZURE_SPEECH_VOICE_HI` (optional) | default `hi-IN-SwaraNeural` |
| `OPENAI_API_KEY` | online realtime voice sessions |
| `ONLINE_VOICE_ENABLED` (optional) | `false` disables paid realtime sessions |
| `APP_ORIGIN` | `https://mybrocode.vercel.app` (exact origin) |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | verify the signed-in learner for a session |

Without the Azure key the UI already falls back to the browser voice automatically
(`serverVoice === 'unavailable'` → `speakWithBrowser()`); without the OpenAI key the online path
stays hidden/off and the browser loop remains usable.

---

## 2. Voice paths, as implemented

### Text to speech

`AI reply → useVoiceTutor.speak() → sentence chunks →`

- server path when `/api/voice/status` says configured: one MP3 per sentence, sequential playback on
  one `<audio>`, next sentence prefetched, blob URLs revoked, generation guard stops stale audio;
- device path otherwise: `SpeechSynthesisUtterance` with the selected `en-IN`/`hi-IN` voice, rate and
  pitch, strong utterance refs, `voiceschanged` discovery, 600 ms stuck-engine retry;
- stop/cancel bumps a generation counter, clears the queue and cancels synthesis, so an old answer
  cannot speak over a new one.

### Speech to text

`Start Listening → SpeechRecognition (continuous where supported) → interim transcript → final
transcript → answer box → learner edits → Check Answer`.

- Stop commits the pending partial instead of discarding it.
- Permission denial, unsupported browsers and recognizer errors set a visible message.
- No audio is recorded to disk or uploaded by the browser hook.
- Barge-in stops tutor speech before the microphone opens.

### UI / theme

`AiVoiceRow`, `VoiceBar`, `VoiceControlCenter` and `useMentorVoice` already share the global theme
tokens and the device-voice fallback. **Not visually verified in this pass** (no browser), so
contrast, mobile layout and theme switching during an active session are NOT TESTED.

---

## 3. Status against the master brief

| Phase | Status | What was actually done / why |
|-------|--------|-----------------------------|
| 1. Full live + repo audit | **PARTIALLY COMPLETED** | Route inventory and live endpoint probes done; no authenticated browser crawl of dashboard/courses |
| 2. Design system redesign | **NOT TESTED** | No wholesale redesign attempted; existing tokens/components left intact to avoid breaking working pages |
| 3. Homepage + dashboard redesign | **NOT TESTED** | Unchanged; no visual or browser verification |
| 4. Course/lesson restructure | **COMPLETED (pre-existing)** | Java 20 modules and C course already live; no changes in this pass |
| 5. Advanced labs | **PARTIALLY COMPLETED (pre-existing)** | Existing lab/runner UI untouched; no new dataset or evaluation work |
| 6. Coding Studio / Notebook | **PARTIALLY COMPLETED (pre-existing)** | Existing multi-file notebook and sandboxed runners untouched |
| 7. Voice Tutor rebuild | **PARTIALLY COMPLETED** | Deployment gap fixed (realtime routes); engine already handled TTS/STT; premium audio BLOCKED on keys; browser audio NOT TESTED |
| 7.1 TTS repair | **PARTIALLY COMPLETED** | Existing engine reviewed, fallback verified by tests; no audio heard |
| 7.2 Female voice | **PARTIALLY COMPLETED** | `en-IN-NeerjaNeural`, `hi-IN-SwaraNeural`, realtime `coral` configured; provider unconfigured in production |
| 7.3 Playback manager | **COMPLETED (code)** | Single audio element, queue, prefetch, revoke, generation guard; unit-tested |
| 7.4 STT + microphone | **PARTIALLY COMPLETED** | Existing implementation reviewed; permission/error paths tested at unit level, not with a real mic |
| 7.5 Voice conversation flow | **PARTIALLY COMPLETED** | Implemented in the existing studio; full spoken loop NOT TESTED |
| 7.6 Voice UI redesign | **NOT TESTED** | Not redesigned in this pass |
| 7.7 Theme compatibility | **NOT TESTED** | No visual/theme switching test |
| 7.8 Voice settings | **PARTIALLY COMPLETED (pre-existing)** | Language, speed, voice, auto-speak exist; persistence unchanged |
| 7.9 Failure recovery | **COMPLETED (code)** | Visible messages for no voices, blocked mic, unsupported recognition, failed audio; never silent |
| 8. AI Tutor intelligence | **PARTIALLY COMPLETED (pre-existing)** | Context plumbing exists; no new model work |
| 9. Security | **PARTIALLY COMPLETED** | New realtime route: same-origin, Supabase-verified account, consent, budget, no key in response; no full penetration test |
| 10. Mobile/responsive | **NOT TESTED** | No browser/device session |
| 11. Automated tests | **COMPLETED for voice units** | 107 existing voice tests + 10 new handler tests pass; browser TTS/STT tests NOT TESTED |
| 12. Performance | **NOT TESTED** | No latency measurements made or claimed |
| 13. Deployment verification | **COMPLETED for the deployment surface** | Local typecheck/tests/build pass; live probes below confirm the new routes are published; premium audio still BLOCKED on keys |

---

## 4. Verification actually run

```
node --test scripts/tests/voice.test.mjs scripts/tests/mentor-voice.test.mjs \
  scripts/tests/voice-handler.test.mjs scripts/tests/interview-voice.test.mjs
→ 107 pass, 0 fail

node --test scripts/tests/realtime-functions.test.mjs \
  scripts/tests/realtime-voice.test.mjs scripts/tests/voice-handler.test.mjs
→ 36 pass, 0 fail

npm run typecheck
→ exit 0
```

### Live production verification after commit `37588c3`

Vercel published the commit while the probe retried; the route changed from 404 to 200 without any
other action.

```
GET  https://mybrocode.vercel.app/api/voice/realtime/status
→ 200 {"configured":false,"enabled":true}          (previously 404)

GET  https://mybrocode.vercel.app/api/voice/status
→ 200 {"configured":false,"engine":"azure",...}   (unchanged: no Azure key)

POST https://mybrocode.vercel.app/api/voice/realtime/session
     Origin: https://mybrocode.vercel.app, valid JSON, no account
→ 401 {"code":"AUTH_REQUIRED","message":"Sign in to continue."}   (previously 404)
```

The 401 is the correct signed-out result, not a failure: it proves the session route is deployed and
reaches account verification. A real session still returns 503 `REALTIME_UNCONFIGURED` until
`OPENAI_API_KEY` is set; that path is covered by unit tests, not by a live paid call.

Not run or not claimable:

- No real speaker/microphone: audio output and recognition accuracy are **NOT TESTED**.
- No authenticated browser: dashboard, studio, mobile and theme rendering are **NOT TESTED**.
- Production still reports the Azure voice as unconfigured until the key is set; that is a
  configuration fact, not a code defect.

---

## 5. Honest conclusion

The Voice Tutor can now answer on the public Vercel site through the online path **once
`OPENAI_API_KEY` is set**, and the status probe no longer 404s. The premium female voice remains
**BLOCKED** on `AZURE_SPEECH_KEY`/`AZURE_SPEECH_REGION`; until then the browser voice is the working
fallback. The wider visual reengineering, browser interaction tests and audio verification requested
in the master brief were not performed and are not claimed.
