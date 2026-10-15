// SPDX-License-Identifier: MIT
// VoxCPM — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes — “free for commercial use”, in its makers’ words (Apache-2.0). Its card also calls it a research release and asks that AI-generated content be marked.",
  url: "https://huggingface.co/openbmb/VoxCPM-0.5B",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/community_models/voxcpm1/session.cpp:214-240).
export const OLD_OPTION_NAMES = {
  text_embedding_graph_context_mb: "text_embedding_graph_arena_mb",
  lm_step_graph_context_mb: "lm_step_graph_arena_mb",
  projection_graph_context_mb: "projection_graph_arena_mb",
  local_encoder_graph_context_mb: "local_encoder_graph_arena_mb",
  dit_graph_context_mb: "dit_graph_arena_mb",
  audiovae_graph_context_mb: "audiovae_graph_arena_mb",
  audiovae_encoder_graph_context_mb: "audiovae_encoder_graph_arena_mb",
};
