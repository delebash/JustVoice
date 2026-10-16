// SPDX-License-Identifier: MIT
// VibeVoice — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Yes"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  commercial: "Unclear",
  summary: "Unclear. The licence is MIT, but Microsoft’s card says the model “is limited to research purpose use” and advises against commercial use; Microsoft has since withdrawn the speech code and its own 7B model (JustVoice’s 7B is a community re-upload).",
  url: "https://huggingface.co/microsoft/VibeVoice-1.5B",
  checked: "2026-10-15",
};

// Not settings (the narrowings review, E15: file paths are never offered as settings):
// `voice_samples` is "Comma-separated reference WAV paths ordered by speaker ID" on the computer
// running the speech runtime — as MOSS-TTSD's is.
export const HIDDEN_OPTIONS = ["voice_samples"];
