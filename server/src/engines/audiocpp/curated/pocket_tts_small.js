// SPDX-License-Identifier: MIT
// Pocket TTS Small — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Kyutai's smaller Pocket TTS checkpoints (2M, 7M and 18M, each with a "refl" twin), offered from the
// model revision 73ce4162 (docs/plans/2026-11-08-latest-models.md).

// What JustVoice measured (docs/plans/2026-11-08-latest-models.md D21, round 11): its 18M package on the
// CPU, the Hatter's cloned voice, 13 book lines told and plain, seeds 7–9, through the app.
export const TESTED = {
  date: "2026-11-08",
  record: "docs/plans/2026-11-08-latest-models.md D21",
  note: "Round 11: 2 % of words wrong read back; it doesn't act a feeling it's told (LAION gain 0.00).",
};

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-11-08: audio.cpp-gguf's PocketTTS-Small-GGUF/README.md ("Model
// weights are licensed under CC-BY-4.0", checkpoint kyutai/pocket-tts db04f0e6) and Kyutai's own
// card (the same terms Pocket TTS has, curated/pocket_tts.js). The licence itself is what counts.
export const LICENCE = {
  name: "CC-BY-4.0",
  commercial: "Yes",
  summary: "Yes. CC-BY-4.0: credit Kyutai. Kyutai’s terms forbid cloning a voice without that person’s explicit consent and passing the audio off as a real recording.",
  url: "https://huggingface.co/kyutai/pocket-tts",
  checked: "2026-11-08",
};
