// SPDX-License-Identifier: MIT
// Manifest for KittenTTS Mini 0.8 — eight English preset voices, run by the audio.cpp runtime
// (the port of justvoice/engines/kitten/manifest.py).
//
// Added with CPU placement (2026-10-02, docs/plans/2026-10-02-cpu-placement.md): an
// 80M-parameter model its makers built for the CPU, measured at 3.41× real time there on a
// Ryzen 7 5700X (8 threads) — fast enough that Auto keeps it off the graphics card.
//
// The voices are KittenML's own eight. Their genders come from the model's config.json, whose
// `voice_aliases` map each name to an `expr-voice-N-f|m` voice (read 2026-10-02). English only;
// eSpeak NG phonemizes it, as for Kokoro.
//
// Measured: the same seed does NOT give the same audio twice, so this engine offers no seed.

import { modelSource } from "../audiocpp/release.js";

export const ID = "kitten";
export const NAME = "KittenTTS";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const DESCRIPTION =
  "KittenTTS Mini 0.8 — eight English preset voices from a small model made to run without " +
  "a graphics card. Runs in the audio.cpp speech runtime from one 302 MB model file.";
export const LICENSE = "Apache-2.0";

export const CAPABILITIES = {
  preset_voices: true,
  voice_cloning: false,
  voice_design: false,
  instruct_field: false,
  paralinguistic_tags: false,
  phoneme_override: false,
  voice_blending: false,
};

export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

// [our voice id, the model's own name, gender] — ids carry the engine so they never collide
// with another engine's voice of the same name (a voice id finds its engine by lookup).
const VOICES = [
  ["kitten_bella", "Bella", "female"],
  ["kitten_jasper", "Jasper", "male"],
  ["kitten_luna", "Luna", "female"],
  ["kitten_bruno", "Bruno", "male"],
  ["kitten_rosie", "Rosie", "female"],
  ["kitten_hugo", "Hugo", "male"],
  ["kitten_kiki", "Kiki", "female"],
  ["kitten_leo", "Leo", "male"],
];

// Our voice id → the name audio.cpp takes (`engines/audiocpp/slot.js`).
export const AUDIOCPP_VOICE = Object.fromEntries(VOICES.map(([vid, name]) => [vid, name]));

export const STATIC_VOICES = VOICES.map(([id, name, gender]) => ({ id, name, language: "en-US", gender }));

export const VARIANTS = [
  {
    id: "kitten-mini-0.8",
    name: "KittenTTS Mini 0.8",
    description: "Eight English preset voices. Made for the CPU. The same seed does not repeat the same audio.",
    languages: ["en-US"],
    voice_cloning: false,
    preset_voices: VOICES.length,
    weights_license: "Apache-2.0",
    sources: [modelSource("KittenTTS-GGUF/kitten-tts-mini-0.8-orig.gguf", 302_167_104)],
    audiocpp: { family: "kitten_tts", task: "tts", file: "KittenTTS-GGUF/kitten-tts-mini-0.8-orig.gguf" },
    // Seconds of audio per second of work on the CPU — the reference machine's figure
    // (Ryzen 7 5700X, 8 threads, 2026-10-02) until a render measures this one.
    cpu_realtime: 3.41,
  },
];

export const DEFAULT_VARIANT_ID = "kitten-mini-0.8";
