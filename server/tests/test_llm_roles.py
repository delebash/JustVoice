# SPDX-License-Identifier: GPL-3.0-or-later
"""AI-features backend — roles, production configs, dispatch precedence,
manifest kinds, per-variant on_disk (engines + AI-features redesign)."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


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
    from justvoice.engines.llm.registry import get_llm_registry

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


def test_dispatch_precedence_role_then_config(app_state) -> None:
    from justvoice.engines.llm.dispatch import resolve_pin
    from justvoice.models import LLMRolesSettings, LLMRoleTarget, ProductionConfig

    state, settings = _settings()

    # 4. DEFAULT_FEATURE_ROLES: speaker_attribution -> accuracy role
    settings.engines.llm_roles = LLMRolesSettings(
        quick=LLMRoleTarget(provider_id="prov-fast", model="qwen3:0.6b"),
        accuracy=LLMRoleTarget(provider_id="prov-big", model="qwen3:14b"),
    )
    state.settings.set(settings)
    adapter, model, _tier = resolve_pin(settings, "speaker_attribution")
    assert (adapter.provider_id, model) == ("prov-big", "qwen3:14b")
    adapter, model, _tier = resolve_pin(settings, "refine")
    assert (adapter.provider_id, model) == ("prov-fast", "qwen3:0.6b")

    # 3. pin.role overrides the default role map
    from justvoice.models import FeaturePinConfig

    settings.engines.feature_pins = [FeaturePinConfig(feature="speaker_attribution", role="quick")]
    adapter, model, _ = resolve_pin(settings, "speaker_attribution")
    assert adapter.provider_id == "prov-fast"

    # 2. explicit pin beats role
    settings.engines.feature_pins = [
        FeaturePinConfig(feature="speaker_attribution", provider_id="prov-big", model="qwen3:8b")
    ]
    adapter, model, _ = resolve_pin(settings, "speaker_attribution")
    assert (adapter.provider_id, model) == ("prov-big", "qwen3:8b")

    # 1. active production config beats everything
    settings.engines.production_configs = [
        ProductionConfig(
            feature="speaker_attribution", name="14b-twopass-v3",
            provider_id="prov-big", model="qwen3:14b", temperature=0.3,
            system_prompt="SYS", user_prompt="USR",
        )
    ]
    adapter, model, _ = resolve_pin(settings, "speaker_attribution")
    assert (adapter.provider_id, model) == ("prov-big", "qwen3:14b")


def test_production_config_endpoints(app_state) -> None:
    client = TestClient(app_state, raise_server_exceptions=False)
    body = {
        "feature": "speaker_attribution", "name": "lab-col-b",
        "provider_id": "prov-big", "model": "qwen3:14b",
        "temperature": 0.3, "system_prompt": "S", "user_prompt": "U",
    }
    r = client.post("/v1/production-configs", json=body)
    assert r.status_code == 201 and r.json()["promoted_at"]
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
    assert r["recommended_quick"] and r["recommended_accuracy"]
    assert r["recommended_quick"]["model"] == "qwen3:0.6b"
    assert r["recommended_accuracy"]["model"] == "qwen3:14b"


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
