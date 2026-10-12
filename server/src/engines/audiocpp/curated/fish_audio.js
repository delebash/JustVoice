// SPDX-License-Identifier: MIT
// Fish Audio S2 Pro — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §4). Direction is a free-form `[tag]` cue at the start of a sentence, up to three
// stacked (`[sad][whispering] I miss you so much.` — docs.fish.audio; "free-form textual
// descriptions" — its model card). audio.cpp passes the text through verbatim. A user found the
// cues "very subtle to essentially inaudible" on emotion-neutral text (fish-speech #1280,
// RESEARCH §10.9). The line's emotion goes as a tag, its direction as a description after it.
// Not yet tested by JustVoice.

export const DIRECTION = {
  kind: "prefix",
  tags: {
    happy: "[happy]",
    sad: "[sad]",
    angry: "[angry]",
    fearful: "[scared]",
    sarcastic: "[sarcastic]",
    contemptuous: "[contemptuous]",
    whispered: "[whispering]",
    shouted: "[shouting]",
  },
  words: "[{text}]",
};

export const TESTED = null;
export const BEST_FOR = [];

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "No",
  summary: "No. Any use tied to something you sell needs a separate licence from Fish Audio.",
  url: "https://huggingface.co/fishaudio/s2-pro/blob/main/LICENSE.md",
  checked: "2026-10-11",
};
