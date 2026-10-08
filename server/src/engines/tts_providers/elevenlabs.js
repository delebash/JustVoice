// SPDX-License-Identifier: MIT
// ElevenLabs TTS adapter (the port of justvoice/engines/tts_providers/elevenlabs.py).
//
// Proprietary /v1/text-to-speech/{voice_id} endpoint. Voices listed at /v1/voices, models
// hardcoded (ElevenLabs doesn't expose a /models endpoint).

import * as http from "@delebash/llm-runner/platform/http";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { writeWavContainer } from "../../audio/wav.js";
import { EngineMeta, PresetVoice, SynthOutput } from "../base.js";
import { httpxJson } from "../external_openai.js";

const log = getLogger("justvoice.engines.tts_providers.elevenlabs");

export const DEFAULT_BASE_URL = "https://api.elevenlabs.io";
export const DEFAULT_MODEL = "eleven_flash_v2_5";

// Pinned model list — ElevenLabs adds/retires models without an API to enumerate them, so the
// UI shows this list and the user can paste a custom id into the dropdown if needed.
export const KNOWN_MODELS = ["eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5", "eleven_turbo_v2_5"];

const errText = (e) => e?.cause?.message ?? e?.message ?? String(e);

export class ElevenLabsBackend {
  constructor({ id, name, apiKey, model = DEFAULT_MODEL, voices = null, baseUrl = "", responseFormat = "wav" }) {
    this.meta = new EngineMeta({
      engineId: id,
      displayName: name,
      backend: "elevenlabs",
      supportedRuntimes: ["http"],
      kind: "tts",
      supportsCloning: true,
    });
    this._apiKey = apiKey;
    this._baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._model = model;
    this._responseFormat = responseFormat;
    this._voicesCache = null;
    this._configuredVoices = voices || [];
    this._ready = false;
  }

  _headers() {
    return { "xi-api-key": this._apiKey, Accept: "*/*" };
  }

  async load(device = "auto", modelVariant = null) {
    try {
      const r = await http.fetch(`${this._baseUrl}/v1/voices`, { headers: this._headers(), timeoutMs: 5000 });
      await r.arrayBuffer().catch(() => {});
      this._ready = r.status < 400;
      if (modelVariant) this._model = modelVariant;
    } catch (e) {
      this._ready = false;
      throw new RuntimeError(`ElevenLabs auth check failed: ${errText(e)}`);
    }
  }

  unload() {
    this._ready = false;
  }

  ready() {
    return this._ready;
  }

  async voices() {
    if (this._voicesCache !== null) return [...this._voicesCache];
    const configured = () => this._configuredVoices.map((v) => new PresetVoice({ id: v, name: v, language: "en" }));
    try {
      const r = await http.fetch(`${this._baseUrl}/v1/voices`, { headers: this._headers(), timeoutMs: 120_000 });
      if (r.status >= 400) {
        await r.arrayBuffer().catch(() => {});
        return configured();
      }
      const data = await r.json();
      this._voicesCache = (data.voices || [])
        .filter((v) => v.voice_id)
        .map(
          (v) =>
            new PresetVoice({
              id: v.voice_id,
              name: v.name || v.voice_id,
              language: (v.labels || {}).language || "en",
              gender: (v.labels || {}).gender ?? null,
            }),
        );
      return [...this._voicesCache];
    } catch (e) {
      log.warning(`ElevenLabs voices() failed: ${errText(e)}`);
      return configured();
    }
  }

  async synthesize(req) {
    // ElevenLabs returns MP3 by default; ask for raw PCM and wrap it as WAV.
    const body = { text: req.text, model_id: this._model, output_format: "pcm_24000" };
    const delivery = req.delivery || {};
    if ("stability" in delivery || "similarity_boost" in delivery || "style" in delivery) {
      const vs = {
        stability: delivery.stability,
        similarity_boost: delivery.similarity_boost,
        style: delivery.style,
        use_speaker_boost: delivery.use_speaker_boost,
      };
      body.voice_settings = Object.fromEntries(Object.entries(vs).filter(([, v]) => v != null));
    }
    const url = `${this._baseUrl}/v1/text-to-speech/${req.voiceId}`;
    let r;
    try {
      r = await http.fetch(url, {
        method: "POST",
        body: httpxJson(body),
        headers: { ...this._headers(), "content-type": "application/json" },
        timeoutMs: 120_000,
      });
    } catch (e) {
      throw new RuntimeError(`ElevenLabs request failed: ${errText(e)}`);
    }
    const pcm = Buffer.from(await r.arrayBuffer());
    if (r.status >= 400) throw new RuntimeError(`ElevenLabs ${r.status}: ${pcm.toString("utf8").slice(0, 400)}`);
    return new SynthOutput({ bytes: writeWavContainer(pcm, 24000, 1), sampleRate: 24000, channels: 1, isWavContainer: true });
  }

  static knownModels() {
    return [...KNOWN_MODELS];
  }
}
