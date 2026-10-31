"""Every tunable of the voice service, read once from the environment.

Nothing here reaches the learner's browser: the weights, the cache directory and the shared secret
stay inside this process (and the Vercel proxy that fronts it).
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field


def _int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, "") or default)
    except ValueError:
        return default
    return max(low, min(high, value))


def _float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


def _origins() -> tuple[str, ...]:
    raw = os.getenv("TTS_ALLOWED_ORIGINS", "") or "https://mybrocode.vercel.app,http://localhost:5173"
    return tuple(origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip())


@dataclass(frozen=True)
class Settings:
    model: str = field(default_factory=lambda: os.getenv("SUPERTONIC_MODEL", "supertonic-3"))
    revision: str = field(default_factory=lambda: os.getenv("SUPERTONIC_MODEL_REVISION", "").strip())
    style: str = field(default_factory=lambda: os.getenv("SUPERTONIC_STYLE", "F1").strip() or "F1")
    steps: int = field(default_factory=lambda: _int("SUPERTONIC_STEPS", 8, 1, 12))
    max_chars: int = field(default_factory=lambda: _int("SUPERTONIC_MAX_CHARS", 1200, 1, 4000))
    cache_dir: str = field(default_factory=lambda: os.getenv("SUPERTONIC_CACHE_DIR", "").strip())
    secret: str = field(default_factory=lambda: os.getenv("TTS_SERVICE_SECRET", "").strip())
    allowed_origins: tuple[str, ...] = field(default_factory=_origins)
    requests_per_window: int = field(default_factory=lambda: _int("TTS_REQUESTS_PER_WINDOW", 60, 1, 10000))
    window_seconds: int = field(default_factory=lambda: _int("TTS_WINDOW_SECONDS", 60, 1, 86400))
    max_body_bytes: int = field(default_factory=lambda: _int("TTS_MAX_BODY_BYTES", 16384, 512, 1_000_000))
    synth_timeout_seconds: float = field(default_factory=lambda: _float("TTS_SYNTH_TIMEOUT", 30.0))


SETTINGS = Settings()
