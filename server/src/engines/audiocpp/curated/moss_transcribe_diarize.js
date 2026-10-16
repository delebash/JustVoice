// SPDX-License-Identifier: MIT
// MOSS-Transcribe-Diarize — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself
// is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/OpenMOSS-Team/MOSS-Transcribe-Diarize",
  checked: "2026-10-15",
};

// Where its words are without its own markup (decided 2026-10-15, TASKS "Slice 2's acceptance
// findings" 3): its `text` is the model's raw output, timed and speaker-tagged ("[0.06][S01]
// …[7.96]"); each segment it parses keeps the words alone in `segments[].text` and
// `speaker_turns[].text` (../audio.cpp/src/models/moss_transcribe_diarize/session.cpp:123-141),
// which /v1/audio/transcriptions/details returns (app/server/runtime.cpp:1546-1563).
export const WORDS_FROM = "speaker_turns";
