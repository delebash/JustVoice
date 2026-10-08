// SPDX-License-Identifier: MIT
// Manifest for Qwen3-TTS — run by the audio.cpp runtime (the port of
// justvoice/engines/qwen3/manifest.py).
//
// Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) each Qwen3
// checkpoint is one GGUF file served by audio.cpp — the same files run on CUDA, Vulkan, Metal
// and CPU. Measured on an RTX 2070 SUPER: 2.0× real time against 0.26× for the PyTorch engine
// it replaces.
//
// Three checkpoint families, and they are not interchangeable (model cards, re-verified
// 2026-08-15):
// - CustomVoice — 9 preset speakers + the `instruct` field for tone, emotion and prosody. It
//   CANNOT clone.
// - Base — clones from a reference clip (+ its transcript, when we have it). No preset
//   speakers; written direction is dropped.
// - VoiceDesign — a voice invented from a prose description; 1.7B only.
//
// Every checkpoint speaks the same 10 languages, and audio.cpp takes them by NAME ("English"),
// not code — `engines/audiocpp/slot.js` maps ours.
//
// CustomVoice 0.6B is our own conversion (switch plan §5, gap 4): audio.cpp's model repo
// publishes CustomVoice at 1.7B only, so the official checkpoint was converted with the
// runtime's `audiocpp_gguf` and published at `CV_06_REPO` — the command, the tensor split and
// the checks are in docs/plans/2026-10-02-gap-4-customvoice-0.6b.md and that repo's README.

import { modelSource, sixteenBit } from "../audiocpp/release.js";

export const ID = "qwen3";
export const NAME = "Qwen3-TTS";
export const DESCRIPTION =
  "Alibaba's open-weight TTS, 10 languages. CustomVoice — 9 preset speakers you can " +
  "direct in plain words; Base — clones a voice from a short clip; VoiceDesign — a " +
  "voice from a written description. Runs in the audio.cpp speech runtime.";
export const LICENSE = "Apache-2.0";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];

export const CAPABILITIES = {
  preset_voices: true,
  // The union across variants: Base clones, CustomVoice does not. The per-variant
  // `voice_cloning` flag below is the one the catalog filter reads.
  voice_cloning: true,
  voice_design: true,
  instruct_field: true,
  // No tag vocabulary — Qwen takes direction as prose, in `instruct`.
  paralinguistic_tags: false,
};

export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

const LANGS = ["zh", "en", "ja", "ko", "de", "fr", "ru", "pt", "es", "it"];

// The longest piece a line reaches the model in (audit 2026-10-04 §13.3). Qwen3's working
// memory grows with the line: 752 characters peaked at 7,122 MB on VoiceDesign whole and
// 3,976 MB in 200-character pieces, at the same speed (§3.3). VoiceDesign's own size waits
// for a listening test — its voice is drawn from the description on every piece.
export const SPLIT_CHARS = 200;

function variant(vid, name, filePath, size, quality, presets, description, { task = "tts", cloning = false, design = false, source = null, split = SPLIT_CHARS } = {}) {
  const row = {
    id: vid,
    name,
    description,
    languages: [...LANGS],
    voice_cloning: cloning,
    voice_design: design,
    preset_voices: presets,
    quality,
    weights_license: "Apache-2.0",
    sources: [source || modelSource(filePath, size)],
    audiocpp: { family: "qwen3_tts", task, file: filePath, clone: cloning },
  };
  if (split) row.split_chars = split;
  return row;
}

// Our conversion of Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice @ 85e237c (gap 4), pinned by commit.
export const CV_06_REPO = "delebash/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF";
export const CV_06_REVISION = "5c14bf487cbb232c08ca8644e569984d9f653a39"; // q8_0 + bf16 (gap 9)
const CV_06_FILE = "qwen3-tts-12hz-0.6b-customvoice-q8_0.gguf";
const CV_06_SIZE = 1_710_423_328;
const CV_06_BF16 = "qwen3-tts-12hz-0.6b-customvoice-bf16.gguf";
const CV_06_BF16_SIZE = 2_157_313_376;

const EIGHT_BIT = [
  variant(
    "qwen3-cv-1.7b-q8",
    "Qwen3-TTS CustomVoice 1.7B",
    "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-q8_0.gguf",
    2_817_044_064,
    92,
    9,
    "9 preset speakers you can direct in plain words. No cloning — Base clones.",
  ),
  variant(
    "qwen3-cv-0.6b-q8",
    "Qwen3-TTS CustomVoice 0.6B",
    CV_06_FILE,
    CV_06_SIZE,
    80,
    9,
    "The same 9 directable speakers in a smaller, lighter model. No cloning — Base " +
      "clones. Converted by JustVoice from Qwen's checkpoint.",
    { source: modelSource(CV_06_FILE, CV_06_SIZE, { repo: CV_06_REPO, revision: CV_06_REVISION }) },
  ),
  variant(
    "qwen3-base-1.7b-q8",
    "Qwen3-TTS Base 1.7B (cloning)",
    "Qwen3-TTS-12Hz-1.7B-Base-GGUF/qwen3-tts-12hz-1.7b-base-q8_0_v2.gguf",
    2_695_175_104,
    90,
    0,
    "Clones a voice from a 3–10 second clip; no preset speakers; written direction is dropped.",
    { cloning: true },
  ),
  variant(
    "qwen3-base-0.6b-q8",
    "Qwen3-TTS Base 0.6B (cloning)",
    "Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-q8_0.gguf",
    1_991_211_136,
    78,
    0,
    "The lighter cloning checkpoint.",
    { cloning: true },
  ),
  variant(
    "qwen3-vd-1.7b-q8",
    "Qwen3-TTS VoiceDesign 1.7B",
    "Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF/qwen3-tts-12hz-1.7b-voicedesign-q8_0.gguf",
    2_816_988_960,
    90,
    0,
    "Invents a voice from a written description — no reference audio. Powers Design from words.",
    { task: "vdes", design: true, split: null },
  ),
];
const BY_ID = Object.fromEntries(EIGHT_BIT.map((r) => [r.id, r]));

// Each checkpoint's 16-bit file at the same pinned commit (gap 9) — byte sizes from that
// commit's tree. The 8-bit rows stay the defaults.
export const VARIANTS = [
  ...EIGHT_BIT,
  sixteenBit(BY_ID["qwen3-cv-1.7b-q8"], "Qwen3-TTS-12Hz-1.7B-CustomVoice-GGUF/qwen3-tts-12hz-1.7b-customvoice-bf16.gguf", 4_179_144_352),
  sixteenBit(BY_ID["qwen3-cv-0.6b-q8"], CV_06_BF16, CV_06_BF16_SIZE, {
    source: modelSource(CV_06_BF16, CV_06_BF16_SIZE, { repo: CV_06_REPO, revision: CV_06_REVISION }),
  }),
  sixteenBit(BY_ID["qwen3-base-1.7b-q8"], "Qwen3-TTS-12Hz-1.7B-Base-GGUF/qwen3-tts-12hz-1.7b-base-bf16.gguf", 4_203_158_464),
  sixteenBit(BY_ID["qwen3-base-0.6b-q8"], "Qwen3-TTS-12Hz-0.6B-Base-GGUF/qwen3-tts-12hz-0.6b-base-bf16.gguf", 2_516_154_496),
  sixteenBit(BY_ID["qwen3-vd-1.7b-q8"], "Qwen3-TTS-12Hz-1.7B-VoiceDesign-GGUF/qwen3-tts-12hz-1.7b-voicedesign-bf16.gguf", 4_179_089_248),
];

// Plain Load (no variant picked) loads CustomVoice 1.7B.
export const DEFAULT_VARIANT_ID = "qwen3-cv-1.7b-q8";

// CustomVoice's preset speakers — shown before the engine is loaded.
export const STATIC_VOICES = [
  { id: "Vivian", name: "Vivian", language: "zh", gender: "female" },
  { id: "Serena", name: "Serena", language: "zh", gender: "female" },
  { id: "Uncle_Fu", name: "Uncle Fu", language: "zh", gender: "male" },
  { id: "Dylan", name: "Dylan", language: "zh", gender: "male" },
  { id: "Eric", name: "Eric", language: "zh", gender: "male" },
  { id: "Ryan", name: "Ryan", language: "en", gender: "male" },
  { id: "Aiden", name: "Aiden", language: "en", gender: "male" },
  { id: "Ono_Anna", name: "Ono Anna", language: "ja", gender: "female" },
  { id: "Sohee", name: "Sohee", language: "ko", gender: "female" },
];
