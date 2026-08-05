# SPDX-License-Identifier: MIT
"""camelCase-NATIVE LLM-config contract (2026-06-21 AI-stack convergence).

The shared LLM-config models (LLMProviderConfig / FeaturePinConfig /
ProductionConfig) have ONE name per field — camelCase — with
NO snake_case aliases and no populate_by_name. The Python attribute == the
JSON key == the JS renderer key. These tests lock that single-name contract:
the field is camel on the model, camel on the wire (/v1/settings emits it
natively), snake_case is REJECTED on input, and the one-time legacy-snake
settings migration upgrades pre-existing rows.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


def test_provider_config_is_camel_native():
    from justvoice.models import LLMProviderConfig

    # camelCase input (the only accepted shape) parses into camel attributes.
    cfg = LLMProviderConfig.model_validate(
        {"id": "p", "name": "P", "providerType": "openai", "baseUrl": "u", "defaultModel": "m"}
    )
    assert cfg.providerType == "openai"
    assert cfg.baseUrl == "u"
    assert cfg.defaultModel == "m"

    # The dump is camel — the single name, no alias layer.
    d = cfg.model_dump()
    assert d["providerType"] == "openai" and d["baseUrl"] == "u"
    assert "provider_type" not in d and "base_url" not in d

    # snake_case kwargs are NOT valid field names anymore — they land in no
    # field (and required `providerType` is then missing → ValidationError).
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        LLMProviderConfig(id="p", name="P", provider_type="openai")  # type: ignore[call-arg]


def test_feature_pin_config_is_camel_native():
    from justvoice.models import FeaturePinConfig

    p = FeaturePinConfig.model_validate({"feature": "compose", "providerId": "x", "model": "m"})
    assert p.providerId == "x"
    d = p.model_dump()
    assert d["providerId"] == "x" and "provider_id" not in d


@pytest.fixture
def client(tmp_path):
    from justvoice.app import create_app

    return TestClient(create_app(data_dir=tmp_path))


def test_settings_emits_camel_for_providers(client):
    # /v1/settings emits the nested provider entries in camelCase natively
    # (no response_model_by_alias needed — there are no aliases). Seed via
    # PATCH (writes settings only) — NOT POST /v1/llm-providers, which would
    # register into the process-global registry singleton and leak into other
    # tests' "no LLM configured" expectations.
    r = client.patch(
        "/v1/settings",
        json={"engines": {"llm": [
            {"id": "op", "name": "OpenAI", "providerType": "openai-compat", "baseUrl": "http://x/v1"}
        ]}},
    )
    assert r.status_code == 200
    llm = client.get("/v1/settings").json()["engines"]["llm"]
    assert llm and llm[0]["providerType"] == "openai-compat" and llm[0]["baseUrl"] == "http://x/v1"
    assert "provider_type" not in llm[0] and "base_url" not in llm[0]


def test_settings_patch_rejects_snake_provider(client):
    # snake_case provider keys are no longer accepted: the required camel
    # `providerType` is absent → 422 (and nothing is persisted).
    body = {"engines": {"llm": [
        {"id": "c", "name": "C", "provider_type": "openai-compat", "base_url": "http://y/v1"}
    ]}}
    r = client.patch("/v1/settings", json=body)
    assert r.status_code == 422
    assert client.get("/v1/settings").json()["engines"]["llm"] == []


def test_legacy_snake_settings_row_is_migrated(tmp_path):
    # A pre-2026-06-21 SQLite settings row stored the LLM sections in
    # snake_case. Loading it must rename those keys to camelCase so no field
    # is dropped (a provider keeps its baseUrl / apiKey / defaultModel, the
    # production config keeps systemPrompt, etc.). The legacy llm_roles
    # section STAYS in the payload deliberately: the roles concept is deleted
    # (2026-08-01) and the load must TOLERATE the stray key, not migrate it.
    import json

    # Initialise the DB the same way the app boot does.
    from justvoice.app import create_app
    from justvoice.database import session as _db
    from justvoice.database.models import SettingsRow
    from justvoice.storage.settings_store import SettingsStore

    create_app(data_dir=tmp_path)

    legacy = {
        "engines": {
            "llm": [{
                "id": "ollama-pc", "name": "Ollama",
                "provider_type": "ollama", "base_url": "http://localhost:11434",
                "api_key": "k", "default_model": "qwen3:8b",
                "embedding_model": "nomic-embed-text", "timeout_seconds": 90,
            }],
            "feature_pins": [{"feature": "compose", "provider_id": "ollama-pc", "model": "m"}],
            "llm_roles": {
                "quick": {"provider_id": "ollama-pc", "model": "qwen3:0.6b"},
                "accuracy": {"provider_id": "ollama-pc", "model": "qwen3:14b"},
            },
            "production_configs": [{
                "feature": "speaker_attribution", "name": "v3", "provider_id": "ollama-pc",
                "model": "qwen3:14b", "system_prompt": "SYS", "user_prompt": "USR",
                "promoted_at": "2026-01-01T00:00:00Z",
            }],
        }
    }
    db = _db.SessionLocal()
    try:
        row = db.get(SettingsRow, "singleton")
        row.data = json.dumps(legacy)
        db.commit()
    finally:
        db.close()

    # Re-load through a fresh store → migration runs in _read_row.
    s = SettingsStore(tmp_path).get()
    prov = s.engines.llm[0]
    assert prov.providerType == "ollama"
    assert prov.baseUrl == "http://localhost:11434"
    assert prov.apiKey == "k"
    assert prov.defaultModel == "qwen3:8b"
    assert prov.embeddingModel == "nomic-embed-text"
    assert prov.timeoutSeconds == 90
    # The pin-era sections (feature_pins / production_configs) were dropped
    # with F1 Phase 2, joining llm_roles: the load must TOLERATE their stray
    # legacy keys — ignored at validation, never resurrected as fields.
    assert not hasattr(s.engines, "llm_roles")
    assert not hasattr(s.engines, "feature_pins")
    assert not hasattr(s.engines, "production_configs")


def test_migration_is_idempotent_on_camel_data(tmp_path):
    # Already-camel data must pass through the migration untouched.
    from justvoice.storage.settings_store import _migrate_llm_camel

    camel = {
        "engines": {
            "llm": [{"id": "p", "providerType": "openai", "baseUrl": "u"}],
            # legacy roles section: the migration must leave it verbatim (the
            # concept is deleted; the model ignores the key at validation).
            "llm_roles": {"quick": {"provider_id": "p", "model": "m"}},
        }
    }
    out = _migrate_llm_camel(json_roundtrip(camel))
    assert out["engines"]["llm"][0]["providerType"] == "openai"
    assert out["engines"]["llm"][0]["baseUrl"] == "u"
    assert "provider_type" not in out["engines"]["llm"][0]
    assert out["engines"]["llm_roles"] == {"quick": {"provider_id": "p", "model": "m"}}


def json_roundtrip(obj):
    import json

    return json.loads(json.dumps(obj))
