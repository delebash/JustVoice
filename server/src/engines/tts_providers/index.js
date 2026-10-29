// SPDX-License-Identifier: MIT
// TTS provider adapters beyond the bundled engines (the port of
// justvoice/engines/tts_providers/__init__.py).
//
// Phase 2 / Slice 5 of the Profile-kill plan. Mirrors the LLM-side registry: each external TTS
// provider type (ElevenLabs / Speechify / Speechmatics) is its own adapter satisfying the TTS
// backend shape from engines/base.js. The legacy engines/external_openai.js is kept for
// persisted ExternalEngineConfig settings; new providers register through this package.

import { ValueError } from "@delebash/core/platform/py";
import { ExternalOpenAiTtsBackend } from "../external_openai.js";
import { ElevenLabsBackend } from "./elevenlabs.js";
import { SpeechifyBackend } from "./speechify.js";
import { SpeechmaticsBackend } from "./speechmatics.js";

export { ElevenLabsBackend, SpeechifyBackend, SpeechmaticsBackend };

const PROVIDERS = {
  elevenlabs: [ElevenLabsBackend, "eleven_flash_v2_5"],
  speechify: [SpeechifyBackend, "simba-multilingual"],
  speechmatics: [SpeechmaticsBackend, "default"],
};

/**
 * The adapter for one saved speech server or provider (`settings.engines.external`, an
 * ExternalEngineConfig): `provider_type` picks it. The one way to build one — the boot registers
 * every saved one through it (app.js `_registerExternalEngines`), POST /v1/engines/external the one
 * being saved (moved here from app.js, 2026-10-29, so the route builds what the boot builds).
 */
export function buildExternalEngine(cfg) {
  const pt = (cfg.provider_type || "openai-compat").toLowerCase();
  if (pt === "openai-compat" || pt === "openai-tts" || pt === "external-openai-tts") {
    // OpenAI TTS uses the same /v1/audio/speech shape as openai-compat; they're the same
    // adapter with a different default base_url.
    const baseUrl = cfg.base_url || (pt === "openai-tts" ? "https://api.openai.com" : "");
    if (!baseUrl) throw new ValueError(`${cfg.id}: openai-compat external engine needs a base_url`);
    return new ExternalOpenAiTtsBackend({
      id: cfg.id,
      name: cfg.name,
      baseUrl,
      apiKey: cfg.api_key,
      model: cfg.model || "tts-1",
      voices: cfg.voices,
      responseFormat: cfg.response_format,
    });
  }
  if (Object.hasOwn(PROVIDERS, pt)) {
    const [Backend, model] = PROVIDERS[pt];
    return new Backend({
      id: cfg.id,
      name: cfg.name,
      apiKey: cfg.api_key || "",
      model: cfg.model || model,
      voices: cfg.voices,
      baseUrl: cfg.base_url,
      responseFormat: cfg.response_format,
    });
  }
  throw new ValueError(`unknown TTS provider_type: '${pt}'`);
}
