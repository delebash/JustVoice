// SPDX-License-Identifier: MIT
// Fish Audio Drama 3 — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-
// catalog.md §4). Its makers direct it with a free-text note in square brackets before the words,
// point cues mid-line and paired tags (RESEARCH §10.33). Round 6 hears it (TASKS "Round 6").

// Its direction, the way round 6 heard it (RESEARCH §10.33, the user's ears 2026-10-19: the best
// model that can be sold with): one note in square brackets before the words — the line's
// direction in words, else a word for its emotion — and a space, as its makers write it ("[choked
// up, crying quietly] I left his jacket by the door."). Its point cues and paired tags are untested.
export const DIRECTION = {
  kind: "prefix",
  one_note: true,
  tags: {
    happy: "[happy] ",
    sad: "[sad] ",
    angry: "[angry] ",
    fearful: "[frightened] ",
    sarcastic: "[sarcastic] ",
    contemptuous: "[contemptuous] ",
    whispered: "[whispering] ",
    shouted: "[shouting] ",
  },
  words: "[{text}] ",
};

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// Fish Audio Community License Agreement v1.0 (last updated 2026-10-13) at its source, checked
// 2026-10-18 (RESEARCH §10.33): §III(a) commercial use while the annual gross revenue of you and
// your affiliates, from all sources, is under USD 500,000; §III(b) at or above it, notify Fish Audio
// and get a separate written licence; §III(c) no hosted service; §IV(a) "Built with Fish Audio"
// shown prominently. The licence itself is what counts. audio.cpp's table also says "Conditional".
export const LICENCE = {
  commercial: "Conditional",
  summary: "Yes while you and your affiliates earn under USD 500,000 a year from all sources, if you show “Built with Fish Audio” on a related website or page. Above that, a separate written licence from Fish Audio. Not as a service that makes speech for other people.",
  url: "https://huggingface.co/fishaudio/drama-3/blob/main/LICENSE",
  checked: "2026-10-18",
};
