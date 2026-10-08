// SPDX-License-Identifier: MIT
// Kokoro's 54-voice preset catalog + speaker_id lookup (the port of
// justvoice/engines/kokoro/voices.py).
//
// Pure data — no third-party imports. The host catalog (which surfaces voices to the GUI even
// when Kokoro isn't loaded) and the audio.cpp request mapping (`engines/audiocpp/slot.js`, the
// voice's language) both read it. Voice ids follow k2-fsa's naming `<lang><gender>_<name>`;
// speaker id is the 0-based index into VOICES.

/** [id, name, language, gender] */
export const VOICES = [
  ["af_alloy", "Alloy", "en-US", "female"],
  ["af_aoede", "Aoede", "en-US", "female"],
  ["af_bella", "Bella", "en-US", "female"],
  ["af_heart", "Heart", "en-US", "female"],
  ["af_jessica", "Jessica", "en-US", "female"],
  ["af_kore", "Kore", "en-US", "female"],
  ["af_nicole", "Nicole", "en-US", "female"],
  ["af_nova", "Nova", "en-US", "female"],
  ["af_river", "River", "en-US", "female"],
  ["af_sarah", "Sarah", "en-US", "female"],
  ["af_sky", "Sky", "en-US", "female"],
  ["am_adam", "Adam", "en-US", "male"],
  ["am_echo", "Echo", "en-US", "male"],
  ["am_eric", "Eric", "en-US", "male"],
  ["am_fenrir", "Fenrir", "en-US", "male"],
  ["am_liam", "Liam", "en-US", "male"],
  ["am_michael", "Michael", "en-US", "male"],
  ["am_onyx", "Onyx", "en-US", "male"],
  ["am_puck", "Puck", "en-US", "male"],
  ["am_santa", "Santa", "en-US", "male"],
  ["bf_alice", "Alice (UK)", "en-GB", "female"],
  ["bf_emma", "Emma (UK)", "en-GB", "female"],
  ["bf_isabella", "Isabella (UK)", "en-GB", "female"],
  ["bf_lily", "Lily (UK)", "en-GB", "female"],
  ["bm_daniel", "Daniel (UK)", "en-GB", "male"],
  ["bm_fable", "Fable (UK)", "en-GB", "male"],
  ["bm_george", "George (UK)", "en-GB", "male"],
  ["bm_lewis", "Lewis (UK)", "en-GB", "male"],
  ["ef_dora", "Dora (Spanish)", "es", "female"],
  ["em_alex", "Alex (Spanish)", "es", "male"],
  ["em_santa", "Santa (Spanish)", "es", "male"],
  ["ff_siwis", "Siwis (French)", "fr", "female"],
  ["hf_alpha", "Alpha (Hindi)", "hi", "female"],
  ["hf_beta", "Beta (Hindi)", "hi", "female"],
  ["hm_omega", "Omega (Hindi)", "hi", "male"],
  ["hm_psi", "Psi (Hindi)", "hi", "male"],
  ["if_sara", "Sara (Italian)", "it", "female"],
  ["im_nicola", "Nicola (Italian)", "it", "male"],
  ["jf_alpha", "Alpha (Japanese)", "ja", "female"],
  ["jf_gongitsune", "Gongitsune (Japanese)", "ja", "female"],
  ["jf_nezumi", "Nezumi (Japanese)", "ja", "female"],
  ["jf_tebukuro", "Tebukuro (Japanese)", "ja", "female"],
  ["jm_kumo", "Kumo (Japanese)", "ja", "male"],
  ["pf_dora", "Dora (Portuguese)", "pt-BR", "female"],
  ["pm_alex", "Alex (Portuguese)", "pt-BR", "male"],
  ["pm_santa", "Santa (Portuguese)", "pt-BR", "male"],
  ["zf_xiaobei", "Xiaobei (Mandarin)", "zh", "female"],
  ["zf_xiaoni", "Xiaoni (Mandarin)", "zh", "female"],
  ["zf_xiaoxiao", "Xiaoxiao (Mandarin)", "zh", "female"],
  ["zf_xiaoyi", "Xiaoyi (Mandarin)", "zh", "female"],
  ["zm_yunjian", "Yunjian (Mandarin)", "zh", "male"],
  ["zm_yunxi", "Yunxi (Mandarin)", "zh", "male"],
  ["zm_yunxia", "Yunxia (Mandarin)", "zh", "male"],
  ["zm_yunyang", "Yunyang (Mandarin)", "zh", "male"],
];

const VOICE_INDEX = new Map(VOICES.map((v, i) => [v[0], i]));

/** The 0-based speaker id for a voice, or null if unknown. */
export function speakerIdFor(voiceId) {
  return VOICE_INDEX.get(voiceId) ?? null;
}

/** Voices as plain objects — what the host catalog wants. */
export function presetVoicesAsDicts() {
  return VOICES.map(([id, name, language, gender]) => ({ id, name, language, gender }));
}
