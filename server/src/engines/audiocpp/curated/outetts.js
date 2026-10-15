// SPDX-License-Identifier: MIT
// OuteTTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "No",
  summary: "No. OuteAI’s training on top of Llama 3.2 is licensed non-commercial (CC-BY-NC-SA-4.0).",
  url: "https://huggingface.co/OuteAI/Llama-OuteTTS-1.0-1B",
  checked: "2026-10-11",
};

// Not offered (decided 2026-10-12, TASKS "The download test's last findings"): cloning the Hatter
// it generated no audio — "OuteTTS generated no complete DAC code pairs" — for 10 seeds of 11 on the
// card and seed 42 on the CPU; audio.cpp's own command-line tool does the same with the same file,
// while its sample clip speaks on every seed tried (RESEARCH §10.14). Not the file: its generation
// is fragile with some voices, and JustVoice's random seed per take turns that into a failure on
// nearly every take — audio.cpp's own default for a quantized clone, seed 42, spoke the Hatter line
// (and three lines in four).
export const NOT_OFFERED = "Cloning some voices it generates no audio for most seeds — the Hatter spoke on one seed in eleven.";

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/community_models/outetts/session.cpp:487).
export const OLD_OPTION_NAMES = {
  aligner_path: "forced_aligner_path",
};
