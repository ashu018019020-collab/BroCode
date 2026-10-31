"""BroCode's server-side Supertonic 3 voice.

The website never downloads the checkpoint. This service downloads it once, caches it on the
persistent volume, loads it once per process, and exposes the two routes the Vercel functions and the
account API already speak:

    GET  /healthz   readiness (503 until the model is loaded)
    GET  /health    always-on diagnostics, never ready=false with a 200 on /healthz
    GET  /ready     alias of /healthz
    POST /v1/tts    { text, lang, rate, voice? } -> audio/wav

It is a thin application around the OFFICIAL SDK (`supertonic.TTS`, package 1.3.1): text
preprocessing, the four ONNX graphs, the denoising loop and the WAV encoder all come from the package.
The only things added here are the production edges: bearer auth, validation, one-at-a-time inference
(ONNX sessions are not thread-safe), a persistent cache location, and sanitized public errors.

Model and cache:
  - `SUPERTONIC_MODEL` default `supertonic-3`; the package pins revision
    `724fb5abbf5502583fb520898d45929e62f02c0b` (the same revision the app's Node engine uses).
    `SUPERTONIC_MODEL_REVISION` is an explicit override for an operator.
  - `SUPERTONIC_CACHE_DIR` is where the weights and `voice_styles/` live. On Render this is
    `/models/supertonic3` on the mounted disk, so a redeploy or restart reuses them.
  - `TTS_SERVICE_SECRET` is required for `/v1/tts`; without it the endpoint refuses (503) rather than
    serving unauthenticated synthesis.
"""
from __future__ import annotations

import asyncio
import hmac
import io
import logging
import os
import threading
import time
from contextlib import asynccontextmanager
from typing import Callable, Optional

import numpy as np
import soundfile as sf
from fastapi import Depends, FastAPI, HTTPException, Response
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

LOGGER = logging.getLogger("brocode.supertonic")

MODEL = os.getenv("SUPERTONIC_MODEL", "supertonic-3")
STYLE = os.getenv("SUPERTONIC_STYLE", "F1")
STEPS = max(1, min(12, int(os.getenv("SUPERTONIC_STEPS", "8"))))
MAX_CHARS = max(1, int(os.getenv("SUPERTONIC_MAX_CHARS", "1200")))
CACHE_DIR = os.getenv("SUPERTONIC_CACHE_DIR", "").strip()
SECRET = os.getenv("TTS_SERVICE_SECRET", "").strip()
MODEL_REVISION = os.getenv("SUPERTONIC_MODEL_REVISION", "").strip()

# The UI language tags and the model's ISO tags. Hinglish in Roman script is sent as `en` by the
# client (see docs/AI-VOICE.md); this service does not guess or rewrite the text.
LANG_MAP = {"en": "en", "en-in": "en", "hi": "hi", "hi-in": "hi"}


class TTSBody(BaseModel):
    text: str = Field(..., min_length=1, max_length=MAX_CHARS)
    lang: str = Field(default="en")
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    voice: Optional[str] = None


class State:
    def __init__(self, secret: str) -> None:
        self.secret = secret
        self.tts = None
        self.style = None
        self.phase = "starting"
        self.error: Optional[str] = None
        self.started_at = time.time()
        self.synth_lock = threading.Lock()
        self.styles: dict = {}


def _load_default() -> object:
    from supertonic import TTS  # imported lazily, so the unit suite needs no 400 MB model

    return TTS(model=MODEL)


def _public_state(state: State) -> dict:
    tts = state.tts
    return {
        "ok": state.phase == "ready",
        "ready": state.phase == "ready",
        "engine": "supertonic",
        "model": MODEL,
        "revision": MODEL_REVISION or "package-pinned",
        "phase": state.phase,
        "style": STYLE,
        "steps": STEPS,
        # The presets this checkpoint really ships. The web app narrows its selector to this list, so
        # a voice it does not have can never be offered (and a stale stored choice is corrected).
        "voices": list(getattr(tts, "voice_style_names", []) or []) if tts else [],
        "sampleRate": getattr(tts, "sample_rate", None) if tts else None,
        "cache": "disk" if CACHE_DIR else "default",
        "error": state.error,
        "uptimeSeconds": round(time.time() - state.started_at, 1),
    }


def create_app(
    loader: Optional[Callable[[], object]] = None,
    secret: Optional[str] = None,
) -> FastAPI:
    """Build the app. `loader`/`secret` are injection points for tests, not production config."""
    state = State(secret if secret is not None else SECRET)
    bearer = HTTPBearer(auto_error=False)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if not state.secret:
            LOGGER.error("TTS_SERVICE_SECRET is not set; /v1/tts will refuse every request.")
        state.phase = "loading"
        started = time.time()
        try:
            tts = await asyncio.to_thread(loader or _load_default)
            state.tts = tts
            names = list(getattr(tts, "voice_style_names", []) or [])
            if not names:
                raise RuntimeError("the model exposes no voice styles")
            chosen = STYLE if STYLE in names else names[0]
            state.style = await asyncio.to_thread(tts.get_voice_style, chosen)
            state.phase = "ready"
            LOGGER.info(
                "Supertonic ready: model=%s style=%s steps=%s sample_rate=%s cache=%s (%.1fs)",
                MODEL, chosen, STEPS, getattr(tts, "sample_rate", "?"),
                CACHE_DIR or "default", time.time() - started,
            )
        except Exception as cause:  # noqa: BLE001 - startup failure must be a reported state
            state.phase = "error"
            state.error = f"model load failed: {type(cause).__name__}"
            LOGGER.exception("Supertonic model failed to load.")
        yield
        state.phase = "stopped"
        state.tts = None

    app = FastAPI(title="BroCode Supertonic voice", version="1.0.0", lifespan=lifespan)

    def authorize(
        credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
    ) -> None:
        if not state.secret:
            raise HTTPException(status_code=503, detail="Voice service is not configured.")
        if credentials is None or not hmac.compare_digest(credentials.credentials, state.secret):
            raise HTTPException(status_code=401, detail="Unauthorized.")

    @app.get("/health")
    def health() -> dict:
        # Always 200: a platform probe can read the phase without treating "loading" as a dead
        # process. Readiness lives on /healthz and /ready.
        body = _public_state(state)
        body["ok"] = True
        return body

    @app.get("/v1/voices")
    def voices() -> dict:
        return {
            "engine": "supertonic",
            "model": MODEL,
            "default": STYLE,
            "voices": _public_state(state)["voices"],
        }

    @app.get("/healthz")
    @app.get("/ready")
    def ready() -> JSONResponse:
        body = _public_state(state)
        return JSONResponse(status_code=200 if state.phase == "ready" else 503, content=body)

    @app.post("/v1/tts")
    def synthesize(body: TTSBody, _: None = Depends(authorize)) -> Response:
        if state.phase != "ready" or state.tts is None or state.style is None:
            raise HTTPException(status_code=503, detail="The voice model is not ready yet.")
        key = body.lang.strip().lower().replace("_", "-")
        lang = LANG_MAP.get(key)
        if lang is None:
            raise HTTPException(status_code=400, detail="Supported languages: en-IN, hi-IN.")
        text = body.text.strip()
        if not text or len(text) > MAX_CHARS:
            raise HTTPException(status_code=400, detail=f"Text must be 1–{MAX_CHARS} characters.")
        voice = body.voice or STYLE
        if voice not in getattr(state.tts, "voice_style_names", []):
            raise HTTPException(status_code=400, detail="Unsupported voice preset.")
        try:
            style = state.styles.get(voice)
            if style is None:
                style = state.tts.get_voice_style(voice)
                state.styles[voice] = style
        except Exception:  # noqa: BLE001
            LOGGER.exception("Voice style failed to load.")
            raise HTTPException(status_code=500, detail="The voice could not be prepared.")

        if not state.synth_lock.acquire(timeout=30):
            raise HTTPException(status_code=503, detail="The voice is busy. Try again in a moment.")
        started = time.time()
        try:
            # ONNX Runtime sessions are not safe under concurrent calls; one at a time is the right
            # trade-off on CPU and keeps peak memory bounded.
            wav, duration = state.tts.synthesize(
                text=text,
                voice_style=style,
                lang=lang,
                speed=body.rate,
                total_steps=STEPS,
                verbose=False,
            )
        except Exception:  # noqa: BLE001
            LOGGER.exception("Supertonic synthesis failed.")
            raise HTTPException(status_code=500, detail="The voice could not generate audio.")
        finally:
            state.synth_lock.release()

        samples = np.asarray(wav).squeeze()
        if samples.size == 0:
            raise HTTPException(status_code=500, detail="The voice returned no audio.")
        buffer = io.BytesIO()
        sf.write(buffer, samples, state.tts.sample_rate, format="WAV", subtype="PCM_16")
        audio = buffer.getvalue()
        try:
            seconds = float(np.asarray(duration).reshape(-1)[0])
        except Exception:  # noqa: BLE001
            seconds = samples.size / float(state.tts.sample_rate)
        LOGGER.info(
            "synth lang=%s chars=%s audio=%.2fs in=%.2fs bytes=%s",
            lang, len(text), seconds, time.time() - started, len(audio),
        )
        return Response(
            content=audio,
            media_type="audio/wav",
            headers={
                "X-Voice-Engine": "supertonic",
                "X-Sample-Rate": str(state.tts.sample_rate),
                "X-Audio-Duration": f"{seconds:.3f}",
                "X-Supertonic-Version": "1.3.1",
                "Cache-Control": "no-store",
            },
        )

    return app


app = create_app()
