// SPDX-License-Identifier: MIT
// Engine layer — backends + registry + catalog (the port of justvoice/engines/__init__.py).
//
// Every adapter implements the `TTSBackend` shape from base.js. The `EngineRegistry` owns the
// runtime-registered set; each engine's static facts are built from audio.cpp's own files
// (`engines/audiocpp/generated.js`, wrapped by `engines/model_catalog.js`), run by the kit's
// audio.cpp speech runtime (`engines/audiocpp/kit_speech.js`). (app_state.js loads this file for
// `EngineRegistry` — it must not import the catalog.)

export { EngineMeta, PresetVoice, SynthOutput, SynthRequest, TTSBackend } from "./base.js";
export { EngineRegistry } from "./registry.js";
