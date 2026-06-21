# SPDX-License-Identifier: GPL-3.0-or-later
"""Regression: PATCH /v1/settings deep-merges instead of replacing subtrees.

Found live 2026-06-11: PATCHing {"engines": {"external": [...]}} (the UI's
external-TTS save path) replaced the WHOLE engines section with defaults,
wiping engines.llm (registered LLM providers), llm_roles, and
production_configs. The store now deep-merges dicts; lists still replace
wholesale.
"""

from __future__ import annotations

from justvoice.models import (
    ExternalEngineConfig,
    LLMProviderConfig,
    SettingsPatch,
)
from justvoice.storage.settings_store import SettingsStore


def _store(tmp_path) -> SettingsStore:
    return SettingsStore(tmp_path)


def test_patch_engines_external_preserves_llm_providers(tmp_path) -> None:
    store = _store(tmp_path)
    s = store.get()
    s.engines.llm.append(
        LLMProviderConfig(
            id="ollama-pc",
            name="Ollama",
            providerType="ollama",
            baseUrl="http://localhost:11434",
            defaultModel="qwen3:8b",
            embeddingModel="nomic-embed-text",
        )
    )
    store.set(s)

    patch = SettingsPatch.model_validate(
        {
            "engines": {
                "external": [
                    {
                        "id": "elevenlabs",
                        "name": "ElevenLabs",
                        "provider_type": "openai-compat",
                        "base_url": "https://api.elevenlabs.io/v1",
                    }
                ]
            }
        }
    )
    new, _ = store.patch(patch)

    assert [e.id for e in new.engines.external] == ["elevenlabs"]
    # The llm list must survive the sibling-key patch.
    assert [p.id for p in new.engines.llm] == ["ollama-pc"]
    assert new.engines.llm[0].embeddingModel == "nomic-embed-text"


def test_patch_lists_replace_wholesale(tmp_path) -> None:
    store = _store(tmp_path)
    s = store.get()
    s.engines.external.append(
        ExternalEngineConfig(id="old", name="Old", base_url="http://old")
    )
    store.set(s)

    patch = SettingsPatch.model_validate({"engines": {"external": []}})
    new, _ = store.patch(patch)
    assert new.engines.external == []


def test_patch_scalar_section_still_works(tmp_path) -> None:
    store = _store(tmp_path)
    patch = SettingsPatch.model_validate({"logging": {"level": "debug"}})
    new, _ = store.patch(patch)
    assert new.logging.level == "debug"
