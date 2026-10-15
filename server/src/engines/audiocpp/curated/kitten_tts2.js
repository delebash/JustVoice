// SPDX-License-Identifier: MIT
// Kitten TTS 2 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-13 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Conditional",
  summary:
    "Yes if you register with Stellon Labs first, while you earn under USD 1 million a year and have raised under USD 1 million; past either, you need their separate licence. You own what it makes.",
  url: "https://huggingface.co/KittenML/kitten-tts-2/blob/main/LICENSE.md",
  checked: "2026-10-13",
};

// Its built-in voices' languages, as audio.cpp's own model doc gives them
// (../audio.cpp/docs/models/kitten_tts2.md "Languages", read 2026-10-15): "Use the language-named
// preset for Arabic, Chinese, French, German, Hindi, Italian, Portuguese, Russian, or Spanish. The
// 38 named English voices remain available." No gender is given for any of them.
const LANGUAGE_PRESETS = {
  Arabic: "ar", Chinese: "zh", French: "fr", German: "de", Hindi: "hi",
  Italian: "it", Portuguese: "pt", Russian: "ru", Spanish: "es",
};
const ENGLISH = [
  "Bella", "Jasper", "Luna", "Bruno", "Rosie", "Hugo", "Kiki", "Leo", "Matthew", "Elliot", "Willow",
  "Dolores", "Victor", "Dante", "Alfred", "Saoirse", "Claire", "Raven", "Marcus", "Herbert", "Diana",
  "Laurence", "Maeve", "Walter", "Edith", "Miles", "Grace", "Reginald", "Iris", "Frank", "Serena",
  "Julian", "Eleanor", "Otis", "Vincent", "Martha", "Sable", "Victoria",
];
export const VOICES = {
  ...Object.fromEntries(ENGLISH.map((name) => [name, { language: "en" }])),
  ...Object.fromEntries(Object.entries(LANGUAGE_PRESETS).map(([name, language]) => [name, { language }])),
};
