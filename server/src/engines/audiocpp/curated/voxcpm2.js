// SPDX-License-Identifier: MIT
// VoxCPM2 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine is built from audio.cpp's files as every engine is (generated.js `ownEngine`); this
// file keeps our ids, names and what JustVoice measured (the adoption plan's slice 4, F10).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes — “free for commercial use”, in its makers’ words (Apache-2.0). They ask that AI-generated audio be labelled.",
  url: "https://huggingface.co/openbmb/VoxCPM2",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = ["Cloning, designing and written direction together"];

// The engine (gap 9 of the switch plan, docs/plans/2026-10-02-gap-9-16bit-and-voxcpm2.md):
// OpenBMB's 2B model, Apache-2.0, 48 kHz output, run on audio.cpp's plain speech task — a reference
// clip clones the voice; a voice description, or a line's written direction on a clone, rides a
// parenthesised prefix on the text (slot.js). The clip's transcript reaches the model from our build
// v0.9.0-jv.1 on (`voxcpm2_transcript`): the approved text (TASKS gap 9) says "and its transcript",
// held back until our copy of audio.cpp passed it on, so the description follows the pinned build
// (`description_until`). On the CPU it ran at 0.2× real time with a 15 GB peak (2026-10-02) — a
// graphics-card model.
export const ENGINE = {
  id: "voxcpm2",
  name: "VoxCPM2",
  description:
    "OpenBMB's 2B model, 30 languages: clones a voice from a short clip and its transcript, or designs one from a written " +
    "description. Runs in the audio.cpp speech runtime.",
  description_until: {
    voxcpm2_transcript:
      "OpenBMB's 2B model, 30 languages: clones a voice from a short clip, or designs one from a written description. Runs in " +
      "the audio.cpp speech runtime.",
  },
  // Written direction reaches it as the parenthesised prefix — on a clone too.
  capabilities: { instruct_field: true },
};

// Its one model: it clones and designs. `split_chars`: the longest piece a line reaches it in (audit
// 2026-10-04 §13.3) — 752 characters peaked at 6,438 MB whole, 5,230 MB in 200-character pieces; a
// description voice keeps the full length: split, it changed person (listened 2026-10-04). Its
// original precision is audio.cpp's own package, offered since the adoption plan's E14/F5.
export const MODELS = [
  {
    entry: "voxcpm2",
    model: "voxcpm2",
    id: "voxcpm2",
    name: "VoxCPM2",
    description: "{engine} 8-bit weights.",
    design: true,
    split_chars: 200,
    packages: ["voxcpm2_q8_0", "voxcpm2_bf16", "voxcpm2_orig"],
  },
];

// audio.cpp's list adds "zh dialects", a description rather than a language; left out, as before
// (whether and how to show it is open — the narrowings review F10).
export const LEFT_OUT_LANGUAGES = ["zh dialects"];
