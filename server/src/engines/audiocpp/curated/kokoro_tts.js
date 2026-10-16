// SPDX-License-Identifier: MIT
// Kokoro — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine is built from audio.cpp's files as every engine is (generated.js `ownEngine`); this
// file keeps our ids, names, genders and what JustVoice measured (the adoption plan's slice 4, F10).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, and its maker welcomes commercial use.",
  url: "https://huggingface.co/hexgrad/Kokoro-82M",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = ["Ready-made voices, fast, on any machine"];

// Setting names audio.cpp renamed (its v0.9.2 spec against v0.9.0-jv.5's), old → new: a value saved
// under the old name is read as the new one (docs/plans/2026-10-13-adopt-everything-audiocpp.md
// §2, §4). The runtime still reads each old name (../audio.cpp src/models/kokoro_tts/session.cpp:176-187).
// Kokoro's request is its own (slot.js), which sends the names it always sent.
export const OLD_OPTION_NAMES = {
  predictor_duration_graph_mb: "predictor_duration_graph_arena_mb",
  predictor_text_graph_mb: "predictor_text_graph_arena_mb",
  predictor_tail_graph_mb: "predictor_tail_graph_arena_mb",
};

// The engine. Its voices are the spec's built-in voices (`ui.builtin_voices`, 54, default
// af_heart), each listed under audio.cpp's own name (`voice_ids`). A lexicon's IPA rides our
// audio.cpp's inline pronunciations (gap 3) and a blend its `voice_pack` option (gap 2): each
// offered once the pinned build has it.
export const ENGINE = {
  id: "kokoro",
  name: "Kokoro",
  description:
    "Kokoro-82M — {voices} preset voices in {languages} languages, fast on any machine. Runs in the audio.cpp speech runtime " +
    "from one 190 MB model file.",
  voice_ids: "audio.cpp's",
  capabilities: { phoneme_override: "inline_ipa", voice_blending: "voice_pack" },
};

// Its one model, its downloads as audio.cpp's packages, in our ids (`<id>-<precision>`).
// `languages: "voices"` — a Kokoro voice speaks its own language, so the model speaks its voices'.
// `split_chars: "spec"` — the longest piece a line reaches it in is audio.cpp's own Kokoro budget
// (its spec's `text_chunk_size`, 240), so it never re-splits a piece with a hard join (audit
// 2026-10-04 §13.3); a 240-character piece peaked at about 2,700 MB on the card.
export const MODELS = [
  {
    entry: "kokoro-tts",
    model: "kokoro",
    id: "kokoro-82m",
    name: "Kokoro 82M",
    description: "{voices} preset voices in {languages} languages. 8-bit weights.",
    quality: 95,
    languages: "voices",
    split_chars: "spec",
    packages: ["kokoro_82m_q8_0", "kokoro_82m_bf16"],
  },
];

// Seconds of audio per second of work on the CPU on the reference machine (Ryzen 7 5700X, 8
// threads) until a render measures this one (docs/plans/2026-10-02-cpu-placement.md §6): the 8-bit
// file 2026-10-02; the 16-bit one 2026-10-04 (af_heart, five short lines) — without it, Auto never
// offered the 16-bit row the CPU (audit §5 B6).
export const CPU_REALTIME = { "kokoro-82m-q8": 3.15, "kokoro-82m-bf16": 2.61 };

// The five Japanese voices need MeCab + UniDic: offered once the pinned runtime reads Japanese; a
// line in one of them is refused by name until the dictionary is installed (gap 7).
export const LANGUAGE_FEATURES = { ja: "japanese" };

// Each voice's display name, gender and language, by audio.cpp's name — k2-fsa's naming
// `<lang><gender>_<name>`; the language as the app writes it (personas and takes keep it).
export const VOICES = {
  af_alloy: { name: "Alloy", gender: "female", language: "en-US" },
  af_aoede: { name: "Aoede", gender: "female", language: "en-US" },
  af_bella: { name: "Bella", gender: "female", language: "en-US" },
  af_heart: { name: "Heart", gender: "female", language: "en-US" },
  af_jessica: { name: "Jessica", gender: "female", language: "en-US" },
  af_kore: { name: "Kore", gender: "female", language: "en-US" },
  af_nicole: { name: "Nicole", gender: "female", language: "en-US" },
  af_nova: { name: "Nova", gender: "female", language: "en-US" },
  af_river: { name: "River", gender: "female", language: "en-US" },
  af_sarah: { name: "Sarah", gender: "female", language: "en-US" },
  af_sky: { name: "Sky", gender: "female", language: "en-US" },
  am_adam: { name: "Adam", gender: "male", language: "en-US" },
  am_echo: { name: "Echo", gender: "male", language: "en-US" },
  am_eric: { name: "Eric", gender: "male", language: "en-US" },
  am_fenrir: { name: "Fenrir", gender: "male", language: "en-US" },
  am_liam: { name: "Liam", gender: "male", language: "en-US" },
  am_michael: { name: "Michael", gender: "male", language: "en-US" },
  am_onyx: { name: "Onyx", gender: "male", language: "en-US" },
  am_puck: { name: "Puck", gender: "male", language: "en-US" },
  am_santa: { name: "Santa", gender: "male", language: "en-US" },
  bf_alice: { name: "Alice (UK)", gender: "female", language: "en-GB" },
  bf_emma: { name: "Emma (UK)", gender: "female", language: "en-GB" },
  bf_isabella: { name: "Isabella (UK)", gender: "female", language: "en-GB" },
  bf_lily: { name: "Lily (UK)", gender: "female", language: "en-GB" },
  bm_daniel: { name: "Daniel (UK)", gender: "male", language: "en-GB" },
  bm_fable: { name: "Fable (UK)", gender: "male", language: "en-GB" },
  bm_george: { name: "George (UK)", gender: "male", language: "en-GB" },
  bm_lewis: { name: "Lewis (UK)", gender: "male", language: "en-GB" },
  ef_dora: { name: "Dora (Spanish)", gender: "female", language: "es" },
  em_alex: { name: "Alex (Spanish)", gender: "male", language: "es" },
  em_santa: { name: "Santa (Spanish)", gender: "male", language: "es" },
  ff_siwis: { name: "Siwis (French)", gender: "female", language: "fr" },
  hf_alpha: { name: "Alpha (Hindi)", gender: "female", language: "hi" },
  hf_beta: { name: "Beta (Hindi)", gender: "female", language: "hi" },
  hm_omega: { name: "Omega (Hindi)", gender: "male", language: "hi" },
  hm_psi: { name: "Psi (Hindi)", gender: "male", language: "hi" },
  if_sara: { name: "Sara (Italian)", gender: "female", language: "it" },
  im_nicola: { name: "Nicola (Italian)", gender: "male", language: "it" },
  jf_alpha: { name: "Alpha (Japanese)", gender: "female", language: "ja" },
  jf_gongitsune: { name: "Gongitsune (Japanese)", gender: "female", language: "ja" },
  jf_nezumi: { name: "Nezumi (Japanese)", gender: "female", language: "ja" },
  jf_tebukuro: { name: "Tebukuro (Japanese)", gender: "female", language: "ja" },
  jm_kumo: { name: "Kumo (Japanese)", gender: "male", language: "ja" },
  pf_dora: { name: "Dora (Portuguese)", gender: "female", language: "pt-BR" },
  pm_alex: { name: "Alex (Portuguese)", gender: "male", language: "pt-BR" },
  pm_santa: { name: "Santa (Portuguese)", gender: "male", language: "pt-BR" },
  zf_xiaobei: { name: "Xiaobei (Mandarin)", gender: "female", language: "zh" },
  zf_xiaoni: { name: "Xiaoni (Mandarin)", gender: "female", language: "zh" },
  zf_xiaoxiao: { name: "Xiaoxiao (Mandarin)", gender: "female", language: "zh" },
  zf_xiaoyi: { name: "Xiaoyi (Mandarin)", gender: "female", language: "zh" },
  zm_yunjian: { name: "Yunjian (Mandarin)", gender: "male", language: "zh" },
  zm_yunxi: { name: "Yunxi (Mandarin)", gender: "male", language: "zh" },
  zm_yunxia: { name: "Yunxia (Mandarin)", gender: "male", language: "zh" },
  zm_yunyang: { name: "Yunyang (Mandarin)", gender: "male", language: "zh" },
};
