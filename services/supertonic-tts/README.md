# Supertonic 3 voice service (Python)

Server-side TTS for BroCode. The browser sends text and receives WAV; it never downloads the
checkpoint. This service uses the **official** `supertonic` SDK (package `1.3.1`), whose model revision
is pinned to `724fb5abbf5502583fb520898d45929e62f02c0b` — the same checkpoint the browser build used
to download.

## Why this shape

- **CPU inference, no GPU.** 99M parameters, ONNX Runtime; one sentence is a couple of seconds.
- **One model per process.** `uvicorn --workers 1`; loading the checkpoint twice would double ~400 MB
  of memory for no throughput gain, because synthesis is serialized anyway.
- **One download, then disk.** `SUPERTONIC_CACHE_DIR` (default `~/.cache/supertonic3`) holds the
  weights and `voice_styles/`. On Render it is `/models/supertonic3` on a mounted disk, so restarts and
  redeploys do not re-download.
- **Vercel is the public edge.** `api/voice/status.js` and `api/voice/tts.js` proxy here using
  `TTS_SERVICE_URL`; this service binds `TTS_SERVICE_SECRET` and is not meant to be called directly by
  a browser.

## Endpoints

| Route | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz` · `/ready` | — | 200 only when the model is loaded; 503 while loading/failed |
| `GET /health` | — | always 200 with `phase`, `ready`, `error`, `sampleRate` |
| `POST /v1/tts` | `Authorization: Bearer $TTS_SERVICE_SECRET` | `{ text, lang, rate, voice? }` → `audio/wav` |

`lang` accepts `en`, `en-IN`, `hi`, `hi-IN`. `voice` defaults to `F1` (`M1–M5`, `F1–F5` are the
built-ins). `rate` is clamped to 0.5–2.0 by the schema. Text is validated to 1–1200 characters before
touching the model. Every response carries `X-Voice-Engine: supertonic` and `X-Sample-Rate`.

## Run locally

```bash
python -m venv .venv && . .venv/bin/activate
pip install -r services/supertonic-tts/requirements.txt
TTS_SERVICE_SECRET=dev \
SUPERTONIC_CACHE_DIR="$PWD/.freebuff/supertonic3" \
uvicorn app:app --app-dir services/supertonic-tts --host 127.0.0.1 --port 8000
```

First boot downloads ~400 MB into the cache (the console says it is loading). `GET /healthz` returns
503 until it is ready. Then:

```bash
curl -s http://127.0.0.1:8000/healthz
curl -s -X POST http://127.0.0.1:8000/v1/tts \
  -H "Authorization: Bearer dev" -H "Content-Type: application/json" \
  -d '{"text":"Welcome to BroCode. Let’s begin your AI engineering interview.","lang":"en-IN"}' \
  -o out.wav
```

Point the web app at it with `TTS_SERVICE_URL=http://127.0.0.1:8000` and
`TTS_SERVICE_SECRET=dev` (for `npm run dev:api`, or in the Vercel project environment).

## Tests

Unit tests use a fake engine (no model, no network):

```bash
pip install -r services/supertonic-tts/requirements-dev.txt
python -m pytest services/supertonic-tts/tests -q
```

## Deploy

`render.yaml` at the repository root deploys this Dockerfile with a 10 GB disk at `/models` and a
generated `TTS_SERVICE_SECRET`. Render → **New → Blueprint** → this repository → **Apply**. The free
plan sleeps and cannot attach a disk, so it would re-download the model on every cold start; the
Starter plan is the cheapest configuration that keeps the checkpoint. Then put the service URL and
secret into the Vercel project (`TTS_SERVICE_URL`, `TTS_SERVICE_SECRET`) and redeploy.

First boot is the slow one: 400 MB download + four sessions. `/healthz` stays 503 until it finishes;
Render's health check keeps the instance out of rotation until then.

## Limits

- One synthesis at a time; concurrent requests wait up to 30 s then get 503.
- No streaming; the Vercel function returns one complete WAV per sentence chunk.
- The free Render plan is not suitable for this workload (memory + no persistent disk).
- Model license: OpenRAIL-M. The weights are downloaded from the official Hugging Face repository at
  the pinned revision; they are not committed to this repository.
