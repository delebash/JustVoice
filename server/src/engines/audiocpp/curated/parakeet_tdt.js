// SPDX-License-Identifier: MIT
// Parakeet-TDT 0.6B v3 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// What JustVoice measured (docs/plans/2026-11-08-latest-models.md D15): Orukeet r3, new from the model
// revision 73ce4162, on our fork's merged build, the 8 GB card, through the app's Transcription.
export const TESTED = {
  date: "2026-11-08",
  record: "docs/plans/2026-11-08-latest-models.md D15",
  note: "Orukeet r3 on the card: every word of a 10-second clip, in 11 s with the load.",
};

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself
// is what counts.
// The model JustVoice downloads is NVIDIA's parakeet-tdt-0.6b-v3 (audio.cpp-gguf
// Parakeet-TDT-0.6B-v3-GGUF); the catalog's licence row for the family is FermionResearch/Phonon-2's,
// the last of the three rows audio.cpp's table gives `parakeet_tdt`. From the model revision 73ce4162
// the family also offers Orukeet r3, Oruk AI's fine-tune of it (Orukeet-GGUF): its NOTICE.md and
// LICENSE-WEIGHTS make the r3 weights CC BY-SA 4.0, "This permits commercial use and modification,
// with attribution and applicable ShareAlike requirements" (read 2026-11-08).
export const LICENCE = {
  name: "CC-BY-4.0",
  commercial: "Yes",
  summary: "Yes. CC-BY-4.0: credit NVIDIA’s Parakeet. NVIDIA says it’s ready for commercial use. Orukeet, Oruk AI’s fine-tune of it, is CC BY-SA 4.0: credit both, and share any change to its weights under the same licence.",
  url: "https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3",
  checked: "2026-11-08",
};
