"""Contract tests for the Python voice service — fake engine, no model, no network."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from fastapi.testclient import TestClient

# `app.py` is the service root, not an installed package.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app  # noqa: E402


class FakeTTS:
    sample_rate = 44100
    voice_style_names = ["F1", "F2", "M1"]

    def __init__(self) -> None:
        self.calls = []

    def get_voice_style(self, name: str):
        return {"voice": name}

    def synthesize(self, *, text, voice_style, lang, speed, total_steps, verbose=False):
        self.calls.append({"text": text, "lang": lang, "speed": speed, "steps": total_steps})
        return np.zeros((1, 4410), dtype=np.float32), np.array([0.1])


def client(secret: str = "test-secret", loader=None):
    fake = FakeTTS()
    app = create_app(loader=loader or (lambda: fake), secret=secret)
    return TestClient(app), fake


def test_healthz_reports_ready_only_after_loading():
    with client()[0] as api:
        body = api.get("/healthz")
        assert body.status_code == 200
        assert body.json()["ready"] is True
        assert body.json()["engine"] == "supertonic"


def test_model_failure_is_a_503_without_a_stack_trace():
    def explode():
        raise RuntimeError("C:\\private\\model\\path is missing")

    with client(loader=explode)[0] as api:
        response = api.get("/healthz")
        assert response.status_code == 503
        assert response.json()["phase"] == "error"
        assert "private" not in response.text
        assert "Traceback" not in response.text
        assert api.post(
            "/v1/tts",
            json={"text": "hi", "lang": "en"},
            headers={"Authorization": "Bearer test-secret"},
        ).status_code == 503


def test_tts_requires_the_shared_bearer_secret():
    with client()[0] as api:
        assert api.post("/v1/tts", json={"text": "Hello", "lang": "en"}).status_code == 401
        wrong = api.post(
            "/v1/tts",
            json={"text": "Hello", "lang": "en"},
            headers={"Authorization": "Bearer wrong"},
        )
        assert wrong.status_code == 401


def test_tts_returns_wav_and_maps_the_ui_language_tags():
    api, fake = client()
    with api as running:
        response = running.post(
            "/v1/tts",
            json={"text": "नमस्ते! आज हम Python सीखेंगे।", "lang": "hi-IN", "rate": 1.1},
            headers={"Authorization": "Bearer test-secret"},
        )
    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert response.headers["x-voice-engine"] == "supertonic"
    assert response.headers["x-sample-rate"] == "44100"
    assert response.content[:4] == b"RIFF"
    assert len(response.content) > 44
    assert fake.calls[0]["lang"] == "hi"
    assert fake.calls[0]["speed"] == 1.1


def test_tts_rejects_unsupported_language_voice_and_oversized_text():
    api, fake = client()
    with api as running:
        headers = {"Authorization": "Bearer test-secret"}
        assert running.post("/v1/tts", json={"text": "Hello", "lang": "fr-FR"}, headers=headers).status_code == 400
        assert running.post("/v1/tts", json={"text": "Hello", "lang": "en", "voice": "Z9"}, headers=headers).status_code == 400
        assert running.post("/v1/tts", json={"text": "x" * 1201, "lang": "en"}, headers=headers).status_code == 422
        assert running.post("/v1/tts", json={"text": "   ", "lang": "en"}, headers=headers).status_code == 400
    assert fake.calls == []
