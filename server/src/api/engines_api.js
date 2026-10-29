// SPDX-License-Identifier: MIT
// /v1/engines + /v1/engines/current — catalog + runtime engine status (the port of
// justvoice/api/engines_api.py).
//
// Merges three sources of truth into one response:
//   1. Managed engines — JustVoice's catalog (built from audio.cpp's own files,
//      engines/audiocpp/generated.js), its facts: licence, tested, best for, terms, default version.
//   2. Runtime-registered external engines (computeStatus derives their state).
//   3. Runtime-registered in-process engines (state.engines.all() — the external
//      OpenAI-compatible servers).
// Status per engine: managed → the kit's audio.cpp runtime (installed from its status, loaded from
// its `loaded()` — not_installed | installed | loaded; round E, docs/plans/2026-10-29-round-e-onto-
// the-kit.md §4 step 4, whose routes under /v1/ai/runtimes/audiocpp install, load, place and delete);
// legacy → the registry's registration + computeStatus().

import { Hono } from "@delebash/core/platform";
import { HttpError } from "@delebash/core/platform/errors";
import { strRepr } from "@delebash/core/platform/py";
import { getState } from "../app_state.js";
import { engineFacts } from "../engines/audiocpp/generated.js";
import * as kitSettings from "../engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../engines/audiocpp/kit_speech.js";
import { CAPABILITY_DETAILS, lookup as lookupCapability } from "../engines/capability_details.js";
import { computeStatus } from "../engines/catalog.js";
import * as modelCatalog from "../engines/model_catalog.js";
import { badRequest, notFound } from "../errors.js";
import {
  construct,
  CurrentEngineResponse,
  EMOTION_VALUES,
  EngineCapabilitiesResponse,
  EngineCapabilityDetail,
  EngineOverrides,
  EnginesListResponse,
} from "../models.js";

// Mapping from manifest CAPABILITIES dict keys → Feature literal strings.
const _CAPABILITY_TO_FEATURE = {
  preset_voices: "preset_voices",
  voice_cloning: "voice_cloning",
  voice_design: "voice_design",
  instruct_field: "instruct_field",
  paralinguistic_tags: "paralinguistic_tags",
  phoneme_override: "phoneme_override",
  gpu_accel: "gpu_accel",
  single_speaker_dialogue: "single_speaker_dialogue",
  voice_blending: "voice_blending",
};

/** An EngineInfo from a plugin manifest — `status` already accounts for the engine being
 * loaded/installed; this fills in the catalog metadata. (`current` is the caller's.) */
export function _infoFromManifest(manifest, status) {
  const caps = manifest.capabilities || {};
  const featureList = Object.entries(caps)
    .filter(([k, enabled]) => enabled && Object.hasOwn(_CAPABILITY_TO_FEATURE, k))
    .map(([k]) => _CAPABILITY_TO_FEATURE[k]);
  // Implicit GPU accel for any engine declaring a GPU build of the speech runtime.
  const req = manifest.requirements || {};
  const runtimes = req.gpu_runtimes || [];
  if (runtimes.some((r) => r === "cuda" || r === "vulkan" || r === "metal") && !featureList.includes("gpu_accel")) {
    featureList.push("gpu_accel");
  }
  const loaded = kitSpeech.loadedOf(manifest.id);
  return {
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    backend: "managed",
    capabilities: featureList,
    prerequisites: { gpu_runtimes: runtimes, rust_native: false, sidecar: false },
    status,
    current: false, // filled in by the caller
    is_stubbed: false,
    // The RESOLVED default (parity batch 2026-08-06): the user's Set-as-default override layered
    // over the manifest's — so the UI's "Default ✓" badge and a no-variant load never disagree.
    default_variant_id: modelCatalog.resolvedDefaultVariant(manifest.id) || manifest.defaultVariantId,
    kind: manifest.kind,
    kinds: manifest.kinds,
    current_variant_id: loaded?.versionId ?? null,
    isolation: manifest.isolation,
    supported_oses: manifest.supportedOses,
    supported_on_this_os: manifest.supportsCurrentOs(),
    deprecated: manifest.deprecated,
    weights_license: manifest.weightsLicense,
    // Where its loaded model runs and why, as the kit's runtime says (its `loaded()`).
    resolved_device: loaded?.placement ?? null,
    placement_reason: loaded?.reason ?? "",
    terms: _termsOf(manifest),
    terms_accepted: _termsAccepted(manifest.id),
    // Its licence in plain words, audio.cpp's status, tested, best for (the Speech engines list).
    ...(manifest.module ? engineFacts(manifest.module) : {}),
  };
}

/** The engine's own terms (manifest TERMS), as the app shows them; null = none. */
export function _termsOf(manifest) {
  const terms = manifest.module?.TERMS;
  return terms && Object.keys(terms).length ? Object.fromEntries(Object.entries(terms).map(([k, v]) => [k, String(v)])) : null;
}

export function _termsAccepted(engineId) {
  const ov = getState().settings.get().engines.engine_overrides[engineId];
  return Boolean(ov?.terms_accepted_at);
}

/** The id of whichever engine is loaded (managed or in-process), or null. */
const _currentId = () => kitSpeech.currentFor("tts") || getState().engines.current();

/** `datetime.now(timezone.utc).isoformat(timespec="seconds")`. */
const utcSecondsIso = () => `${new Date().toISOString().slice(0, 19)}+00:00`;

/**
 * A capability row's build-gated flags as the build pinned here has them — the rows follow the
 * build the app ships, and an install still on an older one can't play blends or splice a
 * lexicon's IPA (audit §5 E3; kit_settings.js `runtimeHas`).
 */
export function _asInstalled(detail) {
  const update = {};
  if (detail.supports_voice_blending && !kitSettings.runtimeHas("voice_pack")) update.supports_voice_blending = false;
  if (detail.supports_phoneme_input && !kitSettings.runtimeHas("inline_ipa")) update.supports_phoneme_input = false;
  if (detail.engine_id === "voxcpm2" && detail.supports_clone_prompt_text && !kitSettings.runtimeHas("voxcpm2_transcript")) {
    update.supports_clone_prompt_text = false;
  }
  return Object.keys(update).length ? { ...detail, ...update } : detail;
}

export function router() {
  const app = new Hono();
  /**
   * Record that the user accepted this engine's terms (manifest TERMS) — once per install.
   * Pocket TTS refuses a render from a reference clip until then (decided 2026-10-02).
   */
  app.post("/v1/engines/:id/terms", (c) => {
    const id = c.req.param("id");
    const m = modelCatalog.getManifest(id);
    if (m === null) throw notFound(`engine ${id}`);
    if (!m.module?.TERMS || !Object.keys(m.module.TERMS).length) throw badRequest(`${m.name} has no terms to accept`);
    const store = getState().settings;
    const cur = store.get();
    const ov = cur.engines.engine_overrides[id] ?? construct(EngineOverrides, {});
    if (!ov.terms_accepted_at) {
      ov.terms_accepted_at = utcSecondsIso();
      cur.engines.engine_overrides[id] = ov;
      store.set(cur);
    }
    return c.json({ engine_id: id, accepted: true, at: ov.terms_accepted_at });
  });

  app.get("/v1/engines", (c) => {
    const st = getState();
    const cur = _currentId();
    const catalog = [];
    const seen = new Set();
    // 1. Managed engines (the plugin model).
    for (const m of modelCatalog.manifests().values()) {
      const info = _infoFromManifest(m, kitSpeech.engineStatus(m.id));
      info.current = m.id === cur;
      catalog.push(info);
      seen.add(m.id);
    }
    // 2. Runtime-registered in-process engines (external OpenAI-compatible servers) — not in
    //    any static catalog. self_hosted comes from the provider config so badges + tab
    //    placement stay honest.
    const extCfg = new Map(st.settings.get().engines.external.map((c) => [c.id, c]));
    for (const engine of st.engines.all()) {
      const eid = engine.meta.engineId;
      if (seen.has(eid)) continue;
      catalog.push({
        id: eid,
        name: engine.meta.displayName,
        description: `Runtime-registered engine (backend: ${engine.meta.backend}). Not in the static catalog.`,
        backend: engine.meta.backend,
        self_hosted: Boolean(extCfg.get(eid)?.self_hosted ?? false),
        capabilities: [],
        prerequisites: {},
        status: computeStatus(eid, true, engine.ready(), cur),
        current: cur === eid,
        is_stubbed: false,
      });
      seen.add(eid);
    }
    return c.json(construct(EnginesListResponse, { engines: catalog, current: cur }));
  });

  /**
   * The full per-engine capability detail map. Keys are engine ids (`kokoro`, `qwen3`) or
   * variant ids (`chatterbox-turbo`) where the variant has materially different parameters.
   * The frontend tries the variant id first, then the base engine id — `lookup()`'s rule.
   */
  app.get("/v1/engines/capabilities", (c) => {
    // OS gate (2026-08-20): a row keyed by a variant this machine's catalog cannot see is
    // dropped HERE — the same one-door rule the catalog applies. Engine-id rows and family rows
    // (a visible variant id extends them, e.g. qwen3-base → qwen3-base-1.7b) always pass.
    const manifests = modelCatalog.manifests();
    const visible = new Set();
    for (const engId of manifests.keys()) for (const v of modelCatalog.modelsFor(engId)) visible.add(v.id);
    const engines = {};
    for (const [key, detail] of Object.entries(CAPABILITY_DETAILS)) {
      if (manifests.has(key) || visible.has(key) || [...visible].some((vid) => vid.startsWith(`${key}-`))) {
        engines[key] = _asInstalled(detail);
      }
    }
    return c.json(construct(EngineCapabilitiesResponse, { engines, emotion_values: [...EMOTION_VALUES] }));
  });

  app.get("/v1/engines/:engine_id/capabilities", (c) => {
    const engineId = c.req.param("engine_id");
    const detail = lookupCapability(engineId);
    if (detail === null) throw new HttpError(404, `No capability detail for engine ${strRepr(engineId)}`);
    return c.json(construct(EngineCapabilityDetail, detail));
  });

  app.get("/v1/engines/current", (c) => {
    const cur = _currentId();
    if (cur == null) return c.json(construct(CurrentEngineResponse, { engine: null }));
    // Managed engine?
    const m = modelCatalog.getManifest(cur);
    if (m) {
      const info = _infoFromManifest(m, kitSpeech.engineStatus(cur));
      info.current = true;
      return c.json(construct(CurrentEngineResponse, { engine: info }));
    }
    // External / runtime-registered (no manifest by design).
    const inst = getState().engines.get(cur);
    if (inst) {
      return c.json(
        construct(CurrentEngineResponse, {
          engine: {
            id: cur,
            name: inst.meta.displayName,
            description: "",
            backend: inst.meta.backend,
            capabilities: [],
            prerequisites: {},
            status: computeStatus(cur, true, inst.ready(), cur),
            current: true,
            is_stubbed: false,
          },
        }),
      );
    }
    return c.json(construct(CurrentEngineResponse, { engine: null }));
  });
  return app;
}

