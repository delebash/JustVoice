// SPDX-License-Identifier: MIT
// /v1/engines + /v1/engines/current — catalog + runtime engine status (the port of
// justvoice/api/engines_api.py).
//
// Merges three sources of truth into one response:
//   1. Manager-managed engines (engines/<id>/manifest.js — the plugin model).
//   2. Runtime-registered external engines (computeStatus derives their state).
//   3. Runtime-registered in-process engines (state.engines.all() — the external
//      OpenAI-compatible servers).
// Status per engine: managed → manager.status(id) (not_installed | installed | loaded); legacy
// → the registry's registration + computeStatus().

import { HttpError } from "@delebash/llm-runner/platform/errors";
import { opt, T } from "@delebash/llm-runner/platform/models";
import { pyInt } from "@delebash/llm-runner/platform/py";
import { getState } from "../app_state.js";
import * as runtime from "../engines/audiocpp/runtime.js";
import { CAPABILITY_DETAILS, lookup as lookupCapability } from "../engines/capability_details.js";
import { computeStatus } from "../engines/catalog.js";
import * as leftovers from "../engines/leftovers.js";
import * as manager from "../engines/manager.js";
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
  EngineVramResponse,
  LeftoverEnginesResponse,
  VramClaim,
} from "../models.js";
import { strRepr } from "../py_compat.js";

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
  const mgr = manager.getManager();
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
    default_variant_id: mgr.resolvedDefaultVariant(manifest.id) || manifest.defaultVariantId,
    kind: manifest.kind,
    kinds: manifest.kinds,
    current_variant_id: mgr.currentVariantId(manifest.id),
    isolation: manifest.isolation,
    supported_oses: manifest.supportedOses,
    supported_on_this_os: manifest.supportsCurrentOs(),
    deprecated: manifest.deprecated,
    weights_license: manifest.weightsLicense,
    // The device the load actually resolved to, straight from the one load door.
    resolved_device: mgr.resolvedDeviceFor(manifest.id),
    // CPU placement (2026-10-02): why it runs there.
    placement_reason: mgr.placementReasonFor(manifest.id),
    terms: _termsOf(manifest),
    terms_accepted: _termsAccepted(manifest.id),
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
const _currentId = () => manager.getManager().currentId() || getState().engines.current();

/** `datetime.now(timezone.utc).isoformat(timespec="seconds")`. */
const utcSecondsIso = () => `${new Date().toISOString().slice(0, 19)}+00:00`;

/**
 * A capability row's build-gated flags as the INSTALLED speech runtime has them — the rows
 * follow the pinned build, and an install still on an older one can't play blends or splice a
 * lexicon's IPA (audit §5 E3).
 */
export function _asInstalled(detail) {
  const update = {};
  if (detail.supports_voice_blending && !runtime.hasFeature("voice_pack")) update.supports_voice_blending = false;
  if (detail.supports_phoneme_input && !runtime.hasFeature("inline_ipa")) update.supports_phoneme_input = false;
  if (detail.engine_id === "voxcpm2" && detail.supports_clone_prompt_text && !runtime.hasFeature("voxcpm2_transcript")) {
    update.supports_clone_prompt_text = false;
  }
  return Object.keys(update).length ? { ...detail, ...update } : detail;
}

/**
 * Q3's standing "AI model (loads on demand)" line — the ROUTED DEFAULT's predicted footprint,
 * from the kit's `previewFit` claim ladder. Several distinct local models → the largest claim.
 * Everything named is cloud → "cloud-routed"; nothing named anywhere → "not-configured".
 * → [claim | null, reason | null].
 */
export async function _onDemandClaim() {
  try {
    const { stores } = await import("@delebash/llm-runner/llm");
    const { getService } = await import("@delebash/llm-runner/runner/lifecycle");
    const { jvLlmConfig } = await import("../engines/llm/run.js");
    const localModels = new Set();
    let namedAny = false;
    const d = stores.getRoutingStore().getRouting().default;
    if (d?.llmId) {
      namedAny = true;
      if (d.llmId === "local-llamacpp" && d.model) localModels.add(d.model);
    }
    for (const c of jvLlmConfig().production_configs || []) {
      const pid = c.providerId || "";
      if (!pid) continue;
      namedAny = true;
      if (pid === "local-llamacpp" && c.model) localModels.add(c.model);
    }
    if (!localModels.size) return [null, namedAny ? "cloud-routed" : "not-configured"];
    const svc = getService();
    let best = null;
    for (const mid of [...localModels].sort()) {
      let claim;
      try {
        claim = (svc.previewFit(mid) || {}).claim || {};
      } catch {
        continue; // one bad row must not kill the strip
      }
      if (!Object.keys(claim).length) continue;
      const c = construct(VramClaim, {
        model: mid,
        vram_mb: pyInt(claim.vramMb || 0),
        ram_mb: pyInt(claim.ramMb || 0),
        source: String(claim.source || "computed"),
        matches: pyInt(claim.matches || 0),
      });
      if (best === null || c.vram_mb > best.vram_mb) best = c;
    }
    return best !== null ? [best, null] : [null, "not-configured"];
  } catch {
    return [null, "unavailable"]; // the strip must render even if routing is mid-boot
  }
}

/** The leftover rows as the splash reads them. */
export function _leftoversResponse(found) {
  const manifests = manager.getManager().manifests();
  const rows = found.map((lo) => ({
    pid: lo.pid,
    engine_id: lo.engineId,
    // The one audio.cpp server holds every model — it has no manifest.
    engine_name: lo.engineId === "audiocpp" ? "Speech runtime" : (manifests.get(lo.engineId)?.name ?? lo.engineId),
    started: lo.started,
    server_pid: lo.serverPid,
    gpu_mb: lo.gpuMb,
  }));
  const measured = rows.map((r) => r.gpu_mb).filter((g) => g != null);
  return construct(LeftoverEnginesResponse, { leftovers: rows, gpu_mb: measured.length ? measured.reduce((a, b) => a + b, 0) : null });
}

/**
 * The memory budget strip (the 2026-08-13 VRAM wiring, Q3/Q4): ONE endpoint reading the
 * shared arbiter — total / committed / remaining for the box's budget pool, each resident
 * booking with its kind + provenance, the busy kinds, the on-demand LLM claim, and eviction
 * events newer than `events_since`.
 */
export async function getEngineVram(eventsSince = 0) {
  let arb;
  try {
    const { getArbiter } = await import("@delebash/llm-runner/runner/arbiter");
    arb = getArbiter();
  } catch {
    throw new HttpError(503, "the shared LLM stack is not mounted");
  }
  // The manager's cached hardware snapshot — never re-probe per poll.
  const mgr = manager.getManager();
  const hw = await mgr._hardware();
  // A slot whose runtime process died goes, booking and all, BEFORE the snapshot (audit
  // 2026-10-04 §13.2).
  for (const kind of ["tts", "stt"]) mgr.loadedFor(kind);
  const snap = hw !== null ? await arb.snapshot(hw) : await arb.snapshot();
  const [claim, claimReason] = await _onDemandClaim();
  // The measured pool state (the strip shows REALITY); `other_mb` = measured use the ledger
  // can't attribute (other apps, OS).
  const used = await mgr.poolUsedMb();
  const other = used !== null ? Math.max(0, used - snap.committed_mb) : 0;

  const engineLabel = (engineId) => mgr.getManifest(engineId)?.name ?? engineId;
  const loaded = [];
  for (const kind of ["tts", "stt"]) {
    const proc = mgr.loadedFor(kind);
    if (proc === null) continue;
    const engineId = proc.manifest.id;
    const variantId = mgr.currentVariantId(engineId) || mgr.resolvedDefaultVariant(engineId);
    let modelName = "";
    if (variantId) {
      try {
        modelName = modelCatalog.modelsFor(engineId).find((v) => v.id === variantId)?.name ?? variantId;
      } catch {
        modelName = variantId; // a catalog miss must not kill the strip
      }
    }
    loaded.push({ key: `${kind}:${engineId}`, kind, label: proc.manifest.name, model: modelName, device: mgr.resolvedDeviceFor(engineId) || "" });
  }
  const reservations = snap.reservations.map((r) => {
    const row = { ...r };
    if (row.kind === "tts" || row.kind === "stt") {
      const i = row.key.indexOf(":"); // key.split(":", 1)[-1]
      row.label = engineLabel(i < 0 ? row.key : row.key.slice(i + 1));
    }
    return row;
  });
  return construct(EngineVramResponse, {
    mem_arch: snap.mem_arch,
    total_mb: snap.vram_total_mb,
    committed_mb: snap.committed_mb,
    booked_mb: snap.booked_mb ?? snap.committed_mb,
    remaining_mb: snap.remaining_mb,
    used_mb: used,
    other_mb: other,
    reservations,
    loaded,
    busy_kinds: snap.busy_kinds,
    claim,
    claim_reason: claimReason,
    events: arb.eventsSince(eventsSince),
  });
}

export async function router(app) {
  /**
   * Record that the user accepted this engine's terms (manifest TERMS) — once per install.
   * Pocket TTS refuses a render from a reference clip until then (decided 2026-10-02).
   */
  app.post("/v1/engines/:id/terms", async (req) => {
    const id = req.params.id;
    const m = manager.getManager().getManifest(id);
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
    return { engine_id: id, accepted: true, at: ov.terms_accepted_at };
  });

  app.get("/v1/engines", async () => {
    const st = getState();
    const mgr = manager.getManager();
    const cur = _currentId();
    const catalog = [];
    const seen = new Set();
    // 1. Managed engines (the plugin model).
    for (const m of mgr.manifests().values()) {
      const info = _infoFromManifest(m, mgr.status(m.id));
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
    return construct(EnginesListResponse, { engines: catalog, current: cur });
  });

  /**
   * The full per-engine capability detail map. Keys are engine ids (`kokoro`, `qwen3`) or
   * variant ids (`chatterbox-turbo`) where the variant has materially different parameters.
   * The frontend tries the variant id first, then the base engine id — `lookup()`'s rule.
   */
  app.get("/v1/engines/capabilities", async () => {
    // OS gate (2026-08-20): a row keyed by a variant this machine's catalog cannot see is
    // dropped HERE — the same one-door rule the catalog applies. Engine-id rows and family rows
    // (a visible variant id extends them, e.g. qwen3-base → qwen3-base-1.7b) always pass.
    const manifests = manager.getManager().manifests();
    const visible = new Set();
    for (const engId of manifests.keys()) for (const v of modelCatalog.modelsFor(engId)) visible.add(v.id);
    const engines = {};
    for (const [key, detail] of Object.entries(CAPABILITY_DETAILS)) {
      if (manifests.has(key) || visible.has(key) || [...visible].some((vid) => vid.startsWith(`${key}-`))) {
        engines[key] = _asInstalled(detail);
      }
    }
    return construct(EngineCapabilitiesResponse, { engines, emotion_values: [...EMOTION_VALUES] });
  });

  app.get("/v1/engines/:engine_id/capabilities", async (req) => {
    const engineId = req.params.engine_id;
    const detail = lookupCapability(engineId);
    if (detail === null) throw new HttpError(404, `No capability detail for engine ${strRepr(engineId)}`);
    return construct(EngineCapabilityDetail, detail);
  });

  app.get("/v1/engines/vram", { schema: { querystring: T.Object({ events_since: opt(T.Integer(), 0) }) } }, async (req) =>
    getEngineVram(req.query.events_since ?? 0),
  );

  app.get("/v1/engines/current", async () => {
    const mgr = manager.getManager();
    const cur = mgr.currentId() || getState().engines.current();
    if (cur == null) return construct(CurrentEngineResponse, { engine: null });
    // Managed engine?
    const m = mgr.getManifest(cur);
    if (m) {
      const info = _infoFromManifest(m, mgr.status(cur));
      info.current = true;
      return construct(CurrentEngineResponse, { engine: info });
    }
    // External / runtime-registered (no manifest by design).
    const inst = getState().engines.get(cur);
    if (inst) {
      return construct(CurrentEngineResponse, {
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
      });
    }
    return construct(CurrentEngineResponse, { engine: null });
  });

  // ── Engines left behind by a server that is gone (2026-09-29) ─────────────
  // The boot splash offers "Stop them" when a model fails to load while old engines hold GPU
  // memory; the server also sweeps them once at startup (serve.js). `engines/leftovers.js` owns
  // what counts as one.

  app.get("/v1/engines/leftovers", async () => _leftoversResponse(await leftovers.findLeftoverEngines()));

  app.post("/v1/engines/leftovers/stop", async () => _leftoversResponse(await leftovers.stopLeftoverEngines("stopped from the app")));
}

