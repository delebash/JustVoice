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

// Not offered (decided 2026-10-11, TASKS "The download test's first findings"; again 2026-10-15,
// "Slice 2's acceptance findings" 1, after a few hours listed without cloning). It reads SEA-G2P
// phonemes, not text: audio.cpp takes plain text only once `vieneu_v3_turbo.g2p_library` names
// sea-g2p, a Rust library the release doesn't build (../audio.cpp/docs/models/vieneu_v3_turbo.md:56-81)
// — from text and a clip it babbled 14.8 s for a line others speak in 4–5 s (RESEARCH §10.14). At
// v0.9.2 it also refuses to speak without a voice ("requires a voice: --voice-ref,
// reference_codes_file, or speaker_embedding_file…", RESEARCH §10.15).
export const NOT_OFFERED =
  "It reads phonemes from SEA-G2P, a library the speech runtime's release doesn't build — from text and a clip it babbled — and it won't speak without a voice.";
