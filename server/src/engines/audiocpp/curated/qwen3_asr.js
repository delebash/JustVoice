// SPDX-License-Identifier: MIT
// Qwen3-ASR — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine — speech recognition: dictation, clone transcripts, captions — is built from audio.cpp's
// files as every engine is (generated.js `ownEngine`); this file keeps our ids, names and what
// JustVoice measured (the adoption plan's slice 4, F10).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/Qwen/Qwen3-ASR-0.6B",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = [];

// The engine. Replaced Whisper at the 2026-10-01 switch — the user: "as long as qwen asr is as good
// as whisper we can drop whisper". Measured on 197 clips with known text (switch plan §2.2): on
// English, Qwen3-ASR 1.7B gets fewer words wrong than Whisper turbo (4.3% against 5.8% on human
// speech). What it does not give: a confidence score, and — on the small sample measured — weaker
// recognition outside English, especially when no language is set (§8 D).
export const ENGINE = {
  id: "asr",
  name: "Speech recognition",
  description:
    "Turns speech into text for dictation, clone transcripts and captions (with word timings). Runs in the audio.cpp speech runtime.",
};

// Its models, 1.7B the default. 0.6B offered since 2026-10-15 (the adoption plan §7 answer 4 —
// left out before by the 2026-10-02 word "keep Qwen3-ASR 1.7B as the only recogniser"); no measured
// speed or quality of its own yet. QwenCleo-ASR, a 1.7B fine-tune for Egyptian Arabic and
// Arabic-English code-switching (the plan's E14/F5; ../audio.cpp/docs/models/qwen3_asr.md
// "QwenCleo-ASR"), in audio.cpp's own words.
export const MODELS = [
  {
    entry: "qwen3-asr-1.7b",
    id: "qwen3-asr-1.7b",
    name: "Qwen3-ASR 1.7B",
    description: "30 languages. Set the language when you know it — detection is the weak spot. Word timings from Qwen3's aligner.",
    quality: 90,
    packages: ["qwen3_asr_1_7b_q8_0", "qwen3_asr_1_7b_f16"],
  },
  {
    entry: "qwen3-asr",
    id: "qwen3-asr-0.6b",
    name: "Qwen3-ASR 0.6B",
    description: "30 languages. Word timings from Qwen3's aligner.",
    packages: ["qwen3_asr_0_6b_q8_0", "qwen3_asr_0_6b_f16"],
  },
  {
    entry: "qwencleo-asr",
    id: "qwencleo-asr",
    packages: ["qwencleo_asr_q8_0", "qwencleo_asr_f16"],
  },
];

// Each model carries Qwen3's forced aligner as a companion, so captions get word times for the
// KNOWN text — the aligner of its own precision (audio.cpp ships both as q8_0 and f16), downloaded,
// verified and deleted with it, registered as `<model>::aligner` on its first use.
export const COMPANIONS = [
  {
    role: "aligner",
    family: "qwen3_forced_aligner",
    task: "align",
    packages: { q8_0: "qwen3_forced_aligner_0_6b_q8_0", f16: "qwen3_forced_aligner_0_6b_f16" },
  },
];

// Seconds of audio per second of work on the CPU, with its GPU accuracy — the reference machine's
// figure (Ryzen 7 5700X, 8 threads, 2026-10-02) until a transcription measures this one
// (docs/plans/2026-10-02-cpu-placement.md §6).
export const CPU_REALTIME = { "qwen3-asr-1.7b-q8": 2.6 };

// A checkpoint's own languages, where it speaks fewer than its family (decided 2026-10-15, TASKS
// "Slice 2's acceptance findings" 5): QwenCleo's "Egyptian Arabic and Arabic-English
// code-switching" (../audio.cpp/docs/models/qwen3_asr.md) as VoiceTut-TTS's are written — the tag
// Habibi's Egyptian model uses, and English. Its model card (mohammedaly22/QwenCleo-ASR, read
// 2026-10-15) also names Modern Standard Arabic; the card's and its GGUF repo's tags are `ar`, `en`.
export const LANGUAGES = { "qwencleo-asr": ["ar-EG", "en"] };

// audio.cpp's list adds "zh dialects", a description rather than a language; left out, as before
// (whether and how to show it is open — the narrowings review F10).
export const LEFT_OUT_LANGUAGES = ["zh dialects"];
