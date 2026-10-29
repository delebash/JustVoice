// SPDX-License-Identifier: MIT
// F5-TTS (the Habibi-TTS Arabic checkpoints) — what audio.cpp's spec can't say
// (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4). Its packages are one self-contained GGUF
// each, the Vocos vocoder inside (audio.cpp's docs/models/f5_tts.md), so no companion downloads
// with it.

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15; the licence itself is what counts. audio.cpp's table
// says "No" for the family; the model card licenses its checkpoints two ways: "The unified, SAU,
// and UAE models are licensed under CC-BY-NC-SA-4.0, restricted by SADA and Mixat. All the rest
// (ALG, EGY, IRQ, MAR, MSA) are released under Apache 2.0 license."
export const LICENCE = {
  name: "CC-BY-NC-SA-4.0 or Apache-2.0, by model",
  commercial: "Conditional",
  summary:
    "Depends on the model. Habibi-TTS ALG, EGY, IRQ, MAR and MSA are Apache-2.0: yes. Unified, SAU and UAE are non-commercial (CC-BY-NC-SA-4.0), because of their training data: no.",
  url: "https://huggingface.co/SWivid/Habibi-TTS",
  checked: "2026-10-15",
};

// Unloading stops the speech process instead of asking audio.cpp to unload (decided 2026-10-15,
// TASKS 4d54ee1f): F5's weights, graphs and vocoder live in caches as long as the process, so an
// unload frees none of it — 7.2 GB committed and 6.2 GB of the card stayed after three Habibi
// models (RESEARCH §10.15 finding 4). Each kind has its own process, so nothing else goes with it.
export const UNLOAD_STOPS_PROCESS = true;

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/community_models/f5_tts/session.cpp:195;
// docs/models/f5_tts.md calls it a "legacy alias").
export const OLD_OPTION_NAMES = {
  cfg_strength: "guidance_scale",
};

// A checkpoint's languages where it speaks fewer than its family (decided 2026-10-15, TASKS "Slice 2's
// acceptance findings" 5): the family lists F5-TTS's English beside Habibi-TTS's Arabic, and every
// model offered here is a Habibi checkpoint — "Habibi Unified (ar)", a "multi-dialect Arabic
// checkpoint suite", with "per-dialect specialized checkpoints (stronger accent)"
// (../audio.cpp/docs/models/f5_tts.md:5-7,63-64,112). Upstream names each dialect only by a code
// (its card and README, read 2026-10-15); a specialised one's language is Arabic with its code's
// country as the region (ALG Algeria, EGY Egypt, IRQ Iraq, MAR Morocco, SAU Saudi Arabia, UAE the
// United Arab Emirates), and MSA's is Modern Standard Arabic, `ar-001`. Keyed by audio.cpp's
// catalog entry.
export const LANGUAGES = {
  "f5-tts-habibi-unified": ["ar"],
  "f5-tts-habibi-alg": ["ar-DZ"],
  "f5-tts-habibi-egy": ["ar-EG"],
  "f5-tts-habibi-irq": ["ar-IQ"],
  "f5-tts-habibi-mar": ["ar-MA"],
  "f5-tts-habibi-msa": ["ar-001"],
  "f5-tts-habibi-sau": ["ar-SA"],
  "f5-tts-habibi-uae": ["ar-AE"],
};

// Its small files' SHA-256s are seed data: ../seed_file_hashes.js `SMALL_FILES` (the kit's family guard, 2026-10-29).
