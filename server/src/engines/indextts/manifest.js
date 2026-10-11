// SPDX-License-Identifier: MIT
// Manifest for IndexTTS 2 and 2.5 — clones a voice from a short clip and sets the emotion apart
// from the voice, run by the audio.cpp runtime (`index_tts2`, in our build v0.9.0-jv.5).
//
// TEST BRANCH ONLY (TASKS "Slice 0, round 3", 2026-10-11): wired for a listening test, not
// shipped. Its licence is the bilibili Model Use License — commercial use below 100 million
// monthly users or RMB 1 billion a year, and "the model and its outputs may not be used to
// improve other commercial AI models" (../audio.cpp/docs/model_licenses.md); shipping it needs a
// ruling and, like Pocket TTS, a terms gate (`TERMS`), which this test leaves out.
//
// Emotion (../audio.cpp/docs/models/index_tts.md): from words (`use_emotion_text` +
// `emotion_text`, read by its built-in Qwen3-0.6B emotion model), an 8-float vector, or a clip.
// A line's direction goes as the words; `emotion_alpha` blends it in (`engines/audiocpp/slot.js`).

import { modelSource } from "../audiocpp/release.js";

export const ID = "indextts";
export const NAME = "IndexTTS";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const LICENSE = "bilibili Model Use License";

export const CAPABILITIES = {
  preset_voices: false,
  voice_cloning: true,
  voice_design: false,
  // A line's direction reaches it as emotion text.
  instruct_field: true,
  paralinguistic_tags: false,
  phoneme_override: false,
};

export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

const Q8_25 = "IndexTTS2.5-GGUF/index-tts2_5-q8_0.gguf";
const Q8_2 = "IndexTTS2-GGUF/index-tts2-q8_0.gguf";

export const DEFAULT_VARIANT_ID = "indextts-25-q8";

export const STATIC_VOICES = [];

export const DESCRIPTION =
  "IndexTTS: clones a voice from a short clip and sets its emotion apart from the voice, from a few " +
  "words. Runs in the audio.cpp speech runtime.";

export const VARIANTS = [
  {
    id: "indextts-25-q8",
    name: "IndexTTS 2.5",
    description: `${DESCRIPTION} 2.5: Chinese, English, Japanese, Spanish and Arabic. 8-bit weights.`,
    languages: ["zh", "en", "ja", "es", "ar"],
    voice_cloning: true,
    voice_design: false,
    preset_voices: 0,
    weights_license: "bilibili Model Use License",
    sources: [modelSource(Q8_25, 3_502_955_328)],
    audiocpp: { family: "index_tts2", task: "tts", file: Q8_25 },
    split_chars: 200,
  },
  {
    id: "indextts-2-q8",
    name: "IndexTTS 2",
    description: `${DESCRIPTION} 2: Chinese and English. 8-bit weights.`,
    languages: ["zh", "en"],
    voice_cloning: true,
    voice_design: false,
    preset_voices: 0,
    weights_license: "bilibili Model Use License",
    sources: [modelSource(Q8_2, 3_633_888_608)],
    audiocpp: { family: "index_tts2", task: "tts", file: Q8_2 },
    split_chars: 200,
  },
];
