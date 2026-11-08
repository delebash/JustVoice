// SPDX-License-Identifier: MIT
// Underdog Bark 3.0 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// An English recogniser (0.6B, a fine-tune of NVIDIA's Parakeet-TDT), offered from the model revision
// 73ce4162 (docs/plans/2026-11-08-latest-models.md).

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading at its source, checked 2026-11-08: the maker's card says "Licence CC BY-NC 4.0 (see
// `LICENSE`; commercial use: license@conway.tech)". The repo's history: released 2026-10-15
// (85db2ad1) under CC-BY-4.0, switched on 2026-11-05 ("Switch the license to CC BY-NC 4.0",
// e7a641c0). audio.cpp's GGUF was added 2026-11-03 (audio.cpp-gguf 0918f432) and its licence table
// still reads CC-BY-4.0 (checked 2026-10-29); the file itself records no source revision or licence
// (its header, read 2026-11-08). The maker's word today is the one shown. The licence itself is what
// counts.
export const LICENCE = {
  name: "CC-BY-NC-4.0",
  commercial: "Separate licence",
  summary: "Non-commercial, CC BY-NC 4.0, since 5 November 2026; its maker sells a commercial licence (license@conway.tech). It was CC-BY-4.0 when audio.cpp converted it; its maker’s word today is the one that counts here.",
  url: "https://huggingface.co/ConwayResearch/Underdog-Bark-3.0",
  checked: "2026-11-08",
};
