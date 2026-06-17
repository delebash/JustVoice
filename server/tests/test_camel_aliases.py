# SPDX-License-Identifier: GPL-3.0-or-later
"""T3.7 — camelCase wire aliases on LLMProviderConfig / FeaturePinConfig.

The models ACCEPT both snake_case (legacy) and camelCase (shared llm-ui
contract) on input and CAN emit camelCase via by_alias — but the settings
routes must keep EMITTING snake_case so the current renderer (which reads
engines.llm[].provider_type etc. in snake) is unaffected. These tests lock
both halves: the new capability AND the non-breaking emission.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_provider_config_accepts_both_forms_and_persists_snake():
    from justvoice.models import LLMProviderConfig

    # camelCase input (the shared contract shape) parses
    camel = LLMProviderConfig.model_validate(
        {"id": "p", "name": "P", "providerType": "openai", "baseUrl": "u", "defaultModel": "m"}
    )
    assert camel.provider_type == "openai"
    assert camel.base_url == "u"
    assert camel.default_model == "m"

    # snake construction still works (populate_by_name)
    snake = LLMProviderConfig(id="p", name="P", provider_type="openai", base_url="u")
    assert snake.provider_type == "openai"

    # default dump is snake (settings.json persistence unchanged) ...
    d = snake.model_dump()
    assert "provider_type" in d and "providerType" not in d
    # ... and by_alias dump is camel (capability the shared UI can opt into)
    da = snake.model_dump(by_alias=True)
    assert da["providerType"] == "openai" and da["baseUrl"] == "u"


def test_feature_pin_config_camel_roundtrip():
    from justvoice.models import FeaturePinConfig

    p = FeaturePinConfig.model_validate({"feature": "compose", "providerId": "x", "model": "m"})
    assert p.provider_id == "x"
    assert "provider_id" in p.model_dump()
    assert p.model_dump(by_alias=True)["providerId"] == "x"


@pytest.fixture
def client(tmp_path):
    from justvoice.app import create_app

    return TestClient(create_app(data_dir=tmp_path))


def test_settings_get_still_emits_snake_for_providers(client):
    # Renderer-safety guarantee: /v1/settings must keep emitting snake_case
    # for the nested provider entries despite the model aliases. Seed via
    # PATCH (writes settings only) — NOT POST /v1/llm-providers, which would
    # register into the process-global registry singleton and leak into other
    # tests' "no LLM configured" expectations.
    r = client.patch(
        "/v1/settings",
        json={"engines": {"llm": [
            {"id": "op", "name": "OpenAI", "provider_type": "openai-compat", "base_url": "http://x/v1"}
        ]}},
    )
    assert r.status_code == 200
    llm = client.get("/v1/settings").json()["engines"]["llm"]
    assert llm and "provider_type" in llm[0] and "providerType" not in llm[0]


def test_settings_patch_accepts_camelcase_provider(client):
    # New capability: the API now accepts a camelCase provider entry on input,
    # and round-trips it back as snake (persistence unchanged).
    body = {"engines": {"llm": [
        {"id": "c", "name": "C", "providerType": "openai-compat", "baseUrl": "http://y/v1"}
    ]}}
    r = client.patch("/v1/settings", json=body)
    assert r.status_code == 200
    llm = {p["id"]: p for p in client.get("/v1/settings").json()["engines"]["llm"]}
    assert "c" in llm
    assert llm["c"]["provider_type"] == "openai-compat"
    assert llm["c"]["base_url"] == "http://y/v1"
