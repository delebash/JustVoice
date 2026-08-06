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
# Passed to install_llm(prefer_local_features=…). speaker_discovery reads the
# same manuscript text attribution does — it moved out of that feature key in
# the restore and keeps the preference with it.
PREFER_LOCAL_FEATURES: set[str] = {"speaker_attribution", "speaker_discovery"}

FEATURE_CATALOG: list[FeatureCatalogEntry] = [
    # ANALYSIS order (user QC 2026-08-06): the plain single cards FIRST, the
    # SPEAKER ATTRIBUTION-headed block LAST — a sub-heading's scope only ends
    # at the next heading, so cards after it would read as belonging to it.
    # Discovery runs alone → its own feature card (moved out from under the
    # attribution heading by the restore; the action key keeps its old name).
    FeatureCatalogEntry(key="speaker_discovery", label="Find new speakers",
                        hint="Behind Discover speakers: lists characters who talk in the text but aren't in your cast yet.",
                        group="Analysis"),
    FeatureCatalogEntry(key="smart_assign", label="Smart assign",
                        hint="Bulk-assign detected speakers to personas.", group="Analysis"),
    FeatureCatalogEntry(key="show_notes", label="Show notes",
                        hint="Chapter summaries for podcast descriptions.", group="Analysis"),
    FeatureCatalogEntry(key="render_preset_suggest", label="Render preset suggestion",
                        hint="Suggest a render preset from the text's mood.", group="Analysis"),
    # The attribution restore (approved 2026-08-06): SPEAKER ATTRIBUTION is a
    # plain heading; its three routes (Guided · Direct · Reasoned) are routed
    # cards under it, with the app's "Auto" panel row first (main.js registers
    # it). The hint is the user's own sentence (QC ruling 2026-08-06).
    FeatureCatalogEntry(key="speaker_attribution", label="Speaker attribution",
                        hint="Extracts who says what and what they say.",
                        group="Analysis"),
    FeatureCatalogEntry(key="compose", label="Compose",
                        hint="Draft text from a prompt in the editor.", group="Editing"),
    FeatureCatalogEntry(key="refine", label="Dictation cleanup",
                        hint="Cleans your dictated text in one pass — what it fixes follows your Capture toggles.",
                        group="Editing"),
    FeatureCatalogEntry(key="persona_rewrite", label="Persona rewrite",
                        hint="Rewrite text in a persona's voice.", group="Editing"),
    FeatureCatalogEntry(key="voice_gender", label="Voice gender guess",
                        hint="Label fetched voices the dictionary doesn't know.", group="Voices"),
]
