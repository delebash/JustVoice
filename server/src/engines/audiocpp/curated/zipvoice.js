// SPDX-License-Identifier: MIT
// ZipVoice — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Unclear"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "CC-BY-NC", // audio.cpp's table says "Not stated"
  commercial: "No",
  summary: "No. Its makers state the model is non-commercial (CC-BY-NC) because of its training data — added to its page on 2026-10-10.",
  url: "https://huggingface.co/k2-fsa/ZipVoice",
  checked: "2026-10-11",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/community_models/zipvoice/session.cpp:161, 316, 326).
export const OLD_OPTION_NAMES = {
  t_shift: "shift",
  lang: "language",
};
