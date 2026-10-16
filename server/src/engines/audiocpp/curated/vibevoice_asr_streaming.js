// SPDX-License-Identifier: MIT
// VibeVoice ASR Streaming — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself
// is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. MIT, nothing added.",
  url: "https://huggingface.co/microsoft/VibeVoice-ASR-Streaming-7B",
  checked: "2026-10-15",
};

// Where its words are without its own markup (decided 2026-10-15, TASKS "Slice 2's acceptance
// findings" 3): its `text` keeps the speaker labels ("Speaker 0: …"); each turn's words without
// its label are in `speaker_turns[].text` (../audio.cpp/src/models/vibevoice_asr/session.cpp:1247-1254,
// postprocess.cpp:158-182), which /v1/audio/transcriptions/details returns
// (app/server/runtime.cpp:1546-1563). VibeVoice-ASR, its offline sibling, already gives the words
// alone in `text` (postprocess.cpp:121-153), so its file names none.
export const WORDS_FROM = "speaker_turns";
