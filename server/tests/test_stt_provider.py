# SPDX-License-Identifier: GPL-3.0-or-later
"""Slice E (plan D4/D5) tests: STT provider slot — dispatcher routing,
the openai-compat external adapter, and settings round-trip."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from justvoice.api import captures_api
from justvoice.engines import stt_external
from justvoice.engines.stt_external import ExternalSTTError, transcribe_external
from justvoice.models import ExternalSTTProviderConfig, Settings, SettingsPatch


def _state(stt_provider="local-whisper", providers=()):
    settings = Settings()
    settings.captures.stt_provider = stt_provider
    settings.engines.external_stt = list(providers)

    class _Store:
        def get(self):
            return settings

    return SimpleNamespace(settings=_Store())


_GROQ = ExternalSTTProviderConfig(
    id="groq", name="Groq", base_url="https://api.groq.com/openai/v1",
    api_key="gsk-test", model="whisper-large-v3",
)


# ─── _resolve_stt_provider routing ─────────────────────────────────────


def test_default_routes_local(monkeypatch):
    monkeypatch.setattr(captures_api, "get_state", lambda: _state())
    assert captures_api._resolve_stt_provider() is None


def test_provider_id_resolves_config(monkeypatch):
    monkeypatch.setattr(
        captures_api, "get_state", lambda: _state("groq", [_GROQ])
    )
    cfg = captures_api._resolve_stt_provider()
    assert cfg is not None and cfg.id == "groq"


def test_unknown_provider_id_422(monkeypatch):
    monkeypatch.setattr(
        captures_api, "get_state", lambda: _state("nonexistent", [_GROQ])
    )
    with pytest.raises(HTTPException) as exc_info:
        captures_api._resolve_stt_provider()
    assert exc_info.value.status_code == 422
    assert "Engines" in str(exc_info.value.detail)


# ─── _transcribe dispatch ──────────────────────────────────────────────


def test_transcribe_local_path_unchanged(monkeypatch):
    monkeypatch.setattr(captures_api, "get_state", lambda: _state())
    monkeypatch.setattr(captures_api, "_ensure_stt_loaded", lambda: None)

    class _Mgr:
        def transcribe(self, path, language):
            return f"local:{path}:{language}"

    monkeypatch.setattr(captures_api, "get_manager", lambda: _Mgr())
    out = asyncio.run(captures_api._transcribe("/tmp/a.wav", "en"))
    assert out == "local:/tmp/a.wav:en"


def test_transcribe_external_path_no_local_gate(monkeypatch):
    monkeypatch.setattr(
        captures_api, "get_state", lambda: _state("groq", [_GROQ])
    )

    # The local Whisper gate must never run on the external route.
    def _boom():
        raise AssertionError("_ensure_stt_loaded called on external route")

    monkeypatch.setattr(captures_api, "_ensure_stt_loaded", _boom)
    monkeypatch.setattr(
        stt_external, "transcribe_external",
        lambda cfg, path, language: f"ext:{cfg.id}:{path}:{language}",
    )
    out = asyncio.run(captures_api._transcribe("/tmp/a.wav", None))
    assert out == "ext:groq:/tmp/a.wav:None"


# ─── transcribe_external adapter ───────────────────────────────────────


class _FakeResponse:
    def __init__(self, status_code=200, payload=None, text="err"):
        self.status_code = status_code
        self._payload = payload
        self.text = text

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


def test_external_posts_multipart_and_strips_text(monkeypatch, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFFfake")
    seen = {}

    def _fake_post(url, headers=None, data=None, files=None, timeout=None):
        seen.update(url=url, headers=headers, data=data)
        return _FakeResponse(payload={"text": "  hello world  "})

    monkeypatch.setattr(stt_external.httpx, "post", _fake_post)
    out = transcribe_external(_GROQ, str(audio), "en")
    assert out == "hello world"
    assert seen["url"] == "https://api.groq.com/openai/v1/audio/transcriptions"
    assert seen["headers"]["Authorization"] == "Bearer gsk-test"
    assert seen["data"]["model"] == "whisper-large-v3"
    assert seen["data"]["language"] == "en"


def test_external_http_error_is_actionable(monkeypatch, tmp_path):
    audio = tmp_path / "a.wav"
    audio.write_bytes(b"RIFFfake")
    monkeypatch.setattr(
        stt_external.httpx, "post",
        lambda *a, **k: _FakeResponse(status_code=401, text="bad key"),
    )
    with pytest.raises(ExternalSTTError) as exc_info:
        transcribe_external(_GROQ, str(audio))
    assert "401" in str(exc_info.value)


def test_external_missing_base_url_errors():
    cfg = ExternalSTTProviderConfig(id="empty", name="Empty")
    with pytest.raises(ExternalSTTError) as exc_info:
        transcribe_external(cfg, "/nonexistent.wav")
    assert "base_url" in str(exc_info.value)


# ─── settings round-trip ───────────────────────────────────────────────


def test_settings_roundtrip_external_stt():
    s = Settings.model_validate({
        "engines": {"external_stt": [{"id": "oai", "name": "OpenAI", "base_url": "https://api.openai.com/v1"}]},
        "captures": {"stt_provider": "oai", "preload_stt": False},
    })
    assert s.engines.external_stt[0].provider_type == "openai-compat"
    assert s.engines.external_stt[0].model == "whisper-1"
    assert s.captures.stt_provider == "oai"
    assert s.captures.preload_stt is False
    # And the patch shape accepts a full engines section carrying it.
    p = SettingsPatch.model_validate({"engines": s.engines.model_dump()})
    assert p.engines.external_stt[0].id == "oai"


def test_captures_defaults_local_whisper():
    s = Settings()
    assert s.captures.stt_provider == "local-whisper"
    assert s.captures.preload_stt is True
    assert s.engines.external_stt == []
