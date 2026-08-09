# SPDX-License-Identifier: MIT
"""The render_core managed bridge (2026-08-08 §7d fix).

Before the fix, render_line only knew the in-process registry — which holds
external cloud providers only — so every managed-plugin voice 404'd and the
whole multi-line render family (chapter, M4B, ZIP, Lines) was cloud-only.
These tests pin the bridge: managed voices resolve via manifests, load via
the manager, synth via its HTTP proxy, cache like every other line — and
the registry branch stays first, exactly as external providers and the
existing test fakes rely on.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

import justvoice.engines.manager as manager_module
from justvoice.engines.base import EngineMeta, PresetVoice, SynthOutput
from justvoice.engines.registry import EngineRegistry
from justvoice.errors import ApiError
from justvoice.render_core import probe_line_cached, render_line


class _Cache:
    def __init__(self):
        self.d = {}

    def has(self, scope, key):
        return (scope, key) in self.d

    def get(self, scope, key):
        return self.d.get((scope, key))

    def put(self, scope, key, data):
        self.d[(scope, key)] = data


class _FakeManifest:
    def __init__(self, engine_id, *, tags=False, kind="tts", static=None):
        self.id = engine_id
        self.kind = kind
        self.capabilities = {"paralinguistic_tags": tags}
        self.static_voices = static or []


class _FakeManager:
    def __init__(self, manifests):
        self._m = manifests
        self.loads = []
        self.synths = []
        self.current = {}

    def get_manifest(self, engine_id):
        return self._m.get(engine_id)

    def manifests(self):
        return dict(self._m)

    def current_for(self, kind):
        return self.current.get(kind)

    def load(self, engine_id, device="auto", **kw):
        self.loads.append((engine_id, device))
        self.current[self._m[engine_id].kind] = engine_id
        return {}

    def synth(self, engine_id, body):
        self.synths.append((engine_id, dict(body)))
        return b"\x00\x01" * 100, {
            "sample_rate": 16000,
            "channels": 1,
            "is_wav_container": False,
        }


class _FakeBackend:
    def __init__(self, engine_id, voice_ids):
        self.meta = EngineMeta(
            engine_id=engine_id,
            display_name=engine_id,
            backend="fake",
            supported_runtimes=["cpu"],
        )
        self._voices = [PresetVoice(id=v, name=v) for v in voice_ids]
        self.calls = []

    def load(self, device, model_variant=None):
        pass

    def unload(self):
        pass

    def ready(self):
        return True

    def voices(self):
        return list(self._voices)

    def synthesize(self, req):
        self.calls.append(req)
        return SynthOutput(bytes=b"\x00\x01" * 10, sample_rate=8000, channels=1)


def _state(cache=None, voices=None):
    settings = SimpleNamespace(
        limits=SimpleNamespace(text_max_chars=5000),
        cache=SimpleNamespace(enabled=cache is not None),
        generation=SimpleNamespace(max_chunk_chars=800, crossfade_ms=50),
    )
    st = SimpleNamespace(
        settings=SimpleNamespace(get=lambda: settings),
        engines=EngineRegistry(),
        voices=voices or SimpleNamespace(get=lambda vid: None),
        lexicons=SimpleNamespace(get=lambda lid: None),
    )
    if cache is not None:
        st._render_cache = cache
    return st


@pytest.fixture
def fake_mgr(monkeypatch):
    mgr = _FakeManager(
        {
            "mock-tts": _FakeManifest(
                "mock-tts", tags=False, static=[{"id": "mv_1", "name": "MV"}]
            ),
            "mock-tags": _FakeManifest(
                "mock-tags", tags=True, static=[{"id": "tv_1", "name": "TV"}]
            ),
        }
    )
    monkeypatch.setattr(manager_module, "get_manager", lambda: mgr)
    return mgr


def test_managed_voice_renders_via_manager(fake_mgr):
    st = _state()
    rl = render_line(st, voice="mv_1", text="Hello world")
    assert rl.sample_rate == 16000
    assert fake_mgr.loads == [("mock-tts", "auto")]
    assert len(fake_mgr.synths) == 1
    engine_id, body = fake_mgr.synths[0]
    assert engine_id == "mock-tts"
    assert body["voice_id"] == "mv_1"


def test_managed_load_skipped_when_current(fake_mgr):
    fake_mgr.current["tts"] = "mock-tts"
    st = _state()
    render_line(st, voice="mv_1", text="Hello")
    assert fake_mgr.loads == []


def test_tag_stripping_follows_manifest_capabilities(fake_mgr):
    st = _state()
    render_line(st, voice="mv_1", text="Hello [laugh] world")
    assert "[laugh]" not in fake_mgr.synths[-1][1]["text"]
    render_line(st, voice="tv_1", text="Hello [laugh] world")
    assert "[laugh]" in fake_mgr.synths[-1][1]["text"]


def test_managed_lines_cache_and_probe(fake_mgr):
    cache = _Cache()
    st = _state(cache=cache)
    assert probe_line_cached(st, "mv_1", "Hi", cache_scope="scene:s1") is False
    render_line(st, voice="mv_1", text="Hi", cache_scope="scene:s1")
    assert len(fake_mgr.synths) == 1
    assert probe_line_cached(st, "mv_1", "Hi", cache_scope="scene:s1") is True
    render_line(st, voice="mv_1", text="Hi", cache_scope="scene:s1")
    assert len(fake_mgr.synths) == 1  # second render was a cache hit


def test_registry_backend_wins_over_manager(fake_mgr):
    st = _state()
    backend = _FakeBackend("mock-tts", ["rv_1"])
    st.engines.register(backend)
    render_line(st, voice="rv_1", text="Hello")
    assert len(backend.calls) == 1
    assert fake_mgr.synths == []


def test_unknown_voice_still_404s(fake_mgr):
    st = _state()
    with pytest.raises(ApiError):
        render_line(st, voice="nope", text="Hello")


def test_cloned_voice_passes_reference_wav(fake_mgr, tmp_path):
    ref = tmp_path / "ref.wav"
    ref.write_bytes(b"RIFF0000WAVE")
    stored = SimpleNamespace(id="v1", engine="mock-tts", source="cloned")
    voices = SimpleNamespace(
        get=lambda vid: stored if vid == "v1" else None,
        ref_wav_path=lambda vid: ref,
    )
    st = _state(voices=voices)
    render_line(st, voice="v1", text="Hello")
    body = fake_mgr.synths[-1][1]
    assert body["audio_prompt_path"] == str(ref.resolve())
