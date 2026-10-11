// SPDX-License-Identifier: MIT
// Higgs Audio TTS 3 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §4). Direction is a tag at the start of the sentence, `<|category:value|>`; "only the
// tags below are recognized — anything else … gets read literally" (PROMPTING.md, checked
// 2026-10-11: 21 emotions, the styles singing / shouting / whispering, prosody, sound effects).
// So only JustVoice emotions with a real tag are sent; sarcastic has none. Whether the tags hold
// on a cloned voice is not documented (RESEARCH §10.8, §10.9). Not yet tested by JustVoice.

export const DIRECTION = {
  kind: "prefix",
  tags: {
    happy: "<|emotion:elation|>",
    sad: "<|emotion:sadness|>",
    angry: "<|emotion:anger|>",
    fearful: "<|emotion:fear|>",
    contemptuous: "<|emotion:disgust|>",
    whispered: "<|style:whispering|>",
    shouted: "<|style:shouting|>",
  },
};

export const TESTED = null;
export const BEST_FOR = [];
