// SPDX-License-Identifier: MIT
// NVIDIA Nemotron 3.5 Transcribe 30B-A4B — what audio.cpp's spec can't say (docs/plans/2026-10-11-
// audiocpp-engine-catalog.md §4). Speech recognition in 40 languages; "34B (4.3B active), including
// the audio encoder" (its model card) — more than an 8 GB card holds, which audio.cpp meets with CPU
// expert offload (upstream #1154). Not yet tested by JustVoice.

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-11-05 (RESEARCH §10.13); the licence itself is
// what counts. Its card: "Use of this model is governed by the OpenMDW License Agreement, version 1.1"
// and "This model is ready for commercial or non-commercial use."
export const LICENCE = {
  name: "OpenMDW-1.1",
  commercial: "Yes",
  summary: "Yes. OpenMDW-1.1, and NVIDIA says it’s ready for commercial use. Keep its licence and notices with any copy.",
  url: "https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B",
  checked: "2026-11-05",
};
