// SPDX-License-Identifier: MIT
// Manifest for Pocket TTS — Kyutai's 100M cloning model, run by the audio.cpp runtime (the port
// of justvoice/engines/pocket/manifest.py).
//
// Added with CPU placement (2026-10-02, docs/plans/2026-10-02-cpu-placement.md): the one model
// in audio.cpp's catalogue that clones fast enough on the CPU — 4.05× real time on a Ryzen 7
// 5700X (8 threads), its presets 3.9×. Cloning a low voice (106 Hz) came out at about 96 Hz
// and a high one (229 Hz) at 226 Hz, so audio.cpp's copy carries the cloning weights.
//
// Downloaded from audio.cpp's own repo, which needs no login. Kyutai's own cloning repo
// (kyutai/pocket-tts) asks for a login and acceptance of its prohibited-use terms; decided
// 2026-10-02 — "use the copy and show kyutai's terms before first clone": the server refuses a
// Pocket render from a reference clip until the user has accepted `TERMS` once (the slot's
// gate).
//
// One model per language — English, German, Italian, Portuguese, Spanish — each its own
// download. The presets speak whichever language's model is loaded; a line in another
// language is refused by name. Weights: CC-BY-4.0 (Kyutai).
//
// The presets: 20 of Kyutai's 26, the ones whose recordings permit commercial use (kyutai/
// tts-voices README and the pocket-tts card, read 2026-10-02):
//   alba — Alba MacKenna, CC BY 4.0 · estelle — Kyutai's own recording, CC0 ·
//   anna, azelma, charles, eponine, eve, fantine, george, jane, mary, michael, paul, vera —
//   VCTK, CC BY 4.0 · bill_boerst, caro_davy, peter_yearsley, stuart_bell — Voice-Zero, CC0 ·
//   javert, marius — Kyutai voice donations, CC0.
// Left out: cosette (Expresso) and jean (EARS), both non-commercial; giovanni, lola, juergen
// and rafael, whose recordings state no licence. Kyutai gives no gender for them, so none is
// set.

import { MODEL_REPO, MODEL_REVISION, sixteenBit } from "../audiocpp/release.js";

export const ID = "pocket";
export const NAME = "Pocket TTS";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const DESCRIPTION =
  "Kyutai's small cloning model — clones a voice from a short clip and speaks 20 preset " +
  "voices, fast enough on the CPU. One model per language: English, German, Italian, " +
  "Portuguese, Spanish. Runs in the audio.cpp speech runtime.";
export const LICENSE = "CC-BY-4.0";
export const WEIGHTS_LICENSE = "CC-BY-4.0";

export const CAPABILITIES = {
  preset_voices: true,
  voice_cloning: true,
  voice_design: false,
  instruct_field: false,
  paralinguistic_tags: false,
  phoneme_override: false,
  voice_blending: false,
};

export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

// Kyutai's own words, as its gated repo shows them (kyutai/pocket-tts `extra_gated_prompt`,
// read 2026-10-02). `gates`: what is refused until they are accepted.
export const TERMS = {
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
};

// [our voice id, display name, audio.cpp's name, preset file bytes] — ids carry the engine so
// they never collide with another engine's voice of the same name.
const PRESETS = [
  ["pocket_alba", "Alba", "alba", 6_194_424],
  ["pocket_anna", "Anna", "anna", 7_816_440],
  ["pocket_azelma", "Azelma", "azelma", 7_963_896],
  ["pocket_bill_boerst", "Bill Boerst", "bill_boerst", 6_735_096],
  ["pocket_caro_davy", "Caro Davy", "caro_davy", 5_260_536],
  ["pocket_charles", "Charles", "charles", 6_194_424],
  ["pocket_eponine", "Eponine", "eponine", 6_931_704],
  ["pocket_estelle", "Estelle", "estelle", 8_258_808],
  ["pocket_eve", "Eve", "eve", 6_538_488],
  ["pocket_fantine", "Fantine", "fantine", 6_538_488],
  ["pocket_george", "George", "george", 6_243_576],
  ["pocket_jane", "Jane", "jane", 7_374_072],
  ["pocket_javert", "Javert", "javert", 6_194_424],
  ["pocket_marius", "Marius", "marius", 6_194_424],
  ["pocket_mary", "Mary", "mary", 6_194_424],
  ["pocket_michael", "Michael", "michael", 7_275_768],
  ["pocket_paul", "Paul", "paul", 6_980_856],
  ["pocket_peter_yearsley", "Peter Yearsley", "peter_yearsley", 3_736_816],
  ["pocket_stuart_bell", "Stuart Bell", "stuart_bell", 5_260_536],
  ["pocket_vera", "Vera", "vera", 6_735_096],
];

// Our voice id → the name audio.cpp takes (`engines/audiocpp/slot.js`).
export const AUDIOCPP_VOICE = Object.fromEntries(PRESETS.map(([vid, , name]) => [vid, name]));

// Listed once, as English — the language of the default model. Loading another language's
// model makes the same presets speak it.
export const STATIC_VOICES = PRESETS.map(([id, name]) => ({ id, name, language: "en", gender: "" }));

// [language code, the repo's folder, model file bytes, CPU real-time factor on the reference
// machine — Ryzen 7 5700X, 8 threads, preset alba, the same five lines translated;
// 2026-10-02]. Read back by Parakeet: English, German and Italian clean; Portuguese and
// Spanish sometimes drop words, depending on the seed.
const LANGUAGES = [
  ["en", "english", 127_856_704, 3.9],
  ["de", "german", 127_857_184, 3.42],
  ["it", "italian", 127_857_440, 3.57],
  ["pt", "portuguese", 127_858_368, 3.63],
  ["es", "spanish", 127_858_240, 3.62],
];
const NAMES = { en: "English", de: "German", it: "Italian", pt: "Portuguese", es: "Spanish" };

function variant(code, folder, size, cpuX) {
  const gguf = `PocketTTS-GGUF/${folder}/pocket-tts-${folder}-q8_0.gguf`;
  const presets = PRESETS.map(([, , name]) => `PocketTTS-GGUF/${folder}/embeddings/${name}.safetensors`);
  const row = {
    id: `pocket-${code}-q8`,
    name: `Pocket TTS ${NAMES[code]}`,
    description:
      `Clones a voice from a short clip, and speaks the ${PRESETS.length} presets, in ` +
      `${NAMES[code]}. Fast enough on the CPU. 8-bit weights.`,
    languages: [code],
    voice_cloning: true,
    preset_voices: PRESETS.length,
    weights_license: "CC-BY-4.0",
    sources: [
      {
        hf_repo: MODEL_REPO,
        revision: MODEL_REVISION,
        files: [gguf, ...presets],
        size_bytes: size + PRESETS.reduce((s, p) => s + p[3], 0),
      },
    ],
    // Its clone runs on the plain speech task with a reference clip — audio.cpp's Pocket
    // refuses the clone task (measured 2026-10-02).
    audiocpp: { family: "pocket_tts", task: "tts", file: gguf },
  };
  if (cpuX != null) row.cpu_realtime = cpuX;
  return row;
}

export const VARIANTS = LANGUAGES.map((lang) => variant(...lang));

// Each language's 16-bit file at the same pinned commit (gap 9) — bytes from that commit's
// tree; the presets are the same embedding files. The 8-bit rows stay the defaults.
const BF16_BYTES = { en: 219_096_064, de: 219_096_544, it: 219_096_800, pt: 219_097_728, es: 219_097_600 };
// The 16-bit rows' own CPU speed on the reference machine (Ryzen 7 5700X, 8 threads, alba,
// five short English lines, 2026-10-04). German and Italian at 16 bits are not measured yet;
// until a render on the CPU measures them, Auto doesn't offer them the CPU (audit §5 B6).
const BF16_CPU = { en: 3.11, es: 3.02, pt: 2.85 };
for (const [code, folder, size] of LANGUAGES) {
  const row8 = VARIANTS.find((r) => r.id === `pocket-${code}-q8`);
  const gguf16 = `PocketTTS-GGUF/${folder}/pocket-tts-${folder}-bf16.gguf`;
  const src8 = row8.sources[0];
  VARIANTS.push(
    sixteenBit(row8, gguf16, BF16_BYTES[code], {
      source: { ...src8, files: [gguf16, ...src8.files.slice(1)], size_bytes: src8.size_bytes - size + BF16_BYTES[code] },
    }),
  );
  if (Object.hasOwn(BF16_CPU, code)) VARIANTS[VARIANTS.length - 1].cpu_realtime = BF16_CPU[code];
}

export const DEFAULT_VARIANT_ID = "pocket-en-q8";
