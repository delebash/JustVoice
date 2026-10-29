// SPDX-License-Identifier: MIT
// sanoTTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-15 (RESEARCH §10.13); the licence itself is what counts.
// audio.cpp's table says "Yes"; our reading of the licence differs (RESEARCH §10.13).
export const LICENCE = {
  name: "GPL-3.0 (the project); MIT (its runtime)",
  commercial: "Unclear",
  summary: "Depends on the voice. heart and heart-nano learned from Kokoro (Apache-2.0), and kristin from a Piper voice trained on public-domain recordings: yes. The other voices learned from Piper voices whose own cards name non-commercial or unknown recordings, most of them fine-tuned from Piper’s research-only Lessac voice: unclear, though sanoTTS calls all its teachers MIT.",
  url: "https://huggingface.co/ampixa/sanoTTS",
  checked: "2026-10-15",
};

// Each download's language — one voice, one language each (decided 2026-10-15, TASKS "Slice 2's
// acceptance findings" 5), from the table in ../audio.cpp/docs/models/sanotts.md:28-47 (pt is
// "Brazilian Portuguese"). Keyed by audio.cpp's package: the persona's language picks the download,
// as Pocket TTS's does (voice_model.variantForModel).
export const LANGUAGES = {
  sanotts_heart_orig: ["en"],
  sanotts_heart_nano_orig: ["en"],
  sanotts_amy_orig: ["en"],
  sanotts_hfc_orig: ["en"],
  sanotts_kristin_orig: ["en"],
  sanotts_vi_orig: ["vi"],
  sanotts_id_orig: ["id"],
  sanotts_cs_orig: ["cs"],
  sanotts_de_orig: ["de"],
  sanotts_es_orig: ["es"],
  sanotts_fr_orig: ["fr"],
  sanotts_it_orig: ["it"],
  sanotts_pt_orig: ["pt-BR"],
  sanotts_ro_orig: ["ro"],
  sanotts_ru_orig: ["ru"],
  sanotts_tr_orig: ["tr"],
  sanotts_ne_orig: ["ne"],
  sanotts_hi_orig: ["hi"],
};

// The SHA-256 of each download's config.json: small files Git stores itself, so catalog.json carries only Git's
// blob id for them (40 hex — all Hugging Face lists outside LFS), and the engine cache names and
// checks every file by its SHA-256 (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1).
// Each file fetched at its revision (2026-10-29), its size and Git blob id checked against the catalog.
export const SMALL_FILES = [
  {
    repo: "ampixa/sanoTTS",
    revision: "c532a5d21c078a16cb633718e9182bfd71a5b760",
    sha256: {
      "gguf/config.json": "58eabea7a1156d436bf30731a47c86c3f1ec02623ee2a545a7cf042a8517b4dd",
      "gguf/heart/config.json": "0b3ffed9db2975352d662b4648006e1e6dfde9892bd30dcac6fea3d013607dd6",
      "gguf/amy/config.json": "f974432ca8bab93ea07abcee768c649a4e4ee0cfe1b1e88efa886e68702073a4",
      "gguf/hfc/config.json": "efe89a538552742252b1a94e404d30bcebe907829669298b5783ca3b874a745f",
      "gguf/kristin/config.json": "299f51b020fc0982da562e30befd7d88fdb9a384d2783721e314bc473bc1b494",
      "gguf/vi/config.json": "d72b29f8c5dad7e442ba7fdf40232d6fd7cab0a9afd306e6d8ab2894ca0722f0",
      "gguf/id/config.json": "e93d194707cd96a810c455d18ac78398457cc6452c897dcdeb5f7592cb4e248b",
      "gguf/cs/config.json": "02e1e77796be139bb4dea3d1e0784a717a8d3e86463aa8e69ef3595de94822a3",
      "gguf/de/config.json": "6847f38cb3028d1d5854123a879660efba959a2e24b980cb37b2ae1fe0eabb17",
      "gguf/es/config.json": "09b7a90a284e36ffaf0e066bbd87f80cfe284bbb7f53cb5b47bdaae121223206",
      "gguf/fr/config.json": "925a7bb3337f0d0d86076d53601e8de5273dad11d6736446e423453066dcb157",
      "gguf/it/config.json": "020842d2b0e35184413d5c9eddc081b8f6220d938adab5483246d5de2c220133",
      "gguf/pt/config.json": "afeae6f79747d31f0110c40f629e06457301bb7f3e43ce17b60a2e5d1c85e376",
      "gguf/ro/config.json": "43513008d42f78f3e9a2666ff3d89d9f7ba43b1c0ec79c31b6932aa6cefe8a08",
      "gguf/ru/config.json": "3cdc42083c7a14da864c650df6dfc7dff47919f5a54ad5722ffa65ecda20e11b",
      "gguf/tr/config.json": "7895212d23ba27df600192e53b50a83de53231eab661c71a628be2a5a034a35f",
      "gguf/ne/config.json": "334d33da82e46f4a39505fa4adde1696ff5c9772b3c023bf996c1e5338411309",
      "gguf/hi/config.json": "0f4a254235b91de1370519497493a3d118df43acdd3a1922a2069b9c518114d9",
    },
  },
];
