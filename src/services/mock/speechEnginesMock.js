// SPDX-License-Identifier: MIT
// Made-up states over real facts for the Speech engines mock (#/mock/speech-engines, dev only;
// docs/plans/2026-10-11-audiocpp-engine-catalog.md slice 4). Names, descriptions, models, sizes,
// languages, audio.cpp's statuses, licence names and words and memory estimates are the server's
// own (the manifests and catalog.json, 2026-10-11), in the wire's field names; each licence in
// plain words, what JustVoice tested and what an engine is best for come from the engine's own
// curated file, the one the server reads. Which models are on disk, loaded or measured, and which
// licences are accepted, are made up to show each state.

import { CURATED } from "../../../server/src/engines/audiocpp/curated/index.js";

export const CARD_MB = 8192; // this machine's graphics card: RTX 2070 SUPER, 8 GB

const LANGS = {
  kokoro: ["en-US", "en-GB", "es", "fr", "hi", "it", "ja", "pt-BR", "zh"],
  index: ["zh", "en", "ja", "es", "ar"],
  cosy: ["zh", "en", "ja", "ko", "de", "es", "fr", "it", "ru", "yue"],
};
const clone = { voice_cloning: true, preset_voices: 0 };

const RAW = [
  {
    id: "kokoro",
    family: "kokoro_tts",
    name: "Kokoro",
    description: "Kokoro-82M — 54 preset voices in 9 languages, fast on any machine. Runs in the audio.cpp speech runtime from one 190 MB model file.",
    table: { name: "Apache-2.0", word: "Yes" },
    catalog_status: "community",
    termsAccepted: true,
    models: [
      { id: "kokoro-82m-q8", name: "Kokoro 82M", size_mb: 180, languages: LANGS.kokoro, voice_cloning: false, preset_voices: 54, directed_by: "sliders", measured_mb: 612, on_disk: true, loaded: true },
      { id: "kokoro-82m-bf16", name: "Kokoro 82M (16-bit)", size_mb: 202, languages: LANGS.kokoro, voice_cloning: false, preset_voices: 54, directed_by: "sliders" },
    ],
  },
  {
    id: "index_tts2",
    name: "IndexTTS2",
    description: "Zero-shot TTS system with voice cloning, emotion-speaker decoupling, text or audio emotion control, and explicit duration control. Variant v2 covers Chinese and English; variant v2.5 (config version 2.5) adds multilingual tiktoken tokenization with Japanese, Spanish and Arabic support.",
    table: { name: "bilibili Model Use License", word: "Conditional" },
    catalog_status: "supported",
    termsAccepted: false,
    models: [
      { id: "index_tts2-indextts2-q8", name: "IndexTTS2", size_mb: 3465, languages: LANGS.index, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8 },
      { id: "index_tts2-indextts2-f16", name: "IndexTTS2 (16-bit)", size_mb: 4431, languages: LANGS.index, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8 },
      { id: "index_tts2-indextts2-orig", name: "IndexTTS2 (original precision)", size_mb: 7710, languages: LANGS.index, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8 },
      { id: "index_tts2-indextts25-q8", name: "IndexTTS2.5", size_mb: 3340, languages: LANGS.index, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8 },
      { id: "index_tts2-indextts25-f16", name: "IndexTTS2.5 (16-bit)", size_mb: 4336, languages: LANGS.index, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8 },
      { id: "index_tts2-indextts25-orig", name: "IndexTTS2.5 (original precision)", size_mb: 7519, languages: LANGS.index, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8 },
    ],
  },
  {
    id: "cosyvoice3",
    name: "CosyVoice3",
    description: "Fun-CosyVoice3 native GGUF package for zero-shot, cross-lingual, and instruction-conditioned text-to-speech using CosyVoice3 speech-token AR generation, causal masked flow mel decoding, CAM++ speaker conditioning, and causal HiFT waveform decoding.",
    table: { name: "Apache-2.0", word: "Yes" },
    catalog_status: "supported",
    termsAccepted: true,
    models: [{ id: "cosyvoice3-q8", name: "CosyVoice3", size_mb: 2153, languages: LANGS.cosy, ...clone, directed_by: "words", min_vram_gb: 8, need_gb: 8, on_disk: true }],
  },
  {
    id: "higgs_audio_tts",
    name: "Higgs Audio v3 TTS",
    description: "Boson AI conversational TTS model for expressive speech across 100+ languages, zero-shot voice cloning, and inline control over emotion, style, prosody, pauses, and sound effects.",
    table: { name: "Boson Higgs TTS 3 Research and Non-Commercial License", word: "No" },
    catalog_status: "supported",
    termsAccepted: false,
    models: [
      { id: "higgs_audio_tts-q8", name: "Higgs Audio v3 TTS", size_mb: 4859, languages: [], languages_note: "100+ languages", ...clone, directed_by: "words", min_vram_gb: 6, need_gb: 6 },
      { id: "higgs_audio_tts-bf16", name: "Higgs Audio v3 TTS (16-bit)", size_mb: 8107, languages: [], languages_note: "100+ languages", ...clone, directed_by: "words", min_vram_gb: 6, need_gb: 7.9 },
    ],
  },
  {
    id: "omnivoice",
    name: "OmniVoice",
    description: "Massively multilingual zero-shot TTS model from k2-fsa for 600+ languages, supporting short-reference voice cloning, attribute-based voice design, pronunciation controls, and nonverbal tags.",
    table: { name: "CC-BY-NC", word: "No" },
    catalog_status: "supported",
    termsAccepted: false,
    models: [
      { id: "omnivoice-q8", name: "OmniVoice", size_mb: 1287, languages: [], languages_note: "600+ languages", ...clone, directed_by: "sliders", min_vram_gb: 10, need_gb: 10 },
      { id: "omnivoice-bf16", name: "OmniVoice (16-bit, bf16)", size_mb: 1563, languages: [], languages_note: "600+ languages", ...clone, directed_by: "sliders", min_vram_gb: 10, need_gb: 10 },
      { id: "omnivoice-f16", name: "OmniVoice (16-bit, f16)", size_mb: 1563, languages: [], languages_note: "600+ languages", ...clone, directed_by: "sliders", min_vram_gb: 10, need_gb: 10 },
    ],
  },
  {
    id: "moss_ttsd",
    name: "MOSS-TTSD",
    description: "8B delay-pattern dialogue TTS: speaker-tagged conversation in one take, with per-speaker zero-shot voice cloning. 24 kHz, 16 codebooks.",
    table: { name: "Not in audio.cpp's licence table", word: "Unclear" },
    catalog_status: "experimental",
    termsAccepted: false,
    models: [{ id: "moss_ttsd-q8", name: "MOSS-TTSD", size_mb: 12437, languages: ["en", "zh"], ...clone, directed_by: "sliders", need_gb: 12.1 }],
  },
];

// Each engine as the server describes it (engines/audiocpp/generated.js engineFacts): its licence
// in plain words beside audio.cpp's word, what we tested, what it's best for.
export const ENGINES = RAW.map(({ table, ...e }) => {
  const cur = CURATED[e.family ?? e.id];
  const l = cur.LICENCE;
  return {
    ...e,
    licence: { name: l.name ?? table.name, commercial: l.commercial, table: table.word, summary: l.summary, url: l.url, checked: l.checked },
    tested: cur.TESTED ?? null,
    best_for: cur.BEST_FOR ?? [],
  };
});
