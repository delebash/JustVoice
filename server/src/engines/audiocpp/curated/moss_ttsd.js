// SPDX-License-Identifier: MIT
// MOSS-TTSD — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Not settings (the narrowings review, E15): `voice_samples` is per-speaker reference WAV paths on
// the server — the clip is the voice's, which the app sends.
export const HIDDEN_OPTIONS = ["voice_samples"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Unclear"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "Apache-2.0", // audio.cpp's table has none
  commercial: "Yes",
  summary: "Yes. MOSS-TTSD 1.0 is Apache-2.0, and its makers name podcast production among its uses.",
  url: "https://huggingface.co/OpenMOSS-Team/MOSS-TTSD-v1.0",
  checked: "2026-10-11",
};
