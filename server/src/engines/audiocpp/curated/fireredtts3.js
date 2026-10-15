// SPDX-License-Identifier: MIT
// FireRedTTS3 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Yes"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  commercial: "Unclear",
  summary: "Unclear. The licence is Apache-2.0, but its makers write that voice cloning — all JustVoice uses it for — is “solely for academic research purposes”; asked whether that binds, they didn’t answer.",
  url: "https://huggingface.co/FireRedTeam/FireRedTTS3",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/fireredtts3/session.cpp:321).
export const OLD_OPTION_NAMES = {
  instruction: "instruct",
};
