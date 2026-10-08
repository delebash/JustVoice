// SPDX-License-Identifier: MIT
// Speechmatics TTS adapter (the port of justvoice/engines/tts_providers/speechmatics.py).
//
// Proprietary endpoint shape: POST /generate/{voice_name} with `{text}` in the JSON body.
// Voices are listed at /voices. Bearer token auth.

import * as http from "@delebash/llm-runner/platform/http";
import { getLogger } from "@delebash/llm-runner/platform/log";
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { EngineMeta, PresetVoice, SynthOutput } from "../base.js";
import { httpxJson } from "../external_openai.js";

const log = getLogger("justvoice.engines.tts_providers.speechmatics");

export const DEFAULT_BASE_URL = "https://preview.tts.speechmatics.com";

// Speechmatics ships a small pinned set of voices. Listed here so the UI can render them even
// when /voices isn't reachable (sometimes the preview endpoint goes down without breaking
// /generate).
export const KNOWN_VOICES = ["sarah", "theo", "megan", "jack"];

const errText = (e) => e?.cause?.message ?? e?.message ?? String(e);

export class SpeechmaticsBackend {
  constructor({ id, name, apiKey, model = "default", voices = null, baseUrl = "", responseFormat = "wav" }) {
    this.meta = new EngineMeta({ engineId: id, displayName: name, backend: "speechmatics", supportedRuntimes: ["http"], kind: "tts" });
    this._apiKey = apiKey;
    this._baseUrl = String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this._configuredVoices = voices && voices.length ? voices : KNOWN_VOICES;
    this._ready = false;
    this._model = model;
    this._responseFormat = responseFormat;
  }

  _headers() {
    return { Authorization: `Bearer ${this._apiKey}`, "Content-Type": "application/json" };
  }

  async load(device = "auto", modelVariant = null) {
    // Speechmatics has no /load semantics; treat the existence of an API key as readiness.
    this._ready = Boolean(this._apiKey);
    if (!this._ready) throw new RuntimeError("Speechmatics requires an API key");
  }

  unload() {
    this._ready = false;
  }

  ready() {
    return this._ready;
  }

  async voices() {
    try {
      const r = await http.fetch(`${this._baseUrl}/voices`, { headers: this._headers(), timeoutMs: 120_000 });
      if (r.status < 400) {
        const data = await r.json();
        const payload = Array.isArray(data) ? data : data.voices || [];
        if (payload.length) {
          return payload.map((v) =>
            typeof v === "string" ? new PresetVoice({ id: v, name: v }) : new PresetVoice({ id: v.name || v.id, name: v.name || v.id }),
          );
        }
      } else {
        await r.arrayBuffer().catch(() => {});
      }
    } catch (e) {
      log.warning(`Speechmatics voices() failed: ${errText(e)}`);
    }
    return this._configuredVoices.map((v) => new PresetVoice({ id: v, name: v }));
  }

  async synthesize(req) {
    // Voice goes in the URL path, not the body.
    const url = `${this._baseUrl}/generate/${req.voiceId}`;
    let r;
    try {
      r = await http.fetch(url, { method: "POST", body: httpxJson({ text: req.text }), headers: this._headers(), timeoutMs: 120_000 });
    } catch (e) {
      throw new RuntimeError(`Speechmatics request failed: ${errText(e)}`);
    }
    const content = Buffer.from(await r.arrayBuffer());
    if (r.status >= 400) throw new RuntimeError(`Speechmatics ${r.status}: ${content.toString("utf8").slice(0, 400)}`);
    return new SynthOutput({ bytes: content, sampleRate: 24000, channels: 1, isWavContainer: true });
  }
}
