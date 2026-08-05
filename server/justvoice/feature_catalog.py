# SPDX-License-Identifier: MIT
"""JustVoice's AI feature catalog — the per-app data `install_llm` registers.

Moved out of `engines/llm/config.py` (F1 Phase 2, 2026-08-05) to mirror the
family shape (JustWrite's `feature_catalog.py`): the catalog + prefer-local set
are INSTALL inputs, not dispatch-config concerns, and they outlive the pin-era
config mapper this move strands for deletion. Labels match the routing surface.
"""

from __future__ import annotations

from llm_runner.llm.routing_api import FeatureCatalogEntry

# Features that prefer the built-in llama.cpp runner when nothing more
# specific is configured (privacy-sensitive, accuracy-critical work).
# Passed to install_llm(prefer_local_features=…).
PREFER_LOCAL_FEATURES: set[str] = {"speaker_attribution"}

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
