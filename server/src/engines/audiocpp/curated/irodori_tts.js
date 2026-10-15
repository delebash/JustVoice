// SPDX-License-Identifier: MIT
// Irodori TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Not a setting (decided 2026-10-15, E15): `no_ref` ("use no-reference generation") — a voice
// here is always a clone, so its clip always goes and no_ref stays off, audio.cpp's rule when a
// speaker reference is given.
export const HIDDEN_OPTIONS = ["no_ref"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes — its maker confirms commercial use is fine (MIT). Cloning a real person’s voice needs their explicit consent.",
  url: "https://huggingface.co/Aratako/Irodori-TTS-500M-v3",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/irodori_tts/session.cpp:107-117).
export const OLD_OPTION_NAMES = {
  instruction: "instruct",
};
