# SPDX-License-Identifier: MIT
"""JustVoice's LLM config — the boundary between JV's settings and the
shared `llm_runner.llm` dispatch.

This is NOT a forwarding shim (RULE #8). It holds the genuinely
JustVoice-specific things the shared dispatch needs and which cannot live
in the shared package: the mapping from JV's settings tree
(`settings.engines.*`) to the shared `LLMConfig` contract, plus which JV
features prefer the built-in local runner.

REALIGNED 2026-08-01 (full-convergence ruling). The old version passed
`llm_roles=` and `default_feature_roles=` — fields the shared `LLMConfig`
deleted with the roles concept (`7232214`) — so every construction here was
a runtime TypeError, not just a stale import: JV's whole dispatch path was
dead, silently, because nothing ran its suite. The shared precedence is now
production-config → explicit pin → prefer-local → first adapter, and this
mapper passes exactly the fields that chain reads.

JustWrite has its own equivalent (`build_llm_config` over the shared
stores). JV still reads providers/pins from its settings tree; moving them
into the shared DB stores is the remaining convergence step.
"""

from __future__ import annotations

from llm_runner.llm import LLMConfig
from llm_runner.llm.routing_api import FeatureCatalogEntry

# Features that prefer the built-in llama.cpp runner when nothing more
# specific is configured (privacy-sensitive, accuracy-critical work).
PREFER_LOCAL_FEATURES: set[str] = {"speaker_attribution"}
LOCAL_RUNNER_PROVIDER_ID = "local-llamacpp"

# JV's feature catalog — the per-app data install_llm registers so the shared
# routing surface knows which features exist. Labels match the AI-features page.
FEATURE_CATALOG: list[FeatureCatalogEntry] = [
    FeatureCatalogEntry(key="speaker_attribution", label="Speaker attribution",
                        hint="Who says each line — the audiobook pipeline's core call.",
                        group="Analysis"),
    FeatureCatalogEntry(key="smart_assign", label="Smart assign",
                        hint="Bulk-assign detected speakers to personas.", group="Analysis"),
    FeatureCatalogEntry(key="show_notes", label="Show notes",
                        hint="Chapter summaries for podcast descriptions.", group="Analysis"),
    FeatureCatalogEntry(key="render_preset_suggest", label="Render preset suggestion",
                        hint="Suggest a render preset from the text's mood.", group="Analysis"),
    FeatureCatalogEntry(key="compose", label="Compose",
                        hint="Draft text from a prompt in the editor.", group="Editing"),
    FeatureCatalogEntry(key="refine", label="Dictation cleanup",
                        hint="Raw speech → clean text before paste.", group="Editing"),
    FeatureCatalogEntry(key="persona_rewrite", label="Persona rewrite",
                        hint="Rewrite text in a persona's voice.", group="Editing"),
    FeatureCatalogEntry(key="voice_gender", label="Voice gender guess",
                        hint="Label fetched voices the dictionary doesn't know.", group="Voices"),
]


def llm_config(settings) -> LLMConfig:
    """Build the shared dispatch's `LLMConfig`.

    PROVIDERS COME FROM THE SHARED DB STORE (convergence part 2, 2026-08-01) —
    the same table the shared /v1/llm-providers CRUD writes and the registry
    boots from. `settings.engines.llm` is dormant legacy data nothing reads
    (see engines/llm/migrate_providers.py). Feature pins and production
    configs stay in JV settings — they are JV's own concepts, not shared
    storage."""
    from llm_runner.llm import stores

    eng = settings.engines
    return LLMConfig(
        providers=list(stores.get_provider_store().list()),
        feature_pins=list(getattr(eng, "feature_pins", []) or []),
        production_configs=list(getattr(eng, "production_configs", []) or []),
        prefer_local_features=PREFER_LOCAL_FEATURES,
        local_runner_provider_id=LOCAL_RUNNER_PROVIDER_ID,
    )
