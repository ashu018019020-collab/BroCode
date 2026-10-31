"""The only voices and languages this deployment will ever speak.

Two voices, two languages, one source of truth. The backend validates against THIS table, not against
whatever the client sent: a hand-edited request asking for `F5` or `fr-FR` is rejected with a 400 even
though the checkpoint may contain those styles, because the product exposes exactly one female and one
male voice and exactly English and Hindi.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class VoiceOption:
    id: str
    gender: str
    label: str
    default: bool = False

    def as_dict(self) -> dict:
        return {"id": self.id, "gender": self.gender, "label": self.label, "default": self.default}


# The real `voice_styles/*.json` names from the pinned checkpoint — never invented ids.
VOICES: tuple[VoiceOption, ...] = (
    VoiceOption(id="F1", gender="female", label="Female", default=True),
    VoiceOption(id="M1", gender="male", label="Male"),
)

VOICE_IDS: tuple[str, ...] = tuple(voice.id for voice in VOICES)
DEFAULT_VOICE = next(voice.id for voice in VOICES if voice.default)

# What the product speaks, and what the model accepts.
LANGUAGES: tuple[str, ...] = ("en", "hi")

# The UI stores `en-IN`/`hi-IN`; Hinglish in Roman script is sent as `en` by the client, because this
# service never rewrites or guesses the learner's text.
LANGUAGE_ALIASES: dict[str, str] = {
    "en": "en",
    "en-in": "en",
    "en-us": "en",
    "en-gb": "en",
    "hi": "hi",
    "hi-in": "hi",
}


def normalize_language(value: object) -> str | None:
    """`en-IN` → `en`, `hi_IN` → `hi`; anything outside the two languages → None."""
    if not isinstance(value, str):
        return None
    return LANGUAGE_ALIASES.get(value.strip().lower().replace("_", "-"))


def is_approved_voice(value: object) -> bool:
    return isinstance(value, str) and value.strip().upper() in VOICE_IDS


def normalize_voice(value: object) -> str | None:
    """The approved id in canonical case, or None. Unset means the default voice."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return DEFAULT_VOICE
    if not isinstance(value, str):
        return None
    candidate = value.strip().upper()
    return candidate if candidate in VOICE_IDS else None


def voice_gender(value: str) -> str | None:
    for voice in VOICES:
        if voice.id == value:
            return voice.gender
    return None


def voices_payload() -> dict:
    """What `GET /v1/voices` answers — only what is actually offered."""
    return {
        "voices": [voice.as_dict() for voice in VOICES],
        "languages": list(LANGUAGES),
        "defaultVoice": DEFAULT_VOICE,
    }
