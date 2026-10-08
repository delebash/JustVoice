// SPDX-License-Identifier: MIT
// External OpenAI-compatible TTS server probe + live add/remove (the port of
// justvoice/api/external_api.py).

import * as http from "@delebash/llm-runner/platform/http";
import { isDict, strip } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import { ExternalOpenAiTtsBackend } from "../engines/external_openai.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { construct, ExternalEngineConfig, ProbeRequest, ProbeResponse } from "../models.js";

export function _extractModelIds(body) {
  if (isDict(body) && Array.isArray(body.data)) return body.data.filter((m) => isDict(m) && "id" in m).map((m) => m.id);
  if (Array.isArray(body)) {
    const out = [];
    for (const item of body) {
      if (typeof item === "string") out.push(item);
      else if (isDict(item) && "id" in item) out.push(item.id);
    }
    return out;
  }
  return [];
}

export function _extractVoiceIds(body) {
  if (isDict(body) && Array.isArray(body.voices)) body = body.voices;
  if (Array.isArray(body)) {
    const out = [];
    for (const v of body) {
      if (typeof v === "string") out.push(v);
      else if (isDict(v)) {
        if ("id" in v) out.push(v.id);
        else if ("name" in v) out.push(v.name);
      }
    }
    return out;
  }
  return [];
}

export function _serverHint(base, models, voices) {
  const lower = base.toLowerCase();
  if (lower.includes("openai.com")) return "openai";
  if (models.includes("kokoro") || voices.some((v) => ["af_", "am_", "bf_", "bm_", "ef_", "em_"].some((p) => String(v).startsWith(p)))) {
    return "kokoro-fastapi";
  }
  if (models.includes("tts-1") || models.includes("tts-1-hd")) return "openai-edge-tts";
  return "unknown";
}

const RECOMMENDED = { "kokoro-fastapi": "kokoro", openai: "tts-1", "openai-edge-tts": "tts-1" };

export async function router(app) {
  app.post("/v1/engines/external/probe", { schema: { body: ProbeRequest } }, async (req) => {
    const base = strip(req.body.base_url).replace(/\/+$/, "");
    if (!base) throw badRequest("base_url must not be empty");
    if (!(base.startsWith("http://") || base.startsWith("https://"))) throw badRequest("base_url must start with http:// or https://");

    const headers = req.body.api_key ? { Authorization: `Bearer ${req.body.api_key}` } : {};
    let reachable = false;
    let error = null;
    let models = [];
    let voices = [];
    const get = async (url, method = "GET") => {
      const r = await http.fetch(url, { method, headers: method === "GET" ? headers : {}, timeoutMs: 8000 });
      const text = await r.text();
      return { status: r.status, json: () => JSON.parse(text) };
    };

    try {
      const r = await get(`${base}/v1/models`);
      reachable = true;
      if (r.status < 400) models = _extractModelIds(r.json());
    } catch (e) {
      error = `/v1/models: ${e?.message ?? e}`;
    }

    for (const p of ["/v1/audio/voices", "/v1/voices"]) {
      try {
        const r = await get(`${base}${p}`);
        reachable = true;
        if (r.status < 400) {
          voices = _extractVoiceIds(r.json());
          if (voices.length) break;
        }
      } catch {
        /* next path */
      }
    }

    if (!reachable) {
      try {
        const r = await get(`${base}/`, "HEAD");
        reachable = r.status < 600;
      } catch {
        /* unreachable */
      }
    }

    const hint = _serverHint(base, models, voices);
    const recommendedModel = models.length ? models[0] : (RECOMMENDED[hint] ?? null);
    return construct(ProbeResponse, {
      reachable,
      models,
      voices,
      server_hint: hint,
      recommended_model: recommendedModel,
      error: reachable ? null : error,
    });
  });

  app.post("/v1/engines/external", { schema: { body: ExternalEngineConfig } }, async (req, reply) => {
    const cfg = req.body;
    const st = getState();
    if (!strip(cfg.id)) throw badRequest("id must not be empty");
    if (!strip(cfg.base_url)) throw badRequest("base_url must not be empty");
    if (st.engines.has(cfg.id)) throw conflict(`Engine id '${cfg.id}' is already registered.`);

    const backend = new ExternalOpenAiTtsBackend({
      id: cfg.id,
      name: cfg.name,
      baseUrl: cfg.base_url,
      apiKey: cfg.api_key,
      model: cfg.model,
      voices: cfg.voices,
      responseFormat: cfg.response_format,
    });
    st.engines.register(backend);

    const current = st.settings.get();
    current.engines.external = current.engines.external.filter((e) => e.id !== cfg.id);
    current.engines.external.push(cfg);
    st.settings.patch({ engines: current.engines });
    reply.code(201);
    return construct(ExternalEngineConfig, cfg);
  });

  app.delete("/v1/engines/external/:id", async (req) => {
    const id = req.params.id;
    const st = getState();
    const current = st.settings.get();
    const before = current.engines.external.length;
    current.engines.external = current.engines.external.filter((e) => e.id !== id);
    if (current.engines.external.length === before) throw notFound(`No external engine with id '${id}' in settings`);
    st.engines.unregister(id);
    st.settings.patch({ engines: current.engines });
    return { removed: id };
  });
}
