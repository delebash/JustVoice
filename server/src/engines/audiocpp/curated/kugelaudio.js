// SPDX-License-Identifier: MIT
// KugelAudio — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-13 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. MIT, and its makers name audiobooks among its intended uses.",
  url: "https://huggingface.co/kugelaudio/kugelaudio-0-open",
  checked: "2026-10-13",
};

// Its built-in voices' languages and genders, as audio.cpp's own model doc gives them
// (../audio.cpp/docs/models/kugelaudio.md, read 2026-10-15): "The `default` and `clear` presets are
// German female voices. `english_female` and `english_male` are British English voices."
export const VOICES = {
  default: { language: "de", gender: "female" },
  clear: { language: "de", gender: "female" },
  english_female: { language: "en-GB", gender: "female" },
  english_male: { language: "en-GB", gender: "male" },
};
