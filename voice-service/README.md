# BroCode voice service — Supertonic 3, server-side

The tutor's AI voice, running **on a server**, not in the learner's browser. The website sends text to
the account API, the account API calls this service, and the learner receives audio. No visitor
downloads a model, a weight file or a WASM runtime — the only thing that crosses the network towards
the browser is the speech itself.

```
Browser (text) → POST /api/voice/tts → account API (server/app.mjs)
                                      → voice-service (this folder) → Supertonic 3 (ONNX, CPU) → WAV
```

## What it is

| | |
| --- | --- |
| Model | `Supertone/supertonic-3`, pinned to revision `724fb5ab…` (never `main`) |
| Graphs | `duration_predictor` · `text_encoder` · `vector_estimator` (8 denoising steps) · `vocoder` |
| Runtime | `onnxruntime-node` on the CPU execution provider |
| Output | 44.1 kHz mono, 16-bit WAV |
| Voice preset | `F1` by default (`F1–F5` female / `M1–M5` male), `SUPERTONIC_STYLE` |
| Languages | `hi-IN` (Devanagari → `hi` tag), `en-IN` (Latin script → `en` tag) |
| Weights | 398 MB, downloaded **once** into the volume, never into git or the frontend bundle |
| License | Model: OpenRAIL-M · reference implementation: MIT |

Measured on a 4-core container with the real graphs (8 steps, style `F1`): model warm-up 2.3 s once at
boot, then English 4.56 s of audio in 1.8 s, Hindi 5.14 s in 1.8 s, Hinglish 3.39 s in 1.3 s — roughly
2.5–3× realtime on CPU. The account API's own round trip added ~1.4 s end-to-end for the first request
in the same test. Treat these as a floor: a slower host is slower, and nothing here is streamed at
token level.

## Run it

```bash
# 1. Weights, once. The Docker image does this on first boot; locally, do it explicitly:
npm run voice:model                     # → models/supertonic-3
# (or point SUPERTONIC_MODEL_DIR=/models/supertonic-3 at a mounted volume)

# 2. The service
TTS_SERVICE_SECRET=change-me PORT=8080 node voice-service/server.mjs
```

The service refuses to start without `TTS_SERVICE_SECRET`. That is deliberate: an inference endpoint
that anyone who finds it can call is a denial-of-service waiting to happen.

```bash
curl -s localhost:8080/healthz
# {"ok":true,"ready":true,"engine":"supertonic","phase":"ready","sampleRate":44100,"steps":8,...}

curl -s -o out.wav -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $TTS_SERVICE_SECRET" -H 'Content-Type: application/json' \
  -d '{"text":"नमस्ते! आज हम Python सीखेंगे।","lang":"hi-IN","rate":1}' \
  localhost:8080/v1/tts
# 200 audio/wav
```

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `TTS_SERVICE_SECRET` | — (required) | Bearer token the account API must present |
| `PORT` | `8080` | Listen port |
| `SUPERTONIC_MODEL_DIR` | `models/supertonic-3` | Where the weights live (a volume in production) |
| `SUPERTONIC_STYLE` | `F1` | Voice preset |
| `SUPERTONIC_STEPS` | `8` | Denoising steps; fewer is faster and coarser |
| `SUPERTONIC_AUTO_FETCH` | `1` | Download missing weights at boot (`0` when the volume is prepared) |
| `TTS_MAX_CHARS` | `1200` | Per-request character cap |

On the **account API / web host** set:

| Variable | Meaning |
| --- | --- |
| `TTS_SERVICE_URL` | Base URL of this service, e.g. `https://brocode-voice.onrender.com` |
| `TTS_SERVICE_SECRET` | The same token |
| `TTS_SERVICE_TIMEOUT_MS` | Per-chunk budget, default `20000` |

`GOOGLE_TTS_API_KEY` is an alternative server engine (used only when `TTS_SERVICE_URL` is unset, or as
a logged fallback when the Supertonic service is unreachable). With neither configured the client says
so and uses its clearly labelled browser voice.

## Deploy

### Docker / any container host (recommended)

```bash
docker build -t brocode-voice -f voice-service/Dockerfile .
docker run -d --name brocode-voice -p 8080:8080 \
  -e TTS_SERVICE_SECRET=... -v brocode-voice-models:/models brocode-voice
```

* **Memory:** 2 GB is the honest floor (≈400 MB of weights plus ONNX Runtime arenas). 4 GB is
  comfortable.
* **CPU:** inference is CPU-bound and this service runs requests **one at a time** on purpose, so one
  instance handles roughly one spoken sentence every 1.5 s. Scale horizontally for more concurrency.
* **Disk:** 398 MB of weights on the volume. The image itself contains none.
* **Timeout:** the first boot downloads the weights (minutes on a slow link). The health check has a
  180 s start period for exactly that reason.

Render / Railway / Fly.io / a VPS all work the same way: build `voice-service/Dockerfile` from the
repository root, mount a persistent volume at `/models`, set `TTS_SERVICE_SECRET`, expose port 8080.

### Why not Vercel serverless

The website stays on Vercel. The **inference** does not: the model is 398 MB, resident, and takes
seconds per sentence — far outside a serverless function's bundle and duration limits. `voice-service/`
is a long-running container so the model is loaded once per process, not once per request.

### After deploying

1. `curl https://<voice-host>/healthz` → `"ready": true`.
2. Set `TTS_SERVICE_URL` and the same `TTS_SERVICE_SECRET` on the web/API deployment, redeploy it.
3. In the app: `GET /api/voice/status` must answer `{"configured":true,"engine":"supertonic",…}`.
   The settings line then reads **AI voice · Supertonic 3 · Hindi + English · Server-powered**.
4. Open the browser Network panel and confirm the page loads **no** `.onnx` file and no multi-hundred-MB
   request; only `/api/voice/tts` returning `audio/wav`.

## Cost

The model runs on your own container: no per-character TTS billing. The real costs are container
hosting (2–4 GB RAM, always-on), the one-time 398 MB download, and the bandwidth of the audio served
(≈20–90 kB per sentence depending on length). Audio is also cached in memory per process (30 clips),
and `/api/voice/tts` sets `Cache-Control: private, max-age=600` so a replayed line is cheap.

## Endpoints

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /healthz` | none (probe only) | `ready`, `phase`, sample rate, steps, style. No paths, no secrets. |
| `POST /v1/tts` | `Authorization: Bearer <secret>` | `{ text, lang, rate }` → `audio/wav`, `X-Voice-Engine`, `X-Sample-Rate`. 400 on bad input, 401 unauthorised, 503 while loading. |

Validation (text present, ≤ `TTS_MAX_CHARS`, `lang` in `en-IN`/`hi-IN`) happens before any tensor is
built. The service never logs lesson text.
