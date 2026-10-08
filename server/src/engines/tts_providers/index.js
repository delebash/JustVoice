// SPDX-License-Identifier: MIT
// TTS provider adapters beyond the bundled engines (the port of
// justvoice/engines/tts_providers/__init__.py).
//
// Phase 2 / Slice 5 of the Profile-kill plan. Mirrors the LLM-side registry: each external TTS
// provider type (ElevenLabs / Speechify / Speechmatics) is its own adapter satisfying the TTS
// backend shape from engines/base.js. The legacy engines/external_openai.js is kept for
// persisted ExternalEngineConfig settings; new providers register through this package.

export { ElevenLabsBackend } from "./elevenlabs.js";
export { SpeechifyBackend } from "./speechify.js";
export { SpeechmaticsBackend } from "./speechmatics.js";
