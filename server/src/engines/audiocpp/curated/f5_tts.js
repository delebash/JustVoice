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

// The SHA-256 of each Habibi download's vocab.txt: small files Git stores itself, so catalog.json carries only Git's
// blob id for them (40 hex — all Hugging Face lists outside LFS), and the engine cache names and
// checks every file by its SHA-256 (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1).
// Each file fetched at its revision (2026-10-29), its size and Git blob id checked against the catalog.
export const SMALL_FILES = [
  {
    repo: "trklou/audio.cpp",
    revision: "4c220adc169f56a2012125aaab1ae821d790f6ca",
    sha256: {
      "habibi-unified/vocab.txt": "49b8f3f126a0cb8146cd5a974cd48866acc4b292f8b59546fd51957f83251d5b",
      "habibi-alg/vocab.txt": "a959e14efa69a068f1bd14ad5c335a82e3bcad5083ebd1c72f5c4eb3925f5c4e",
      "habibi-egy/vocab.txt": "ceed48f51f0211ffbb8b36007ead3c9b8698fbda9709f184fd712bd3dcd095c5",
      "habibi-irq/vocab.txt": "55484bc3dda8b8e6a7fbf04261b47a8788d4b553a85b93dc46dac6fd39c9fd88",
      "habibi-mar/vocab.txt": "a49a0b74e12cb91de49a636f59c4045e3a1683d389fa6c223b53024faa9afbea",
      "habibi-msa/vocab.txt": "4de4460ff1ef7cb40c2e564bc1ee2f3198164d10ce71380290986e483ba7e19c",
      "habibi-sau/vocab.txt": "9bd4755a39ee21eafe78f54d6c32ae939f900775427f447598430c795c04362f",
      "habibi-uae/vocab.txt": "6f249cb7a0fcef576d4e0281a9998b30a92048a72616f84020238bf743810d79",
    },
  },
];
