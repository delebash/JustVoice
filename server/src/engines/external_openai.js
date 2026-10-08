// SPDX-License-Identifier: MIT
// External OpenAI-compatible TTS engine adapter (the port of
// justvoice/engines/external_openai.py).
//
// Wraps any server speaking the standard OpenAI TTS spec at `POST /v1/audio/speech`.
// Configured via `settings.engines.external`. Requests go through the kit's one HTTP client;
// the JSON body is httpx's (compact, UTF-8, `speed` a float).

import * as http from "@delebash/llm-runner/platform/http";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { PyFloat, pyJson } from "@delebash/llm-runner/platform/pyjson";
import { EngineMeta, PresetVoice, SynthOutput } from "./base.js";

const log = getLogger("justvoice.engines.external_openai");

/** httpx's `json=` body text. Candidate for platform/. */
export const httpxJson = (v, floats = []) => pyJson(v, { separators: [",", ":"], ensureAscii: false, floats });

const rstripSlash = (s) => String(s).replace(/\/+$/, "");

export class ExternalOpenAiTtsBackend {
  constructor({ id, name, baseUrl, apiKey = null, model, voices = [], responseFormat = "wav" }) {
    this.meta = new EngineMeta({
      engineId: id,
      displayName: name,
      backend: "external-openai-tts",
      supportedRuntimes: ["http"],
      supportsCloning: false,
      supportsStreaming: false,
      supportsSpeed: true, // sent as `speed` on /v1/audio/speech below
    });
    this._baseUrl = rstripSlash(baseUrl);
    this._apiKey = apiKey;
    this._model = model;
    this._responseFormat = responseFormat;
    this._voices = (voices || []).map((v) => new PresetVoice({ id: v, name: v, language: "en" }));
    if (!this._voices.length) this._voices = [new PresetVoice({ id: "default", name: `${name} default`, language: "en" })];
    this._ready = false;
  }

  async load(device = "auto", modelVariant = null) {
    try {
      const r = await http.fetch(`${this._baseUrl}/`, { method: "HEAD", timeoutMs: 5000 });
      await r.arrayBuffer().catch(() => {});
      this._ready = true;
    } catch (e) {
      this._ready = false;
      throw new RuntimeError(`External TTS server at ${this._baseUrl} is not responding: ${e?.cause?.message ?? e?.message ?? e}`);
    }
  }

  unload() {
    this._ready = false;
  }

  ready() {
    return this._ready;
  }

  voices() {
    return [...this._voices];
  }

  async synthesize(req) {
    const delivery = req.delivery || {};
    const body = {
      model: this._model,
      input: req.text,
      voice: req.voiceId,
      response_format: this._responseFormat,
      speed: Number((delivery.speed instanceof PyFloat ? delivery.speed.v : delivery.speed) || 1.0),
    };
    const headers = { "content-type": "application/json" };
    if (this._apiKey) headers.Authorization = `Bearer ${this._apiKey}`;
    const url = `${this._baseUrl}/v1/audio/speech`;
    const r = await http.fetch(url, { method: "POST", body: httpxJson(body, ["speed"]), headers, timeoutMs: 120_000 });
    const content = Buffer.from(await r.arrayBuffer());
    if (r.status >= 400) {
      throw new RuntimeError(`${this.meta.engineId}: ${r.status} from ${url}: ${content.toString("utf8")}`);
    }
    log.debug(`${this.meta.engineId}: ${content.length} bytes from ${url}`);
    return new SynthOutput({ bytes: content, sampleRate: 24_000, channels: 1, isWavContainer: true }); // WAV header is authoritative
  }
}
