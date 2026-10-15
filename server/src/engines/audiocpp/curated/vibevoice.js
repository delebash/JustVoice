// SPDX-License-Identifier: MIT
// VibeVoice — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Not settings (the narrowings review, E15: file paths are never offered as settings):
// `voice_samples` is "Comma-separated reference WAV paths ordered by speaker ID" on the computer
// running the speech runtime — as MOSS-TTSD's is.
export const HIDDEN_OPTIONS = ["voice_samples"];
