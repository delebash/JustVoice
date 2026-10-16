// SPDX-License-Identifier: MIT
// Index-Echo-S2TT — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself
// is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/IndexTeam/Index-Echo-S2TT-2B",
  checked: "2026-10-15",
};

// Not offered (decided 2026-10-15, TASKS "Slice 2's acceptance findings" 3): it "translates
// Chinese speech into English, Spanish, or Japanese text. It returns the source transcript and
// translation as timestamped subtitle cues" (../audio.cpp/docs/models/index_echo.md:3-5) — its
// text came back as timed captions with a translation (RESEARCH §10.15, finding 3), not a
// transcript. Its family has only speech-to-text entries, so nothing of it is listed.
export const NOT_OFFERED = "A Chinese speech translator, not a recogniser: it returns timed captions, each a Chinese line and its translation.";
