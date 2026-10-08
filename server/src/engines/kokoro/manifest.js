// SPDX-License-Identifier: MIT
// Manifest for Kokoro — 54 preset voices, run by the audio.cpp runtime (the port of
// justvoice/engines/kokoro/manifest.py).
//
// Since the 2026-10-01 switch (docs/plans/2026-10-01-audiocpp-switch.md) Kokoro is one GGUF
// file served by audio.cpp, not a Python program. The voice pack is inside the GGUF; the voice
// ids are unchanged (`voices.js`, k2-fsa naming `<lang><gender>_<name>`), so every persona
// built on a Kokoro voice keeps working.
//
// English, Spanish, French, Hindi, Italian and Portuguese are phonemized by eSpeak NG, which
// the runtime install fetches onto this machine (`engines/audiocpp/espeak.js`). Chinese works
// from the GGUF's own table. Japanese needs MeCab + UniDic: MeCab ships in our runtime, UniDic
// is the optional Japanese dictionary (gap 7).
//
// What follows the pin (the voices offered, the IPA and blend capabilities) is computed by
// `build()` — what Python's module body did at import; a test calls it again after changing
// the pin (Python reloaded the module).

import { modelSource, pinnedHas, sixteenBit } from "../audiocpp/release.js";
import { presetVoicesAsDicts } from "./voices.js";

export const ID = "kokoro";
export const NAME = "Kokoro";
export const SUPPORTED_OSES = ["windows", "linux", "macos"];
export const LICENSE = "Apache-2.0";
export const REQUIREMENTS = { gpu_runtimes: ["cuda", "vulkan", "metal", "cpu"] };
export const DEFAULT_VARIANT_ID = "kokoro-82m-q8";

/** The pin-dependent half of the manifest, as the module body computed it. */
export function build() {
  const CAPABILITIES = {
    preset_voices: true,
    voice_cloning: false,
    voice_design: false,
    instruct_field: false,
    paralinguistic_tags: false,
    // A lexicon's IPA rides our audio.cpp's inline pronunciations (gap 3) — on with the pin.
    phoneme_override: pinnedHas("inline_ipa"),
    // Blends need our audio.cpp's `voice_pack` option (gap 2) — on once the pin has it.
    voice_blending: pinnedHas("voice_pack"),
  };
  // The five Japanese voices need MeCab + UniDic. Offered once the pinned runtime reads
  // Japanese; a line in one of them is refused by name until the dictionary is installed.
  const STATIC_VOICES = presetVoicesAsDicts().filter((v) => pinnedHas("japanese") || v.language !== "ja");
  // Counted from the voices offered, so the text follows the pin (audit §5 F).
  const languages = [...new Set(STATIC_VOICES.map((v) => v.language))];
  const voicesText = `${STATIC_VOICES.length} preset voices in ${languages.length} languages`;
  const DESCRIPTION =
    `Kokoro-82M — ${voicesText}, fast on any machine. Runs in the audio.cpp speech runtime ` +
    "from one 190 MB model file.";
  const VARIANTS = [
    {
      id: "kokoro-82m-q8",
      name: "Kokoro 82M",
      description: `${voicesText}. 8-bit weights.`,
      languages,
      voice_cloning: false,
      preset_voices: STATIC_VOICES.length,
      quality: 95,
      weights_license: "Apache-2.0",
      sources: [modelSource("Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf", 189_549_408)],
      audiocpp: { family: "kokoro_tts", task: "tts", file: "Kokoro-82M-GGUF/kokoro-82m-q8_0.gguf" },
      // Seconds of audio per second of work on the CPU — the reference machine's figure
      // (Ryzen 7 5700X, 8 threads, 2026-10-02) until a render measures this one
      // (docs/plans/2026-10-02-cpu-placement.md §6).
      cpu_realtime: 3.15,
      // The longest piece a line reaches the model in — audio.cpp's own Kokoro budget, so it
      // never re-splits a piece with a hard join (audit 2026-10-04 §13.3); a 240-character
      // piece peaked at about 2,700 MB on the card.
      split_chars: 240,
    },
  ];
  // The 16-bit file at the same pinned commit (gap 9); the 8-bit row stays the default.
  VARIANTS.push(sixteenBit(VARIANTS[0], "Kokoro-82M-GGUF/kokoro-82m-bf16.gguf", 211_954_816));
  // Its own CPU speed on the reference machine (Ryzen 7 5700X, 8 threads, af_heart, five short
  // lines, 2026-10-04). Without one, Auto never offered the 16-bit row the CPU (audit §5 B6).
  VARIANTS[VARIANTS.length - 1].cpu_realtime = 2.61;
  return { CAPABILITIES, STATIC_VOICES, DESCRIPTION, VARIANTS };
}

const built = build();
export const CAPABILITIES = built.CAPABILITIES;
export const STATIC_VOICES = built.STATIC_VOICES;
export const DESCRIPTION = built.DESCRIPTION;
export const VARIANTS = built.VARIANTS;
