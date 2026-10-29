// SPDX-License-Identifier: MIT
// /v1/engines/{id}/models — each engine's model versions and their facts (the port of
// justvoice/api/models_api.py).
//
// JustVoice's per-version facts — languages, cloning, voices, how it is directed, its description,
// its load options — and whether it is downloaded (the kit's models cache). The kit's audio.cpp
// runtime downloads, loads, places and deletes the models, and says where each runs and what it
// measured (its routes under /v1/ai/runtimes/audiocpp — round E, docs/plans/2026-10-29-round-e-
// onto-the-kit.md §4 step 4); a model's load options stay ours, saved here.

import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { Hono, input } from "@delebash/core/platform";
import { T } from "@delebash/core/platform/models";
import { getState } from "../app_state.js";
import * as kitSpeech from "../engines/audiocpp/kit_speech.js";
import * as runtimeOptions from "../engines/audiocpp/runtime_options.js";
import * as modelCatalog from "../engines/model_catalog.js";
import { badRequest, notFound } from "../errors.js";
import { construct, EngineOverrides, ModelsListResponse } from "../models.js";
import * as vmod from "../voice_model.js";

export const RuntimeOptionsBody = T.Object({ options: T.Record(T.String(), T.String()) });

export function router() {
  const app = new Hono();
  app.get("/v1/engines/:id/models", (c) => {
    const id = c.req.param("id");
    // Validate against the catalog's discovered manifests — the ONE catalog.
    const m = modelCatalog.getManifest(id);
    if (m === null) throw notFound(`engine ${id}`);
    const variants = modelCatalog.modelsFor(id);
    // The per-model on-disk flag drives the verb shown (Download vs Load/Delete): every file in
    // the kit's models cache at its pinned size.
    for (const v of variants) {
      const files = kitSpeech.modelFiles(v.id);
      v.on_disk = files !== null;
      // local_dir rides along for the desktop "Open folder" verb — the folder holding its main
      // file, resolved HERE so the layout knowledge stays server-side.
      if (files?.model) v.local_dir = path.dirname(String(files.model));
    }
    // How each speech model is directed — written direction, tags, or sliders only (the Engines
    // page, 2026-10-09). Speech recognition speaks nothing, so it has none.
    if (m.kind === "tts") {
      for (const v of variants) {
        const family = vmod.modelOfVariant(v.id);
        v.directed_by = family ? vmod.directedBy(family) : null;
      }
    }
    const rows = new Map(modelCatalog._variantRows(id).map((r) => [r.id, r]));
    for (const v of variants) {
      if (rows.has(v.id)) v.runtime_options = runtimeOptions.describe(id, rows.get(v.id));
    }
    return c.json(construct(ModelsListResponse, { engine_id: id, variants }));
  });

  /**
   * A model's speech-runtime options (`engines/audiocpp/runtime_options.js`) — saved per model
   * in `engine_overrides[id].runtime_options`; a value at its default is dropped. The runtime
   * reads them when the model loads (kit_hooks.js `sessionOptions`), so a loaded model whose
   * options changed is unloaded here, through the kit, and the answer's `reload` asks the caller to
   * load it again.
   */
  app.put("/v1/engines/:id/models/:variant_id/runtime-options", input({ body: RuntimeOptionsBody }), async (c) => {
    const { id, variant_id: variantId } = c.req.param();
    const m = modelCatalog.getManifest(id);
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
    const loaded = kitSpeech.currentVariantId(id) === variantId;
    if (loaded && changed) await kitSpeech.unload(variantId);
    return c.json({ engine_id: id, variant_id: variantId, runtime_options: runtimeOptions.describe(id, row), reload: Boolean(loaded && changed) });
  });
  return app;
}
