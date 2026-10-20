// SPDX-License-Identifier: MIT
// GET /v1/health (the port of justvoice/api/health_api.py).

import { makeHealthRouter } from "@delebash/core/platform";
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

/** /v1/health through the kit's shared router (app-structure §14); JustVoice's extras are its
 * engine block and the legacy snake_case api_version. */
export function router() {
  return makeHealthRouter({ product: PRODUCT, version: VERSION, apiVersion: API_VERSION, extras: () => engineHealth() });
}

/** The engine half of the health answer, in the HealthResponse model's shape. */
export function engineHealth() {
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
  return construct(HealthResponse, {
    product: PRODUCT,
    apiVersion: API_VERSION,
    status: "ok",
    version: VERSION,
    api_version: API_VERSION,
    current_engine: current,
    current_model: loadedModelName(current),
    engines,
    dataDir: st.dataDir ?? null,
  });
}
