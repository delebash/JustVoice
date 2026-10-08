// SPDX-License-Identifier: MIT
// Engine layer — backends + registry + catalog (the port of justvoice/engines/__init__.py).
//
// Every adapter implements the `TTSBackend` shape from base.js. The `EngineRegistry` owns the
// runtime-registered set; each engine's static facts live in `engines/<id>/manifest.js`, run
// by the speech runtime through `engines/manager.js`. (app_state.js loads this file for
// `EngineRegistry` — it must not import the manager.)

export { EngineMeta, PresetVoice, SynthOutput, SynthRequest, TTSBackend } from "./base.js";
export { EngineRegistry } from "./registry.js";
