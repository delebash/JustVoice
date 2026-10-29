// SPDX-License-Identifier: MIT
// Pocket TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine is built from audio.cpp's files as every engine is (generated.js `ownEngine`); this
// file keeps our ids, names, the preset voices the spec doesn't list, Kyutai's terms and what
// JustVoice measured (the adoption plan's slice 4, F10).
//
// Added with CPU placement (2026-10-02, docs/plans/2026-10-02-cpu-placement.md): the one model in
// audio.cpp's catalogue that clones fast enough on the CPU — 4.05× real time on a Ryzen 7 5700X
// (8 threads), its presets 3.9×. Cloning a low voice (106 Hz) came out at about 96 Hz and a high
// one (229 Hz) at 226 Hz, so audio.cpp's copy carries the cloning weights. Downloaded from
// audio.cpp's own repo, which needs no login.

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. CC-BY-4.0. Kyutai’s terms forbid cloning a voice without that person’s explicit consent and passing the audio off as a real recording. JustVoice leaves out its non-commercial preset voices.",
  url: "https://huggingface.co/kyutai/pocket-tts",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = ["Someone’s own voice on a modest machine"];

// The engine. Kyutai's own cloning repo (kyutai/pocket-tts) asks for a login and acceptance of its
// prohibited-use terms; decided 2026-10-02 — "use the copy and show kyutai's terms before first
// clone": the server refuses a Pocket render from a reference clip until the user has accepted
// `terms` once (the slot's gate). Kyutai's own words, as its gated repo shows them (kyutai/
// pocket-tts `extra_gated_prompt`, read 2026-10-02). `gates`: what is refused until they are
// accepted.
export const ENGINE = {
  id: "pocket",
  name: "Pocket TTS",
  description:
    "Kyutai's small cloning model — clones a voice from a short clip and speaks 20 preset voices, fast enough on the CPU. " +
    "One model per language: English, German, Italian, Portuguese, Spanish, and French for cloning only. Runs in the audio.cpp speech runtime.",
  terms: {
    owner: "Kyutai",
    title: "Kyutai's terms for Pocket TTS",
    text:
      "Prohibited use: Use of our model must comply with all applicable laws and regulations " +
      "and must not result in, involve, or facilitate any illegal, harmful, deceptive, " +
      "fraudulent, or unauthorized activity. Prohibited uses include, without limitation, " +
      "voice impersonation or cloning without explicit and lawful consent; misinformation, " +
      "disinformation, or deception (including fake news, fraudulent calls, or presenting " +
      "generated content as genuine recordings of real people or events); and the generation " +
      "of unlawful, harmful, libelous, abusive, harassing, discriminatory, hateful, or " +
      "privacy-invasive content. We disclaim all liability for any non-compliant use.",
    url: "https://huggingface.co/kyutai/pocket-tts",
    gates: "cloning",
  },
  // Each language's 8-bit row, then their 16-bit rows — the order the list has always shown.
  order: "precision",
};

// One model per language, each its own download (audio.cpp's packages per language): the presets
// speak whichever language's model is loaded; a line in another language is refused by name. Read
// back by Parakeet (2026-10-02): English, German and Italian clean; Portuguese and Spanish sometimes
// drop words, depending on the seed. French — the spec's sixth language — clones only: its one
// preset voice (cosette, Expresso) is non-commercial, and its folder has none of the others
// (decided 2026-10-16, TASKS "Slice 4's gaps" 2); not measured on the CPU yet.
const language = (code, folder, word, { presets = true } = {}) => ({
  entry: "pocket-tts",
  model: "pocket",
  id: `pocket-${code}`,
  name: `Pocket TTS ${word}`,
  description: presets
    ? `Clones a voice from a short clip, and speaks the {voices} presets, in ${word}. Fast enough on the CPU. 8-bit weights.`
    : `Clones a voice from a short clip, in ${word}. 8-bit weights.`,
  languages: [code],
  ...(presets ? {} : { voices: false }),
  packages: [`pocket_tts_${folder}_q8_0`, `pocket_tts_${folder}_bf16`],
});
export const MODELS = [
  language("en", "english", "English"),
  language("de", "german", "German"),
  language("it", "italian", "Italian"),
  language("pt", "portuguese", "Portuguese"),
  language("es", "spanish", "Spanish"),
  language("fr", "french", "French", { presets: false }),
];

// Seconds of audio per second of work on the CPU on the reference machine (Ryzen 7 5700X, 8
// threads, preset alba): the 8-bit rows the same five lines translated, 2026-10-02; the 16-bit
// rows five short English lines, 2026-10-04. German and Italian at 16 bits are not measured yet;
// until a render on the CPU measures them, Auto doesn't offer them the CPU (audit §5 B6).
export const CPU_REALTIME = {
  "pocket-en-q8": 3.9,
  "pocket-de-q8": 3.42,
  "pocket-it-q8": 3.57,
  "pocket-pt-q8": 3.63,
  "pocket-es-q8": 3.62,
  "pocket-en-bf16": 3.11,
  "pocket-es-bf16": 3.02,
  "pocket-pt-bf16": 2.85,
};

// The presets, by audio.cpp's name: our id (it carries the engine, so it never collides with
// another engine's voice of the same name), its display name, and the bytes of its voice file. The
// spec lists one (`ui.builtin_voices`: alba, in the English package); the other nineteen are files
// of the same repo's `<language>/embeddings/` folders that no spec package names, downloaded with
// each language's model (`file_bytes`). 20 of Kyutai's 26, the ones whose recordings permit
// commercial use (kyutai/tts-voices README and the pocket-tts card, read 2026-10-02):
//   alba — Alba MacKenna, CC BY 4.0 · estelle — Kyutai's own recording, CC0 ·
//   anna, azelma, charles, eponine, eve, fantine, george, jane, mary, michael, paul, vera —
//   VCTK, CC BY 4.0 · bill_boerst, caro_davy, peter_yearsley, stuart_bell — Voice-Zero, CC0 ·
//   javert, marius — Kyutai voice donations, CC0.
// Left out: cosette (Expresso) and jean (EARS), both non-commercial; giovanni, lola, juergen and
// rafael, whose recordings state no licence. Kyutai gives no gender for them, so none is set.
// Listed once, as English — the language of the default model; loading another language's model
// makes the same presets speak it.
const preset = (id, name, bytes) => ({ id: `pocket_${id}`, name, language: "en", file_bytes: bytes });
export const VOICES = {
  alba: preset("alba", "Alba", 6_194_424),
  anna: preset("anna", "Anna", 7_816_440),
  azelma: preset("azelma", "Azelma", 7_963_896),
  bill_boerst: preset("bill_boerst", "Bill Boerst", 6_735_096),
  caro_davy: preset("caro_davy", "Caro Davy", 5_260_536),
  charles: preset("charles", "Charles", 6_194_424),
  eponine: preset("eponine", "Eponine", 6_931_704),
  estelle: preset("estelle", "Estelle", 8_258_808),
  eve: preset("eve", "Eve", 6_538_488),
  fantine: preset("fantine", "Fantine", 6_538_488),
  george: preset("george", "George", 6_243_576),
  jane: preset("jane", "Jane", 7_374_072),
  javert: preset("javert", "Javert", 6_194_424),
  marius: preset("marius", "Marius", 6_194_424),
  mary: preset("mary", "Mary", 6_194_424),
  michael: preset("michael", "Michael", 7_275_768),
  paul: preset("paul", "Paul", 6_980_856),
  peter_yearsley: preset("peter_yearsley", "Peter Yearsley", 3_736_816),
  stuart_bell: preset("stuart_bell", "Stuart Bell", 5_260_536),
  vera: preset("vera", "Vera", 6_735_096),
};

// Its preset voice files' SHA-256s are seed data: ../seed_file_hashes.js `POCKET_VOICE_FILES` (the kit's family guard, 2026-10-29).
