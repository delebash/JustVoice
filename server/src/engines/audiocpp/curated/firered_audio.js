// SPDX-License-Identifier: MIT
// FireRedAudio — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Yes"; our reading of the licence differs (RESEARCH §10.13).
// The speaker's (re-read 2026-10-15); its recogniser, `firered_audio_asr` since the adoption
// plan's slice 2, has its own below.
export const LICENCE = {
  commercial: "Unclear",
  summary: "Unclear for voice cloning. The licence is Apache-2.0, but its makers write that voice cloning is “solely for academic research purposes”, and haven’t said whether that’s a licence term.",
  url: "https://huggingface.co/FireRedTeam/FireRedAudio",
  checked: "2026-10-15",
};

// Its recogniser's: the research-only sentence is about voice cloning, so recognition is plain
// Apache-2.0 (read 2026-10-15, RESEARCH §10.13).
export const RECOGNISER_LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0 — its makers' research-only sentence is about voice cloning, not speech recognition.",
  url: "https://huggingface.co/FireRedTeam/FireRedAudio",
  checked: "2026-10-15",
};

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/firered_audio/session.cpp:126-153).
export const OLD_OPTION_NAMES = {
  instruction: "instruct",
  max_new_audio_steps: "max_audio_steps",
  min_new_audio_steps: "min_audio_steps",
  max_new_text_tokens: "max_text_tokens",
  max_new_tokens: "max_tokens",
};
