// SPDX-License-Identifier: MIT
// XTTS v2 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-29 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table has no row for it. Its GGUF files (onicubag/xTTSv2-GGUF) are tagged MPL-2.0 —
// the licence of Coqui's code — but they are Coqui's XTTS-v2 weights, whose own LICENSE.txt is the
// Coqui Public Model License 1.0.0: "This license allows only non-commercial use of a machine
// learning model and its outputs", non-commercial "only so far as you do not receive any direct or
// indirect payment arising from the use of the model or its output".
export const LICENCE = {
  name: "Coqui Public Model License 1.0.0", // audio.cpp's table has none
  commercial: "No",
  summary:
    "No. Coqui’s licence allows only non-commercial use of the model and of what it makes — nothing you are paid for, directly or indirectly. The converted files say MPL-2.0, but they are Coqui’s weights.",
  url: "https://huggingface.co/coqui/XTTS-v2/blob/main/LICENSE.txt",
  checked: "2026-10-29",
};
