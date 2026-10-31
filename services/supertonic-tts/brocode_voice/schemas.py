"""The request body `/v1/tts` accepts, and the validation that happens before the model is touched."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field

from .config import SETTINGS
from .voice_registry import normalize_language, normalize_voice


class TTSBody(BaseModel):
    """`{ text, lang, rate, voice? }`.

    `lang` accepts the UI's `en-IN`/`hi-IN` tags and the ISO `en`/`hi`; anything else is refused by the
    route with a 400 that names the two languages. `voice` is optional and defaults to the registry's
    default (F1), so an older client that sends no voice still gets the tutor.
    """

    text: str = Field(..., min_length=1, max_length=SETTINGS.max_chars)
    lang: str = Field(default="en")
    rate: float = Field(default=1.0, ge=0.5, le=2.0)
    voice: Optional[str] = None

    @property
    def language(self) -> str | None:
        return normalize_language(self.lang)

    @property
    def voice_id(self) -> str | None:
        return normalize_voice(self.voice)
