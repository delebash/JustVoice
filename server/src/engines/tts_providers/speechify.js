// SPDX-License-Identifier: MIT
// Speechify TTS adapter (SIMBA 3.0 API) — the port of
// justvoice/engines/tts_providers/speechify.py.
//
// POST /v1/audio/speech with bearer auth. The response is base64-encoded audio in JSON
// (`audio_data`) — distinct from ElevenLabs returning raw bytes.

import * as http from "@delebash/llm-runner/platform/http";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { EngineMeta, PresetVoice, SynthOutput } from "../base.js";
import { httpxJson } from "../external_openai.js";

const log = getLogger("justvoice.engines.tts_providers.speechify");

export const DEFAULT_BASE_URL = "https://api.sws.speechify.com";
export const DEFAULT_MODEL = "simba-multilingual";

const errText = (e) => e?.cause?.message ?? e?.message ?? String(e);

export class SpeechifyBackend {
  constructor({ id, name, apiKey, model = DEFAULT_MODEL, voices = null, baseUrl = "", responseFormat = "wav" }) {
    this.meta = new EngineMeta({ engineId: id, displayName: name, backend: "speechify", supportedRuntimes: ["http"], kind: "tts" });
    this._apiKey = apiKey;
    this._baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._model = model;
    this._configuredVoices = voices || [];
    this._voicesCache = null;
    this._ready = false;
    this._responseFormat = responseFormat;
  }

  _headers() {
    return { Authorization: `Bearer ${this._apiKey}`, "Content-Type": "application/json" };
  }

  async load(device = "auto", modelVariant = null) {
    try {
      const r = await http.fetch(`${this._baseUrl}/v1/voices`, { headers: this._headers(), timeoutMs: 5000 });
      await r.arrayBuffer().catch(() => {});
      this._ready = r.status < 500;
      if (modelVariant) this._model = modelVariant;
    } catch (e) {
      this._ready = false;
      throw new RuntimeError(`Speechify auth check failed: ${errText(e)}`);
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
    const configured = () => this._configuredVoices.map((v) => new PresetVoice({ id: v, name: v }));
    try {
      const r = await http.fetch(`${this._baseUrl}/v1/voices`, { headers: this._headers(), timeoutMs: 120_000 });
      if (r.status >= 400) {
        await r.arrayBuffer().catch(() => {});
        return configured();
      }
      const data = await r.json();
      // Speechify nests by language: {voices: [{id, display_name, gender, languages: [...]}]}
      const payload = (data && data.voices) || data;
      this._voicesCache = (Array.isArray(payload) ? payload : [])
        .filter((v) => v && typeof v === "object" && !Array.isArray(v) && (v.id || v.voice_id || v.name))
        .map(
          (v) =>
            new PresetVoice({
              id: v.id || v.voice_id || v.name,
              name: v.display_name || v.name || "voice",
              language: Array.isArray(v.languages) ? ((v.languages[0] || {}).locale ?? "en") : "en",
              gender: v.gender ?? null,
            }),
        );
      return [...this._voicesCache];
    } catch (e) {
      log.warning(`Speechify voices() failed: ${errText(e)}`);
      return configured();
    }
  }

  async synthesize(req) {
    const body = { input: req.text, voice_id: req.voiceId, model: this._model, audio_format: "wav" };
    const url = `${this._baseUrl}/v1/audio/speech`;
    let r;
    try {
      r = await http.fetch(url, { method: "POST", body: httpxJson(body), headers: this._headers(), timeoutMs: 120_000 });
    } catch (e) {
      throw new RuntimeError(`Speechify request failed: ${errText(e)}`);
    }
    const text = await r.text();
    if (r.status >= 400) throw new RuntimeError(`Speechify ${r.status}: ${text.slice(0, 400)}`);
    const payload = JSON.parse(text);
    const audioB64 = payload.audio_data || payload.audio || "";
    if (!audioB64) throw new RuntimeError("Speechify returned no audio_data");
    return new SynthOutput({ bytes: Buffer.from(audioB64, "base64"), sampleRate: 24000, channels: 1, isWavContainer: true });
  }
}
