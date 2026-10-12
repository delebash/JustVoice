// SPDX-License-Identifier: MIT
// IndexTTS 2 / 2.5 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §4). The authors' documented way to give emotion is an eight-value emotion vector
// [happy, angry, sad, afraid, disgusted, melancholic, surprised, calm] or an emotion clip, at a
// weight "around 0.6" (README; the authors' web UI defaults to 0.65); describing the emotion in
// words is the mode their web UI hides as experimental (RESEARCH §10.8). So a line's emotion goes
// as a vector; a direction with no emotion the vector covers goes as words. There is no category
// for volume or manner (muttering, whispering, shouting) or for contempt — disgusted is nearest.

export const DIRECTION = {
  kind: "vector",
  option: "emotion_vector",
  // JustVoice's emotions → the authors' order; the values follow the authors' own examples.
  vectors: {
    happy: [0.75, 0, 0, 0, 0, 0, 0, 0],
    angry: [0, 0.7, 0, 0, 0, 0, 0, 0],
    sad: [0, 0, 0.8, 0, 0, 0, 0, 0],
    fearful: [0, 0, 0, 0.75, 0, 0, 0, 0],
    contemptuous: [0, 0, 0, 0, 0.75, 0, 0, 0],
  },
  alpha_option: "emotion_alpha",
  alpha: 0.65,
  // A direction in words, when the line's emotion has no vector.
  words: { flag: "use_emotion_text", option: "emotion_text" },
};

// Round 3 (RESEARCH §10.6) used the words mode at weight 1.0 — like the book on 12 of 21 tries,
// steady per line, the clip's person kept. The vector mapping above is not yet tested.
export const TESTED = {
  date: "2026-10-11",
  record: "RESEARCH §10.6, round 3",
  note: "Acted 12 of 21 lines like the book in a blind test, with directions in words; kept the cloned voice.",
};

export const BEST_FOR = ["Acting a cloned voice's emotion"];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Conditional"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  commercial: "Unclear",
  summary: "Unclear. bilibili’s own licence allows it while you earn under RMB 100 million a year (the Chinese text, which governs; the English says 1 billion), and its audio may not be used to train other AI. But one part it runs, MaskGCT’s semantic codec, is non-commercial (CC-BY-NC-4.0), and bilibili’s licence leaves that part to you.",
  url: "https://huggingface.co/IndexTeam/IndexTTS-2.5/blob/main/LICENSE",
  checked: "2026-10-11",
};
