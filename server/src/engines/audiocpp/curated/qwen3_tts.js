// SPDX-License-Identifier: MIT
// Qwen3-TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base",
  checked: "2026-10-11",
};

// A hand-wired engine (engines/<id>/manifest.js): wired and measured by hand, so tested; what it
// is best for is the Speech engines page's picking table (approved 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Wired by hand and measured by JustVoice.",
};

export const BEST_FOR = ["To direct performances in words (CustomVoice)","Someone’s own voice, in 10 languages (Base)","A voice designed from a description (VoiceDesign)"];

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/qwen3_tts/session.cpp:676-699).
// Applied once this family moves onto the generated path (the plan's slice 4); its hand-wired
// request keeps the names it sends today.
export const OLD_OPTION_NAMES = {
  speaker: "voice_id",
  instruction: "instruct",
};

// What JustVoice knows about two of its load options (engines/audiocpp/runtime_options.js), shown
// on the model's row itself (audit 2026-10-04 §13.5, batch 5h). Measured on Qwen3-TTS CustomVoice
// 1.7B, a 752-character line in 200-character pieces, on an 8 GB card (RESEARCH §2.1):
// `perf_mode=flash_attention` 194 MB less at the peak and 9 % faster, a different take for the
// same seed; `conv_weight_type=f16` 492 MB less, the audio 2.04 dB (log-spectral) from the 32-bit
// take. `only_8bit`: audio.cpp accepts it only with Q8_0 weights ("qwen3_tts.perf_mode=
// flash_attention is supported only with Q8_0 GGUF weights", ../audio.cpp
// src/models/qwen3_tts/session.cpp). `default`: the app's own, sent unless another is chosen —
// the user couldn't tell 16-bit decoder weights from 32-bit by ear (2026-10-04), so 16-bit is
// the default, where audio.cpp's own is 32-bit.
export const LOAD_OPTIONS = {
  perf_mode: {
    label: "Attention",
    choices: { off: "Exact", flash_attention: "Flash attention" },
    only_8bit: true,
    hint: "Flash attention: about 9 % faster and 0.2 GB less at the peak; the same seed gives a different take.",
  },
  conv_weight_type: {
    label: "Decoder weights",
    choices: { f16: "16-bit", f32: "32-bit" },
    default: "f16",
    hint: "16-bit: about 0.5 GB less at the peak than 32-bit; no difference heard.",
  },
};
