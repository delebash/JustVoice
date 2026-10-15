// SPDX-License-Identifier: MIT
// dots.tts — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Not settings (decided 2026-10-15, E15): `source_text` and `target_text` belong to its Edit
// template, which the app never sends.
export const HIDDEN_OPTIONS = ["source_text", "target_text"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0 covers its code and every released model. Its makers ask you to mark AI-generated audio.",
  url: "https://github.com/studio-dots-ai/dots.tts",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/dots_tts/request.cpp:105).
export const OLD_OPTION_NAMES = {
  instruction: "instruct",
};
