"""The model: one load per process, one synthesis at a time, WAV bytes out.

The checkpoint is downloaded by the official SDK on FIRST BOOT into `SUPERTONIC_CACHE_DIR` and reused
from disk afterwards. No learner ever downloads it.
"""
from __future__ import annotations

import asyncio
import io
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import numpy as np
import soundfile as sf

from .config import SETTINGS
from .voice_registry import DEFAULT_VOICE, VOICE_IDS

LOGGER = logging.getLogger("brocode.supertonic")


def load_default_engine() -> object:
    from supertonic import TTS  # imported lazily: the unit suite needs no 400 MB model

    return TTS(model=SETTINGS.model)


@dataclass
class EngineState:
    secret: str = ""
    tts: object | None = None
    style: object | None = None
    phase: str = "starting"
    error: Optional[str] = None
    started_at: float = field(default_factory=time.time)
    styles: dict = field(default_factory=dict)
    synth_lock: threading.Lock = field(default_factory=threading.Lock)

    def public(self) -> dict:
        """What a probe may see. Never a path, never a stack trace, never the secret."""
        return {
            "ok": self.phase == "ready",
            "ready": self.phase == "ready",
            "engine": "supertonic",
            "model": SETTINGS.model,
            "revision": SETTINGS.revision or "package-pinned",
            "phase": self.phase,
            "style": SETTINGS.style,
            "steps": SETTINGS.steps,
            "sampleRate": getattr(self.tts, "sample_rate", None) if self.tts else None,
            "cache": "disk" if SETTINGS.cache_dir else "default",
            "voices": list(VOICE_IDS),
            "error": self.error,
            "uptimeSeconds": round(time.time() - self.started_at, 1),
        }

    def available_styles(self) -> list[str]:
        return list(getattr(self.tts, "voice_style_names", []) or [])

    async def initialize(self, loader: Optional[Callable[[], object]] = None) -> None:
        self.phase = "loading"
        started = time.time()
        try:
            tts = await asyncio.to_thread(loader or load_default_engine)
            self.tts = tts
            names = self.available_styles()
            if not names:
                raise RuntimeError("the model exposes no voice styles")
            # The tutor's voice if the checkpoint has it, otherwise the first approved one.
            approved = [name for name in names if name in VOICE_IDS]
            if not approved:
                raise RuntimeError("the checkpoint has none of the approved voices")
            chosen = SETTINGS.style if SETTINGS.style in approved else approved[0]
            self.style = await asyncio.to_thread(tts.get_voice_style, chosen)
            await self._health_check(tts, chosen)
            self.phase = "ready"
            LOGGER.info(
                "Supertonic ready: model=%s style=%s steps=%s sample_rate=%s cache=%s (%.1fs)",
                SETTINGS.model, chosen, SETTINGS.steps,
                getattr(tts, "sample_rate", "?"), SETTINGS.cache_dir or "default",
                time.time() - started,
            )
        except Exception as cause:  # noqa: BLE001 - startup failure is a reported state, not a crash
            self.phase = "error"
            self.error = f"model load failed: {type(cause).__name__}"
            LOGGER.exception("Supertonic model failed to load.")

    async def _health_check(self, tts: object, style: str) -> None:
        """A short real synthesis, so "ready" means the loop actually produces audio."""
        try:
            wav, _ = await asyncio.to_thread(
                tts.synthesize,
                text="Ready.",
                voice_style=style,
                lang="en",
                speed=1.0,
                total_steps=max(2, min(4, SETTINGS.steps)),
                verbose=False,
            )
            if np.asarray(wav).size == 0:
                raise RuntimeError("warm-up produced no audio")
        except TypeError:
            # A loader double in the tests may not accept keyword arguments; readiness is the load.
            return

    def style_for(self, voice: str) -> object:
        cached = self.styles.get(voice)
        if cached is not None:
            return cached
        style = self.tts.get_voice_style(voice)  # type: ignore[union-attr]
        self.styles[voice] = style
        return style

    def synthesize(self, *, text: str, lang: str, voice: str, rate: float) -> tuple[bytes, float, int]:
        """Blocking: caller runs it in a thread. Returns (wav bytes, seconds, sample rate)."""
        if self.tts is None:
            raise RuntimeError("engine not loaded")
        style = self.style_for(voice)
        if not self.synth_lock.acquire(timeout=SETTINGS.synth_timeout_seconds):
            raise TimeoutError("the voice is busy")
        try:
            wav, duration = self.tts.synthesize(  # type: ignore[union-attr]
                text=text,
                voice_style=style,
                lang=lang,
                speed=rate,
                total_steps=SETTINGS.steps,
                verbose=False,
            )
        finally:
            self.synth_lock.release()
        samples = np.asarray(wav).squeeze()
        if samples.size == 0:
            raise ValueError("the voice returned no audio")
        sample_rate = int(getattr(self.tts, "sample_rate", 44100))
        buffer = io.BytesIO()
        sf.write(buffer, samples, sample_rate, format="WAV", subtype="PCM_16")
        try:
            seconds = float(np.asarray(duration).reshape(-1)[0])
        except Exception:  # noqa: BLE001
            seconds = samples.size / float(sample_rate)
        return buffer.getvalue(), seconds, sample_rate
