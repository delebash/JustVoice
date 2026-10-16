// SPDX-License-Identifier: MIT
// OmniVoice — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "No",
  summary: "No. The model is non-commercial (CC-BY-NC) because of its training data; only its code is Apache-2.0.",
  url: "https://huggingface.co/k2-fsa/OmniVoice#license",
  checked: "2026-10-11",
};

// Its model's id (the plan's §4: saved voices, personas and memory prices use it). A family with
// one model names it after the family; OmniVoice had one until our fork's catalog gave
// VoiceTut-TTS an entry (2026-10-15), so its own entry keeps the id it had.
export const MODEL_IDS = { omnivoice: "omnivoice" };

// Its direction (the adoption plan's E3: OmniVoice's `instruct` becomes its direction option).
// OmniVoice takes only its own words there — gender, age, pitch, "whisper", accents and Chinese
// dialects — and refuses anything else ("unsupported OmniVoice instruct items",
// ../audio.cpp/src/models/omnivoice/prompt_builder.cpp:311-460). Of a line's direction only the
// whispered emotion is one of them; nothing else is sent, so it is never refused. Not yet tested by
// JustVoice.
export const DIRECTION = {
  kind: "phrases",
  option: "instruct",
  phrases: { whispered: "whisper" },
};

export const TESTED = null;
export const BEST_FOR = [];

// A checkpoint's languages where it speaks fewer than its family (decided 2026-10-15, TASKS "Slice 2's
// acceptance findings" 5): VoiceTut-TTS is "an OmniVoice fine-tune for Egyptian Arabic and
// Arabic-English code-switching" (../audio.cpp/docs/models/omnivoice.md:160-166) — listed as
// `ar-EG`, the tag Habibi-TTS's Egyptian model has, so a book in Arabic offers both. Its request is
// unchanged: OmniVoice's own languages name no `ar-EG` (it takes `arz`), so the line goes without
// one and the model picks it, as it did. Keyed by audio.cpp's catalog entry.
export const LANGUAGES = {
  "voicetut-tts": ["ar-EG", "en"],
};
