// SPDX-License-Identifier: MIT
// Qwen3-TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine is built from audio.cpp's files as every engine is (generated.js `ownEngine`); this
// file keeps our ids, names, genders, which checkpoint does what, and what JustVoice measured (the
// adoption plan's slice 4, F10).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = ["To direct performances in words (CustomVoice)","Someone’s own voice, in 10 languages (Base)","A voice designed from a description (VoiceDesign)"];

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/qwen3_tts/session.cpp:676-699).
// Qwen3's request is its own (slot.js): it sends the names the pinned build reads (v0.9.0-jv.5
// reads only the old ones), and its settings keep the app's names (capability_details.js).
export const OLD_OPTION_NAMES = {
  speaker: "voice_id",
  instruction: "instruct",
};

// What JustVoice knows about two of its load options (engines/audiocpp/runtime_options.js), shown
// on the model's row itself (audit 2026-10-04 §13.5, batch 5h). Measured on Qwen3-TTS CustomVoice
// 1.7B, a 752-character line in 200-character pieces, on an 8 GB card (RESEARCH §2.1):
// `perf_mode=flash_attention` 194 MB less at the peak and 9 % faster, a different take for the
// same seed; `conv_weight_type=f16` 492 MB less, the audio 2.04 dB (log-spectral) from the 32-bit
// take. `default`: the app's own, sent unless another is chosen —
// the user couldn't tell 16-bit decoder weights from 32-bit by ear (2026-10-04), so 16-bit is
// the default, where audio.cpp's own is 32-bit.
export const LOAD_OPTIONS = {
  perf_mode: {
    label: "Attention",
    choices: { off: "Exact", flash_attention: "Flash attention" },
    hint: "Flash attention: about 9 % faster and 0.2 GB less at the peak; the same seed gives a different take.",
  },
  conv_weight_type: {
    label: "Decoder weights",
    choices: { f16: "16-bit", f32: "32-bit" },
    default: "f16",
    hint: "16-bit: about 0.5 GB less at the peak than 32-bit; no difference heard.",
  },
};

// The engine: Alibaba's three checkpoint families, which are not interchangeable (model cards,
// re-verified 2026-08-15): CustomVoice — 9 preset speakers + the `instruct` field for tone, emotion
// and prosody; it CANNOT clone. Base — clones from a reference clip (+ its transcript, when we have
// it); no preset speakers; written direction is dropped. VoiceDesign — a voice invented from a prose
// description; 1.7B only. audio.cpp's spec lists all three under one family, and its voices on
// every entry: which checkpoint clones, speaks the speakers or designs is ours (`clone`, `voices`,
// the vdes task). Since the 2026-10-01 switch each checkpoint is one GGUF file served by audio.cpp —
// measured on an RTX 2070 SUPER: 2.0× real time against 0.26× for the PyTorch engine it replaced.
// Plain Load (no model picked) loads CustomVoice 1.7B (`default`).
export const ENGINE = {
  id: "qwen3",
  name: "Qwen3-TTS",
  description:
    "Alibaba's open-weight TTS, 10 languages. CustomVoice — 9 preset speakers you can direct in plain words; Base — clones a " +
    "voice from a short clip; VoiceDesign — a voice from a written description. Runs in the audio.cpp speech runtime.",
  default: "qwen3-cv-1.7b-q8",
  capabilities: { instruct_field: true },
  // Each checkpoint's 8-bit row, then their 16-bit rows, then the original precision — the order
  // the list has always shown.
  order: "precision",
};

// Its checkpoints, in our ids (`<id>-<precision>`): `model` is the capability row a voice speaks
// on (sizes share one). `split_chars`: the longest piece a line reaches the model in (audit
// 2026-10-04 §13.3) — Qwen3's working memory grows with the line: 752 characters peaked at
// 7,122 MB on VoiceDesign whole and 3,976 MB in 200-character pieces, at the same speed (§3.3);
// VoiceDesign keeps the full length, since its voice is drawn from the description on every piece
// (listened 2026-10-04). CustomVoice 0.6B is our own conversion (switch plan §5, gap 4: audio.cpp
// publishes CustomVoice at 1.7B only), in our fork's catalog (docs/plans/2026-10-02-gap-4-
// customvoice-0.6b.md). Base 1.7B's original precision is audio.cpp's own package, offered since
// the adoption plan's E14/F5.
export const MODELS = [
  {
    entry: "qwen3-tts-1.7b-custom",
    model: "qwen3-cv",
    id: "qwen3-cv-1.7b",
    name: "Qwen3-TTS CustomVoice 1.7B",
    description: "9 preset speakers you can direct in plain words. No cloning — Base clones.",
    quality: 92,
    clone: false,
    split_chars: 200,
    packages: ["qwen3_tts_1_7b_customvoice_q8_0", "qwen3_tts_1_7b_customvoice_bf16"],
  },
  {
    entry: "qwen3-tts-0.6b-custom",
    model: "qwen3-cv",
    id: "qwen3-cv-0.6b",
    name: "Qwen3-TTS CustomVoice 0.6B",
    description: "The same 9 directable speakers in a smaller, lighter model. No cloning — Base clones. Converted by JustVoice from Qwen's checkpoint.",
    quality: 80,
    clone: false,
    split_chars: 200,
    packages: ["qwen3_tts_0_6b_customvoice_q8_0", "qwen3_tts_0_6b_customvoice_bf16"],
  },
  {
    entry: "qwen3-tts-1.7b",
    model: "qwen3-base",
    id: "qwen3-base-1.7b",
    name: "Qwen3-TTS Base 1.7B (cloning)",
    description: "Clones a voice from a 3–10 second clip; no preset speakers; written direction is dropped.",
    quality: 90,
    clone: true,
    voices: false,
    split_chars: 200,
    packages: ["qwen3_tts_1_7b_base_q8_0", "qwen3_tts_1_7b_base_bf16", "qwen3_tts_1_7b_base_orig"],
  },
  {
    entry: "qwen3-tts",
    model: "qwen3-base",
    id: "qwen3-base-0.6b",
    name: "Qwen3-TTS Base 0.6B (cloning)",
    description: "The lighter cloning checkpoint.",
    quality: 78,
    clone: true,
    voices: false,
    split_chars: 200,
    packages: ["qwen3_tts_0_6b_base_q8_0", "qwen3_tts_0_6b_base_bf16"],
  },
  {
    entry: "qwen3-tts-1.7b-vdesign",
    model: "qwen3-vd",
    id: "qwen3-vd-1.7b",
    name: "Qwen3-TTS VoiceDesign 1.7B",
    description: "Invents a voice from a written description — no reference audio. Powers Design from words.",
    quality: 90,
    clone: false,
    voices: false,
    packages: ["qwen3_tts_1_7b_voicedesign_q8_0", "qwen3_tts_1_7b_voicedesign_bf16"],
  },
];

// CustomVoice's speakers, by audio.cpp's name (the spec writes them in lower case): our id — as
// Qwen's model card writes them, which is what the request sends — display name, gender and the
// speaker's own language.
export const VOICES = {
  aiden: { id: "Aiden", name: "Aiden", gender: "male", language: "en" },
  dylan: { id: "Dylan", name: "Dylan", gender: "male", language: "zh" },
  eric: { id: "Eric", name: "Eric", gender: "male", language: "zh" },
  ono_anna: { id: "Ono_Anna", name: "Ono Anna", gender: "female", language: "ja" },
  ryan: { id: "Ryan", name: "Ryan", gender: "male", language: "en" },
  serena: { id: "Serena", name: "Serena", gender: "female", language: "zh" },
  sohee: { id: "Sohee", name: "Sohee", gender: "female", language: "ko" },
  uncle_fu: { id: "Uncle_Fu", name: "Uncle Fu", gender: "male", language: "zh" },
  vivian: { id: "Vivian", name: "Vivian", gender: "female", language: "zh" },
};
