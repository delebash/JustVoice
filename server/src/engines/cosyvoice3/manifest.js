// SPDX-License-Identifier: MIT
// Manifest for CosyVoice3 — clones a voice from a short clip and speaks it the way a written
// instruction says, run by the audio.cpp runtime (`cosyvoice3`, in our build v0.9.0-jv.5).
//
// TEST BRANCH ONLY (TASKS "Slice 0, round 3", 2026-10-11): wired for a listening test against
// VoxCPM2 and IndexTTS, not shipped.
//
// Per request it takes a template (../audio.cpp/docs/models/cosyvoice3.md): `zero_shot` — the
// clip and its words, the closer clone; `cross_lingual` — the clip alone; `instruct` — the clip
// as the voice plus a written instruction (audio.cpp frames it "You are a helpful assistant. …").
// A line with direction goes as `instruct`; one without as `zero_shot` when the voice has its
// clip's words, else `cross_lingual` (`engines/audiocpp/slot.js`).
//
// Weights: FunAudioLLM/Fun-CosyVoice3-0.5B-2512, Apache-2.0 (../audio.cpp/docs/model_licenses.md).

import { modelSource } from "../audiocpp/release.js";

export const ID = "cosyvoice3";
export const NAME = "CosyVoice3";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const LICENSE = "Apache-2.0";

export const CAPABILITIES = {
  preset_voices: false,
  voice_cloning: true,
  voice_design: false,
  // A line's direction reaches it as the instruction of the `instruct` template.
  instruct_field: true,
  paralinguistic_tags: false,
  phoneme_override: false,
};

export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

// audio.cpp's cosyvoice3 doc lists these ten.
const LANGS = ["zh", "en", "ja", "ko", "de", "es", "fr", "it", "ru", "yue"];

const Q8 = "CosyVoice3-GGUF/cosyvoice3-q8_0.gguf";

export const DEFAULT_VARIANT_ID = "cosyvoice3-q8";

// Cloned voices only — every voice is the user's own; no presets.
export const STATIC_VOICES = [];

export const DESCRIPTION =
  "CosyVoice3, 10 languages: clones a voice from a short clip, and speaks a line the way a written " +
  "instruction says. Runs in the audio.cpp speech runtime.";

export const VARIANTS = [
  {
    id: "cosyvoice3-q8",
    name: "CosyVoice3",
    description: `${DESCRIPTION} 8-bit weights.`,
    languages: [...LANGS],
    voice_cloning: true,
    voice_design: false,
    preset_voices: 0,
    weights_license: "Apache-2.0",
    sources: [modelSource(Q8, 2_257_658_080)],
    audiocpp: { family: "cosyvoice3", task: "tts", file: Q8 },
    split_chars: 200,
  },
];
