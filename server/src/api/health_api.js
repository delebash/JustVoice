// SPDX-License-Identifier: MIT
// GET /v1/health (the port of justvoice/api/health_api.py).

import { Hono } from "@delebash/llm-runner/platform";
import { getState } from "../app_state.js";
import * as manager from "../engines/manager.js";
import { _variantRows } from "../engines/model_catalog.js";
import { construct, HealthResponse } from "../models.js";
import { API_VERSION, PRODUCT, VERSION } from "../version.js";

/** The loaded model's own name — its catalog row's (*Kokoro 82M*), else the engine's, else
 * whatever the registry calls it. Never the bare id when a name exists. */
export function loadedModelName(engineId) {
  if (!engineId) return null;
  const mgr = manager.getManager();
  const variant = mgr.currentVariantId(engineId);
  const row = _variantRows(engineId).find((r) => r.id === variant);
  if (row) return row.name || variant;
  const m = mgr.getManifest(engineId);
  if (m) return m.name;
  const inst = getState().engines.get(engineId);
  return inst ? inst.meta.displayName : engineId;
}

export function router() {
  const app = new Hono();
  app.get("/v1/health", (c) => {
    const st = getState();
    const engines = st.engines.all().map((e) => ({
      id: e.meta.engineId,
      name: e.meta.displayName,
      ready: e.ready(),
      backend: e.meta.backend,
    }));
    // The legacy in-process registry (st.engines) tracks "current" for backends registered at
    // boot; the EngineManager tracks the TTS slot's loaded engine independently — checking
    // both keeps the topbar pill honest however the engine was loaded.
    const current = manager.getManager().currentId() || st.engines.current();
    return c.json(
      construct(HealthResponse, {
        product: PRODUCT,
        apiVersion: API_VERSION,
        status: "ok",
        version: VERSION,
        api_version: API_VERSION,
        current_engine: current,
        current_model: loadedModelName(current),
        engines,
      }),
    );
  });
  return app;
}
