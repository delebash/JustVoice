// SPDX-License-Identifier: MIT
// External OpenAI-compatible TTS server probe + live add/remove (the port of
// justvoice/api/external_api.py).

import { Hono, input } from "@delebash/core/platform";
import * as http from "@delebash/core/platform/http";
import { isDict, strip } from "@delebash/core/platform/py";
import { getState } from "../app_state.js";
import { buildExternalEngine } from "../engines/tts_providers/index.js";
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

export function router() {
  const app = new Hono();
  app.post("/v1/engines/external/probe", input({ body: ProbeRequest }), async (c) => {
    const body = c.req.valid("json");
    const base = strip(body.base_url).replace(/\/+$/, "");
    if (!base) throw badRequest("base_url must not be empty");
    if (!(base.startsWith("http://") || base.startsWith("https://"))) throw badRequest("base_url must start with http:// or https://");

    const headers = body.api_key ? { Authorization: `Bearer ${body.api_key}` } : {};
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
    return c.json(
      construct(ProbeResponse, {
        reachable,
        models,
        voices,
        server_hint: hint,
        recommended_model: recommendedModel,
        error: reachable ? null : error,
      }),
    );
  });

  // Save one: registered at once and kept in settings.engines.external (what the boot registers).
  // Saving a saved one again is its edit — it replaces the one registered; an id that something
  // else holds stays refused. Built first, with the boot's own adapter for its provider_type, so a
  // config that can't be built changes nothing.
  app.post("/v1/engines/external", input({ body: ExternalEngineConfig }), (c) => {
    const cfg = c.req.valid("json");
    const st = getState();
    if (!strip(cfg.id)) throw badRequest("id must not be empty");
    if (!strip(cfg.base_url)) throw badRequest("base_url must not be empty");
    const current = st.settings.get();
    const saved = current.engines.external.some((e) => e.id === cfg.id);
    if (st.engines.has(cfg.id) && !saved) throw conflict(`Engine id '${cfg.id}' is already registered.`);

    let backend;
    try {
      backend = buildExternalEngine(cfg);
    } catch (e) {
      throw badRequest(String(e?.message ?? e));
    }
    st.engines.unregister(cfg.id);
    st.engines.register(backend);

    current.engines.external = current.engines.external.filter((e) => e.id !== cfg.id);
    current.engines.external.push(cfg);
    st.settings.patch({ engines: current.engines });
    return c.json(construct(ExternalEngineConfig, cfg), 201);
  });

  app.delete("/v1/engines/external/:id", (c) => {
    const id = c.req.param("id");
    const st = getState();
    const current = st.settings.get();
    const before = current.engines.external.length;
    current.engines.external = current.engines.external.filter((e) => e.id !== id);
    if (current.engines.external.length === before) throw notFound(`No external engine with id '${id}' in settings`);
    st.engines.unregister(id);
    st.settings.patch({ engines: current.engines });
    return c.json({ removed: id });
  });
  return app;
}
