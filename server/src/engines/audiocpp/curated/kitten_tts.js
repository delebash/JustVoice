// SPDX-License-Identifier: MIT
// KittenTTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/KittenML/kitten-tts-mini-0.8",
  checked: "2026-10-11",
};

// A hand-wired engine (engines/<id>/manifest.js): wired and measured by hand, so tested; what it
// is best for is the Speech engines page's picking table (approved 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Wired by hand and measured by JustVoice.",
};

export const BEST_FOR = ["English voices made for the CPU"];
