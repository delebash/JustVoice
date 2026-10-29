// SPDX-License-Identifier: MIT
// MagpieTTS Multilingual 357M — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. NVIDIA’s Open Model License says its models are “commercially usable” and claims no rights in what they make; its card lists audiobook narration among its uses.",
  url: "https://huggingface.co/nvidia/magpie_tts_multilingual_357m",
  checked: "2026-10-15",
};

// audio.cpp's own piece budget for Magpie, in characters: its spec's `text_chunk_size` default
// until upstream's v0.9.3 made it depend on the language ("default 100 for zh and ko, otherwise
// 300", model_specs/magpie_tts.json; src/models/magpie_tts/tokenizer_text.cpp:1051) and the spec
// stopped giving one. Kept so a calibrating piece, and the price measured at it, stays what it was
// (generated.js `textChunkSize`).
export const TEXT_CHUNK_SIZE = 300;
