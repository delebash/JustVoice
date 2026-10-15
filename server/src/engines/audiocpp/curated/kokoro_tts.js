// SPDX-License-Identifier: MIT
// Kokoro — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, and its maker welcomes commercial use.",
  url: "https://huggingface.co/hexgrad/Kokoro-82M",
  checked: "2026-10-11",
};

// A hand-wired engine (engines/<id>/manifest.js): wired and measured by hand, so tested; what it
// is best for is the Speech engines page's picking table (approved 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Wired by hand and measured by JustVoice.",
};

export const BEST_FOR = ["Ready-made voices, fast, on any machine"];

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/kokoro_tts/session.cpp:176-187).
// Applied once this family moves onto the generated path (the plan's slice 4); its hand-wired
// request keeps the names it sends today.
export const OLD_OPTION_NAMES = {
  predictor_duration_graph_mb: "predictor_duration_graph_arena_mb",
  predictor_text_graph_mb: "predictor_text_graph_arena_mb",
  predictor_tail_graph_mb: "predictor_tail_graph_arena_mb",
};
