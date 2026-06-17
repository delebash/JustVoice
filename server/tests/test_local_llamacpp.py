# SPDX-License-Identifier: GPL-3.0-or-later
"""P1.5 — local-llamacpp provider type + qwen3-llm demotion + dispatch default.

The built-in llama.cpp runner registers as the OpenAI-compat provider type
`local-llamacpp` (pointed at the loopback llama-server). It's the smart
default for speaker attribution and outranks the lightweight qwen3 fallback
in recommendations; the qwen3-llm 4B variant is dropped.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from justvoice.app import create_app


class _Fake:
    def __init__(self, provider_id, provider_type, default_model="m"):
        self.provider_id = provider_id
        self.provider_type = provider_type
        self.default_model = default_model

    def chat(self, *a, **k):  # pragma: no cover
        raise NotImplementedError

    def stream_chat(self, *a, **k):  # pragma: no cover
        raise NotImplementedError


def test_construct_local_llamacpp_points_at_loopback():
    from justvoice.engines.llm.registry import construct
    from justvoice.models import LLMProviderConfig

    adapter = construct(
        LLMProviderConfig(id="local-llamacpp", name="Local llama.cpp",
                          provider_type="local-llamacpp")
    )
    assert adapter.provider_type == "local-llamacpp"
    # empty base_url resolves to the loopback llama-server (OpenAI-compat /v1)
    assert adapter._base_url == "http://127.0.0.1:8080/v1"


def test_qwen3_llm_4b_variant_dropped():
    from justvoice.engines.model_catalog import models_for

    ids = {v.id for v in models_for("qwen3-llm")}
    assert "qwen3-llm-4b" not in ids
    assert {"qwen3-llm-0.6b", "qwen3-llm-1.7b"} <= ids


@pytest.fixture()
def app_clean_registry(tmp_path):
    app = create_app(data_dir=tmp_path)
    from justvoice.engines.llm.registry import get_llm_registry

    reg = get_llm_registry()
    saved = list(reg.all())
    reg._adapters = {}
    yield app, reg
    reg._adapters = {a.provider_id: a for a in saved}


def test_speaker_attribution_prefers_local_runner_when_present(app_clean_registry):
    _app, reg = app_clean_registry
    from justvoice.app_state import get_state
    from justvoice.engines.llm.dispatch import resolve_pin

    settings = get_state().settings.get()
    # cloud provider registered FIRST, the built-in runner second
    reg.register(_Fake("claude-x", "anthropic", "claude-opus-4-8"))
    reg.register(_Fake("local-llamacpp", "local-llamacpp", "qwen3:14b"))

    # No pin/role configured → attribution picks the built-in runner, not the
    # first-registered cloud adapter.
    adapter, _model, _ = resolve_pin(settings, "speaker_attribution")
    assert adapter.provider_id == "local-llamacpp"

    # A non-target feature keeps the generic first-adapter fallback.
    adapter, _model, _ = resolve_pin(settings, "refine")
    assert adapter.provider_id == "claude-x"


def test_recommendations_rank_local_runner_first(app_clean_registry):
    app, reg = app_clean_registry
    # two accuracy-class LOCAL providers; the built-in runner must win
    reg.register(_Fake("ollama-x", "ollama", "qwen3:14b"))
    reg.register(_Fake("local-llamacpp", "local-llamacpp", "qwen3:14b"))

    body = TestClient(app, raise_server_exceptions=False).get(
        "/v1/llm-roles/recommendations"
    ).json()
    cand = {c["provider_id"]: c for c in body["candidates"]}
    assert cand["local-llamacpp"]["local"] is True  # classified local, not metered
    assert body["recommended_accuracy"]["provider_id"] == "local-llamacpp"
