// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2024-2026 JustWrite contributors
// SPDX-FileCopyrightText: 2026 JustVoice contributors
//
// Speaker-attribution pipeline (the port of justvoice/extraction/__init__.py), ported from
// JustWrite's src/renderer/src/services/speakerAttribution.js. The algorithmic logic —
// paragraph segmentation, anchor propagation, confidence-floor demotion, corrections injection
// — is upstream-MIT. Ships as one cohesive feature: anchor propagation + LLM call + confidence
// floor + corrections.
//
// `analyzeScene({settings, request, …})` is the public entrypoint that POST
// /v1/scenes/{id}/analyze dispatches to. Returns a list of attribution rows ready to write into
// Block rows with speaker_id + extraction_confidence + source.

export { AnalyzeRequest, AttributionRow, analyzeScene } from "./pipeline.js";
