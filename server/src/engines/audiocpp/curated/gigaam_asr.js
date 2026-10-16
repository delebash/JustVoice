// SPDX-License-Identifier: MIT
// GigaAM ASR — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person use it, and what it writes, in work they sell? Our
// reading of the licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself
// is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. MIT, nothing added.",
  url: "https://huggingface.co/ai-sage/GigaAM-v3",
  checked: "2026-10-15",
};

// A checkpoint's languages where it speaks fewer than its family (decided 2026-10-15, TASKS "Slice 2's
// acceptance findings" 5): "v3: Russian; Multilingual: Russian, Kazakh, Kyrgyz, Uzbek, English"
// (../audio.cpp/docs/models/gigaam_asr.md:13) — the Multilingual models keep the family's five.
// Keyed by audio.cpp's catalog entry.
export const LANGUAGES = {
  "gigaam-v3-ctc": ["ru"],
  "gigaam-v3-rnnt": ["ru"],
  "gigaam-v3-e2e-ctc": ["ru"],
  "gigaam-v3-e2e-rnnt": ["ru"],
};
