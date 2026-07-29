# SPDX-License-Identifier: MIT
# SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
# SPDX-FileCopyrightText: 2026 JustVoice contributors
#
# Speaker-attribution pipeline ported from JustWrite's
# src/renderer/src/services/speakerAttribution.js (857 LOC). The
# algorithmic logic — paragraph segmentation, anchor propagation,
# confidence-floor demotion, corrections injection — is upstream-MIT;
# our backend integration is MIT as part of the combined
# JustVoice work.
#
# Phase 3 of the Profile-kill plan. Ships as one cohesive feature:
# anchor propagation + LLM call + confidence floor + corrections, not
# four separate phases. See plan §"Six reframes" #2.

"""Speaker-attribution pipeline.

`analyze_scene(scene_text, characters, ...)` is the public entrypoint
that POST /v1/scenes/{id}/analyze dispatches to. Returns a list of
attribution rows ready to write into Block rows with persona_id +
extraction_confidence + source.
"""

from .pipeline import (
    AttributionRow,
    analyze_scene,
    AnalyzeRequest,
)

__all__ = [
    "AttributionRow",
    "analyze_scene",
    "AnalyzeRequest",
]
