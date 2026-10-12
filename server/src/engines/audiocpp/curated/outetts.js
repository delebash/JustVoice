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
// while its sample clip speaks on every seed tried (RESEARCH §10.14). Not the file, not JustVoice's
// request: its generation is fragile with some voices.
export const NOT_OFFERED = "Cloning some voices it generates no audio for most seeds — the Hatter spoke on one seed in eleven.";
