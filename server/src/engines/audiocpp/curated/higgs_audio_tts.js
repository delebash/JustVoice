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

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "No"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  commercial: "Conditional",
  summary: "Yes for your own audiobooks, podcasts and videos, if you credit Boson AI’s Higgs Audio where listeners can see it — no revenue cap. Offering Higgs to other people as a service needs Boson’s paid licence.",
  url: "https://huggingface.co/bosonai/higgs-tts-3-4b/blob/main/LICENSE",
  checked: "2026-10-11",
};
