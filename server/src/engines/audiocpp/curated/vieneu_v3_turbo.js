// SPDX-License-Identifier: MIT
// VieNeu-TTS v3 Turbo — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Unclear"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "Apache-2.0", // audio.cpp's table has none
  commercial: "Yes",
  summary: "Yes. Apache-2.0, and its makers say its audio may be used in commercial and monetized content. A cloned voice must be one you have the right to use.",
  url: "https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo",
  checked: "2026-10-11",
};

// Not offered. Hidden 2026-10-11 on the implementer's pick: the question (hide it, or mark it
// "doesn't clone from a clip yet") had no recommendation for VieNeu when the user said "your rec on
// both go" (TASKS "The download test's first findings"). Decided 2026-10-13 (the narrowings review
// K2): list it, marked as not cloning yet — built with the adoption plan
// (docs/plans/2026-10-13-adopt-everything-audiocpp.md); until then it stays hidden. It reads SEA-G2P
// phonemes, not text, and needs a speaker embedding its unported CAM++ encoder would make (audio.cpp
// docs/community_models/vieneu_v3_turbo.md) — from text and a clip it babbled 14.8 s for a line others speak in 4–5 s.
export const NOT_OFFERED =
  "It reads phonemes from a separate library, not text, and needs a speaker embedding audio.cpp can't make yet — from text and a clip it babbles.";
