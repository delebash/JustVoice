// SPDX-License-Identifier: MIT
// LFM2.5-Audio — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-13 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Conditional",
  summary: "Yes while you, with any company you're part of, earn under USD 10 million a year.",
  url: "https://huggingface.co/LiquidAI/LFM2.5-Audio-1.5B/blob/main/LICENSE",
  checked: "2026-10-13",
};

// Its built-in voices' languages and genders, as audio.cpp's own model doc gives them
// (../audio.cpp/docs/models/lfm2_audio.md, read 2026-10-15): "`us_male` (default), `us_female`,
// `uk_male`, `uk_female` for English" — US or UK, male or female (its catalog hint).
export const VOICES = {
  us_male: { language: "en-US", gender: "male" },
  us_female: { language: "en-US", gender: "female" },
  uk_male: { language: "en-GB", gender: "male" },
  uk_female: { language: "en-GB", gender: "female" },
};

// A checkpoint's languages where it speaks fewer than its family (decided 2026-10-15, TASKS "Slice 2's
// acceptance findings" 5): "`en` (`LFM2.5-Audio-1.5B`), `ja` (`LFM2.5-Audio-1.5B-JP`); each
// checkpoint transcribes, speaks and chats in its own language" (../audio.cpp/docs/models/
// lfm2_audio.md:17). Keyed by audio.cpp's catalog entry: its speech and its recognition models.
export const LANGUAGES = {
  "lfm2-audio-tts": ["en"],
  "lfm2-audio-asr": ["en"],
  "lfm2-audio-jp-tts": ["ja"],
  "lfm2-audio-jp-asr": ["ja"],
};
