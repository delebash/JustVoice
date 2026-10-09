// SPDX-License-Identifier: MIT
// /v1/engines/{id}/models — installable model variants (the port of
// justvoice/api/models_api.py).
//
// Every speech model lives in the speech cache (`speech_cache.js`). Until the 2026-10-01
// switch a model could also count as downloaded from an engine's own legacy folder or a Hugging
// Face cache; both probes went with the per-engine environments — the HF one would now be wrong
// outright, because nearly every variant comes from the one `audio-cpp/audio.cpp-gguf`
// repository, so one cached file would have marked them all downloaded.

import { existsSync, rmSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { Hono, input } from "@delebash/llm-runner/platform";
import { dirSize } from "@delebash/llm-runner/platform/disk_api";
import { literal, T } from "@delebash/llm-runner/platform/models";
import { getState } from "../app_state.js";
import * as runtimeOptions from "../engines/audiocpp/runtime_options.js";
import * as manager from "../engines/manager.js";
import * as modelCatalog from "../engines/model_catalog.js";
import { badRequest, conflict, notFound } from "../errors.js";
import { construct, EngineOverrides, ModelsListResponse } from "../models.js";
import { speechCacheRoot } from "../paths.js";
import * as speechCache from "../speech_cache.js";

export const PlacementBody = T.Object({ placement: literal("auto", "gpu", "cpu") });
export const RuntimeOptionsBody = T.Object({ options: T.Record(T.String(), T.String()) });

/** Where each model runs, or would run now, and why; its CPU speed (CPU placement,
 * 2026-10-02 — docs/plans/2026-10-02-cpu-placement.md §8). Mutates the variants. */
export async function _annotatePlacement(engineId, variants) {
  const mgr = manager.getManager();
  const m = mgr.getManifest(engineId);
  const kind = m.kind;
  const loaded = mgr.status(engineId) === "loaded" ? mgr.currentVariantId(engineId) : null;
  for (const v of variants) {
    v.placement = manager.EngineManager._userPlacement(engineId, v.id);
    [v.cpu_realtime, v.cpu_realtime_here] = mgr.cpuSpeed(kind, engineId, v.id);
    if (v.id === loaded) {
      v.runs_on = (mgr.resolvedDeviceFor(engineId) || "") === "cpu" ? "cpu" : "gpu";
      v.runs_on_reason = mgr.placementReasonFor(engineId);
    } else {
      [v.runs_on, v.runs_on_reason] = await mgr.placementFor(m, kind, v.id);
    }
  }
}

const variantIn = (engineId, variantId) => modelCatalog.modelsFor(engineId).some((v) => v.id === variantId);

export function router() {
  const app = new Hono();
  app.get("/v1/engines/:id/models", async (c) => {
    const id = c.req.param("id");
    // Validate against the manager's discovered manifests — the ONE catalog.
    if (manager.getManager().getManifest(id) === null) throw notFound(`engine ${id}`);
    const variants = modelCatalog.modelsFor(id);
    // The per-model on-disk flag drives the verb shown (Download vs Load/Delete): the speech
    // cache's files.json, every file present at its recorded size.
    const st = getState();
    for (const v of variants) {
      v.on_disk = speechCache.variantOnDisk(st.dataDir, id, v.id);
      // local_dir rides along for the desktop "Open folder" verb — resolved HERE so the layout
      // knowledge stays server-side.
      if (v.on_disk) v.local_dir = String(speechCache.variantDir(st.dataDir, id, v.id));
    }
    await _annotatePlacement(id, variants);
    const rows = new Map(modelCatalog._variantRows(id).map((r) => [r.id, r]));
    for (const v of variants) {
      if (rows.has(v.id)) v.runtime_options = runtimeOptions.describe(id, rows.get(v.id));
    }
    return c.json(construct(ModelsListResponse, { engine_id: id, variants }));
  });

  /**
   * Where one model runs: Auto, the graphics card, or the CPU — saved per model in
   * `engine_overrides[id].placements`. A loaded model is not moved here: the answer's `moves`
   * says it would now run elsewhere, and the next load of it puts it there.
   */
  app.put("/v1/engines/:id/models/:variant_id/placement", input({ body: PlacementBody }), async (c) => {
    const { id, variant_id: variantId } = c.req.param();
    const body = c.req.valid("json");
    const mgr = manager.getManager();
    const m = mgr.getManifest(id);
    if (m === null) throw notFound(`engine ${id}`);
    if (!variantIn(id, variantId)) throw notFound(`variant ${variantId} on engine ${id}`);
    const store = getState().settings;
    const cur = store.get();
    const ov = cur.engines.engine_overrides[id] ?? construct(EngineOverrides, {});
    if (body.placement === "auto") delete ov.placements[variantId];
    else ov.placements[variantId] = body.placement;
    cur.engines.engine_overrides[id] = ov;
    store.set(cur);
    const [runsOn, why] = await mgr.placementFor(m, m.kind, variantId);
    const loaded = mgr.status(id) === "loaded" && mgr.currentVariantId(id) === variantId;
    const now = loaded ? ((mgr.resolvedDeviceFor(id) || "") === "cpu" ? "cpu" : "gpu") : null;
    return c.json({
      engine_id: id,
      variant_id: variantId,
      placement: body.placement,
      runs_on: runsOn,
      runs_on_reason: why,
      loaded,
      moves: Boolean(loaded && now !== runsOn),
    });
  });

  /**
   * A model's speech-runtime options (`engines/audiocpp/runtime_options.js`) — saved per model
   * in `engine_overrides[id].runtime_options`; a value at its default is dropped. The runtime
   * reads them when the model loads, so a loaded model whose options changed is unloaded here,
   * and the answer's `reload` asks the caller to load it again.
   */
  app.put("/v1/engines/:id/models/:variant_id/runtime-options", input({ body: RuntimeOptionsBody }), async (c) => {
    const { id, variant_id: variantId } = c.req.param();
    const mgr = manager.getManager();
    const m = mgr.getManifest(id);
    if (m === null) throw notFound(`engine ${id}`);
    const row = modelCatalog._variantRows(id).find((r) => r.id === variantId) ?? null;
    if (row === null) throw notFound(`variant ${variantId} on engine ${id}`);
    let values;
    try {
      values = runtimeOptions.validate(row, c.req.valid("json").options);
    } catch (e) {
      if (e?.name === "ValueError") throw badRequest(e.message);
      throw e;
    }
    const store = getState().settings;
    const cur = store.get();
    const ov = cur.engines.engine_overrides[id] ?? construct(EngineOverrides, {});
    const prev = ov.runtime_options[variantId] || {};
    const changed = !isDeepStrictEqual(prev, values); // dict != dict
    if (Object.keys(values).length) ov.runtime_options[variantId] = values;
    else delete ov.runtime_options[variantId];
    cur.engines.engine_overrides[id] = ov;
    store.set(cur);
    const loaded = mgr.status(id) === "loaded" && mgr.currentVariantId(id) === variantId;
    if (loaded && changed) await mgr.unload(m.kind);
    return c.json({ engine_id: id, variant_id: variantId, runtime_options: runtimeOptions.describe(id, row), reload: Boolean(loaded && changed) });
  });

  /**
   * Delete every downloaded speech model (the whole speech cache) to reclaim disk — the Settings
   * Disk-usage panel's per-store clear verb. SAFE BY DESIGN: the catalog rows come from the
   * manifests, so each model re-downloads the next time it's loaded. Refuses with
   * `{ok: false, detail: "unload engines first"}` (HTTP 200) while any engine is loaded — a
   * resident model's file is open in the runtime. On success `{ok: true, bytes}`.
   */
  app.post("/v1/engines/speech-cache/clear", async (c) => {
    const mgr = manager.getManager();
    if ([...mgr.manifests().keys()].some((eid) => mgr.status(eid) === "loaded")) return c.json({ ok: false, detail: "unload engines first" });
    const root = speechCacheRoot(getState().dataDir);
    let freed = 0;
    if (existsSync(root)) {
      freed = await dirSize(root);
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        /* ignore_errors */
      }
    }
    return c.json({ ok: true, bytes: freed });
  });

  /** Delete one model's downloaded file(s) — the per-model 'Delete downloaded model' verb. The
   * engine and its other variants stay. */
  app.delete("/v1/engines/:id/models/:variant_id", (c) => {
    const { id, variant_id: variantId } = c.req.param();
    if (!variantIn(id, variantId)) throw notFound(`variant ${variantId} on engine ${id}`);
    const st = getState();
    if (!speechCache.variantOnDisk(st.dataDir, id, variantId)) throw notFound(`${variantId} has no downloaded files`);
    const mgr = manager.getManager();
    const m = mgr.getManifest(id);
    if (m !== null && mgr.currentFor(m.kind) === id && mgr.currentVariantId(id) === variantId) {
      // Windows refuses to delete a file the runtime holds; Linux and macOS deleted it under the
      // loaded model, which then vanished at its next restart (audit §5 E7).
      throw conflict(`${variantId} is loaded — unload it, then delete its files`);
    }
    const vdir = String(speechCache.variantDir(st.dataDir, id, variantId));
    try {
      rmSync(vdir, { recursive: true, force: true });
    } catch {
      /* ignore_errors */
    }
    if (existsSync(vdir)) {
      // A file the runtime still holds open (Windows refuses the delete).
      throw conflict(`${variantId}'s files are still in use and were not deleted — unload the model and try again (${vdir})`);
    }
    return c.json({ deleted: true, engine_id: id, variant_id: variantId, path: vdir });
  });
  return app;
}

