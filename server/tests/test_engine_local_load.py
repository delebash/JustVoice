# SPDX-License-Identifier: MIT
"""Load-door pins (phase ②, plan doc §12, and the 2026-10-01 switch): the manager
makes the planned variant LOCAL — in the speech cache — before the runtime is
told about it, and passes the folder on /load; an already-loaded early-return
never re-triggers acquisition; bare contexts (no app state / unknown catalog
row) honestly answer None instead of inventing a path or raising."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from justvoice.engines.manager import EngineManager


class _Resp:
    status_code = 200
    text = ""

    def json(self):
        return {"ok": True, "voices": []}


class _Slot:
    def __init__(self, manifest, placement="gpu"):
        self.manifest = manifest
        self.placement = placement
        self.terminated = False
        self.load_bodies = []

    def spawn(self):
        pass

    def is_alive(self):
        return not self.terminated

    def terminate(self):
        self.terminated = True

    def post(self, path, json=None, timeout=None):
        if path == "/load":
            self.load_bodies.append(json)
        return _Resp()

    def get(self, path):
        return _Resp()


def _manifest(engine_id="eng"):
    return SimpleNamespace(
        id=engine_id, kind="tts", is_installed=True, default_variant_id="v1",
        requirements={},
    )


def _mgr(monkeypatch, manifest):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "_new_slot", _Slot)
    monkeypatch.setattr(EngineManager, "_resolve_device", lambda self, m, requested: "cpu")
    monkeypatch.setattr(EngineManager, "pool_used_mb",
                        lambda self, *, fresh=False: None)
    monkeypatch.setattr(EngineManager, "_prior_measured_mb",
                        lambda self, kind, engine_id: 0)
    monkeypatch.setattr(EngineManager, "_record_speech_load",
                        lambda self, m, kind, variant, mb, device: None)
    mgr = mgr_mod.EngineManager()
    mgr._manifests = {manifest.id: manifest}
    mgr._hw_cache = None
    mgr._hw_detected = True
    return mgr


def test_load_passes_the_local_dir_on_load(monkeypatch):
    mgr = _mgr(monkeypatch, _manifest())
    monkeypatch.setattr(
        EngineManager, "_ensure_variant_local",
        lambda self, m, v, p, c: "X:/cache/eng/v1" if v == "v1" else None)
    mgr.load("eng", device="cpu")
    body = mgr._loaded["tts"].load_bodies[0]
    assert body["model_dir"] == "X:/cache/eng/v1"
    assert body["variant"] == "v1"          # the resolved default rode along


def test_already_loaded_never_retriggers_acquisition(monkeypatch):
    mgr = _mgr(monkeypatch, _manifest())
    calls: list[str] = []
    monkeypatch.setattr(
        EngineManager, "_ensure_variant_local",
        lambda self, m, v, p, c: (calls.append(v), None)[1])
    mgr.load("eng", device="cpu")
    assert calls == ["v1"]
    mgr.load("eng", device="cpu")           # early return — same engine, no variant
    assert calls == ["v1"]


def test_acquisition_answers_none_in_bare_contexts(monkeypatch):
    """No usable app state / no catalog row → None, never an invented path."""
    mgr = _mgr(monkeypatch, _manifest())
    assert mgr._ensure_variant_local(
        mgr._manifests["eng"], "v1", None, None) is None
    assert mgr._ensure_variant_local(
        mgr._manifests["eng"], None, None, None) is None


@pytest.fixture
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


def _put_on_disk(vdir: Path, name: str, size: int) -> None:
    """Files + the speech cache's files.json record, as a finished fetch leaves them."""
    from justvoice import speech_cache

    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / name).write_bytes(bytes(size))
    (vdir / speech_cache.MANIFEST_NAME).write_text(json.dumps(
        {"sources": [], "files": [{"path": name, "size": size, "oid": ""}]}), encoding="utf-8")


def test_a_downloaded_model_needs_no_fetch(monkeypatch, app):
    from justvoice import speech_cache
    from justvoice.app_state import get_state

    vdir = speech_cache.variant_dir(get_state().data_dir, "kokoro", "kokoro-82m-q8")
    _put_on_disk(vdir, "kokoro-82m-q8_0.gguf", 64)
    monkeypatch.setattr(speech_cache, "fetch_hf_variant",
                        lambda *a, **k: pytest.fail("a downloaded model was fetched again"))
    m = SimpleNamespace(id="kokoro")
    assert EngineManager.__new__(EngineManager)._ensure_variant_local(m, "kokoro-82m-q8", None, None) == str(vdir)


def test_model_files_on_disk_do_not_make_an_engine_installed(monkeypatch, app):
    """Weights are not the program. An engine is installed when the speech
    runtime is — a downloaded model with no runtime cannot render a line, and
    calling it installed would send the user to Load and fail there instead of
    showing the runtime row's Install."""
    from justvoice import speech_cache
    from justvoice.app_state import get_state
    from justvoice.engines.audiocpp import runtime
    from justvoice.engines.manager import discover_engines

    st = get_state()
    _put_on_disk(speech_cache.variant_dir(st.data_dir, "kokoro", "kokoro-82m-q8"),
                 "kokoro-82m-q8_0.gguf", 64)
    kokoro = discover_engines()["kokoro"]
    assert speech_cache.any_variant_on_disk(st.data_dir, "kokoro") is True

    monkeypatch.setattr(runtime, "installed_exe", lambda backend=None: None)
    assert kokoro.is_installed is False
    monkeypatch.setattr(runtime, "installed_exe", lambda backend=None: Path("C:/rt/audiocpp_server.exe"))
    assert kokoro.is_installed is True
