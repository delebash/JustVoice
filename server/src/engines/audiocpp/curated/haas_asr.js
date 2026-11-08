// SPDX-License-Identifier: MIT
// Haas-ja v1.0 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// A Japanese recogniser on NVIDIA's Parakeet-TDT design, offered from the model revision 73ce4162
// (docs/plans/2026-11-08-latest-models.md).

// What JustVoice measured (docs/plans/2026-11-08-latest-models.md D15): on our fork's merged build, the
// 8 GB card, through the app's Transcription, a Japanese sentence Kokoro's Alpha spoke.
export const TESTED = {
  date: "2026-11-08",
  record: "docs/plans/2026-11-08-latest-models.md D15",
  note: "On the card: every character of a spoken Japanese sentence, in 11 s with the load.",
};

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-11-08 (its maker's card, "## License"). The
// licence itself is what counts.
export const LICENCE = {
  name: "Apache-2.0",
  commercial: "Yes",
  summary: "Yes. Apache-2.0: “The model weights and the inference code are released under the Apache 2.0 License.” Japanese only.",
  url: "https://huggingface.co/third-intelligence/Haas-ja-v1.0",
  checked: "2026-11-08",
};
