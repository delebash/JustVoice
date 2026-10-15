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

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/community_models/f5_tts/session.cpp:195;
// docs/models/f5_tts.md calls it a "legacy alias").
export const OLD_OPTION_NAMES = {
  cfg_strength: "guidance_scale",
};
