// SPDX-License-Identifier: MIT
// Audio8 TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Not settings (the narrowings review, E15): `multi_reference_cond` is reference WAV paths and their
// words on the server — the clip is the voice's, which the app sends.
export const HIDDEN_OPTIONS = ["multi_reference_cond"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0 covers its code and weights. Its makers ask for consent before cloning a voice.",
  url: "https://huggingface.co/Edge0/Audio8-TTS-Preview-0.6b",
  checked: "2026-10-11",
};
