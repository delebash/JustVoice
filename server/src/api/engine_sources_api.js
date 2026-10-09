// SPDX-License-Identifier: MIT
// Per-(engine, variant) download-source overrides (the port of
// justvoice/api/engine_sources_api.py).
//
// Project rule: no hardcoded operator-tunable values. Engine model repos live in each engine's
// manifest VARIANTS rows as verified *defaults* (phase ②c), and this surface lets the operator
// point a variant at another Hugging Face repo (a mirror, a fork) without editing code. The
// override swaps the repository and revision and KEEPS the pinned file names — the runtime's
// config names those files, and a whole-tree fetch of a GGUF repo can run to many gigabytes.
//
//   GET    /v1/engines/{engine_id}/sources               every variant's effective source +
//                                                         provenance ("manifest" | "override")
//   PUT    /v1/engines/{engine_id}/sources/{variant_id}  set the override (hf_repo required)
//   DELETE /v1/engines/{engine_id}/sources/{variant_id}  clear it → the manifest default
//
// Writes go through the settings store so they persist, and the prefetch worker reads the same
// `engines.engine_overrides` map. `resolveSource` is SYNC: engines/manager.js
// `_ensureVariantLocal` and installer.spawnPrefetch import it.

import { Hono, input } from "@delebash/llm-runner/platform";
import { nullable, opt, T } from "@delebash/llm-runner/platform/models";
import { strRepr } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import * as manager from "../engines/manager.js";
import * as modelCatalog from "../engines/model_catalog.js";
import { badRequest, notFound } from "../errors.js";
import { construct, EngineModelSourceOverride, EngineOverrides } from "../models.js";

export const VariantSource = T.Object({
  variant_id: T.String(),
  name: opt(nullable(T.String()), null),
  size_mb: opt(nullable(T.Integer()), null),
  // Effective values after override resolution. hf_repo null = unconfigured (a misconfigured
  // manifest, surfaced honestly).
  hf_repo: opt(nullable(T.String()), null),
  hf_revision: opt(nullable(T.String()), null),
  // "manifest" (no override) | "override" (operator-set).
  provenance: opt(T.String(), "manifest"),
});

export const EngineSourcesResponse = T.Object({
  engine_id: T.String(),
  variants: opt(T.Array(VariantSource), []),
});

/** A variant by id in the engine's model catalog. */
export function _catalogVariant(engineId, variantId) {
  return modelCatalog.modelsFor(engineId).find((v) => v.id === variantId) ?? null;
}

/**
 * The manifest's VERIFIED source rows (phase ②c): the first source drives the single-source
 * wire fields; the FULL list rides `sources` so multi-file variants (speech recognition: the
 * recogniser + its aligner) download completely. `files` is the pinned per-file list the
 * speech-cache fetch resolves verbatim — a missing name fails loud.
 */
export function _defaultSourceFor(engineId, variant) {
  const sources = modelCatalog.sourcesFor(engineId, variant.id);
  const first = sources.length ? sources[0] : {};
  return {
    hf_repo: first.hf_repo ?? null,
    hf_revision: first.revision ?? null,
    files: first.files ?? null,
    sources: sources.length ? sources : null,
    size_mb: variant.size_mb,
    name: variant.name,
  };
}

/**
 * The effective download source for (engine, variant) → `[source, "manifest" | "override"]`.
 * `source` = {hf_repo, hf_revision, files, sources, size_mb, name}. An operator OVERRIDE swaps
 * every row's repo and revision and keeps its pinned files, so the fetch asks the mirror for
 * exactly the names the runtime will load. Used by the prefetch worker, the load door's
 * acquisition, and GET /sources.
 */
export function resolveSource(engineId, variantId) {
  const variant = _catalogVariant(engineId, variantId);
  const dflt = variant
    ? _defaultSourceFor(engineId, variant)
    : { hf_repo: null, hf_revision: null, files: null, sources: null, size_mb: null, name: variantId };
  const settings = getState().settings.get();
  const overrides = settings.engines.engine_overrides[engineId];
  const override = overrides ? (overrides.sources[variantId] ?? null) : null;
  if (override?.hf_repo) {
    const rows = (dflt.sources || []).map((row) => ({ ...row, hf_repo: override.hf_repo, revision: override.hf_revision }));
    return [
      {
        hf_repo: override.hf_repo,
        hf_revision: override.hf_revision,
        files: dflt.files,
        sources: rows.length ? rows : null,
        size_mb: dflt.size_mb,
        name: dflt.name,
      },
      "override",
    ];
  }
  return [dflt, "manifest"];
}

/** Variant ids from the model catalog (what GET /v1/engines/{id}/models lists). */
const _allVariantIds = (engineId) => modelCatalog.modelsFor(engineId).map((v) => v.id);

function variantSource(variantId) {
  return (eff, prov) =>
    construct(VariantSource, {
      variant_id: variantId,
      name: eff.name ?? null,
      size_mb: eff.size_mb ?? null,
      hf_repo: eff.hf_repo ?? null,
      hf_revision: eff.hf_revision ?? null,
      provenance: prov,
    });
}

function requireManifest(engineId) {
  if (manager.getManager().getManifest(engineId) === null) throw notFound(`engine ${strRepr(engineId)} (no manifest)`);
}

export function router() {
  const app = new Hono();
  app.get("/v1/engines/:engine_id/sources", (c) => {
    const engineId = c.req.param("engine_id");
    requireManifest(engineId);
    const variants = _allVariantIds(engineId).map((vid) => variantSource(vid)(...resolveSource(engineId, vid)));
    return c.json(construct(EngineSourcesResponse, { engine_id: engineId, variants }));
  });

  app.put("/v1/engines/:engine_id/sources/:variant_id", input({ body: EngineModelSourceOverride }), (c) => {
    const { engine_id: engineId, variant_id: variantId } = c.req.param();
    const body = c.req.valid("json");
    requireManifest(engineId);
    // Permissive overrides for variants the manifest doesn't know would let a typo become a
    // silently broken row — rejected.
    if (!_allVariantIds(engineId).includes(variantId)) throw notFound(`variant ${strRepr(variantId)} on engine ${strRepr(engineId)}`);
    if (!body.hf_repo) throw badRequest("override needs hf_repo");
    const store = getState().settings;
    const settings = store.get();
    const overrides = settings.engines.engine_overrides[engineId] ?? construct(EngineOverrides, {});
    overrides.sources[variantId] = body;
    settings.engines.engine_overrides[engineId] = overrides;
    store.set(settings);
    return c.json(variantSource(variantId)(...resolveSource(engineId, variantId)));
  });

  app.delete("/v1/engines/:engine_id/sources/:variant_id", (c) => {
    const { engine_id: engineId, variant_id: variantId } = c.req.param();
    requireManifest(engineId);
    const store = getState().settings;
    const settings = store.get();
    const overrides = settings.engines.engine_overrides[engineId];
    if (overrides && Object.hasOwn(overrides.sources, variantId)) {
      delete overrides.sources[variantId];
      // Python's own rule, kept: with no source override left the WHOLE engine entry goes —
      // its default model, placements, runtime options and terms with it.
      if (!Object.keys(overrides.sources).length) delete settings.engines.engine_overrides[engineId];
      store.set(settings);
    }
    return c.json(variantSource(variantId)(...resolveSource(engineId, variantId)));
  });
  return app;
}
