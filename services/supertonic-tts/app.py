"""BroCode's server-side Supertonic 3 voice.

The website never downloads the checkpoint. This service downloads it once into
`SUPERTONIC_CACHE_DIR`, loads it once per process, and exposes the routes the deployment's serverless
proxy calls:

    GET  /health      always-on diagnostics (phase, model, voices, uptime)
    GET  /healthz     readiness: 503 until the model is loaded and a warm-up synth succeeded
    GET  /ready       alias of /healthz
    GET  /v1/voices   exactly the two offered voices (female F1, male M1) and two languages (en, hi)
    POST /v1/tts      { text, lang, rate, voice? } -> audio/wav

The decisions live in `brocode_voice/` so they can be unit-tested without a 400 MB model:
`voice_registry` (the only approved voices/languages), `schemas` (request validation), `security` (the
shared bearer secret), `middleware` (CORS allowlist, body cap, rate limit), `engine` (one load, one
synthesis at a time, WAV bytes) and `config` (every tunable).

Model and cache:
  - `SUPERTONIC_MODEL` default `supertonic-3`; the package pins the checkpoint revision, and
    `SUPERTONIC_MODEL_REVISION` is an explicit override for an operator.
  - `SUPERTONIC_CACHE_DIR` is where the weights and `voice_styles/` live. On Render this is
    `/models/supertonic3` on the mounted disk, so a redeploy or restart reuses them.
  - `TTS_SERVICE_SECRET` is required for `/v1/tts`; without it the endpoint refuses (503) rather than
    serving unauthenticated synthesis.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Callable, Optional

from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse

from brocode_voice.config import SETTINGS
from brocode_voice.engine import EngineState
from brocode_voice.middleware import install as install_middleware
from brocode_voice.schemas import TTSBody
from brocode_voice.security import authorize_factory
from brocode_voice.voice_registry import VOICE_IDS, voices_payload

LOGGER = logging.getLogger("brocode.supertonic")


def create_app(
    loader: Optional[Callable[[], object]] = None,
    secret: Optional[str] = None,
) -> FastAPI:
    """Build the app. `loader`/`secret` are injection points for tests, not production config."""
    state = EngineState(secret=SETTINGS.secret if secret is None else secret)
    authorize = authorize_factory(state.secret)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if not state.secret:
            LOGGER.error("TTS_SERVICE_SECRET is not set; /v1/tts will refuse every request.")
        await state.initialize(loader)
        yield
        state.phase = "stopped"
        state.tts = None

    app = FastAPI(title="BroCode Supertonic voice", version="2.0.0", lifespan=lifespan)
    install_middleware(
        app,
        allowed_origins=SETTINGS.allowed_origins,
        max_body_bytes=SETTINGS.max_body_bytes,
        limit=SETTINGS.requests_per_window,
        window_seconds=SETTINGS.window_seconds,
    )

    @app.get("/health")
    def health() -> dict:
        # Always 200: a platform probe can read the phase without treating "loading" as a dead
        # process. Readiness lives on /healthz and /ready.
        body = state.public()
        body["ok"] = True
        return body

    @app.get("/healthz")
    @app.get("/ready")
    def ready() -> JSONResponse:
        body = state.public()
        return JSONResponse(status_code=200 if state.phase == "ready" else 503, content=body)

    @app.get("/v1/voices")
    def voices() -> dict:
        """Only what is real: the two approved voices and the two supported languages."""
        payload = voices_payload()
        # A checkpoint missing an approved style cannot speak it, so its row is not advertised.
        available = set(state.available_styles()) or set(VOICE_IDS)
        payload["voices"] = [voice for voice in payload["voices"] if voice["id"] in available]
        payload["ready"] = state.phase == "ready"
        return payload

    @app.post("/v1/tts")
    def synthesize(body: TTSBody, _: None = Depends(authorize)) -> Response:
        if state.phase != "ready" or state.tts is None or state.style is None:
            raise HTTPException(status_code=503, detail="The voice model is not ready yet.")
        lang = body.language
        if lang is None:
            raise HTTPException(status_code=400, detail="Supported languages: en, hi.")
        voice = body.voice_id
        if voice is None:
            raise HTTPException(status_code=400, detail="Supported voices: F1 (female), M1 (male).")
        text = body.text.strip()
        if not text or len(text) > SETTINGS.max_chars:
            raise HTTPException(status_code=400, detail=f"Text must be 1–{SETTINGS.max_chars} characters.")
        try:
            audio, seconds, sample_rate = state.synthesize(
                text=text, lang=lang, voice=voice, rate=body.rate
            )
        except TimeoutError:
            raise HTTPException(status_code=503, detail="The voice is busy. Try again in a moment.")
        except ValueError:
            raise HTTPException(status_code=500, detail="The voice returned no audio.")
        except Exception:  # noqa: BLE001 - never leak a path or a stack trace to a caller
            LOGGER.exception("Supertonic synthesis failed.")
            raise HTTPException(status_code=500, detail="The voice could not generate audio.")

        LOGGER.info(
            "synth lang=%s voice=%s chars=%s audio=%.2fs bytes=%s",
            lang, voice, len(text), seconds, len(audio),
        )
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={
                "X-Voice-Engine": "supertonic",
                "X-Voice": voice,
                "X-Sample-Rate": str(sample_rate),
                "X-Audio-Duration": f"{seconds:.3f}",
                "X-Supertonic-Version": "1.3.1",
                "Cache-Control": "no-store",
            },
        )

    return app


app = create_app()
