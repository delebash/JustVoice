# SPDX-License-Identifier: MIT
"""Phase ② load-door pins (plan doc §12): the manager makes the planned
variant LOCAL before spawn and passes `model_dir` on /load; an
already-loaded early-return never re-triggers acquisition; bare contexts
(no app state / unknown catalog row) honestly answer None = legacy load."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

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


# ── Phase ④ — the URL arm: the last legacy writer dies ───────────────


@pytest.fixture
def app(tmp_path):
    from justvoice.app import create_app

    return create_app(data_dir=tmp_path)


def _url_manifest(tmp_path, engine_id="kok", steps=None):
    return SimpleNamespace(
        id=engine_id, kind="tts", isolation="shared",
        model_install_steps=steps or [],
        models_dir=tmp_path / "legacy-models",
    )


def test_url_arm_fetches_into_the_speech_cache(monkeypatch, tmp_path, app):
    """A cold load of a URL-source variant (kokoro shape) lands in the
    SPEECH CACHE with its files.json — the legacy engine-dir models
    location gets no write."""
    import justvoice.api.engine_sources_api as esa
    from justvoice import installer, speech_cache
    from justvoice.app_state import get_state

    m = _url_manifest(tmp_path)
    monkeypatch.setattr(
        esa, "resolve_source",
        lambda e, v: ({"url": "http://example.test/model-256.bin"}, "manifest"))

    def fake_stream(url, dest, on_progress, cancel_check=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"\0" * 256)
        on_progress(256)
        return "deadbeef"

    monkeypatch.setattr(installer, "_stream_download", fake_stream)

    from justvoice.engines.manager import EngineManager

    out = EngineManager.__new__(EngineManager)._ensure_variant_local(m, "v1", None, None)
    st = get_state()
    vdir = speech_cache.variant_dir(st.data_dir, "kok", "v1")
    assert out == str(vdir)
    assert (vdir / "model-256.bin").stat().st_size == 256
    assert speech_cache.variant_on_disk(st.data_dir, "kok", "v1")
    assert not m.models_dir.exists()


def test_url_arm_prefers_a_legacy_tarball_install(monkeypatch, tmp_path, app):
    """A pre-④ tarball install under the engine dir keeps serving offline —
    the URL arm answers None (legacy load) instead of re-downloading."""
    import justvoice.api.engine_sources_api as esa

    m = _url_manifest(tmp_path, steps=[{"expected_files": ["model.onnx"]}])
    m.models_dir.mkdir(parents=True)
    (m.models_dir / "model.onnx").write_bytes(b"x")
    monkeypatch.setattr(
        esa, "resolve_source",
        lambda e, v: ({"url": "http://example.test/model.tar.bz2"}, "manifest"))

    from justvoice.engines.manager import EngineManager

    assert EngineManager.__new__(EngineManager)._ensure_variant_local(m, "v1", None, None) is None


def test_is_installed_reads_the_speech_cache(monkeypatch, tmp_path, app):
    """Phase ④'s cache-truth status: a prefetched shared engine counts as
    installed (no more 'not installed' chip over an on-disk model row, no
    legacy re-download at the load door)."""
    from justvoice import speech_cache
    from justvoice.app_state import get_state
    from justvoice.engines import manager as mgr_mod
    from justvoice.engines.manager import get_manager

    monkeypatch.setattr(mgr_mod, "shared_venv_exists", lambda: True)
    manifest = get_manager().get_manifest("kokoro")
    assert manifest is not None

    st = get_state()
    vdir = speech_cache.variant_dir(st.data_dir, "kokoro", "kokoro-v1")
    vdir.mkdir(parents=True)
    (vdir / "model.onnx").write_bytes(b"\0" * 32)
    speech_cache.write_manifest_from_dir(vdir, url="http://example.test/t.tar.bz2")
    assert speech_cache.any_variant_on_disk(st.data_dir, "kokoro") is True
    assert manifest.is_installed is True
