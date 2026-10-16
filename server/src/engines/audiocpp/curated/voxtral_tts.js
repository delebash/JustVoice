// SPDX-License-Identifier: MIT
// Voxtral TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "No",
  summary: "No. Its preset voices are non-commercial (CC-BY-NC-4.0), and Mistral says the model inherits that licence.",
  url: "https://huggingface.co/mistralai/Voxtral-4B-TTS-2603",
  checked: "2026-10-15",
};

// Its built-in voices' languages and genders, as audio.cpp's own model doc gives them
// (../audio.cpp/docs/models/voxtral_tts.md "Embedded Voices", read 2026-10-15): each voice id
// names its gender, and every group but the general presets names its language. The general
// presets' language isn't stated, so it isn't set.
const group = (lang, ids) => ids.map((id) => [id, { language: lang, gender: id.endsWith("_female") ? "female" : "male" }]);
export const VOICES = Object.fromEntries([
  ...["casual_female", "casual_male", "cheerful_female", "neutral_female", "neutral_male"].map((id) => [
    id,
    { gender: id.endsWith("_female") ? "female" : "male" },
  ]),
  ...group("pt", ["pt_male", "pt_female"]),
  ...group("nl", ["nl_male", "nl_female"]),
  ...group("it", ["it_male", "it_female"]),
  ...group("fr", ["fr_male", "fr_female"]),
  ...group("es", ["es_male", "es_female"]),
  ...group("de", ["de_male", "de_female"]),
  ...group("ar", ["ar_male"]),
  ...group("hi", ["hi_male", "hi_female"]),
]);
