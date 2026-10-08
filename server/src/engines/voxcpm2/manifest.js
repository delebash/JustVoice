// SPDX-License-Identifier: MIT
// Manifest for VoxCPM2 — cloning and voice design in one model, run by the audio.cpp runtime
// (the port of justvoice/engines/voxcpm2/manifest.py).
//
// Added with gap 9 of the switch plan (docs/plans/2026-10-02-gap-9-16bit-and-voxcpm2.md).
// OpenBMB's 2B model, Apache-2.0 (upstream repo not gated), 30 languages, 48 kHz output.
// audio.cpp v0.9.0 runs it on the plain speech task only ("VoxCPM2 only supports the Tts
// task"):
// - a reference clip clones the voice (`voice_ref`);
// - a voice description — or a line's written direction on a clone — rides a parenthesised
//   prefix on the text, "(a deep, slow, elderly man's voice)The line.", which is how VoxCPM2
//   takes it (its README; audio.cpp splits the leading tag off and does not speak it —
//   measured 2026-10-02 with a Qwen3-ASR read-back);
// - the clip's transcript reaches the model from our build v0.9.0-jv.1 on: VoxCPM2's
//   transcript-guided cloning needs the clip as prompt audio too, and upstream v0.9.0's server
//   set prompt audio for transcription only — measured with the CLI, the transcript alone
//   changed nothing. Our copy passes the clip as prompt audio when a transcript comes with it
//   (audio.cpp 0acac2b1). An older installed build ignores the transcript.
//
// Per request: `guidance_scale` (CFG) and `num_inference_steps`, and the seed. On the CPU it
// ran at 0.2× real time with a 15 GB peak footprint (2026-10-02) — a graphics-card model.
//
// What follows the pin (the description) is computed by `build()` — what Python's module
// body did at import.

import { modelSource, pinnedHas, sixteenBit } from "../audiocpp/release.js";

export const ID = "voxcpm2";
export const NAME = "VoxCPM2";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const LICENSE = "Apache-2.0";

export const CAPABILITIES = {
  preset_voices: false,
  voice_cloning: true,
  voice_design: true,
  // Written direction reaches it as the parenthesised prefix — on a clone too.
  instruct_field: true,
  paralinguistic_tags: false,
  phoneme_override: false,
};

export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

// audio.cpp's voxcpm2 spec (v0.9.0) lists these 30 plus "zh dialects".
const LANGS = [
  "ar", "my", "zh", "da", "nl", "en", "fi", "fr", "de", "el", "he", "hi", "id", "it", "ja",
  "km", "ko", "lo", "ms", "no", "pl", "pt", "ru", "es", "sw", "sv", "tl", "th", "tr", "vi",
];

const Q8 = "VoxCPM2-GGUF/voxcpm2-q8_0.gguf";

export const DEFAULT_VARIANT_ID = "voxcpm2-q8";

// Cloned or designed — every voice is the user's own; no presets.
export const STATIC_VOICES = [];

/** The pin-dependent half of the manifest, as the module body computed it. */
export function build() {
  // The approved text (TASKS gap 9) says "and its transcript"; it was held back until our copy
  // of audio.cpp passed the transcript on, and follows the pinned build.
  const DESCRIPTION = pinnedHas("voxcpm2_transcript")
    ? "OpenBMB's 2B model, 30 languages: clones a voice from a short clip and its transcript, or " +
      "designs one from a written description. Runs in the audio.cpp speech runtime."
    : "OpenBMB's 2B model, 30 languages: clones a voice from a short clip, or designs one from a " +
      "written description. Runs in the audio.cpp speech runtime.";
  const VARIANTS = [
    {
      id: "voxcpm2-q8",
      name: "VoxCPM2",
      description: `${DESCRIPTION} 8-bit weights.`,
      languages: [...LANGS],
      voice_cloning: true,
      voice_design: true,
      preset_voices: 0,
      weights_license: "Apache-2.0",
      sources: [modelSource(Q8, 2_955_000_480)],
      audiocpp: { family: "voxcpm2", task: "tts", file: Q8 },
      // The longest piece a line reaches the model in (audit 2026-10-04 §13.3): 752 characters
      // peaked at 6,438 MB whole, 5,230 MB in 200-character pieces. A description voice keeps
      // the full length: split, it changed person (listened 2026-10-04).
      split_chars: 200,
    },
  ];
  VARIANTS.push(sixteenBit(VARIANTS[0], "VoxCPM2-GGUF/voxcpm2-bf16.gguf", 4_772_288_288));
  return { DESCRIPTION, VARIANTS };
}

const built = build();
export const DESCRIPTION = built.DESCRIPTION;
export const VARIANTS = built.VARIANTS;
