// SPDX-License-Identifier: MIT
// Chatterbox Turbo and Nano — what audio.cpp's spec can't say (docs/plans/2026-10-11-audiocpp-
// engine-catalog.md §4). audio.cpp's `chatterbox_turbo` family; its models join Chatterbox's
// engine (chatterbox.js holds the engine, its licence and what it is best for). Built from
// audio.cpp's files as every engine is (generated.js `ownEngine`); this file keeps our ids, names
// and what JustVoice measured (the adoption plan's slice 4, F10).
//
// Turbo and Nano came back with gap 1 (docs/plans/2026-10-03-gap-1-turbo-cloning.md): our
// audio.cpp clones on Turbo from a file we convert from Resemble's own checkpoint (our fork's
// tools/community_models/chatterbox_turbo/convert_chatterbox_turbo.py, with the voice encoder and
// speech tokenizer kept), in our fork's catalog — q8_0 and f16, as audio.cpp ships core
// Chatterbox. English; Turbo's 19 inline tags; a clip must be longer than 5 seconds. Their models
// are offered once the pinned runtime clones on Turbo (`needs`: `turbo_clone`, v0.9.0-jv.4).
//
// Each also speaks the model's own voice, with no clip (the plan's F4; decided 2026-10-15, §7
// question 6: "Turbo (built-in)" and "Nano (built-in)", gender Not known — the spec gives it no
// name or gender). audio.cpp's own Turbo package (its built-in voice only, no voice encoder, so it
// can't copy a voice) is offered beside ours (the plan's E6/E14/F5), in audio.cpp's own words.

export const ENGINE = { id: "chatterbox" };

export const MODELS = [
  {
    entry: "chatterbox-turbo-clone",
    model: "chatterbox-turbo",
    id: "chatterbox-turbo",
    name: "Chatterbox Turbo (350M, English)",
    description:
      "Streamlined English-only variant. Native paralinguistic tags ([cough], [laugh], [chuckle] and 16 more). Lower latency; " +
      "no exaggeration/CFG knobs. Clones from a clip longer than 5 seconds. 8-bit weights.",
    quality: 82,
    needs: "turbo_clone",
    own_voice: "Turbo (built-in)",
    packages: ["chatterbox_turbo_clone_q8_0", "chatterbox_turbo_clone_f16"],
  },
  {
    entry: "chatterbox-nano",
    model: "chatterbox-nano",
    id: "chatterbox-nano",
    name: "Chatterbox Nano (110M, English)",
    description:
      "Turbo's architecture at 110M parameters — same 19 inline tags, aimed at CPU and low-VRAM boxes. Clones from a clip longer " +
      "than 5 seconds. 8-bit weights.",
    quality: 78,
    needs: "turbo_clone",
    own_voice: "Nano (built-in)",
    packages: ["chatterbox_nano_q8_0", "chatterbox_nano_f16"],
  },
  // audio.cpp's own package: its f16 file isn't at the pinned model revision (RESEARCH §1.4), so
  // only its 8-bit one. Turbo's settings and tags (capability_details.js `like`); named as
  // audio.cpp's catalog names it, whole — "Chatterbox Turbo" is our Turbo's name too, and two models
  // under one name is the duplicate engine_knob_wiring's test refuses.
  {
    entry: "chatterbox-turbo",
    clone: false,
    like: "chatterbox-turbo",
    audiocpp_name: true,
    packages: ["chatterbox_turbo_q8_0"],
  },
];
