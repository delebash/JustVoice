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

// The SHA-256 of its licence files and checksum list: small files Git stores itself, so catalog.json carries only Git's
// blob id for them (40 hex — all Hugging Face lists outside LFS), and the engine cache names and
// checks every file by its SHA-256 (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1).
// Each file fetched at its revision (2026-10-29), its size and Git blob id checked against the catalog.
// The revision is the one the catalog built at our fork's merge of upstream (dacb0d7f) names — the
// repository's main that day; its five files are byte for byte the ones at be39e32c. (was: 73b762c9,
// the jv.6 catalog's, and be39e32c, the uncommitted catalog's of 2026-10-18 — until that rebuild.)
export const SMALL_FILES = [
  {
    repo: "dignome/kitten_tts2",
    revision: "895debc13b2c104d7e89c9c71a57f8f1e7173b12",
    sha256: {
      "LICENSE": "f2429d9172b1e192102ab07552d7ca86c981f13598cbe3b51cc1fbd94604e1a3",
      "NOTICE": "d8d3652f8ff8ebe338fe1259e02659a67ce8dc65f34dca53ce6896fbf07560d8",
      "native/LICENSE": "4248e910a928849fe5815a0f9236e17fa07768d95b9193212752c464b93d6caa",
      "speaker/LICENSE": "14d7016ad68e7394d6e6b78d96cc2ae431c905287b89674cfdf021e79e62b8ba",
      "SHA256SUMS": "ae8039b0e806d7770b7c62566825a72e3d692bb34dfbdcdc400f2991cf47c81f",
    },
  },
];
