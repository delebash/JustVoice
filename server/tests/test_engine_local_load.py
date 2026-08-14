# SPDX-License-Identifier: MIT
"""Phase ② load-door pins (plan doc §12): the manager makes the planned
variant LOCAL before spawn and passes `model_dir` on /load; an
already-loaded early-return never re-triggers acquisition; bare contexts
(no app state / unknown catalog row) honestly answer None = legacy load."""

from __future__ import annotations

from types import SimpleNamespace

from justvoice.engines.manager import EngineManager


class _Resp:
    status_code = 200
    text = ""

    def json(self):
        return {"ok": True, "voices": []}


class _Proc:
    def __init__(self, manifest):
        self.manifest = manifest
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
        id=engine_id, kind="tts", isolation="shared", is_installed=True,
        default_variant_id="v1",
        requirements={"cpu_adequate": True, "gpu_runtimes": ["cpu"]},
    )


def _mgr(monkeypatch, manifest):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "EngineProcess", _Proc)
    monkeypatch.setattr(mgr_mod, "shared_venv_exists", lambda: True)
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
    """No usable app state / no catalog row → None: the engine loads its
    legacy way instead of the door inventing a path or raising."""
    mgr = _mgr(monkeypatch, _manifest())
    assert mgr._ensure_variant_local(
        mgr._manifests["eng"], "v1", None, None) is None
    assert mgr._ensure_variant_local(
        mgr._manifests["eng"], None, None, None) is None
