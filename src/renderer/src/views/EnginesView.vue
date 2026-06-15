<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EnginesView (Phase 2 / Slice 2 rewrite — dropdown selector UX).

  Per-engine row: model dropdown + selection-driven info panel +
  ONE contextual action button. Mirrors JustWrite's SettingsProviderForm
  pattern. Tabbed by `engine.kind` so LLM providers (Phase 2 Slice 3+),
  TTS engines, and embeddings each get their own tab.

  Replaces the prior card-grid layout — fixes the six EnginesView bugs
  in one restructure:
    1. Dual-spin can't happen — there's exactly one Load button per
       engine, not one per variant.
    2. Progress bar replaces the spinner — the action area renders an
       inline determinate track when busy.
    3. Per-variant unload — Unload only appears when the selected
       variant IS the loaded variant.
    4. "Loaded: X" reads from engine.current_variant_id (server truth).
    5. Shared-venv tri-state — contextual button shows Remove only when
       at least one variant has weights on disk.
    6. Density — one row per engine; info panel only renders for the
       expanded selection.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
import ProviderForm from "../components/ProviderForm.vue";
import RecommendCard from "../components/RecommendCard.vue";

const api = useApi();
const tasks = useRenderTasks();

// Seed from the last fetch so revisiting Engines doesn't flash the
// "no engines" banner before the list arrives (user-hit 2026-06-12).
const ENGINES_CACHE_KEY = "jv.engines.lastList";
function _cachedEngines() {
  try { return JSON.parse(window.sessionStorage?.getItem(ENGINES_CACHE_KEY) || "[]"); }
  catch { return []; }
}
const engines = ref(_cachedEngines());
const enginesLoaded = ref(engines.value.length > 0);
const system = ref(null);
// State keyed by either `engineId` (for engine-wide ops: setup/unload/
// uninstall) OR `engineId/variantId` (for per-variant Download/Load).
// This is the C1 fix from docs/plans/2026-06-14-engines-download-contract
// .md: a Chatterbox Multilingual download must NOT light up Chatterbox
// Turbo as "Downloading", and the busy/progress maps were keyed only by
// engine, so they did. The composite key is the operation's scope.
const busy = reactive({});      // engineId | engineId/variantId -> verb
const progress = reactive({});  // same key shape
const installJobs = reactive({});  // same — Cancel targets the right job
const _engineKey = (engineId) => engineId;
const _variantKey = (engineId, variantId) => `${engineId}/${variantId}`;
// Bridges the per-(engine,variant) progress map to the engine-level
// header strip: returns the first in-flight progress row matching
// this engine (engine-wide install OR any per-variant download).
function _anyProgressForEngine(engineId) {
  if (progress[engineId]) return progress[engineId];
  const prefix = engineId + "/";
  for (const k of Object.keys(progress)) {
    if (k.startsWith(prefix)) return progress[k];
  }
  return null;
}

// Per-engine model variants:
//   {[engineId]: {variants: [{id, name, size_mb, vram_mb, ...}], recommended: {would_oom: [...]}}}
const variants = reactive({});

// Per-engine dropdown selection. Defaults to the loaded variant > default
// > first available. Reactive so the info panel re-renders on change.
const selectedVariants = reactive({});  // {engineId: variantId}

// Tab selection: TTS / LLM / Embeddings. Filters which engines surface.
// Falls back to "tts" so existing manifests show by default.
const KIND_LABELS = { tts: "TTS", stt: "STT", llm: "LLM", embedding: "Embeddings" };
const activeKind = ref("tts");

// ── Registered providers (JustWrite SettingsProviderForm pattern) ─────
//
// Two stores feed the per-tab Registered Providers section:
//   LLM tab: /v1/llm-providers — full CRUD with adapter ping + models().
//   TTS tab: settings.engines.external[] — registered via PATCH /v1/settings.
//
// `editingKey` holds the id of the provider currently expanded in edit
// mode, or "new" when the Add row is open. The draft is a working copy
// that ProviderForm mutates; on Save we POST or PATCH and refresh.

const llmProviders = ref([]);
const ttsProviders = ref([]);
const editingKey = ref("");  // "" | "new" | "<provider-id>"
const draft = ref(null);

// Item 9: self-hosted providers list under the LOCAL tab's matching
// kind section (only TTS externals exist as a config store today;
// LLM providers have their own detect-and-connect local flow).
function selfHostedFor(kind) {
  if (kind !== "tts") return [];
  return ttsProviders.value.filter((p) => p.self_hosted);
}

const visibleProviders = computed(() => {
  if (activeKind.value === "llm") return llmProviders.value;
  if (activeKind.value === "tts") return ttsProviders.value;
  return [];
});

async function loadProviders() {
  // LLM list — backend endpoint with `registered` flag.
  try {
    const r = await api.safeRequest("/v1/llm-providers", { providers: [] });
    llmProviders.value = (r?.providers || []).map((p) => ({ ...p, kind: "llm" }));
  } catch {
    llmProviders.value = [];
  }
  // TTS list — settings.engines.external[] surfaces every registered
  // external TTS server. Read straight from /v1/settings since there's
  // no dedicated /v1/tts-providers endpoint yet.
  try {
    const s = await api.safeRequest("/v1/settings", null);
    const list = s?.engines?.external || [];
    ttsProviders.value = list.map((p) => ({
      id: p.id,
      name: p.name || p.id,
      kind: "tts",
      provider_type: p.provider_type || "openai-compat",
      base_url: p.base_url || "",
      api_key: "",  // never echoed back; treat empty == "leave existing"
      has_api_key: !!p.api_key,
      default_model: "",
      tts_model: p.model || "",
      voices: Array.isArray(p.voices) ? [...p.voices] : [],
      response_format: p.response_format || "wav",
      self_hosted: !!p.self_hosted,
    }));
  } catch {
    ttsProviders.value = [];
  }
}

function defaultDraft(kind) {
  if (kind === "llm") {
    return {
      id: "",
      name: "",
      kind: "llm",
      provider_type: "anthropic",
      base_url: "https://api.anthropic.com",
      api_key: "",
      default_model: "claude-haiku-4-5",
      embedding_model: "",
      pinned_tier: "",
    };
  }
  return {
    id: "",
    name: "",
    kind: "tts",
    provider_type: "openai-compat",
    base_url: "",
    api_key: "",
    tts_model: "",
    voices: [],
    response_format: "wav",
    self_hosted: false,
  };
}

function startNewProvider() {
  draft.value = defaultDraft(activeKind.value === "tts" ? "tts" : "llm");
  editingKey.value = "new";
}
function startEditProvider(p) {
  draft.value = { ...p };
  editingKey.value = p.id;
}
function cancelEdit() {
  editingKey.value = "";
  draft.value = null;
}

async function saveProvider(payload) {
  // The capability checkboxes mean one provider can be LLM, TTS, or BOTH
  // (the mock's OpenAI row). LLM half lives in /v1/llm-providers, TTS
  // half in settings.engines.external — same id ties them together and
  // allProviders merges them back into one row.
  const wantsLlm = payload.kind === "llm" || payload.kind === "both";
  const wantsTts = payload.kind === "tts" || payload.kind === "both";
  try {
    const llmExists = llmProviders.value.some((p) => p.id === payload.id);
    if (wantsLlm) {
      const body = {
        id: payload.id,
        name: payload.name,
        provider_type: payload.provider_type,
        base_url: payload.base_url || "",
        api_key: payload.api_key || (llmExists ? "" : null),  // "" = keep existing key
        default_model: payload.default_model || "",
        embedding_model: payload.embedding_model || "",
        timeout_seconds: payload.timeout_seconds || 60,
      };
      if (llmExists) {
        await api.request(`/v1/llm-providers/${payload.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        await api.request("/v1/llm-providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
    } else if (llmExists) {
      // LLM capability unchecked on an existing provider — remove that half.
      await api.request(`/v1/llm-providers/${payload.id}`, { method: "DELETE" });
    }

    // TTS half: read current settings, splice/replace (or drop), PATCH back.
    const current = await api.request("/v1/settings");
    const externals = [...(current?.engines?.external || [])];
    const filtered = externals.filter((e) => e.id !== payload.id);
    if (wantsTts) {
      // When editing existing and api_key is blank, preserve the old one.
      let apiKey = payload.api_key || null;
      if (!payload.api_key) {
        const prev = externals.find((e) => e.id === payload.id);
        if (prev?.api_key) apiKey = prev.api_key;
      }
      filtered.push({
        id: payload.id,
        name: payload.name || payload.id,
        provider_type: payload.provider_type === "openai" ? "openai-compat" : (payload.provider_type || "openai-compat"),
        base_url: payload.base_url || "",
        api_key: apiKey,
        model: payload.tts_model || "",
        voices: Array.isArray(payload.voices) ? payload.voices : [],
        response_format: payload.response_format || "wav",
        self_hosted: !!payload.self_hosted,
      });
    }
    if (wantsTts || filtered.length !== externals.length) {
      await api.request("/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engines: { external: filtered } }),
      });
    }
    pushToast({ message: `${payload.name || payload.id} saved.`, kind: "success" });
    cancelEdit();
    await loadProviders();
    await refresh();
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  }
}

async function deleteProvider() {
  if (!draft.value) return;
  const ok = await confirmDialog({
    title: `Delete ${draft.value.name || draft.value.id}?`,
    message: "The provider will be unregistered. Feature pins referencing it fall back to the first available provider.",
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    // Remove BOTH halves — a "both"-capability provider lives in the
    // llm store and the external TTS list under the same id.
    if (llmProviders.value.some((p) => p.id === draft.value.id)) {
      await api.request(`/v1/llm-providers/${draft.value.id}`, { method: "DELETE" });
    }
    const current = await api.request("/v1/settings");
    const externals = current?.engines?.external || [];
    const filtered = externals.filter((e) => e.id !== draft.value.id);
    if (filtered.length !== externals.length) {
      await api.request("/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engines: { external: filtered } }),
      });
    }
    pushToast({ message: `${draft.value.name || draft.value.id} deleted.`, kind: "success" });
    cancelEdit();
    await loadProviders();
  } catch (e) {
    pushToast({ message: `Delete failed: ${e?.message || e}`, kind: "error" });
  }
}

const RUNTIME_LABELS = {
  cuda: "CUDA",
  metal: "Metal",
  coreml: "CoreML",
  directml: "DirectML",
  rocm: "ROCm",
  mlx: "MLX",
  vulkan: "Vulkan",
  cpu: "CPU",
};

const activeRuntimes = computed(() => {
  const r = system.value?.runtimes || {};
  return Object.keys(RUNTIME_LABELS).filter((k) => r[k]).map((k) => RUNTIME_LABELS[k]);
});

const enginesByKind = computed(() => {
  const out = { tts: [], llm: [], embedding: [] };
  for (const e of engines.value) {
    const k = e.kind || "tts";
    (out[k] = out[k] || []).push(e);
  }
  return out;
});

const availableKinds = computed(() => {
  return Object.keys(KIND_LABELS).filter((k) => (enginesByKind.value[k] || []).length > 0);
});

const visibleEngines = computed(() => enginesByKind.value[activeKind.value] || []);

function fmtDisk(mb) {
  if (mb == null) return "—";
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";
}

function pct(p) {
  return p.bytes_total > 0 ? Math.min(100, Math.round(100 * p.bytes_downloaded / p.bytes_total)) : 0;
}

// ── C3: inline install/download progress strip helpers ──────────────
// fmtBytesMb / fmtRate / fmtEta — small monotype-friendly formatters
// that feed the .jv-install-strip head row. fmtRate measures the byte
// delta since the previous poll tick using a per-key WeakMap keyed on
// the job state object itself, so the rate display always reflects
// the latest server tick without recomputing every render.
function fmtBytesMb(bytes) {
  return (bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1);
}
const _rateHistory = new Map();  // key -> { lastBytes, lastAt, bps }
function _rateFor(key, bytes) {
  const now = performance.now();
  const prev = _rateHistory.get(key);
  if (!prev) {
    _rateHistory.set(key, { lastBytes: bytes, lastAt: now, bps: 0 });
    return 0;
  }
  const dt = (now - prev.lastAt) / 1000;
  if (dt >= 0.5) {
    const db = Math.max(0, bytes - prev.lastBytes);
    const bps = db / dt;
    // EWMA so it doesn't jitter wildly between polls.
    const smooth = prev.bps ? (prev.bps * 0.6 + bps * 0.4) : bps;
    _rateHistory.set(key, { lastBytes: bytes, lastAt: now, bps: smooth });
    return smooth;
  }
  return prev.bps;
}
function fmtRate(bps) {
  if (!bps || bps < 1024) return "";
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
}
function fmtEta(p, bps) {
  if (!bps || !p.bytes_total || p.bytes_downloaded >= p.bytes_total) return "";
  const remaining = p.bytes_total - p.bytes_downloaded;
  const sec = remaining / bps;
  if (sec < 60) return `${Math.round(sec)}s left`;
  if (sec < 3600) return `${Math.round(sec / 60)}m left`;
  return `${(sec / 3600).toFixed(1)}h left`;
}
function progressKeyAndRate(p) {
  // Key the rate history off the progress object itself so independent
  // strips (multiple in-flight downloads for one engine) tick separately.
  return _rateFor(p, p.bytes_downloaded || 0);
}

// All in-flight progress rows for one engine (engine-wide install +
// every per-variant download). Lets the new template render the strip
// ONCE per active operation, instead of conflating them in the header.
function progressRowsFor(engineId) {
  const out = [];
  if (progress[engineId]) {
    out.push({ key: engineId, jobId: installJobs[engineId] || null, variantId: null, value: progress[engineId] });
  }
  const prefix = engineId + "/";
  for (const k of Object.keys(progress)) {
    if (k.startsWith(prefix)) {
      out.push({
        key: k,
        jobId: installJobs[k] || null,
        variantId: k.slice(prefix.length),
        value: progress[k],
      });
    }
  }
  return out;
}

// Variant id -> display name (for the strip title).
function variantNameFor(engineId, variantId) {
  const v = variantsFor(engineId).find((x) => x.id === variantId);
  return v?.name || variantId || engineId;
}

// Cancel an in-flight install/download. Wired to the canonical
// DELETE /v1/jobs/{job_id} which signals the cooperative cancel flag;
// the prefetch worker raises _Cancelled and rmtree's the partial dir.
async function cancelProgressRow(row) {
  if (!row?.jobId) return;
  try {
    await api.request(`/v1/jobs/${row.jobId}`, { method: "DELETE" });
    pushToast({ message: "Cancelled — partial files removed.", kind: "info", duration: 3500 });
  } catch (e) {
    pushToast({ message: `Cancel failed: ${e?.message || e}`, kind: "error" });
  }
}

// Clear a terminal (completed/failed) strip from the UI. The job stays
// in the server's history; this is purely a renderer-side dismiss.
function dismissProgressRow(row) {
  if (!row?.key) return;
  delete progress[row.key];
  delete installJobs[row.key];
}

// Note: the per-row Source override pill (C4) and its dialog were
// removed 2026-06-15 as part of the Ollama-style one-button collapse
// (docs/plans/2026-06-15-engines-one-button.md). The endpoints at
// /v1/engines/{id}/sources are still live as a settings escape hatch
// for the rare URL-shift case — restore the surface here if we ever
// need it back.

async function refresh() {
  const e = await api.safeRequest("/v1/engines", { engines: [] });
  engines.value = e?.engines ?? [];
  enginesLoaded.value = true;
  try { window.sessionStorage?.setItem(ENGINES_CACHE_KEY, JSON.stringify(engines.value)); } catch { /* ignore */ }
  // If the active kind has no engines, snap to the first kind that does.
  if (!visibleEngines.value.length && availableKinds.value.length) {
    activeKind.value = availableKinds.value[0];
  }
  // Eager-fetch model variants for every engine so the dropdown populates
  // without a per-card "Show variants" toggle. Per-engine failures tolerated.
  await Promise.all(
    engines.value.map(async (eng) => {
      if (variants[eng.id]) return;
      try {
        const [models, recommended] = await Promise.all([
          api.request(`/v1/engines/${eng.id}/models`).catch(() => ({ variants: [] })),
          api.request(`/v1/engines/${eng.id}/models/recommended`).catch(() => ({})),
        ]);
        variants[eng.id] = { variants: models.variants || [], recommended };
      } catch { /* tolerated */ }
      // Default the dropdown to the loaded variant > default_variant_id > first.
      if (selectedVariants[eng.id] === undefined) {
        const list = variants[eng.id]?.variants || [];
        selectedVariants[eng.id] = eng.current_variant_id
          || eng.default_variant_id
          || (list[0] && list[0].id)
          || "";
      }
    }),
  );
}

async function loadSystem() {
  system.value = await api.safeRequest("/v1/system/info", null);
}

function variantsFor(engineId) {
  return variants[engineId]?.variants || [];
}

function selectedVariantFor(engine) {
  const list = variantsFor(engine.id);
  const id = selectedVariants[engine.id];
  return list.find((v) => v.id === id) || list[0] || null;
}

function isLoadedVariant(engine, variantId) {
  return engine.status === "loaded" && engine.current_variant_id === variantId;
}

function isOnDisk(engine, variantId) {
  // Variant is on disk if its id appears in any downloaded-models list the
  // recommender returned, OR if the engine itself is installed.
  // The /models/recommended endpoint exposes a `downloaded_variant_ids` field
  // on engines that support per-variant fetch; fall back to engine.status
  // ("installed" or "loaded" both imply at least one variant is on disk).
  const rec = variants[engine.id]?.recommended;
  if (rec?.downloaded_variant_ids?.includes(variantId)) return true;
  if (engine.status === "installed" || engine.status === "loaded") return true;
  return false;
}

// Contextual action button: returns {label, kind, action, disabled, busy}
// based on the engine + selected variant state.
function contextualAction(engine) {
  const variant = selectedVariantFor(engine);
  const variantId = variant?.id || null;
  // engine-wide ops (venv setup, unload) read the engine key; per-variant
  // ops (download/load a specific model) read the composite key so sibling
  // variants aren't shown as busy.
  const eKey = _engineKey(engine.id);
  const vKey = variantId ? _variantKey(engine.id, variantId) : null;
  const isBusy = busy[eKey] != null || (vKey && busy[vKey] != null);

  // Loaded variant → Unload (engine-wide slot op)
  if (variantId && isLoadedVariant(engine, variantId)) {
    return {
      label: "Unload",
      variant: "secondary",
      action: () => unload(engine),
      disabled: isBusy,
      busy: busy[eKey] === "unload",
    };
  }

  // Engine in isolated venv mode AND not yet installed → Install (engine-wide)
  if (engine.isolation === "venv" && engine.status === "not_installed") {
    return {
      label: busy[eKey] === "install" ? "Installing…" : "Install",
      variant: "primary",
      action: () => install(engine, variantId),
      disabled: isBusy,
      busy: busy[eKey] === "install",
    };
  }

  // Variant not on disk → Download (per-variant)
  if (variantId && !isOnDisk(engine, variantId)) {
    return {
      label: vKey && busy[vKey] === "install" ? "Downloading…" : "Download",
      variant: "primary",
      action: () => install(engine, variantId),
      disabled: isBusy,
      busy: !!vKey && busy[vKey] === "install",
    };
  }

  // Variant on disk but not loaded → Load (per-variant)
  return {
    label: vKey && busy[vKey] === "load" ? "Loading…" : "Load",
    variant: "primary",
    action: () => load(engine, variantId),
    disabled: isBusy || !variantId,
    busy: !!vKey && busy[vKey] === "load",
  };
}

async function install(engine, variant) {
  // C1: when a variant is passed (per-variant Download), state is keyed
  // by `${engine.id}/${variant}` so a Multilingual download doesn't also
  // mark Turbo as Downloading. Engine-wide install (Setup venv) keeps
  // the engine key.
  const key = variant ? _variantKey(engine.id, variant) : _engineKey(engine.id);
  busy[key] = "install";
  progress[key] = { phase: "connecting", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: null, variant_id: variant || null };

  const task = tasks.start({
    label: variant ? `Downloading · ${engine.id}/${variant}` : `Installing · ${engine.id}`,
    kind: "install",
    statsFn: (t) => {
      const s = [];
      if (t.meta?.phase) s.push(t.meta.phase);
      if (t.meta?.bytesTotal > 0) {
        s.push(`${(t.meta.bytesDl / 1048576).toFixed(1)} / ${(t.meta.bytesTotal / 1048576).toFixed(1)} MB`);
      }
      return s;
    },
  });

  try {
    const accepted = await api.request(`/v1/engines/${engine.id}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variant ? { model_variant: variant } : {}),
    });
    installJobs[key] = accepted.job_id;
    while (true) {
      const job = await api.request(`/v1/jobs/${accepted.job_id}`);
      const pctVal = job.bytes_total > 0 ? Math.round(100 * (job.bytes_downloaded || 0) / job.bytes_total) : null;
      progress[key] = {
        phase: job.phase,
        bytes_downloaded: job.bytes_downloaded || 0,
        bytes_total: job.bytes_total || 0,
        current_file: job.current_file || null,
        error: job.error || null,
        variant_id: variant || null,
      };
      tasks.update(task.id, {
        percent: pctVal,
        meta: { phase: job.phase, bytesDl: job.bytes_downloaded || 0, bytesTotal: job.bytes_total || 0 },
      });
      if (job.phase === "completed") {
        tasks.finish(task.id);
        pushToast({ message: variant ? `${engine.id}/${variant} downloaded.` : `${engine.id} installed.`, kind: "success", duration: 4000 });
        setTimeout(() => { delete progress[key]; }, 2000);
        break;
      }
      if (job.phase === "failed") {
        tasks.fail(task.id, job.error || "unknown error");
        pushToast({ message: `${engine.id} install failed: ${job.error || "unknown"}`, kind: "error", duration: 8000 });
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    // C2: invalidate the cached variants so refresh() ACTUALLY re-reads
    // them — refresh() short-circuits per engine if variants[eng.id] is
    // already cached, so without this the per-variant on_disk + the
    // contextual button stay stale until a full page reload.
    delete variants[engine.id];
    await refresh();
  } catch (e) {
    tasks.fail(task.id, String(e.message || e));
    pushToast({ message: `Install failed: ${e.message || e}`, kind: "error", duration: 8000 });
    progress[key] = { phase: "failed", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: String(e.message || e), variant_id: variant || null };
  } finally {
    busy[key] = null;
    delete installJobs[key];
  }
}

// Button label for the single Load button.
// - On disk + loading in progress → "Loading…"
// - On disk + idle → "Load model"
// - Not on disk + downloading in progress → "Downloading…"
// - Not on disk + idle → "⬇ Load (1.5 GB)" — Ollama-style verb showing
//   the user this click also fetches.
function loadButtonLabel(engine, variant) {
  const key = _variantKey(engine.id, variant.id);
  const verb = busy[key];
  if (verb === "load") return "Loading…";
  if (verb === "install") return "Downloading…";
  if (modelOnDisk(engine, variant)) return "Load model";
  return `⬇ Load (${fmtDisk(variant.size_mb)})`;
}

async function load(engine, variant) {
  // Per-variant key.
  const key = variant ? _variantKey(engine.id, variant) : _engineKey(engine.id);
  const ctl = new AbortController();
  const task = tasks.start({
    label: `Loading · ${engine.name || engine.id}${variant ? ` (${variant})` : ""}`,
    kind: "load",
    statsFn: (t) => {
      const out = [];
      if (t.meta?.phase) out.push(t.meta.phase);
      if (t.meta?.bytesTotal > 0) {
        out.push(`${(t.meta.bytesDl / 1048576).toFixed(1)} / ${(t.meta.bytesTotal / 1048576).toFixed(1)} MB`);
      }
      return out;
    },
    onCancel: async () => {
      // Cancel the download job if there is one, OR the load if we're
      // past download. Best-effort either way.
      const inflight = installJobs[key];
      if (inflight) {
        try { await api.request(`/v1/jobs/${inflight}`, { method: "DELETE" }); } catch (_) { /* */ }
      }
      try {
        await fetch(`${api.serverUrl}/v1/engines/${engine.id}/cancel-load`, { method: "POST" });
      } catch (_) { /* best-effort */ }
      ctl.abort();
    },
    onRetry: () => load(engine, variant),
  });

  try {
    // Phase A: prefetch if weights aren't on disk yet (the Ollama
    // semantic — one click does pull + run). We rely on the per-variant
    // `on_disk` flag the server already computes in /v1/engines/{id}/models.
    const v = variantsFor(engine.id).find((x) => x.id === variant);
    const needsDownload = !modelOnDisk(engine, v || { id: variant });
    if (needsDownload) {
      busy[key] = "install";
      progress[key] = { phase: "connecting", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: null, variant_id: variant };
      const accepted = await api.request(`/v1/engines/${engine.id}/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_variant: variant }),
      });
      installJobs[key] = accepted.job_id;
      // Poll until completed or failed; same shape as the previous
      // install() flow, but inline so we never break out of the busy
      // window between download and load.
      while (true) {
        const job = await api.request(`/v1/jobs/${accepted.job_id}`);
        const pctVal = job.bytes_total > 0 ? Math.round(100 * (job.bytes_downloaded || 0) / job.bytes_total) : null;
        progress[key] = {
          phase: job.phase,
          bytes_downloaded: job.bytes_downloaded || 0,
          bytes_total: job.bytes_total || 0,
          current_file: job.current_file || null,
          error: job.error || null,
          variant_id: variant,
        };
        tasks.update(task.id, {
          percent: pctVal,
          meta: { phase: job.phase, bytesDl: job.bytes_downloaded || 0, bytesTotal: job.bytes_total || 0 },
        });
        if (job.phase === "completed") {
          delete installJobs[key];
          break;
        }
        if (job.phase === "failed") {
          delete installJobs[key];
          throw new Error(job.error || "download failed");
        }
        await new Promise((r) => setTimeout(r, 600));
      }
      // Drop the variants cache so the next refresh() reads on_disk
      // truthfully (the next phase, load, is about to flip to spawning).
      delete variants[engine.id];
    }

    // Phase B: load the engine. Same call as before — server brings
    // the variant up; spawn the subprocess, load weights, warm up.
    busy[key] = "load";
    progress[key] = { phase: "spawning", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: null, variant_id: variant };
    await api.request(`/v1/engines/${engine.id}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "auto", model_variant: variant || null }),
      signal: ctl.signal,
    });
    window.dispatchEvent(new Event("jv:health-refresh"));
    delete variants[engine.id];
    await refresh();
    tasks.finish(task.id);
    pushToast({ message: `${engine.name || engine.id} loaded.`, kind: "success", duration: 4500 });
    delete progress[key];
  } catch (e) {
    if (ctl.signal.aborted) return;
    const raw = String(e.message || e);
    tasks.fail(task.id, raw);
    pushToast({ message: `Load failed: ${raw}`, kind: "error", duration: 12000 });
    progress[key] = { phase: "failed", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: raw, variant_id: variant || null };
  } finally {
    busy[key] = null;
    delete installJobs[key];
  }
}

async function unload(engine) {
  // Engine-wide slot op — keeps engine key.
  busy[_engineKey(engine.id)] = "unload";
  try {
    // Pass kind so per-kind slot unload (Phase 2 / Slice 1) targets this
    // engine's slot specifically — leaves other kinds' loaded engines alone.
    const resp = await api.request("/v1/engines/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: engine.kind || "tts" }),
    });
    await refresh();
    pushToast({
      message: resp?.previous_engine ? `${resp.previous_engine} unloaded.` : "Nothing was loaded.",
      kind: resp?.previous_engine ? "success" : "info",
      duration: 3500,
    });
  } catch (e) {
    pushToast({ message: `Unload failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy[_engineKey(engine.id)] = null;
  }
}

async function uninstall(engine) {
  const isExternal = engine.backend === "external-openai-tts";
  const hasPipPackages = Array.isArray(engine.pip_packages) && engine.pip_packages.length > 0;
  let uninstallDeps = false;

  if (isExternal) {
    const ok = await confirmDialog({
      title: `Remove ${engine.id}?`,
      message: "The external server registration will be removed. The remote server itself is not affected.",
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
  } else if (hasPipPackages) {
    const choice = await promptDialog({
      title: `Uninstall ${engine.id}?`,
      message: "Model files will be removed from disk. You can also remove the Python packages this engine pulled in.",
      fields: [
        {
          key: "scope",
          label: "What to remove",
          type: "select",
          defaultValue: "files-only",
          options: [
            { value: "files-only", label: "Model files only" },
            { value: "files-and-deps", label: `Model files + Python packages (${engine.pip_packages.join(", ")})` },
          ],
        },
      ],
      confirmLabel: "Uninstall",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!choice) return;
    uninstallDeps = choice.scope === "files-and-deps";
  } else {
    const ok = await confirmDialog({
      title: `Uninstall ${engine.id}?`,
      message: "Model files will be removed from disk.",
      danger: true,
      confirmLabel: "Uninstall",
    });
    if (!ok) return;
  }

  busy[_engineKey(engine.id)] = "uninstall";
  try {
    let path;
    if (isExternal) {
      path = `/v1/engines/external/${encodeURIComponent(engine.id)}`;
    } else {
      path = `/v1/engines/${encodeURIComponent(engine.id)}`;
      if (uninstallDeps) path += "?uninstall_deps=true";
    }
    await api.request(path, { method: "DELETE" });
    // C2: drop cached variants so refresh() actually re-reads on-disk state.
    delete variants[engine.id];
    await refresh();
    pushToast({
      message: `${engine.name || engine.id} ${isExternal ? "removed" : "uninstalled"}.`,
      kind: "success",
      duration: 4000,
    });
  } catch (e) {
    pushToast({ message: `${isExternal ? "Remove" : "Uninstall"} failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy[_engineKey(engine.id)] = null;
  }
}


// ─── Engines redesign (v7 contract — preview/engines-redesign.html) ───
const topTab = ref("local");           // "local" | "online"
const q = ref("");                      // local-tab search
const qp = ref("");                     // online-tab search
const capLocal = ref("all");            // capability chip filters
const capOnline = ref("all");
const expanded = reactive({});          // engineId -> bool (manual toggles)

const SECTIONS = [
  { id: "tts",       title: "Voice generation", suffix: "TTS",
    note: "one model loaded at a time — loading another swaps the TTS slot" },
  { id: "stt",       title: "Transcription", suffix: "STT",
    note: "powers dictation, /v1/transcribe, and agent transcription" },
  { id: "llm",       title: "Language models", suffix: "LLM",
    note: "" },
  { id: "embedding", title: "Embeddings", suffix: "EMBED",
    note: "powers semantic search / RAG (future features)" },
];

function engineCaps(e) { return e.kinds?.length ? e.kinds : [e.kind || "tts"]; }

function searchBlob(e) {
  const vs = variantsFor(e.id).map((v) => `${v.name} ${v.description || ""}`).join(" ");
  return `${e.name} ${e.id} ${e.description || ""} ${vs}`.toLowerCase();
}

function engineVisible(e, sectionId) {
  if (engineCaps(e)[0] !== sectionId) return false;
  if (capLocal.value !== "all" && !engineCaps(e).includes(capLocal.value)) return false;
  if (q.value.trim() && !searchBlob(e).includes(q.value.trim().toLowerCase())) return false;
  return true;
}

const sectionData = computed(() =>
  SECTIONS.map((s) => {
    const list = engines.value.filter((e) => engineVisible(e, s.id));
    const rank = { loaded: 0, installed: 1, not_installed: 2 };
    list.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
    const all = engines.value.filter((e) => engineCaps(e)[0] === s.id);
    const modelCount = all.reduce((n, e) => n + variantsFor(e.id).length, 0);
    return { ...s, engines: list, engineCount: all.length, modelCount };
  }).filter((s) => s.engineCount > 0 || s.id === "embedding"),
);

function isOpen(e) {
  if (expanded[e.id] !== undefined) return expanded[e.id];
  if (q.value.trim()) return true;                        // search auto-expands
  return e.status === "loaded" || _anyProgressForEngine(e.id) != null; // smart defaults
}
function toggleOpen(e) { expanded[e.id] = !isOpen(e); }

function groupSummary(e) {
  const vs = variantsFor(e.id);
  const onDisk = vs.filter((v) => v.on_disk === true).length;
  const parts = [`${vs.length} model${vs.length === 1 ? "" : "s"}`];
  if (vs.some((v) => v.on_disk !== null)) parts.push(onDisk ? `${onDisk} on disk` : "none on disk");
  return parts.join(" · ");
}
function loadedVariantName(e) {
  if (e.status !== "loaded") return null;
  const v = variantsFor(e.id).find((x) => x.id === e.current_variant_id);
  return v ? v.name : (e.current_variant_id || e.name);
}

// fits-your-hardware dot — needs a detected GPU VRAM figure; hidden otherwise.
const gpuVramMb = computed(() => {
  const g = (system.value?.gpus || [])[0];
  return g?.vram_mb || null;
});
function fitFor(v) {
  if (!gpuVramMb.value || !v.vram_mb) return null;
  if (v.vram_mb > gpuVramMb.value) return "no";
  if (v.vram_mb > gpuVramMb.value * 0.8) return "tight";
  return "ok";
}
const FIT_TITLES = {
  ok: "Fits your hardware",
  tight: "Tight — close other models first",
  no: "Won't fit on this card",
};

// Loaded-now rail — one slot per kind from server truth.
const rail = computed(() => {
  const out = {};
  for (const k of ["tts", "stt", "llm"]) {
    const e = engines.value.find((x) => x.status === "loaded" && (x.kind || "tts") === k);
    out[k] = e ? { engine: e, model: loadedVariantName(e) } : null;
  }
  return out;
});
const railVram = computed(() => {
  let mb = 0;
  for (const k of ["tts", "stt", "llm"]) {
    const slot = rail.value[k];
    if (!slot) continue;
    const v = variantsFor(slot.engine.id).find((x) => x.id === slot.engine.current_variant_id);
    mb += v?.vram_mb || 0;
  }
  return mb;
});
async function unloadKind(kind) {
  try {
    await api.request("/v1/engines/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    window.dispatchEvent(new Event("jv:health-refresh"));
    await refresh();
  } catch (e) {
    pushToast({ message: `Unload failed: ${e.message || e}`, kind: "error" });
  }
}

// Per-model verbs (the three pairs). Variant-level state beats engine-level.
function modelLoaded(e, v) { return isLoadedVariant(e, v.id); }
function modelOnDisk(e, v) { return v.on_disk === true || (v.on_disk == null && isOnDisk(e, v.id)); }
function engineNeedsInstall(e) { return e.isolation === "venv" && e.status === "not_installed"; }

async function deleteModel(e, v) {
  const ok = await confirmDialog({
    title: `Delete ${v.name}?`,
    message: `Removes the downloaded weights (${fmtDisk(v.size_mb)}) from disk. The engine stays; you can download again anytime.`,
    danger: true,
    confirmLabel: "Delete model",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/engines/${e.id}/models/${encodeURIComponent(v.id)}`, { method: "DELETE" });
    pushToast({ message: `${v.name} deleted.`, kind: "success" });
    delete variants[e.id];
    await refresh();
  } catch (err) {
    pushToast({ message: `Delete failed: ${err.message || err}`, kind: "error" });
  }
}

// Online tab — merge both provider stores with capability chips.
// One row per provider — an id present in BOTH stores (llm + external
// TTS) merges into a single row with combined capability chips, like
// the mock's OpenAI row. The summary line mirrors the mock's msum:
// "chat: … · embed: … · tts: … · N voices · key set / no key".
const allProviders = computed(() => {
  const byId = new Map();
  for (const pr of llmProviders.value) {
    byId.set(pr.id, {
      ...pr,
      kind: "llm",
      caps: pr.embedding_model ? ["llm", "embedding"] : ["llm"],
      online: !!pr.registered,
    });
  }
  for (const pr of ttsProviders.value) {
    const prev = byId.get(pr.id);
    if (prev) {
      byId.set(pr.id, {
        ...prev,
        kind: "both",
        caps: [...prev.caps, "tts"],
        tts_model: pr.tts_model,
        voices: pr.voices,
        response_format: pr.response_format,
        has_api_key: prev.has_api_key || pr.has_api_key,
      });
    } else {
      byId.set(pr.id, { ...pr, kind: "tts", caps: ["tts"], online: false });
    }
  }
  const rows = [];
  for (const r of byId.values()) {
    const bits = [];
    if (r.caps.includes("llm")) bits.push(`chat: ${r.default_model || "—"}`);
    if (r.embedding_model) bits.push(`embed: ${r.embedding_model}`);
    if (r.caps.includes("tts")) {
      bits.push(`tts: ${r.tts_model || "—"}`);
      if (Array.isArray(r.voices) && r.voices.length) bits.push(`${r.voices.length} voices`);
    }
    const local = /localhost|127\.0\.0\.1/.test(r.base_url || "");
    bits.push(r.has_api_key ? "key set" : (local ? "no key — self-hosted, free" : "no key"));
    rows.push({ ...r, msum: bits.join(" · ") });
  }
  return rows.filter((r) => {
    if (capOnline.value !== "all" && !r.caps.includes(capOnline.value)) return false;
    const blob = `${r.name} ${r.id} ${r.base_url || ""} ${r.msum}`.toLowerCase();
    if (qp.value.trim() && !blob.includes(qp.value.trim().toLowerCase())) return false;
    return true;
  });
});

// Row-level Test (the mock's per-row Test button) — pings the provider
// and re-colors the status dot with the measured latency in the title.
const rowTest = reactive({});  // id -> { ok, ms, message }
async function testProviderRow(pr) {
  rowTest[pr.id] = { busy: true };
  const t0 = performance.now();
  const ms = () => Math.max(1, Math.round(performance.now() - t0));
  try {
    if (pr.caps.includes("llm") && pr.online) {
      const r = await api.request(`/v1/llm-providers/${pr.id}/ping`, { method: "POST" });
      rowTest[pr.id] = r?.ok ? { ok: true, ms: ms() } : { ok: false, message: r?.error || "not reachable" };
    } else {
      const r = await api.request("/v1/engines/external/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base_url: pr.base_url, api_key: null }),
      });
      rowTest[pr.id] = r ? { ok: true, ms: ms() } : { ok: false, message: "probe failed" };
    }
  } catch (e) {
    rowTest[pr.id] = { ok: false, message: e?.message || String(e) };
  }
  const t = rowTest[pr.id];
  pushToast({
    message: t.ok ? `${pr.name || pr.id}: reachable · ${t.ms} ms` : `${pr.name || pr.id}: ${t.message}`,
    kind: t.ok ? "success" : "error",
  });
}
function rowDotClass(pr) {
  const t = rowTest[pr.id];
  if (t && !t.busy) return t.ok ? "" : "err";
  return (pr.has_api_key || pr.online || /localhost|127\.0\.0\.1/.test(pr.base_url || "")) ? "" : "off";
}

const sharedEngines = computed(() => engines.value.filter((e) => e.isolation !== "venv").length);

onMounted(() => {
  refresh(); loadSystem(); loadProviders();
  // Loads can happen anywhere (Voices ask-before-load, first-render
  // auto-load) — refresh so the per-variant Load/Unload verbs track.
  window.addEventListener("jv:health-refresh", refresh);
});
onBeforeUnmount(() => window.removeEventListener("jv:health-refresh", refresh));
</script>

<template>
  <!-- Engines redesign — the free-vs-money split (preview/engines-redesign.html v7). -->
  <div class="jv-toptabs">
    <button type="button" class="jv-toptab" :class="{ on: topTab === 'local' }" @click="topTab = 'local'">
      <span class="t1">Local models</span>
      <span class="t2"><span class="free">FREE</span> · run on your machine · disk + VRAM</span>
    </button>
    <button type="button" class="jv-toptab" :class="{ on: topTab === 'online' }" @click="topTab = 'online'; cancelEdit()">
      <span class="t1">Online providers</span>
      <span class="t2"><span class="paid">METERED</span> · your accounts · API key + URL</span>
    </button>
  </div>

  <!-- ════ LOCAL MODELS ════ -->
  <div v-show="topTab === 'local'">
    <RecommendCard />
    <div class="ev-toprow">
      <div class="jv-searchbar">
        🔍 <input v-model="q" placeholder="Search local models and engines…" title="Filters engines and models; matching groups auto-expand">
      </div>
      <div class="ev-chips">
        <button v-for="c in ['all','tts','stt','llm','embedding']" :key="c" type="button"
          class="ev-chip" :class="{ on: capLocal === c }" @click="capLocal = c"
        >{{ c === 'all' ? 'All' : c === 'embedding' ? 'EMBED' : c.toUpperCase() }}</button>
      </div>
    </div>

    <div class="jv-card ev-hw" v-if="system">
      <div class="ev-hw-cell"><div class="k">OS</div><strong>{{ system.os }}</strong></div>
      <div class="ev-hw-cell"><div class="k">CPU</div><strong>{{ system.cpu_cores }}</strong> <span class="jv-muted">threads</span></div>
      <div class="ev-hw-cell"><div class="k">Memory</div><strong>{{ Math.round(system.ram_total_mb / 1024) }} GB</strong></div>
      <div class="ev-hw-cell" v-for="(g, i) in system.gpus || []" :key="i">
        <div class="k">GPU</div><strong>{{ g.name }}</strong>
        <span class="jv-muted" v-if="g.vram_mb">{{ (g.vram_mb / 1024).toFixed(1) }} GB VRAM</span>
      </div>
      <div class="ev-hw-cell"><div class="k">Acceleration</div>
        <span><JvTag v-for="r in activeRuntimes" :key="r" :label="r" /><span v-if="!activeRuntimes.length" class="jv-muted">CPU only</span></span>
      </div>
    </div>

    <!-- Loaded-now rail -->
    <div class="ev-rail">
      <div class="ev-rail-h">Loaded now</div>
      <div class="ev-slot" v-for="k in ['tts','stt','llm']" :key="k" :class="{ empty: !rail[k] }">
        <span class="k">{{ k.toUpperCase() }}</span>
        <div v-if="rail[k]">
          <div class="nm">{{ rail[k].model || rail[k].engine.name }}</div>
          <div class="sub">{{ rail[k].engine.name }}</div>
        </div>
        <div v-else><div class="nm">— nothing loaded</div></div>
        <button v-if="rail[k]" type="button" class="ev-x" title="Free this slot — weights stay on disk" @click="unloadKind(k)">Unload</button>
      </div>
      <div class="ev-vrtotal" v-if="railVram" title="Sum of the loaded models' declared VRAM needs">
        est. VRAM <strong>{{ fmtDisk(railVram) }}</strong><span v-if="gpuVramMb"> / {{ fmtDisk(gpuVramMb) }}</span>
      </div>
    </div>

    <p v-if="enginesLoaded && !engines.length" class="jv-banner jv-banner--warn">
      No engines listed — the Python server may not be running. Check <a href="#settings">Settings → Connection</a>.
    </p>

    <!-- capability sections -->
    <div v-for="sec in sectionData" :key="sec.id">
      <div class="ev-section-h">
        <h3>{{ sec.title }} <span class="suffix">— {{ sec.suffix }}</span></h3>
        <span class="count">{{ sec.engineCount }} engine{{ sec.engineCount === 1 ? '' : 's' }} · {{ sec.modelCount }} models</span>
        <span class="note" v-if="sec.id === 'llm'">stays loaded alongside TTS · feature routing lives in <a class="ev-xlink" href="#settings" title="Which provider+model each AI feature uses">Settings → AI features</a></span>
        <span class="note" v-else>{{ sec.note }}</span>
      </div>

      <!-- Self-hosted providers (item 9): the user runs these — they
           belong under Local with their kind, provider verbs only. -->
      <div v-for="pr in selfHostedFor(sec.id)" :key="`sh-${pr.id}`" class="ev-group">
        <div class="ev-ghead" style="cursor:default">
          <span class="chev" style="visibility:hidden">▶</span>
          <span class="nm">{{ pr.name }}</span><span class="id">{{ pr.id }}</span>
          <span class="ev-caps">
            <span class="ev-cap" :class="sec.id">{{ sec.id.toUpperCase() }}</span>
            <span class="ev-cap iso" title="OpenAI-compatible server you run yourself — free, private, nothing to install here">SELF-HOSTED</span>
          </span>
          <span class="desc">{{ pr.base_url }}</span>
          <span class="gsum">
            <JvButton variant="ghost" size="sm" label="Edit" title="Edit this provider (opens the provider form)" @click="topTab = 'online'; startEditProvider(pr)" />
          </span>
        </div>
      </div>

      <div v-if="!sec.engines.length && sec.id === 'embedding'" class="ev-empty">
        No local embedding engine yet — the engine slot exists and one is planned. Cloud embeddings work today via the <b>Online providers</b> tab.
      </div>

      <div v-for="e in sec.engines" :key="e.id" class="ev-group">
        <div class="ev-ghead" @click="toggleOpen(e)">
          <span class="chev" :class="{ open: isOpen(e) }">▶</span>
          <span class="nm">{{ e.name }}</span><span class="id">{{ e.id }}</span>
          <span class="ev-caps">
            <span v-for="c in engineCaps(e)" :key="c" class="ev-cap" :class="c">{{ c === 'embedding' ? 'EMBED' : c.toUpperCase() }}</span>
            <span v-if="e.isolation === 'venv'" class="ev-cap iso" title="Runs in its own isolated environment — the same mechanism custom engines use">ISOLATED</span>
          </span>
          <span class="desc" :title="e.description">{{ e.description }}</span>
          <span class="gsum">
            <!-- C3: the per-engine header strip is now intentionally
                 minimal — the prominent progress UI is the big
                 .jv-install-strip rendered INSIDE .ev-gbody below, next
                 to the model row it belongs to. The header just
                 surfaces a soft "active" indicator so collapsed groups
                 stay discoverable when something's in flight. -->
            <span v-if="_anyProgressForEngine(e.id)" class="meta">{{ (_anyProgressForEngine(e.id).phase || '').replaceAll('_', ' ') }} · click to expand</span>
            <span v-if="!_anyProgressForEngine(e.id) && engineNeedsInstall(e)" class="ev-badge none">engine not installed</span>
            <JvButton v-if="!_anyProgressForEngine(e.id) && engineNeedsInstall(e)" variant="primary" size="sm"
              :label="busy[_engineKey(e.id)] === 'install' ? 'Installing…' : 'Install engine'" :disabled="busy[_engineKey(e.id)] != null"
              title="One-time: builds this engine's isolated venv. Models download separately afterwards."
              @click.stop="install(e, null)" />
            <span v-if="!_anyProgressForEngine(e.id) && !engineNeedsInstall(e)" class="meta">{{ groupSummary(e) }}</span>
            <span v-if="!_anyProgressForEngine(e.id) && !engineNeedsInstall(e) && loadedVariantName(e)" class="ldd">● {{ loadedVariantName(e) }} loaded</span>
          </span>
        </div>

        <div class="ev-gbody" v-if="isOpen(e)">
          <!-- One-button row (docs/plans/2026-06-15-engines-one-button.md):
               Ollama-style. The action button is ALWAYS "Load model" — if
               weights aren't on disk the load() handler kicks the prefetch
               first, polls the job, then continues to load, all under one
               click. The C3 progress strip below shows phase + bytes. -->
          <div v-for="v in variantsFor(e.id)" :key="v.id" class="ev-model" :class="{ dim: engineNeedsInstall(e) }">
            <span v-if="fitFor(v)" class="ev-fit" :class="fitFor(v)" :title="FIT_TITLES[fitFor(v)]"></span>
            <span class="vn">{{ v.name }}</span>
            <span class="vmeta">{{ fmtDisk(v.size_mb) }}<span v-if="v.vram_mb"> · {{ fmtDisk(v.vram_mb) }} VRAM</span></span>
            <span class="vdesc" :title="v.description">{{ v.description }}</span>
            <span class="right">
              <span v-if="modelLoaded(e, v)" class="ev-badge loaded">● Loaded</span>
              <span v-else-if="modelOnDisk(e, v)" class="ev-badge ready" title="Weights are downloaded; click Load to bring it into memory">Ready</span>
              <JvButton v-if="modelLoaded(e, v)" variant="ghost" size="sm" label="Unload model"
                title="Free the slot — weights stay on disk" @click="unload(e)" />
              <JvButton v-if="modelLoaded(e, v) || (modelOnDisk(e, v) && v.on_disk === true)" variant="ghost" size="sm"
                label="Delete model" class="ev-danger"
                :title="`Delete the downloaded weights — frees ${fmtDisk(v.size_mb)}`"
                @click="deleteModel(e, v)" />
              <JvButton v-if="!modelLoaded(e, v)" variant="primary" size="sm"
                :label="loadButtonLabel(e, v)"
                :disabled="busy[_variantKey(e.id, v.id)] != null || busy[_engineKey(e.id)] != null || engineNeedsInstall(e)"
                :title="modelOnDisk(e, v) ? `Load into the ${(e.kind || 'tts').toUpperCase()} slot` : `Download (${fmtDisk(v.size_mb)}) and load — one step`"
                @click="load(e, v.id)" />
            </span>
          </div>
          <!-- C3: one big install/download progress strip per in-flight
               operation on this engine. Engine-wide install renders a
               strip titled with the engine name; per-variant downloads
               render a strip per variant_id. Each carries phase + bytes
               + rate + ETA + Cancel; failed strips show the error in
               place of the file row. -->
          <div
            v-for="row in progressRowsFor(e.id)"
            :key="row.key"
            class="jv-install-strip"
            :data-phase="row.value.phase"
          >
            <div class="jv-install-strip__head">
              <span class="jv-install-strip__title">
                {{ row.variantId ? variantNameFor(e.id, row.variantId) : (e.name || e.id) + ' · engine setup' }}
              </span>
              <span class="jv-install-strip__phase">{{ (row.value.phase || '').replaceAll('_', ' ') }}</span>
              <template v-if="row.value.bytes_total > 0">
                <span class="jv-install-strip__bytes">
                  {{ fmtBytesMb(row.value.bytes_downloaded || 0) }} / {{ fmtBytesMb(row.value.bytes_total) }} MB
                </span>
                <span class="jv-install-strip__rate">
                  <template v-if="fmtRate(progressKeyAndRate(row.value))">{{ fmtRate(progressKeyAndRate(row.value)) }}</template>
                  <template v-if="fmtEta(row.value, progressKeyAndRate(row.value))"> · {{ fmtEta(row.value, progressKeyAndRate(row.value)) }}</template>
                </span>
              </template>
              <!-- R2: indeterminate phases (no bytes) still need a hint so
                   the user isn't staring at striping with nothing else. -->
              <span v-else class="jv-install-strip__rate">working…</span>
              <span class="jv-spacer" />
              <!-- In flight → Cancel; terminal → Dismiss (clears the strip).
                   Without Dismiss the user was stuck staring at a FAILED
                   block they couldn't remove (user-reported 2026-06-15). -->
              <JvButton
                v-if="row.value.phase !== 'completed' && row.value.phase !== 'failed' && row.jobId"
                variant="danger-outline" size="sm" label="Cancel"
                @click="cancelProgressRow(row)"
              />
              <JvButton
                v-else-if="row.value.phase === 'failed' || row.value.phase === 'completed'"
                variant="ghost" size="sm" label="Dismiss"
                @click="dismissProgressRow(row)"
              />
            </div>
            <!-- R0+R1: bytes_total > 0 → real percentage; bytes_total
                 === 0 → truly indeterminate (full-width animated stripes
                 supplied by .jv-install-strip[data-indeterminate]). No
                 more fake 35% placeholder that doesn't move. -->
            <div class="jv-install-strip__bar" :data-indeterminate="row.value.bytes_total > 0 ? null : 'true'">
              <i :style="row.value.bytes_total > 0 ? { width: pct(row.value) + '%' } : { width: '100%' }" />
            </div>
            <div class="jv-install-strip__foot">
              <span v-if="row.value.error" class="jv-install-strip__err">⚠ {{ row.value.error }}</span>
              <span v-else-if="row.value.current_file" class="jv-install-strip__file">{{ row.value.current_file }}</span>
            </div>
          </div>

          <div class="ev-gfoot" v-if="e.isolation === 'venv' && e.status !== 'not_installed'">
            isolated venv
            <JvButton variant="ghost" size="sm" label="Uninstall engine" class="ev-danger" style="margin-left:auto"
              title="Remove this engine's venv and all its downloaded models" @click="uninstall(e)" />
          </div>
          <div class="ev-gfoot" v-else-if="e.isolation !== 'venv' && (e.status === 'installed' || e.status === 'loaded')">
            shared runtime · engine installed automatically
          </div>
        </div>
      </div>
    </div>

    <p class="ev-fitnote" v-if="gpuVramMb">
      Hardware fit, against your card:
      <span class="ev-fit ok"></span> fits
      <span class="ev-fit tight"></span> tight — free a slot first
      <span class="ev-fit no"></span> won't fit in {{ fmtDisk(gpuVramMb) }}
    </p>

    <div class="ev-runtime">
      Shared runtime (torch + common deps for the {{ sharedEngines }} shared engines)
      <span class="jv-muted" style="margin-left:auto">engines install into it automatically on first use</span>
    </div>
  </div>

  <!-- ════ ONLINE PROVIDERS ════ -->
  <div v-show="topTab === 'online'">
    <div class="ev-toprow">
      <div class="jv-searchbar">🔍 <input v-model="qp" placeholder="Search providers…"></div>
      <div class="ev-chips">
        <button v-for="c in ['all','tts','llm','embedding']" :key="c" type="button" class="ev-chip" :class="{ on: capOnline === c }" @click="capOnline = c"
        >{{ c === 'all' ? 'All' : c === 'embedding' ? 'EMBED' : c.toUpperCase() }}</button>
      </div>
      <JvButton variant="primary" size="sm" label="+ Add provider" title="Connect a cloud or self-hosted API — no install, no downloads, no VRAM" @click="startNewProvider" />
    </div>

    <div class="ev-costnote">
      💳 These call external APIs with your keys — usage is billed by the provider, and your text leaves this machine.
      Local models on the other tab are free and private. ·
      <a class="ev-xlink" href="#settings" title="Which provider+model each AI feature uses">feature routing → Settings · AI features</a>
    </div>

    <!-- New provider — a card with a placeholder header row; the form is
         the card body, exactly like an editing row (mock's #newprov). -->
    <div v-if="editingKey === 'new' && draft" class="ev-prov">
      <div class="ev-prow">
        <span class="ev-dot off"></span>
        <div class="pmain"><span class="nm" style="color:var(--ink-3)">New provider</span></div>
        <span class="right">
          <JvButton variant="ghost" size="sm" label="Cancel" @click="cancelEdit" />
        </span>
      </div>
      <ProviderForm
        :draft="draft"
        editing-key="new"
        @save="saveProvider"
        @cancel="cancelEdit"
      />
    </div>

    <!-- The header row stays visible while editing — the form expands
         beneath it as the card body (mock's .prov.editing). -->
    <div v-for="pr in allProviders" :key="`${pr.kind}-${pr.id}`" class="ev-prov" :class="{ 'ev-prov--selfhosted': pr.self_hosted }">
      <div class="ev-prow">
        <span class="ev-dot" :class="rowDotClass(pr)" :title="rowTest[pr.id]?.ok ? `Reachable · ${rowTest[pr.id].ms} ms` : (rowTest[pr.id]?.message || 'Click Test to check reachability')"></span>
        <div class="pmain">
          <span class="nm">{{ pr.name || pr.id }}</span>
          <span class="ev-caps" style="display:inline-flex;margin-left:6px">
            <span v-for="c in pr.caps" :key="c" class="ev-cap" :class="c">{{ c === 'embedding' ? 'EMBED' : c.toUpperCase() }}</span>
          </span>
          <span class="url">{{ pr.base_url || '—' }}</span>
          <span class="msum">{{ pr.msum }}</span>
        </div>
        <span class="right">
          <JvButton
            variant="ghost" size="sm" label="Test"
            :loading="!!rowTest[pr.id]?.busy"
            title="Ping the server and re-color the status dot"
            @click="testProviderRow(pr)"
          />
          <JvButton
            variant="ghost" size="sm" label="Edit"
            title="Edit inline — URL, key, capabilities, models"
            @click="editingKey === pr.id ? cancelEdit() : startEditProvider(pr)"
          />
        </span>
      </div>
      <ProviderForm
        v-if="editingKey === pr.id && draft"
        :draft="draft"
        :editing-key="pr.id"
        @save="saveProvider"
        @cancel="cancelEdit"
        @delete="deleteProvider"
      />
    </div>
    <p v-if="!allProviders.length" class="jv-muted" style="margin-top:14px">No providers yet — click “+ Add provider”.</p>
  </div>
</template>


<style scoped>
/* ── Engines redesign (v7 contract) ─────────────────────────────────── */
.ev-toprow{display:flex;gap:12px;align-items:center;margin-bottom:14px}
/* Filter chips — DELIBERATELY scoped, not promoted: the app already has
   jv-pill --solid/--ghost filter chips (smaller). Converging the two
   looks is a Phase 4 visual-direction call (mock-v7 approved this
   size); promoting a second canonical chip would duplicate the job. */
.ev-chips{display:flex;gap:6px}
.ev-chip{font:inherit;font-size:11.5px;font-weight:700;letter-spacing:.04em;border:1px solid var(--line);border-radius:999px;padding:5px 13px;cursor:pointer;background:var(--surface);color:var(--ink-2)}
.ev-chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.ev-hw{display:flex;gap:26px;align-items:center;padding:12px 18px;margin-bottom:14px}
.ev-hw-cell .k{font-size:10.5px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.05em}
.ev-rail{display:flex;align-items:center;background:var(--surface);border:1px solid var(--accent-line,#b8d2c3);border-radius:10px;margin-bottom:18px;overflow:hidden}
.ev-rail-h{background:var(--accent-soft,#e8f0eb);color:var(--accent-ink,#2c6049);font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;padding:14px 16px;align-self:stretch;display:flex;align-items:center;border-right:1px solid var(--accent-line,#b8d2c3)}
.ev-slot{display:flex;align-items:center;gap:10px;padding:9px 16px;border-right:1px solid var(--line);flex:1;min-width:0}
.ev-slot .k{font-size:10.5px;font-weight:700;color:var(--ink-3);width:30px}
.ev-slot .nm{font-weight:600;font-size:13px;white-space:nowrap}
.ev-slot .sub{font-size:11px;color:var(--ink-3);white-space:nowrap}
.ev-slot.empty .nm{color:var(--ink-3);font-weight:400}
.ev-x{margin-left:auto;border:1px solid var(--line);background:var(--surface);border-radius:6px;font-size:11px;padding:3px 9px;cursor:pointer;color:var(--ink-2)}
.ev-x:hover{border-color:#b04a3e;color:#b04a3e}
.ev-vrtotal{padding:9px 16px;font-size:12px;color:var(--ink-2);border-left:1px solid var(--line);white-space:nowrap}
.ev-section-h{display:flex;align-items:baseline;gap:10px;margin:26px 0 0;padding-bottom:8px;border-bottom:2px solid var(--line)}
.ev-section-h h3{font-family:var(--font-serif,Georgia,serif);font-size:17px;margin:0;font-weight:600}
.ev-section-h .suffix{color:var(--ink-3);font-weight:400}
.ev-section-h .count{font-size:12px;color:var(--ink-3)}
.ev-section-h .note{margin-left:auto;font-size:12px;color:var(--ink-3)}
.ev-xlink{color:var(--accent-ink,#2c6049);text-decoration:underline}
.ev-group{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-top:10px;box-shadow:0 1px 3px rgba(20,22,24,.04);overflow:hidden}
.ev-ghead{display:flex;align-items:center;gap:10px;padding:11px 16px;cursor:pointer}
.ev-ghead:hover{background:var(--surface-2)}
.ev-ghead .chev{color:var(--ink-3);font-size:10px;width:11px;transition:transform .15s;flex:none}
.ev-ghead .chev.open{transform:rotate(90deg)}
.ev-ghead .nm{font-weight:700;font-size:14px;white-space:nowrap}
.ev-ghead .id{font-family:var(--font-mono);font-size:10.5px;color:var(--ink-3)}
.ev-ghead .desc{color:var(--ink-3);font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev-ghead .gsum{margin-left:auto;display:flex;align-items:center;gap:8px;flex:none;font-size:12px;color:var(--ink-2)}
.ev-ghead .gsum .meta{font-size:12px;color:var(--ink-2)}
.ev-ghead .gsum .ldd{color:var(--accent-ink,#2c6049);font-weight:600}
.ev-caps{display:flex;gap:4px;flex:none}
.ev-cap{font-size:9.5px;font-weight:700;letter-spacing:.05em;padding:2px 7px;border-radius:999px;border:1px solid var(--line-strong,#cfccc4);color:var(--ink-2);background:var(--surface)}
.ev-cap.tts{border-color:var(--accent-line,#b8d2c3);background:var(--accent-soft,#e8f0eb);color:var(--accent-ink,#2c6049)}
.ev-cap.stt{border-color:#c8d4e8;background:#eaf0f8;color:#3a5a8c}
.ev-cap.llm{border-color:#e2d2b0;background:#f5edda;color:#b08a3e}
.ev-cap.embedding{border-color:#bcd9d4;background:#e3f1ee;color:#2e6e64}
.ev-cap.iso{border-color:#d8c8e8;background:#f1eaf8;color:#6a4a8c}
.ev-badge{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;padding:4px 11px;border-radius:999px}
.ev-badge.loaded{background:var(--accent);color:#fff}
.ev-badge.ready{background:var(--accent-soft,#e8f0eb);color:var(--accent-ink,#2c6049);border:1px solid var(--accent-line,#b8d2c3)}
.ev-badge.none{border:1px dashed var(--line-strong,#cfccc4);color:var(--ink-3)}
.ev-gbody{border-top:1px solid var(--line)}
.ev-model{display:flex;align-items:center;gap:12px;padding:10px 16px 10px 37px;border-bottom:1px solid var(--line)}
.ev-model:last-of-type{border-bottom:0}
.ev-model:hover{background:var(--surface-2)}
.ev-model.dim{opacity:.55}
.ev-model .vn{font-weight:600;font-size:13.5px;min-width:170px}
.ev-model .vmeta{font-size:11.5px;color:var(--ink-3);min-width:150px}
.ev-model .vdesc{font-size:12px;color:var(--ink-2);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ev-model .right{margin-left:auto;display:flex;gap:8px;align-items:center;flex:none}
.ev-fit{width:9px;height:9px;border-radius:50%;flex:none;display:inline-block}
.ev-fit.ok{background:#4d9b6d}
.ev-fit.tight{background:#d9a23c}
.ev-fit.no{background:#c45a4d}
.ev-gfoot{display:flex;align-items:center;gap:10px;padding:8px 16px 8px 37px;font-size:11.5px;color:var(--ink-3);background:var(--surface-2)}
.ev-error{padding:8px 16px;font-size:12px;color:#b04a3e}
.ev-progress{height:6px;border-radius:3px;background:var(--surface-3,#f3f1ec);width:120px;overflow:hidden;display:inline-block}
.ev-progress i{display:block;height:100%;background:var(--accent);border-radius:3px}
.ev-danger{color:#b04a3e !important}
.ev-fitnote{font-size:11px;color:var(--ink-3);margin:14px 2px 0}
.ev-fitnote .ev-fit{vertical-align:middle;margin:0 3px 0 10px}
.ev-runtime{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px 16px;border:1px dashed var(--line-strong,#cfccc4);border-radius:10px;font-size:12px;color:var(--ink-3)}
.ev-empty{margin-top:10px;border:1px dashed var(--line-strong,#cfccc4);border-radius:10px;padding:16px 18px;font-size:12.5px;color:var(--ink-3);background:var(--surface)}
.ev-costnote{display:flex;gap:10px;align-items:center;margin-bottom:14px;padding:10px 16px;border:1px solid #e2d2b0;background:#f5edda;border-radius:10px;font-size:12.5px;color:var(--ink-2)}
.ev-prov{background:var(--surface);border:1px solid var(--line);border-radius:10px;margin-top:10px;overflow:hidden}
.ev-prow{display:flex;align-items:center;gap:12px;padding:12px 16px}
.ev-dot{width:8px;height:8px;border-radius:50%;background:#4d9b6d;flex:none}
.ev-dot.off{background:var(--line-strong,#cfccc4)}
.ev-dot.err{background:#c45a4d}
.ev-prow .pmain{min-width:0;flex:1}
.ev-prow .nm{font-weight:600}
.ev-prow .url{font-family:var(--font-mono);font-size:11px;color:var(--ink-3);display:block}
.ev-prow .msum{font-size:11.5px;color:var(--ink-2)}
.ev-prow .right{margin-left:auto;display:flex;gap:8px;align-items:center;flex:none}
</style>

