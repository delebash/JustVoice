// SPDX-License-Identifier: MIT
// KittenTTS — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-engine-catalog.md §4).
// Its engine is built from audio.cpp's files as every engine is (generated.js `ownEngine`); this
// file keeps our ids, genders and what JustVoice measured (the adoption plan's slice 4, F10).

// Its licence in plain words — can a person sell an audiobook made with it? Our reading of the
// licence at its source, checked 2026-10-11 (RESEARCH §10.13); the licence itself is what counts.
export const LICENCE = {
  commercial: "Yes",
  summary: "Yes. Apache-2.0, nothing added.",
  url: "https://huggingface.co/KittenML/kitten-tts-mini-0.8",
  checked: "2026-10-11",
};

// Measured by JustVoice; what it is best for is the Speech engines page's picking table (approved
// 2026-10-09).
export const TESTED = {
  record: "docs/engines.md",
  note: "Measured by JustVoice.",
};

export const BEST_FOR = ["English voices made for the CPU"];

// The engine: KittenML's 80M-parameter model made for the CPU, measured at 3.41× real time there
// on a Ryzen 7 5700X (8 threads) — fast enough that Auto keeps it off the graphics card (CPU
// placement, 2026-10-02). eSpeak NG phonemizes it, as for Kokoro.
export const ENGINE = {
  id: "kitten",
  name: "KittenTTS",
  description:
    "KittenTTS Mini 0.8 — eight English preset voices from a small model made to run without a graphics card. Runs in the " +
    "audio.cpp speech runtime from one 302 MB model file.",
};

// Its one model — its download is the spec's original-precision package, under the id it always had.
// The same seed repeats its take on the graphics card and the CPU since our fork's 7ec5c652 (jv
// bcc5dfbb), so it offers a seed like every engine (decided 2026-10-16, TASKS "Slice 5's findings"
// 1; was: no seed, the same seed not giving the same audio twice — measured 2026-10-02).
export const MODELS = [
  {
    entry: "kitten-tts",
    model: "kitten",
    name: "KittenTTS Mini 0.8",
    description: "Eight English preset voices. Made for the CPU.",
    languages: "voices",
    packages: { kitten_tts_mini_0_8_orig: "kitten-mini-0.8" },
  },
];

// Seconds of audio per second of work on the CPU on the reference machine (Ryzen 7 5700X, 8
// threads, 2026-10-02) until a render measures this one.
export const CPU_REALTIME = { "kitten-mini-0.8": 3.41 };

// The spec's eight voices (`ui.builtin_voices`, default Leo), by audio.cpp's name: our id (it
// carries the engine, so it never collides with another engine's voice of the same name) and its
// gender, from the model's config.json, whose `voice_aliases` map each name to an
// `expr-voice-N-f|m` voice (read 2026-10-02). English, as the app writes it.
export const VOICES = {
  Bella: { id: "kitten_bella", gender: "female", language: "en-US" },
  Jasper: { id: "kitten_jasper", gender: "male", language: "en-US" },
  Luna: { id: "kitten_luna", gender: "female", language: "en-US" },
  Bruno: { id: "kitten_bruno", gender: "male", language: "en-US" },
  Rosie: { id: "kitten_rosie", gender: "female", language: "en-US" },
  Hugo: { id: "kitten_hugo", gender: "male", language: "en-US" },
  Kiki: { id: "kitten_kiki", gender: "female", language: "en-US" },
  Leo: { id: "kitten_leo", gender: "male", language: "en-US" },
};
