// SPDX-License-Identifier: MIT
// OmniVoice — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "No",
  summary: "No. The model is non-commercial (CC-BY-NC) because of its training data; only its code is Apache-2.0.",
  url: "https://huggingface.co/k2-fsa/OmniVoice#license",
  checked: "2026-10-11",
};

// Its model's id (the plan's §4: saved voices, personas and memory prices use it). A family with
// one model names it after the family; OmniVoice had one until our fork's catalog gave
// VoiceTut-TTS an entry (2026-10-15), so its own entry keeps the id it had.
export const MODEL_IDS = { omnivoice: "omnivoice" };
