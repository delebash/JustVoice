// SPDX-License-Identifier: MIT
// VieNeu-TTS v3 Turbo — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Unclear"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "Apache-2.0", // audio.cpp's table has none
  commercial: "Yes",
  summary: "Yes. Apache-2.0, and its makers say its audio may be used in commercial and monetized content. A cloned voice must be one you have the right to use.",
  url: "https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo",
  checked: "2026-10-11",
};

// Listed, marked as not copying a voice from a clip yet (decided 2026-10-13, the narrowings review
// K2; built with the adoption plan's slice 2, docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §3). Hidden from 2026-10-11 on the implementer's pick until then. It needs a 192-d speaker
// embedding from a CAM++ encoder audio.cpp hasn't ported — "Without it the embedding is all zeros
// and the voice will not match" (audio.cpp docs/community_models/vieneu_v3_turbo.md); from text
// and a clip it babbled 14.8 s for a line others speak in 4–5 s (RESEARCH §10.14). So its clone
// isn't offered: it speaks in its one voice, and whether it speaks from text alone is checked in
// the plan's slice 2 acceptance.
export const NOT_CLONING_YET = true;
