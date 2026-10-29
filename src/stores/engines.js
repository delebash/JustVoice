// SPDX-License-Identifier: MIT
//
// Engines store — single source of truth for the engine list as the
// READ-ONLY consumers see it (Personas, Voices, Studio,
// Home, etc.). See stores/projects.js + the rebuild plan doc.
//
// Anything that changes what an engine is (a load, an install, a licence
// accepted) dispatches `jv:health-refresh`; this store listens for that event
// and reloads so the other views stay current without their own fetches.
//
// Since round E (2026-10-29) the speech models' downloads, loads and places are
// the kit's audio.cpp runtime's, on its AI Settings tab (Speech). What that tab
// shows of OURS — an engine's licence, testing, best for, a model's languages,
// cloning, voices, direction and load options — is JustVoice's facts:
// GET /v1/engines and GET /v1/engines/{id}/models, kept here (`models`), each
// kit model found by its id, which is our model version's (`factsOf`).

import { defineStore } from "pinia";
import { computed, ref } from "vue";

import { useApi } from "./api.js";

export const useEnginesStore = defineStore("engines", () => {
  const items = ref([]);
  const loaded = ref(false);
  let _inflight = null;

  // Subscribed at STORE CREATION, not inside ensureLoaded (2026-08-21).
  // It used to be a side effect of ensureLoaded, so a view that called
  // reload() directly — VoicesView does — never subscribed at all, and the
  // only component that did call ensureLoaded was mounted nowhere. So on an
  // ordinary session nothing here listened, and the doors that correctly
  // dispatched jv:health-refresh reached no store: the deeper half of the
  // "engine loads that nobody announces" finding.
  window.addEventListener("jv:health-refresh", () => { void reload(); });

  // Failure leaves `loaded` false so the next caller retries — see the note in
  // stores/personas.js.
  async function reload() {
    const r = await useApi().safeRequest("/v1/engines", null);
    if (!r) return items.value;
    items.value = r.engines ?? [];
    loaded.value = true;
    return items.value;
  }

  function ensureLoaded() {
    if (loaded.value) return Promise.resolve(items.value);
    if (!_inflight) _inflight = reload().finally(() => { _inflight = null; });
    return _inflight;
  }

  function byId(id) {
    return items.value.find((e) => e.id === id) || null;
  }

  // ── Each speech engine's model versions, our facts about them ──────────
  // engine id → its variants (GET /v1/engines/{id}/models). Read once for every speech
  // engine the server manages; one engine again after its load options change.
  const models = ref({});
  const speechEngines = () => items.value.filter((e) => e.backend === "managed" && ["tts", "stt"].includes(e.kind || "tts"));

  async function loadModels(engineId = null) {
    if (!loaded.value) await ensureLoaded();
    const ids = engineId ? [engineId] : speechEngines().map((e) => e.id);
    const got = await Promise.all(ids.map(async (id) => {
      const r = await useApi().safeRequest(`/v1/engines/${encodeURIComponent(id)}/models`, null);
      return [id, r?.variants ?? null];
    }));
    const next = { ...models.value };
    for (const [id, variants] of got) if (variants) next[id] = variants;
    models.value = next;
  }

  // model version id → its engine's id and the variant
  const byVersion = computed(() => {
    const out = new Map();
    for (const [engineId, variants] of Object.entries(models.value)) for (const variant of variants) out.set(variant.id, { engineId, variant });
    return out;
  });
  /** A kit model (its id is our model version's) as JustVoice knows it: `{engine, variant}`, or
   *  null for one no engine of ours lists (yet). */
  function factsOf(modelId) {
    const hit = byVersion.value.get(modelId);
    const engine = hit ? byId(hit.engineId) : null;
    return engine ? { engine, variant: hit.variant } : null;
  }

  // The default speech engine (settings.engines.default_tts_engine — the ONE source; the Speech
  // tab's "Set as default" on an engine): which engine new-voice flows and first-render
  // auto-setup prefer.
  const defaultEngineId = ref("");
  async function loadDefaultEngine() {
    const s = await useApi().safeRequest("/v1/settings", null);
    defaultEngineId.value = s?.engines?.default_tts_engine || "";
  }
  async function setDefaultEngine(id) {
    await useApi().patch("/v1/settings", { engines: { default_tts_engine: id } });
    defaultEngineId.value = id;
  }

  return { items, loaded, reload, ensureLoaded, byId, models, loadModels, factsOf, defaultEngineId, loadDefaultEngine, setDefaultEngine };
});
