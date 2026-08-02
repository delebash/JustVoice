# SPDX-License-Identifier: MIT
"""AI-features backend — recommendations, production configs, dispatch precedence,
manifest kinds, per-variant on_disk (engines + AI-features redesign).

The persisted Quick/Accuracy ROLES are gone (2026-08-01, full-convergence ruling —
the shared package deleted the concept with 7232214). The precedence test below
asserts the CURRENT shared chain: production config → explicit pin → prefer-local →
first adapter. The file keeps its name because /v1/llm-roles/recommendations still
exists (the UI path name survives)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app
from justvoice.engines.llm.config import llm_config


class FakeAdapter:
    def __init__(self, provider_id, default_model):
        self.provider_id = provider_id
        self.provider_type = "ollama"
        self.default_model = default_model

    def chat(self, *a, **k):  # pragma: no cover - not exercised
        raise NotImplementedError

    def stream_chat(self, *a, **k):  # pragma: no cover
        raise NotImplementedError


@pytest.fixture()
def app_state(tmp_path):
    app = create_app(data_dir=tmp_path)
    from llm_runner.llm import get_llm_registry

    reg = get_llm_registry()
    # isolate registry per test
    saved = list(reg.all())
    for a in saved:
        pass
    reg._adapters = {}
    reg.register(FakeAdapter("prov-big", "qwen3:14b"))
    reg.register(FakeAdapter("prov-fast", "qwen3:0.6b"))
    yield app
    reg._adapters = {a.provider_id: a for a in saved}


def _settings():
    from justvoice.app_state import get_state

    return get_state(), get_state().settings.get()


def test_dispatch_precedence_config_pin_local_first(app_state) -> None:
    """The CURRENT shared chain, no roles: production config → explicit pin →
    prefer-local → first registered adapter."""
    from llm_runner.llm.dispatch import resolve_pin

    from justvoice.models import FeaturePinConfig, ProductionConfig

    state, settings = _settings()

    # 4. nothing configured → first registered adapter. (speaker_attribution is in
    # PREFER_LOCAL_FEATURES but no "local-llamacpp" adapter is registered here, so
    # the prefer-local step is a no-op and it also falls through to first.)
    settings.engines.feature_pins = []
    settings.engines.production_configs = []
    state.settings.set(settings)
    adapter, _model, _tier = resolve_pin(llm_config(settings), "refine")
    assert adapter.provider_id == "prov-big"
    adapter, _model, _tier = resolve_pin(llm_config(settings), "speaker_attribution")
    assert adapter.provider_id == "prov-big"

    # 3. prefer-local routes to the built-in runner WHEN it is registered.
    reg = __import__("llm_runner.llm", fromlist=["get_llm_registry"]).get_llm_registry()
    reg.register(FakeAdapter("local-llamacpp", "gemma-4-12b"))
    try:
        adapter, model, _ = resolve_pin(llm_config(settings), "speaker_attribution")
        assert (adapter.provider_id, model) == ("local-llamacpp", "gemma-4-12b")
        # …and only for the features that opted in.
        adapter, _model, _ = resolve_pin(llm_config(settings), "refine")
        assert adapter.provider_id == "prov-big"
    finally:
        reg._adapters.pop("local-llamacpp", None)

    # 2. explicit pin beats prefer-local and first.
    settings.engines.feature_pins = [
        FeaturePinConfig(feature="speaker_attribution", providerId="prov-big", model="qwen3:8b")
    ]
    adapter, model, _ = resolve_pin(llm_config(settings), "speaker_attribution")
    assert (adapter.provider_id, model) == ("prov-big", "qwen3:8b")

    # 1. active production config beats everything.
    settings.engines.production_configs = [
        ProductionConfig(
            feature="speaker_attribution", name="14b-twopass-v3",
            providerId="prov-big", model="qwen3:14b", temperature=0.3,
            systemPrompt="SYS", userPrompt="USR",
        )
    ]
    adapter, model, _ = resolve_pin(llm_config(settings), "speaker_attribution")
    assert (adapter.provider_id, model) == ("prov-big", "qwen3:14b")


def test_production_config_endpoints(app_state) -> None:
    client = TestClient(app_state, raise_server_exceptions=False)
    body = {
        "feature": "speaker_attribution", "name": "lab-col-b",
        "providerId": "prov-big", "model": "qwen3:14b",
        "temperature": 0.3, "systemPrompt": "S", "userPrompt": "U",
    }
    r = client.post("/v1/production-configs", json=body)
    assert r.status_code == 201 and r.json()["promotedAt"]
    assert len(client.get("/v1/production-configs").json()["configs"]) == 1
    # replace, not append
    client.post("/v1/production-configs", json={**body, "name": "v2"})
    cfgs = client.get("/v1/production-configs").json()["configs"]
    assert len(cfgs) == 1 and cfgs[0]["name"] == "v2"
    assert client.delete("/v1/production-configs/speaker_attribution").status_code == 200
    assert client.get("/v1/production-configs").json()["configs"] == []
    assert client.delete("/v1/production-configs/speaker_attribution").status_code == 404


def test_role_recommendations(app_state) -> None:
    client = TestClient(app_state, raise_server_exceptions=False)
    r = client.get("/v1/llm-roles/recommendations").json()
    assert r["recommendedQuick"] and r["recommendedAccuracy"]
    assert r["recommendedQuick"]["model"] == "qwen3:0.6b"
    assert r["recommendedAccuracy"]["model"] == "qwen3:14b"


def test_manifest_kinds_and_on_disk(app_state) -> None:
    client = TestClient(app_state, raise_server_exceptions=False)
    engines = {e["id"]: e for e in client.get("/v1/engines").json()["engines"]}
    assert engines["whisper"]["kinds"] == ["stt"]
    assert engines["chatterbox"]["kinds"] == ["tts"]
    # back-compat: kind == kinds[0]
    assert engines["whisper"]["kind"] == "stt"
    variants = client.get("/v1/engines/chatterbox/models").json()["variants"]
    # container has no HF cache for these — on_disk must be a real False,
    # not None (they're HF-distributed)
    assert all(v["on_disk"] is False for v in variants)
