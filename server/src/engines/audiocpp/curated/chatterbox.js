// SPDX-License-Identifier: MIT
// Chatterbox (with Turbo and Multilingual) — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine is built from audio.cpp's files as every engine is (generated.js `ownEngine`); this
// file keeps our ids, names and what JustVoice measured (the adoption plan's slice 4, F10). Turbo
// and Nano, audio.cpp's `chatterbox_turbo` family, join the same engine (chatterbox_turbo.js).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// No watermark claim (corrected 2026-10-15): Resemble's own package adds its PerTh watermark,
// audio.cpp doesn't (user, 2026-10-01: "dont care about watermark"; no PerTh code in audio.cpp's src/).
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. MIT, nothing added.",
  url: "https://huggingface.co/ResembleAI/chatterbox",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = ["Someone’s own voice, with per-line emotion tags (Turbo, Nano)","Someone’s own voice in another language (Multilingual)"];

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/chatterbox/session.cpp:59-62).
// Chatterbox's request is its own (slot.js): it sends the name the pinned build reads (v0.9.0-jv.5
// reads only the old one), and its settings keep the app's names (capability_details.js).
export const OLD_OPTION_NAMES = {
  s3gen_cfg_rate: "flow_guidance_scale",
};

// Chatterbox Multilingual's v3 checkpoint (the adoption plan's F3) on the model's row itself,
// labelled with audio.cpp's own word — its spec: "Multilingual T3 checkpoint selection" — v2 the
// default, as the spec's (decided 2026-10-15, TASKS "Slice 3's six questions" 2). Its other load
// options fold (engines/audiocpp/runtime_options.js).
export const LOAD_OPTIONS = {
  multilingual_t3: {
    label: "Checkpoint",
    choices: { v2: "v2", v3: "v3" },
  },
};

// The engine. Since the 2026-10-01 switch Chatterbox is one GGUF file served by audio.cpp —
// measured on an RTX 2070 SUPER: 2.08× real time against 0.92× for the PyTorch engine it replaced,
// at 3.2 GB of VRAM instead of 5.4. Exaggeration and CFG are set per line (verified 2026-10-01 — no
// model reload). Turbo's 19 inline tags come with our build's Turbo (`paralinguistic_tags`).
export const ENGINE = {
  id: "chatterbox",
  name: "Chatterbox",
  description:
    "Resemble AI's open-source cloning TTS. Multilingual: 500M parameters, {languages} languages, zero-shot voice cloning, " +
    "per-line exaggeration / CFG / temperature. Runs in the audio.cpp speech runtime.",
  capabilities: { paralinguistic_tags: "turbo_clone" },
};

// Multilingual: clone-only — every voice is a reference clip the user brings. Its languages are the
// spec's (our fork's: Hebrew, Russian and Chinese, and Japanese with the optional dictionary, gap 7),
// each offered once the pinned build reads it (`LANGUAGE_FEATURES`).
export const MODELS = [
  {
    entry: "chatterbox",
    model: "chatterbox-multilingual",
    id: "chatterbox-multilingual-v2",
    name: "Chatterbox Multilingual ({languages} languages)",
    description: "Zero-shot cloning from a reference clip, with exaggeration and CFG per line. 8-bit weights.",
    quality: 88,
    packages: ["chatterbox_q8_0", "chatterbox_f16"],
  },
];

// The languages our audio.cpp added (gap 7), offered once the pinned build has them.
export const LANGUAGE_FEATURES = { he: "chatterbox_he_ru_zh", ru: "chatterbox_he_ru_zh", zh: "chatterbox_he_ru_zh", ja: "japanese" };
