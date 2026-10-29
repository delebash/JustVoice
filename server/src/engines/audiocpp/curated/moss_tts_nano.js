// SPDX-License-Identifier: MIT
// MOSS-TTS Nano — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, confirmed by its makers.",
  url: "https://huggingface.co/OpenMOSS-Team/MOSS-TTS-Nano-100M",
  checked: "2026-10-11",
};

// audio.cpp's own piece budget for MOSS-TTS Nano, in characters: its spec's `text_chunk_size`
// default until upstream's v0.9.3 made it depend on the text ("default 50 when hanzi, kana and
// Hangul outnumber other letters and digits, otherwise 256", model_specs/moss_tts_nano.json;
// src/models/moss/moss_tts_nano/session.cpp:23) and the spec stopped giving one. Kept so a
// calibrating piece, and the price measured at it, stays what it was (generated.js `textChunkSize`).
export const TEXT_CHUNK_SIZE = 256;
