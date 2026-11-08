// SPDX-License-Identifier: MIT
// Ming 3.0 TTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// A line's emotion the way its makers' cookbook gives it (github.com/inclusionAI/Ming-3.0-tts, "How
// it is said"): the `emotion` template with one of its seven labels — 高兴 / 悲伤 / 愤怒 / 恐惧 /
// 厌恶 / 惊讶 / 中性 — on a cloned voice by its speaker embedding alone (the cookbook's emotion
// example passes the clip and no transcript; with one, audio.cpp also lays the clip's own latents
// before the line, ../audio.cpp docs/models/ming3_tts.md "Voice Cloning"). Shouted and whispered have
// no label: they go as its `basic` template's volume, 高 / 低 (a structured template takes only its
// own controls, src/models/ming3_tts/prompt.cpp). Sarcastic has no label and goes plain.
// Round 10 tests it (docs/plans/2026-11-08-commercial-engine.md).
export const DIRECTION = {
  kind: "phrases",
  option: "emotion",
  set: { template_name: "emotion" },
  drop_reference_text: true,
  phrases: {
    happy: "高兴",
    sad: "悲伤",
    angry: "愤怒",
    fearful: "恐惧",
    contemptuous: "厌恶",
    shouted: { template_name: "basic", volume: "高" },
    whispered: { template_name: "basic", volume: "低" },
  },
};

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-29 (RESEARCH §10.13); the licence itself is what counts.
// Its card: "Released under the MIT license"; it asks, beside the licence, that cloning and its
// character voices not be used "to impersonate a real person without consent, to deceive, or for
// any illegal purpose".
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. MIT, nothing added. A cloned voice must be one you have the right to use.",
  url: "https://huggingface.co/inclusionAI/Ming-3.0-tts-0.5B",
  checked: "2026-10-29",
};
