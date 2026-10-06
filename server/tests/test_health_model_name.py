# SPDX-License-Identifier: MIT
"""The top bar and Home show the loaded model by its name, never the engine id
(2026-10-06, one wording per fact — docs/plans/2026-10-06-one-word-one-meaning-audit.md B3)."""

from __future__ import annotations

from justvoice.api import health_api
from justvoice.engines.manager import EngineManager


def test_the_loaded_model_is_named_by_its_catalog_row(monkeypatch):
    mgr = EngineManager()
    mgr._current_variants["qwen3"] = "qwen3-cv-1.7b-q8"
    monkeypatch.setattr(health_api, "get_manager", lambda: mgr)
    assert health_api.loaded_model_name("qwen3") == "Qwen3-TTS CustomVoice 1.7B"


def test_no_loaded_variant_falls_back_to_the_engines_name(monkeypatch):
    mgr = EngineManager()
    monkeypatch.setattr(health_api, "get_manager", lambda: mgr)
    assert health_api.loaded_model_name("kokoro") == mgr.get_manifest("kokoro").name
    assert health_api.loaded_model_name("kokoro") != "kokoro"


def test_nothing_loaded_names_nothing():
    assert health_api.loaded_model_name(None) is None
