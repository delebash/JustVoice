# SPDX-License-Identifier: MIT
"""Render truth — what a chapter render actually produces (2026-08-15).

Three claims the app made and did not keep, pinned here so they cannot come
undone:

1. **Effects apply.** The persona effects editor saved chains, the render
   preset overlaid them, `apply_effects_chain` worked — and only the
   single-line `/v1/generate` path ever called it. Chapter renders, the M4B
   export and every take made from them were dry.
2. **The chain is part of the cache key.** `effects_chain_hash` and
   `CacheKeyBuilder.with_effects_chain` both existed, documented as being in
   the key, wired to nothing. Editing a chain served the old audio back.
3. **Mastering happens.** `/v1/render_chapter` mastered only when a caller
   named a preset; Studio never named one; `assemble_project`'s docstring
   said "mastered WAV"; ACX QC measured raw TTS output and printed a verdict
   on it.
"""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import justvoice.engines.manager as manager_module
from justvoice.api import render_chapter_api
from justvoice.app import create_app
from justvoice.audio.effects import effects_chain_hash
from justvoice.database.models import Block, Project, RenderPreset, Scene
from justvoice.mastering import resolve_master_target
from justvoice.models import Persona
from justvoice.render_core import RenderedLine, probe_line_cached, render_line
from tests.conftest_db import tmp_db  # noqa: F401 — pytest discovers via fixture name
from tests.jw_fixtures import book_json, scene as jw_scene

GAIN_UP = [{"type": "gain", "params": {"gain_db": 6.0}}]
GAIN_DOWN = [{"type": "gain", "params": {"gain_db": -6.0}}]


# ── the render_line harness (same shape as test_render_managed_bridge) ──


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
    def __init__(self, engine_id, *, static=None):
        self.id = engine_id
        self.kind = "tts"
        self.capabilities = {"paralinguistic_tags": False}
        self.static_voices = static or []


class _FakeManager:
    def __init__(self, manifests):
        self._m = manifests
        self.synths = []
        self.current = {}

    def get_manifest(self, engine_id):
        return self._m.get(engine_id)

    def manifests(self):
        return dict(self._m)

    def current_for(self, kind):
        return self.current.get(kind)

    def load(self, engine_id, device="auto", **kw):
        self.current[self._m[engine_id].kind] = engine_id
        return {}

    def synth(self, engine_id, body):
        self.synths.append((engine_id, dict(body)))
        # A steady non-zero signal, so a gain effect visibly moves it.
        return b"\x00\x10" * 400, {
            "sample_rate": 16000, "channels": 1, "is_wav_container": False,
        }


def _render_state(cache):
    settings = SimpleNamespace(
        limits=SimpleNamespace(text_max_chars=5000),
        cache=SimpleNamespace(enabled=True),
        generation=SimpleNamespace(max_chunk_chars=800, crossfade_ms=50),
    )
    from justvoice.engines.registry import EngineRegistry

    st = SimpleNamespace(
        settings=SimpleNamespace(get=lambda: settings),
        engines=EngineRegistry(),
        voices=SimpleNamespace(get=lambda vid: None),
        lexicons=SimpleNamespace(get=lambda lid: None),
    )
    st._render_cache = cache
    return st


@pytest.fixture()
def fake_mgr(monkeypatch):
    mgr = _FakeManager(
        {"mock-tts": _FakeManifest("mock-tts", static=[{"id": "mv_1", "name": "MV"}])}
    )
    monkeypatch.setattr(manager_module, "get_manager", lambda: mgr)
    return mgr


# ── 1. effects apply to a rendered line ────────────────────────────────


def test_effects_chain_changes_the_audio(fake_mgr):
    st = _render_state(_Cache())
    dry = render_line(st, voice="mv_1", text="Hi", cache_scope="s")
    wet = render_line(st, voice="mv_1", text="Hi", effects=GAIN_UP, cache_scope="s")
    assert len(dry.pcm) == len(wet.pcm), "an effect must not change line length"
    assert dry.pcm != wet.pcm, "the gain effect never reached the audio"
    # Both are real renders, cached under different keys.
    assert len(fake_mgr.synths) == 2


def test_chain_is_part_of_the_cache_key(fake_mgr):
    st = _render_state(_Cache())
    render_line(st, voice="mv_1", text="Hi", effects=GAIN_UP, cache_scope="s")
    assert len(fake_mgr.synths) == 1
    # Same chain → hit.
    render_line(st, voice="mv_1", text="Hi", effects=GAIN_UP, cache_scope="s")
    assert len(fake_mgr.synths) == 1
    # Edited chain → miss (this is what "editing a chain re-renders" means).
    render_line(st, voice="mv_1", text="Hi", effects=GAIN_DOWN, cache_scope="s")
    assert len(fake_mgr.synths) == 2
    # Chain removed → miss again, and the dry audio is its own entry.
    render_line(st, voice="mv_1", text="Hi", cache_scope="s")
    assert len(fake_mgr.synths) == 3


def test_probe_mirrors_the_effects_key(fake_mgr):
    """The Render tab's "N of M lines unchanged" banner probes keys without
    rendering. If it ignored the chain it would promise cache hits that the
    render then misses."""
    st = _render_state(_Cache())
    render_line(st, voice="mv_1", text="Hi", effects=GAIN_UP, cache_scope="s")
    assert probe_line_cached(st, "mv_1", "Hi", effects=GAIN_UP, cache_scope="s") is True
    assert probe_line_cached(st, "mv_1", "Hi", effects=GAIN_DOWN, cache_scope="s") is False
    assert probe_line_cached(st, "mv_1", "Hi", cache_scope="s") is False


def test_empty_chain_hashes_like_no_chain(fake_mgr):
    """[] and None must share an entry, or every dry line would cache twice."""
    st = _render_state(_Cache())
    render_line(st, voice="mv_1", text="Hi", effects=[], cache_scope="s")
    render_line(st, voice="mv_1", text="Hi", effects=None, cache_scope="s")
    assert len(fake_mgr.synths) == 1
    assert effects_chain_hash([]) == effects_chain_hash(None)


# ── 2. scene resolution carries the chain ──────────────────────────────


def _persona(pid: str, *, voice_id: str = "voice-1", effects=None) -> Persona:
    now = datetime.now(timezone.utc)
    return Persona(
        id=pid, name=f"P {pid}", voice_id=voice_id, default_delivery={},
        effects_chain=effects or [], created_at=now, updated_at=now,
    )


def _state_with(personas: dict[str, Persona]):
    class _Personas:
        def get(self, pid):
            return personas.get(pid)

    return SimpleNamespace(personas=_Personas())


def _seed_scene(db, *, project_type: str = "audiobook", mastering=None):
    proj = Project(
        id="proj-1", name="P", project_type=project_type, mastering_preset=mastering,
    )
    db.add(proj)
    db.flush()
    sc = Scene(id="scene-1", project_id=proj.id, position=0, title="Ch 1")
    db.add(sc)
    db.flush()
    db.add(Block(scene_id=sc.id, position=0, text="A line.", persona_id="p1"))
    db.flush()
    db.commit()
    return sc


def test_scene_lines_carry_the_persona_chain(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed_scene(db)
    db.close()

    lines, _lex = render_chapter_api._resolve_scene_to_lines(
        "scene-1", None, _state_with({"p1": _persona("p1", effects=GAIN_UP)}),
    )
    assert lines[0].effects == GAIN_UP


def test_preset_chain_overlays_the_persona_chain(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed_scene(db)
    import json

    from justvoice.database.models import Persona as PersonaRow

    db.add(PersonaRow(id="p1", name="P", voice_id="voice-1"))
    db.add(RenderPreset(
        id="pr-1", name="Room", voice_id="p1", delivery_json="{}",
        effects_chain=json.dumps(GAIN_DOWN), lexicons_json="[]",
    ))
    db.commit()
    db.close()

    lines, _lex = render_chapter_api._resolve_scene_to_lines(
        "scene-1", "pr-1", _state_with({"p1": _persona("p1", effects=GAIN_UP)}),
    )
    # Cascade order: persona first, preset on top.
    assert lines[0].effects == GAIN_UP + GAIN_DOWN


def test_no_chain_leaves_the_line_alone(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed_scene(db)
    db.close()

    lines, _lex = render_chapter_api._resolve_scene_to_lines(
        "scene-1", None, _state_with({"p1": _persona("p1")}),
    )
    assert lines[0].effects is None


# ── 3. which master target applies ─────────────────────────────────────


@pytest.mark.parametrize(
    "kind,expected",
    [
        ("audiobook", "acx"),
        ("podcast", "podcast"),
        ("game_voicelines", None),
        ("custom", None),
        ("", None),
    ],
)
def test_kind_defaults(kind, expected):
    assert resolve_master_target(project_type=kind) == (expected, "kind")


def test_precedence_request_beats_preset_beats_project_beats_kind():
    assert resolve_master_target(
        requested="youtube", preset_master="podcast",
        project_master="inaudio", project_type="audiobook",
    ) == ("youtube", "request")
    assert resolve_master_target(
        preset_master="podcast", project_master="inaudio", project_type="audiobook",
    ) == ("podcast", "preset")
    assert resolve_master_target(
        project_master="inaudio", project_type="audiobook",
    ) == ("inaudio", "project")


def test_none_is_an_answer_not_a_gap():
    """"none" means ship it raw and STOPS the search — otherwise turning
    mastering off on an audiobook would silently fall through to ACX."""
    assert resolve_master_target(requested="none", project_type="audiobook") == (None, "request")
    assert resolve_master_target(preset_master="none", project_type="audiobook") == (None, "preset")
    assert resolve_master_target(project_master="none", project_type="audiobook") == (None, "project")


def test_unknown_target_renders_raw():
    """Project.mastering_preset can hold "custom", which has no filtergraph.
    Raw is the honest outcome; inventing ACX numbers for it is not."""
    assert resolve_master_target(project_master="custom", project_type="audiobook") == (None, "project")


# ── 4. the scene render + QC actually master ───────────────────────────


def _stub_render_line(monkeypatch):
    monkeypatch.setattr(
        render_chapter_api, "render_line",
        lambda st, **kw: RenderedLine(
            pcm=b"\x00\x10" * 400, sample_rate=16000, channels=1, effective_delivery={},
        ),
    )


def _master_state():
    presets = SimpleNamespace(
        acx=SimpleNamespace(
            loudness_target_lufs=-20.0, true_peak_dbfs=-3.5, sample_rate=44100,
            channels=1, format="mp3", bitrate_kbps=192,
            head_silence_secs=0.75, tail_silence_secs=2.0,
        ),
    )
    return SimpleNamespace(
        settings=SimpleNamespace(get=lambda: SimpleNamespace(mastering=presets)),
        personas=SimpleNamespace(get=lambda pid: _persona("p1")),
    )


def test_scene_render_masters_to_the_project_target(tmp_db, monkeypatch):  # noqa: F811
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed_scene(db, project_type="audiobook", mastering="acx")
    db.close()
    _stub_render_line(monkeypatch)
    monkeypatch.setattr(render_chapter_api, "have_ffmpeg", lambda: True)
    calls = []
    monkeypatch.setattr(
        render_chapter_api, "master_to_wav",
        lambda pcm, sr, ch, **kw: calls.append(kw["preset_name"]) or b"MASTERED",
    )
    st = _master_state()
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: st)

    out = render_chapter_api.render_scene_to_wav(st, "scene-1", strict=False)
    assert out == b"MASTERED"
    assert calls == ["acx"]


def test_game_project_renders_raw(tmp_db, monkeypatch):  # noqa: F811
    """A game engine wants the line, not a loudness-normalised broadcast
    master — game_voicelines stays raw on purpose."""
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed_scene(db, project_type="game_voicelines")
    db.close()
    _stub_render_line(monkeypatch)
    monkeypatch.setattr(render_chapter_api, "have_ffmpeg", lambda: True)
    monkeypatch.setattr(
        render_chapter_api, "master_to_wav",
        lambda *a, **k: pytest.fail("game renders must not be mastered"),
    )
    st = _master_state()
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: st)

    out = render_chapter_api.render_scene_to_wav(st, "scene-1", strict=False)
    assert out.startswith(b"RIFF")


def test_render_survives_a_missing_ffmpeg(tmp_db, monkeypatch):  # noqa: F811
    """No ffmpeg must not mean no render — an audiobook project would be
    unable to produce audio at all."""
    session_factory, _engine = tmp_db
    monkeypatch.setattr(render_chapter_api, "SessionLocal", session_factory)
    db = session_factory()
    _seed_scene(db, project_type="audiobook", mastering="acx")
    db.close()
    _stub_render_line(monkeypatch)
    monkeypatch.setattr(render_chapter_api, "have_ffmpeg", lambda: False)
    monkeypatch.setattr(
        render_chapter_api, "master_to_wav",
        lambda *a, **k: pytest.fail("must not shell out without ffmpeg"),
    )
    st = _master_state()
    monkeypatch.setattr(render_chapter_api, "get_state", lambda: st)

    out = render_chapter_api.render_scene_to_wav(st, "scene-1", strict=False)
    assert out.startswith(b"RIFF")


# ── 5. the endpoints report what they did ──────────────────────────────


@pytest.fixture()
def client(tmp_path):
    app = create_app(data_dir=tmp_path)
    return TestClient(app, raise_server_exceptions=False)


def _seed_book(client) -> str:
    payload = book_json(
        premise="by S. K. H.",
        chapters=[("ch1", "One", [jw_scene("scn1", "Hello.")])],
    )
    r = client.post("/v1/projects/import?source=justwrite", json=payload)
    assert r.status_code == 200, r.text
    return r.json()["project_id"]


def test_master_target_endpoint_reports_the_resolved_preset(client):
    pid = _seed_book(client)
    r = client.get(f"/v1/render/master-target?project_id={pid}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["preset"] == "acx"
    assert body["source"] in ("project", "kind")
    # The pill's numbers come from settings, not from a template string.
    assert body["targets"]["loudness_target_lufs"] == -20.0
    assert isinstance(body["ffmpeg"], bool)


def test_master_target_endpoint_404s_on_an_unknown_project(client):
    assert client.get("/v1/render/master-target?project_id=nope").status_code == 404


def test_qc_says_whether_it_measured_a_mastered_render(client, monkeypatch):
    """An ACX verdict computed over raw TTS output is a wrong answer. When
    ffmpeg is missing QC still measures — and says the numbers are raw."""
    pid = _seed_book(client)
    monkeypatch.setattr(
        "justvoice.api.render_chapter_api.render_scene_to_wav",
        lambda st, scene_id, **kw: _sine_wav(),
    )
    monkeypatch.setattr("justvoice.mastering.have_ffmpeg", lambda: False)
    body = client.get(f"/v1/projects/{pid}/qc").json()
    assert body["master_preset"] == "acx"
    assert body["mastered"] is False
    assert "ffmpeg" in body["note"]

    monkeypatch.setattr("justvoice.mastering.have_ffmpeg", lambda: True)
    body = client.get(f"/v1/projects/{pid}/qc").json()
    assert body["mastered"] is True
    assert body["note"] is None


def _sine_wav(amplitude: float = 0.14, seconds: float = 1.0, rate: int = 16000) -> bytes:
    import io
    import math
    import struct
    import wave

    n = int(rate * seconds)
    frames = b"".join(
        struct.pack("<h", int(amplitude * 32767 * math.sin(2 * math.pi * 440 * i / rate)))
        for i in range(n)
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buf.getvalue()
