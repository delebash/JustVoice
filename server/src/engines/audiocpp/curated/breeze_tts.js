// SPDX-License-Identifier: MIT
// Breeze TTS 2 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md
// §4). Its authors' headline is direction on a cloned voice: the clip, its exact transcript and an
// instruction, written in the target text's language, with `--cfg-scale 4` "to strengthen
// instruction-following" (README). audio.cpp defaults `guidance_scale` to 1.0, where it skips the
// guidance entirely (RESEARCH §10.8) — so a directed line gets 4 unless the settings say
// otherwise. Not yet tested by JustVoice.

export const DIRECTION = {
  kind: "words",
  option: "instruction",
  when_directed: { guidance_scale: 4 },
};

export const TESTED = null;
export const BEST_FOR = [];
