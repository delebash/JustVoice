# SPDX-License-Identifier: GPL-3.0-or-later
"""Slice A (WS0–WS2) tests: whisper catalog visibility, voice-catalog
truth model (availability flags + per-variant voice cache), and the
swap-at-render contract (409 engine-swap-required + group-by-engine
batch rendering).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from justvoice.api import render_chapter_api, voices_api
from justvoice.engines import manager as manager_mod
from justvoice.engines.catalog import known_engines
from justvoice.engines.model_catalog import models_for
from justvoice.errors import ApiError
from justvoice.models import (
    BetweenLines,
    ChapterLine,
    RenderChapterRequest,
    Settings,
)
from justvoice.render_core import RenderedLine, raise_if_swap_blocked

from tests.conftest_db import tmp_db  # noqa: F401 — pytest discovers via fixture name


# ─── WS0: whisper visible in catalogs ──────────────────────────────────


def test_whisper_in_known_engines():
    ids = {e.id for e in known_engines()}
    assert "whisper" in ids


def test_whisper_model_variants():
    variants = models_for("whisper")
    assert {v.id for v in variants} == {"base", "small", "medium", "large", "turbo"}
    # Every whisper size is CPU-capable — none may be flagged would-oom.
    assert all((v.vram_mb or 0) == 0 for v in variants)


# ─── WS2: raise_if_swap_blocked contract ───────────────────────────────


class _FakeManifest:
    def __init__(self, engine_id="chatterbox", kind="tts", installed=True, disk_mb=2800):
        self.id = engine_id
        self.kind = kind
        self.is_installed = installed
        self.requirements = {"disk_space_mb": disk_mb}
        self.default_variant_id = "v1"


class _FakeManager:
    def __init__(self, manifest=None, loaded_tts: str | None = "kokoro"):
        self._manifest = manifest
        self._loaded_tts = loaded_tts

    def get_manifest(self, engine_id):
        if self._manifest is not None and self._manifest.id == engine_id:
            return self._manifest
        return None

    def current_for(self, kind):
        return self._loaded_tts if kind == "tts" else None


def _state_with_settings(auto_swap: bool = False):
    settings = Settings()
    settings.generation.auto_engine_swap = auto_swap

    class _SettingsStore:
        def get(self):
            return settings

    return SimpleNamespace(settings=_SettingsStore())


def _patch_manager(monkeypatch, mgr):
    monkeypatch.setattr(manager_mod, "get_manager", lambda: mgr)


def test_swap_blocked_raises_409_with_contract_fields(monkeypatch):
    _patch_manager(monkeypatch, _FakeManager(_FakeManifest()))
    with pytest.raises(ApiError) as exc_info:
        raise_if_swap_blocked(_state_with_settings(), "chatterbox", allow_engine_swap=False)
    err = exc_info.value
    assert err.status_code == 409
    assert err.extra["code"] == "engine-swap-required"
    assert err.extra["from_engine"] == "kokoro"
    assert err.extra["to_engine"] == "chatterbox"
    assert err.extra["to_variant"] == "v1"
    assert err.extra["weights_on_disk"] is True
    assert isinstance(err.extra["est_seconds"], int)


def test_swap_allowed_by_request_flag(monkeypatch):
    _patch_manager(monkeypatch, _FakeManager(_FakeManifest()))
    raise_if_swap_blocked(_state_with_settings(), "chatterbox", allow_engine_swap=True)


def test_swap_allowed_by_auto_engine_swap_setting(monkeypatch):
    _patch_manager(monkeypatch, _FakeManager(_FakeManifest()))
    raise_if_swap_blocked(
        _state_with_settings(auto_swap=True), "chatterbox", allow_engine_swap=False
    )


def test_non_managed_engine_never_gated(monkeypatch):
    # In-process external providers have no manifest — loading is a ping.
    _patch_manager(monkeypatch, _FakeManager(manifest=None))
    raise_if_swap_blocked(_state_with_settings(), "external-openai-tts", allow_engine_swap=False)


def test_est_seconds_none_when_weights_not_on_disk(monkeypatch):
    _patch_manager(monkeypatch, _FakeManager(_FakeManifest(installed=False)))
    with pytest.raises(ApiError) as exc_info:
        raise_if_swap_blocked(_state_with_settings(), "chatterbox", allow_engine_swap=False)
    assert exc_info.value.extra["est_seconds"] is None
    assert exc_info.value.extra["weights_on_disk"] is False


# ─── WS2: batch renders group by engine ────────────────────────────────


def _run_render_chapter(monkeypatch, lines, engine_by_voice):
    """Drive render_chapter with stubbed state/resolver/renderer; returns
    (render order as voice ids, engine sequence, combined response)."""
    call_order: list[str] = []

    monkeypatch.setattr(
        render_chapter_api, "get_state", lambda: _state_with_settings()
    )
    monkeypatch.setattr(
        render_chapter_api,
        "_resolve_engine_for_voice",
        lambda st, voice: engine_by_voice[voice],
    )

    def _fake_render_line(st, voice, text, **kwargs):
        call_order.append(voice)
        # Distinct 2-byte PCM per line so reassembly order is observable.
        idx = int(text)
        return RenderedLine(
            pcm=bytes([idx, idx]), sample_rate=22050, channels=1, effective_delivery={}
        )

    monkeypatch.setattr(render_chapter_api, "render_line", _fake_render_line)

    req = RenderChapterRequest(
        lines=lines, between_lines=BetweenLines(silence_ms=0), master="none"
    )
    resp = asyncio.run(render_chapter_api.render_chapter(req))
    engines_seq = [engine_by_voice[v] for v in call_order]
    return call_order, engines_seq, resp


def test_batch_groups_by_engine_and_reassembles_in_position_order(monkeypatch):
    # Interleaved 2-engine cast: N-M-N-M (kokoro / chatterbox).
    lines = [
        ChapterLine(voice="narrator", text="0"),
        ChapterLine(voice="mara", text="1"),
        ChapterLine(voice="narrator", text="2"),
        ChapterLine(voice="mara", text="3"),
    ]
    engine_by_voice = {"narrator": "kokoro", "mara": "chatterbox"}

    call_order, engines_seq, resp = _run_render_chapter(monkeypatch, lines, engine_by_voice)

    # Grouped: each engine appears as one contiguous run (one swap per engine).
    runs = [engines_seq[0]]
    for e in engines_seq[1:]:
        if e != runs[-1]:
            runs.append(e)
    assert len(runs) == 2, f"engines interleaved during render: {engines_seq}"
    # Stable within engine: script order preserved per group.
    assert [v for v in call_order if v == "narrator"] == ["narrator", "narrator"]
    assert [v for v in call_order if v == "mara"] == ["mara", "mara"]

    # Output reassembled by original position: WAV data = 00 01 02 03 pairs.
    body = resp.body
    data = body[44:]  # standard 44-byte WAV header
    assert data == bytes([0, 0, 1, 1, 2, 2, 3, 3])


def test_single_engine_batch_renders_in_script_order(monkeypatch):
    lines = [ChapterLine(voice="narrator", text=str(i)) for i in range(3)]
    call_order, _engines, resp = _run_render_chapter(
        monkeypatch, lines, {"narrator": "kokoro"}
    )
    assert call_order == ["narrator"] * 3
    assert resp.body[44:] == bytes([0, 0, 1, 1, 2, 2])


# ─── WS1: voice availability flags on /v1/voices ───────────────────────


class _FakeVoicesManager:
    def __init__(self, manifests, loaded: set[str], variants: dict[str, str]):
        self._manifests = manifests
        self._loaded = loaded
        self._variants = variants

    def manifests(self):
        return self._manifests

    def loaded_ids(self):
        return set(self._loaded)

    def current_variant_id(self, engine_id):
        return self._variants.get(engine_id)


def _fake_voices_state(stored_records=()):
    class _Voices:
        def list(self):
            return list(stored_records)

    class _Engines:
        def all(self):
            return []

    return SimpleNamespace(voices=_Voices(), engines=_Engines())


def test_voice_availability_flags(monkeypatch):
    kokoro = SimpleNamespace(
        id="kokoro", static_voices=[{"id": "af_alloy", "name": "Alloy", "language": "en-US"}]
    )
    chatterbox = SimpleNamespace(id="chatterbox", static_voices=[])
    mgr = _FakeVoicesManager(
        {"kokoro": kokoro, "chatterbox": chatterbox},
        loaded={"kokoro"},
        variants={"kokoro": "kokoro-multi-lang-v1_0"},
    )
    monkeypatch.setattr(voices_api, "get_manager", lambda: mgr)
    monkeypatch.setattr(voices_api, "get_state", lambda: _fake_voices_state())
    monkeypatch.setattr(voices_api, "_cached_voice_lists", lambda: [])

    out = asyncio.run(voices_api.list_voices())
    [alloy] = out.voices
    assert alloy.engine_loaded is True
    assert alloy.variant_id == "kokoro-multi-lang-v1_0"


def test_cached_voices_surface_when_engine_cold(monkeypatch):
    kokoro = SimpleNamespace(
        id="kokoro", static_voices=[{"id": "af_alloy", "name": "Alloy", "language": "en-US"}]
    )
    mgr = _FakeVoicesManager({"kokoro": kokoro}, loaded=set(), variants={})
    monkeypatch.setattr(voices_api, "get_manager", lambda: mgr)
    monkeypatch.setattr(voices_api, "get_state", lambda: _fake_voices_state())
    monkeypatch.setattr(
        voices_api,
        "_cached_voice_lists",
        lambda: [
            # Variant-discovered voice from a previous load — engine now cold.
            ("qwen3", "qwen3-tts-0.6b", [{"id": "qv1", "name": "Qwen Voice 1"}]),
            # Duplicate of a static preset — must not appear twice.
            ("kokoro", "kokoro-multi-lang-v1_0", [{"id": "af_alloy", "name": "Alloy dup"}]),
        ],
    )

    out = asyncio.run(voices_api.list_voices())
    by_id = {(v.engine, v.id): v for v in out.voices}
    assert len(out.voices) == 2  # no duplicate af_alloy
    qv1 = by_id[("qwen3", "qv1")]
    assert qv1.engine_loaded is False
    assert qv1.variant_id == "qwen3-tts-0.6b"
    assert by_id[("kokoro", "af_alloy")].name == "Alloy"  # static wins


# ─── WS1: voice-cache persistence on load ──────────────────────────────


def test_persist_voice_cache_roundtrip(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    from justvoice.database import session as db_session
    from justvoice.database.models import EngineVoiceCache

    monkeypatch.setattr(db_session, "SessionLocal", session_factory)

    manager_mod._persist_voice_cache(
        "kokoro", "kokoro-multi-lang-v1_0", {"voices": [{"id": "af_alloy"}]}
    )
    # Second write for the same (engine, variant) must update, not duplicate.
    manager_mod._persist_voice_cache(
        "kokoro",
        "kokoro-multi-lang-v1_0",
        {"voices": [{"id": "af_alloy"}, {"id": "af_bella"}]},
    )

    db = session_factory()
    try:
        rows = db.query(EngineVoiceCache).all()
        assert len(rows) == 1
        assert rows[0].engine_id == "kokoro"
        assert rows[0].variant_id == "kokoro-multi-lang-v1_0"
        assert "af_bella" in rows[0].voices_json
    finally:
        db.close()


def test_persist_voice_cache_noop_without_db(monkeypatch):
    from justvoice.database import session as db_session

    monkeypatch.setattr(db_session, "SessionLocal", None)
    # Must not raise — bare-manager / unit-test environments have no DB.
    manager_mod._persist_voice_cache("kokoro", "v1", {"voices": [{"id": "x"}]})
