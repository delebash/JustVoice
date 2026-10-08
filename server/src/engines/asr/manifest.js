// SPDX-License-Identifier: MIT
// Manifest for speech recognition — dictation, clone transcripts, captions (the port of
// justvoice/engines/asr/manifest.py).
//
// Replaced Whisper at the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) — user:
// "as long as qwen asr is as good as whisper we can drop whisper". Measured on 197 clips with
// known text (plan §2.2): on English, Qwen3-ASR 1.7B gets fewer words wrong than Whisper turbo
// (4.3% against 5.8% on human speech). Each variant carries Qwen3's forced aligner as a
// companion file, so captions get word times for the KNOWN text.
//
// What it does not give: a confidence score, and — on the small sample measured — weaker
// recognition outside English, especially when no language is set (plan §8 D).

import { modelSource, sixteenBit } from "../audiocpp/release.js";

export const ID = "asr";
export const NAME = "Speech recognition";
export const KIND = "stt";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const DESCRIPTION =
  "Turns speech into text for dictation, clone transcripts and captions (with word " +
  "timings). Runs in the audio.cpp speech runtime.";
export const LICENSE = "Apache-2.0";
export const CAPABILITIES = { stt: true };
export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

const ALIGNER = "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf";
const ALIGNER_SIZE = 1_129_966_496;

const QWEN3_ASR_LANGS = [
  "zh", "en", "yue", "ar", "de", "fr", "es", "pt", "id", "it", "ko", "ru", "th", "vi",
  "ja", "tr", "hi", "ms", "nl", "sv", "da", "fi", "pl", "cs", "fil", "fa", "el", "ro",
  "hu", "mk",
];

export const VARIANTS = [
  {
    id: "qwen3-asr-1.7b-q8",
    name: "Qwen3-ASR 1.7B",
    description:
      "30 languages. Set the language when you know it — detection is the " +
      "weak spot. Word timings from Qwen3's aligner.",
    languages: [...QWEN3_ASR_LANGS],
    voice_cloning: false,
    preset_voices: 0,
    quality: 90,
    weights_license: "Apache-2.0",
    sources: [
      {
        ...modelSource("Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf", 2_473_010_048),
        files: ["Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf", ALIGNER],
        size_bytes: 2_473_010_048 + ALIGNER_SIZE,
      },
    ],
    audiocpp: {
      family: "qwen3_asr",
      task: "asr",
      file: "Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-q8_0.gguf",
      companions: [{ role: "aligner", family: "qwen3_forced_aligner", task: "align", file: ALIGNER }],
    },
    // Seconds of audio per second of work on the CPU, with its GPU accuracy — the reference
    // machine's figure (Ryzen 7 5700X, 8 threads, 2026-10-02) until a transcription measures
    // this one (docs/plans/2026-10-02-cpu-placement.md §6).
    cpu_realtime: 2.6,
  },
];

// The 16-bit recogniser and aligner at the same pinned commit (gap 9; audio.cpp ships both as
// f16); the 8-bit row stays the default.
const ASR_F16 = "Qwen3-ASR-1.7B-GGUF/qwen3-asr-1.7b-f16.gguf";
const ASR_F16_SIZE = 4_087_653_248;
const ALIGNER_F16 = "Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-f16.gguf";
const ALIGNER_F16_SIZE = 1_840_097_696;
VARIANTS.push(
  sixteenBit(VARIANTS[0], ASR_F16, ASR_F16_SIZE, {
    dtype: "f16",
    source: { ...modelSource(ASR_F16, ASR_F16_SIZE), files: [ASR_F16, ALIGNER_F16], size_bytes: ASR_F16_SIZE + ALIGNER_F16_SIZE },
    companions: [{ role: "aligner", family: "qwen3_forced_aligner", task: "align", file: ALIGNER_F16 }],
  }),
);

export const DEFAULT_VARIANT_ID = "qwen3-asr-1.7b-q8";

export const STATIC_VOICES = [];
