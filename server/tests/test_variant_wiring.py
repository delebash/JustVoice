# SPDX-License-Identifier: GPL-3.0-or-later
"""Variant wiring contract — the audit found every engine ignored the
`variant` arg, making the Engines-tab model dropdown cosmetic. These tests
pin the catalog ids to the engine-side maps so the wiring can't silently
drift again. (Engines import torch lazily inside load(), so the modules
are importable without ML deps.)
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ENGINES = Path(__file__).resolve().parents[1] / "justvoice" / "engines"
# The plugin shim normally comes from the engine venv; point at the in-repo
# copy for direct imports.
PLUGIN_DIR = str(Path(__file__).resolve().parents[1] / "justvoice_plugin")


def _load_engine_module(name: str):
    """Import an engine.py outside the package (they self-insert the plugin
    shim path, mirroring how the subprocess runs them)."""
    if PLUGIN_DIR not in sys.path:
        sys.path.insert(0, PLUGIN_DIR)
    spec = importlib.util.spec_from_file_location(
        f"_audit_{name}", ENGINES / name / "engine.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


def test_qwen3_catalog_ids_match_engine_map() -> None:
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("qwen3")
    catalog_ids = {v.id for v in models_for("qwen3")}
    assert catalog_ids == set(engine_mod.QWEN_VARIANT_REPOS), (
        "qwen3 catalog variant ids and engine QWEN_VARIANT_REPOS diverged"
    )
    assert engine_mod.DEFAULT_VARIANT in engine_mod.QWEN_VARIANT_REPOS


def test_qwen3_catalog_repos_match_engine_repos() -> None:
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("qwen3")
    for v in models_for("qwen3"):
        expected = engine_mod.QWEN_VARIANT_REPOS[v.id]
        assert expected in v.files[0].url, (
            f"catalog variant {v.id} points at {v.files[0].url}, engine loads {expected}"
        )


def test_chatterbox_catalog_has_only_verified_variants() -> None:
    from justvoice.engines.model_catalog import models_for

    ids = {v.id for v in models_for("chatterbox")}
    # The two real upstream variants; "chatterbox-original-v1" was an
    # unverified placeholder removed by the parity audit.
    assert ids == {"chatterbox-multilingual-v2", "chatterbox-turbo-v1"}
    repos = {v.files[0].url for v in models_for("chatterbox")}
    assert any("ResembleAI/chatterbox/" in r for r in repos)
    assert any("ResembleAI/chatterbox-turbo/" in r for r in repos)


def test_manifest_default_variants_exist_in_catalog() -> None:
    """Every manifest DEFAULT_VARIANT_ID must be a real catalog variant."""
    from justvoice.engines.model_catalog import models_for

    for manifest_path in sorted(ENGINES.glob("*/manifest.py")):
        engine_id = None
        default = None
        for line in manifest_path.read_text().splitlines():
            if line.startswith("ID = "):
                engine_id = line.split("=", 1)[1].strip().strip('"')
            if line.startswith("DEFAULT_VARIANT_ID = "):
                default = line.split("=", 1)[1].strip().strip('"')
        if default is None:
            continue
        catalog_ids = {v.id for v in models_for(engine_id)}
        assert default in catalog_ids, (
            f"{manifest_path.parent.name}: DEFAULT_VARIANT_ID {default!r} "
            f"not in catalog {sorted(catalog_ids)}"
        )


def test_whisper_catalog_ids_match_engine_map() -> None:
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("whisper")
    catalog_ids = {v.id for v in models_for("whisper")}
    assert catalog_ids == set(engine_mod.WHISPER_VARIANT_REPOS)
    for v in models_for("whisper"):
        assert engine_mod.WHISPER_VARIANT_REPOS[v.id] in v.files[0].url
    assert engine_mod.DEFAULT_VARIANT in engine_mod.WHISPER_VARIANT_REPOS


def test_qwen3_llm_catalog_ids_match_engine_map() -> None:
    from justvoice.engines.model_catalog import models_for

    engine_mod = _load_engine_module("qwen3_llm")
    catalog_ids = {v.id for v in models_for("qwen3-llm")}
    assert catalog_ids == set(engine_mod.QWEN_LLM_VARIANT_REPOS)
    for v in models_for("qwen3-llm"):
        assert engine_mod.QWEN_LLM_VARIANT_REPOS[v.id] in v.files[0].url


def test_new_engine_kinds_discovered() -> None:
    from justvoice.engines.manager import discover_engines

    kinds = {k: m.kind for k, m in discover_engines().items()}
    assert kinds.get("whisper") == "stt"
    assert kinds.get("qwen3-llm") == "llm"


# ─── current_variant_id recording (user-hit 2026-06-12) ────────────────
# Loading via the Voices ask-before-load path passes variant=None; the
# manager must record the RESOLVED default variant id, never None/"auto",
# or the Engines page can't tell which model row is loaded (both rows
# said "Load model" while the info box said loaded).


class _FakeResp:
    def __init__(self, payload):
        self.status_code = 200
        self._payload = payload
        self.text = ""

    def json(self):
        return self._payload


class _FakeProc:
    def __init__(self, manifest):
        self.manifest = manifest

    def spawn(self):
        pass

    def is_alive(self):
        return True

    def terminate(self):
        pass

    def post(self, path, json=None):
        return _FakeResp({"ok": True})

    def get(self, path):
        return _FakeResp({"voices": []})


class _FakeManifest:
    id = "fake-tts"
    kind = "tts"
    isolation = "shared"
    is_installed = True
    default_variant_id = "fake-default-v1"


def _fake_manager(monkeypatch):
    from justvoice.engines import manager as mgr_mod

    monkeypatch.setattr(mgr_mod, "EngineProcess", _FakeProc)
    monkeypatch.setattr(mgr_mod, "shared_venv_exists", lambda: True)
    mgr = mgr_mod.EngineManager()
    mgr._manifests["fake-tts"] = _FakeManifest()
    return mgr


def test_load_without_variant_records_default(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto")  # the voice_preview_api call shape
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"


def test_load_with_auto_variant_records_default(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="auto")
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"


def test_load_with_explicit_variant_records_it(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="fake-other-v2")
    assert mgr.current_variant_id("fake-tts") == "fake-other-v2"


def test_already_loaded_reload_keeps_resolved_variant(monkeypatch) -> None:
    mgr = _fake_manager(monkeypatch)
    mgr.load("fake-tts", device="auto", variant="fake-other-v2")
    # Re-load with no variant (Voices preview path) must NOT clobber the
    # explicit variant back to default, and must never store None.
    mgr.load("fake-tts", device="auto")
    assert mgr.current_variant_id("fake-tts") == "fake-other-v2"
    mgr.load("fake-tts", device="auto", variant="fake-default-v1")
    assert mgr.current_variant_id("fake-tts") == "fake-default-v1"
