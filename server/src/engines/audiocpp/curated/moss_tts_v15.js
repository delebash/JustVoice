// SPDX-License-Identifier: MIT
// MOSS-TTS v1.5 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, confirmed by its makers.",
  url: "https://huggingface.co/OpenMOSS-Team/MOSS-TTS-v1.5",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/community_models/moss_tts_v15/session.cpp:345).
export const OLD_OPTION_NAMES = {
  tokens: "duration_frames",
};
