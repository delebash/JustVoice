// SPDX-License-Identifier: MIT
// Manifest for Chatterbox Multilingual — voice cloning, run by the audio.cpp runtime (the port
// of justvoice/engines/chatterbox/manifest.py).
//
// Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) Chatterbox is one
// GGUF file served by audio.cpp. Measured on an RTX 2070 SUPER: 2.08× real time against 0.92×
// for the PyTorch engine it replaces, at 3.2 GB of VRAM instead of 5.4.
//
// Clone-only: every Chatterbox voice is a reference clip the user brings. Exaggeration and CFG
// are set per line (verified 2026-10-01 — no model reload).
//
// Turbo and Nano came back with gap 1 (docs/plans/2026-10-03-gap-1-turbo-cloning.md): our
// audio.cpp clones on Turbo from a file we convert from Resemble's own checkpoint, published at
// TURBO_REPO / NANO_REPO. Their rows join VARIANTS when the pinned runtime has `turbo_clone`
// (v0.9.0-jv.4); on an older pin they wait in PENDING_VARIANTS. Hebrew, Russian and Chinese
// (`chatterbox_he_ru_zh`) and Japanese (`japanese`) join the 19 languages the same way (gap 7).
// Resemble's PerTh watermark is not applied by audio.cpp (user, 2026-10-01: "dont care about
// watermark").
//
// What follows the pin is computed by `build()` — what Python's module body did at import; a
// test calls it again after changing the pin (Python reloaded the module).

import { pySorted } from "@delebash/llm-runner/platform/py";
import { modelSource, pinnedHas, sixteenBit } from "../audiocpp/release.js";

export const ID = "chatterbox";
export const NAME = "Chatterbox";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const LICENSE = "MIT";
export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };

// Turbo and Nano (gap 1): English, clone-only, Turbo's 19 inline tags. Converted by us from
// Resemble's checkpoints with the voice encoder and speech tokenizer kept (our audio.cpp's
// tools/community_models/chatterbox_turbo/convert_chatterbox_turbo.py) — q8_0 and f16, f16 as
// audio.cpp ships core Chatterbox. A clip must be longer than 5 seconds.
export const TURBO_REPO = "delebash/chatterbox-turbo-GGUF";
export const TURBO_REVISION = "db9317b6f796c4d11112ee845a6189328e25fb15"; // q8_0 + f16, 2026-10-03
export const NANO_REPO = "delebash/chatterbox-nano-GGUF";
export const NANO_REVISION = "e707626a9bb9d3cbb035abfaacb82616c4c3d2e7"; // q8_0 + f16, 2026-10-03

export const DEFAULT_VARIANT_ID = "chatterbox-multilingual-v2-q8";

// Clone-only — the voices are the user's own clips, stored host-side.
export const STATIC_VOICES = [];

function turboRow(id, name, description, quality, repo, revision, file, size) {
  return {
    id,
    name,
    description,
    languages: ["en"],
    voice_cloning: true,
    preset_voices: 0,
    quality,
    weights_license: "MIT",
    sources: [modelSource(file, size, { repo, revision })],
    audiocpp: { family: "chatterbox_turbo", task: "tts", file },
  };
}

/** The pin-dependent half of the manifest, as the module body computed it. */
export function build() {
  // audio.cpp's core Chatterbox languages (model_specs/chatterbox.json, v0.9.0).
  let langs = ["ar", "da", "de", "el", "en", "es", "fi", "fr", "hi", "it", "ko", "ms", "nl", "no", "pl", "pt", "sv", "sw", "tr"];
  // Gap 7 (docs/plans/2026-10-03-gap-7-more-languages.md): Hebrew, Russian and Chinese in our
  // audio.cpp; Japanese too, with the optional Japanese dictionary.
  if (pinnedHas("chatterbox_he_ru_zh")) langs = pySorted([...langs, "he", "ru", "zh"]);
  if (pinnedHas("japanese")) langs = pySorted([...langs, "ja"]);

  const DESCRIPTION =
    `Resemble AI's open-source cloning TTS. Multilingual: 500M parameters, ${langs.length} languages, ` +
    "zero-shot voice cloning, per-line exaggeration / CFG / temperature. Runs in the " +
    "audio.cpp speech runtime.";

  const CAPABILITIES = {
    preset_voices: false,
    voice_cloning: true,
    voice_design: false,
    instruct_field: false,
    // Turbo's 19 inline tags; the tag filter reads the rendering variant's row, so
    // Multilingual keeps none (gap 1).
    paralinguistic_tags: pinnedHas("turbo_clone"),
    phoneme_override: false,
  };

  const VARIANTS = [
    {
      id: "chatterbox-multilingual-v2-q8",
      name: `Chatterbox Multilingual (${langs.length} languages)`,
      description: "Zero-shot cloning from a reference clip, with exaggeration and CFG per line. 8-bit weights.",
      languages: [...langs],
      voice_cloning: true,
      preset_voices: 0,
      quality: 88,
      weights_license: "MIT",
      sources: [modelSource("Chatterbox-GGUF/chatterbox-q8_0.gguf", 2_088_393_668)],
      audiocpp: { family: "chatterbox", task: "clon", file: "Chatterbox-GGUF/chatterbox-q8_0.gguf" },
    },
  ];
  // The 16-bit file at the same pinned commit (gap 9; audio.cpp ships Chatterbox as f16, not
  // bf16); the 8-bit row stays the default.
  VARIANTS.push(sixteenBit(VARIANTS[0], "Chatterbox-GGUF/chatterbox-f16.gguf", 3_744_360_386, { dtype: "f16" }));

  const turbo = turboRow(
    "chatterbox-turbo-q8",
    "Chatterbox Turbo (350M, English)",
    "Streamlined English-only variant. Native paralinguistic tags ([cough], [laugh], [chuckle] " +
      "and 16 more). Lower latency; no exaggeration/CFG knobs. Clones from a clip longer than " +
      "5 seconds. 8-bit weights.",
    82,
    TURBO_REPO,
    TURBO_REVISION,
    "chatterbox-turbo-q8_0.gguf",
    880_908_100,
  );
  const nano = turboRow(
    "chatterbox-nano-q8",
    "Chatterbox Nano (110M, English)",
    "Turbo's architecture at 110M parameters — same 19 inline tags, aimed at CPU and low-VRAM " +
      "boxes. Clones from a clip longer than 5 seconds. 8-bit weights.",
    78,
    NANO_REPO,
    NANO_REVISION,
    "chatterbox-nano-q8_0.gguf",
    616_250_532,
  );
  // Offered once the pinned runtime clones on Turbo (`turbo_clone`); the capability rows
  // (`chatterbox-turbo`, `chatterbox-nano`) and the knob-wiring test read them either way.
  let PENDING_VARIANTS = [
    turbo,
    sixteenBit(turbo, "chatterbox-turbo-f16.gguf", 1_391_709_474, {
      dtype: "f16",
      source: modelSource("chatterbox-turbo-f16.gguf", 1_391_709_474, { repo: TURBO_REPO, revision: TURBO_REVISION }),
    }),
    nano,
    sixteenBit(nano, "chatterbox-nano-f16.gguf", 894_652_290, {
      dtype: "f16",
      source: modelSource("chatterbox-nano-f16.gguf", 894_652_290, { repo: NANO_REPO, revision: NANO_REVISION }),
    }),
  ];
  if (pinnedHas("turbo_clone")) {
    VARIANTS.push(...PENDING_VARIANTS);
    PENDING_VARIANTS = [];
  }
  return { DESCRIPTION, CAPABILITIES, VARIANTS, PENDING_VARIANTS };
}

const built = build();
export const DESCRIPTION = built.DESCRIPTION;
export const CAPABILITIES = built.CAPABILITIES;
export const VARIANTS = built.VARIANTS;
export const PENDING_VARIANTS = built.PENDING_VARIANTS;
