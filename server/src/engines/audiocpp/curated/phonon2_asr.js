// SPDX-License-Identifier: MIT
// Phonon-2 (FermionResearch) — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-
// engine-catalog.md §4). English speech recognition "Based on parakeet-tdt-0.6b-v3 by NVIDIA" (its
// model card). Not yet tested by JustVoice.

// What JustVoice measured (docs/plans/2026-11-08-latest-models.md D15): offered since the model files
// moved to 73ce4162; on our fork's merged build, the 8 GB card, through the app's Transcription.
export const TESTED = {
  date: "2026-11-08",
  record: "docs/plans/2026-11-08-latest-models.md D15",
  note: "On the card: every word of a 10-second clip, in 9 s with the load.",
};

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-11-05 (RESEARCH §10.13); the licence itself is
// what counts. Its card: "Licence CC-BY-4.0, same as the original"; "`NOTICE` lists the changes."
export const LICENCE = {
  name: "CC-BY-4.0",
  commercial: "Yes",
  summary: "Yes. CC-BY-4.0: credit FermionResearch’s Phonon-2 and NVIDIA’s Parakeet it’s built on.",
  url: "https://huggingface.co/FermionResearch/Phonon-2",
  checked: "2026-11-05",
};
