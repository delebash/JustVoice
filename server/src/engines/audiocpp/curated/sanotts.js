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

// Its small files' SHA-256s are seed data: ../seed_file_hashes.js `SMALL_FILES` (the kit's family guard, 2026-10-29).
