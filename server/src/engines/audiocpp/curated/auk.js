// SPDX-License-Identifier: MIT
// AuK — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Yes"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  commercial: "Separate licence",
  summary: "Not under its free licences, as audio.cpp packages it: AuK’s own weights are MIT, but it can’t run without Qwen2.5-Omni-3B, whose research licence says to ask Alibaba Cloud for a licence to use it commercially.",
  url: "https://huggingface.co/Qwen/Qwen2.5-Omni-3B/blob/main/LICENSE",
  checked: "2026-10-11",
};

// Not offered (decided 2026-10-12, TASKS "The download test's last findings"): audio.cpp loads AuK
// from a folder of three separate downloads — its generator, Qwen2.5-Omni-3B and a VAE — and,
// cloning from a clip without a voice description, needs "the complete upstream instruction" as
// the text (audio.cpp docs/community_models/auk.md). JustVoice fetches the generator alone, which
// audio.cpp refuses to load (RESEARCH §10.14).
export const NOT_OFFERED =
  "It loads as a folder of three downloads — its generator, Qwen2.5-Omni-3B and a VAE — and JustVoice fetches only the generator.";
