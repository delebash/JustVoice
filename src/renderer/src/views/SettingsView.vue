<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, computed, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { projectsService } from "../services/projects.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvCheckbox from "../components/jv/JvCheckbox.vue";
import JvToggle from "../components/jv/JvToggle.vue";
import JvField from "../components/jv/JvField.vue";
import { useOnboarding } from "../stores/onboarding.js";
import CacheView from "./CacheView.vue";
import AudioChannelsView from "./AudioChannelsView.vue";
import WebhooksView from "./WebhooksView.vue";

const api = useApi();
const tasks = useRenderTasks();

// ── Workspace focus (primary use case) ──────────────────────────────
// The welcome modal asks this once; this card is the only place to
// change it afterwards. Writing through onboarding.set() persists to
// settings.json AND live re-filters the sidebar (App.vue visibleFor).
const onboarding = useOnboarding();
const USE_CASES = [
  { id: "audiobook", label: "Audiobooks" },
  { id: "game", label: "Game dialogue" },
  { id: "podcast", label: "Podcasts" },
  { id: "dictation", label: "Dictation" },
  { id: "accessibility", label: "Accessibility" },
  { id: "multiple", label: "A bit of everything" },
  { id: "unset", label: "Not set (show all tabs)" },
];
async function setUseCase(id) {
  await onboarding.set({ primary: id });
  pushToast({ kind: "success", title: "Workspace focus updated", description: "The sidebar now shows the tabs for this use case." });
}

function rerunQuickSetup() {
  window.dispatchEvent(new Event("jv:quick-setup"));
}

// ── Testing / danger zone ─────────────────────────────────────────────
// Tier 1: forget UI state so the app behaves like a fresh install
// (welcome → QuickSetup → empty Home) without touching data.
async function resetUiState() {
  const ok = await confirmDialog({
    title: "Reset UI state?",
    message: "Forgets the active project and re-arms the welcome + Quick Setup wizards. No projects, voices, or settings data is touched. The app reloads.",
    confirmLabel: "Reset UI",
  });
  if (!ok) return;
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app: { onboarding_shown: false, primary_use_case: "unset" } }),
    });
  } catch { /* server flag is best-effort; local state still clears */ }
  try {
    for (const k of ["jv.activeProject", "jv.quickSetup.seen"]) window.localStorage?.removeItem(k);
    window.sessionStorage?.clear();
  } catch { /* ignore */ }
  window.location.hash = "#overview";
  window.location.reload();
}

// Tier 2: wipe every project (and optionally the personas) — the
// workflow-testing reset. Voices, engines, providers, lexicons survive.
const deletePersonasToo = ref(false);
const wipeBusy = ref(false);
async function deleteAllProjects() {
  if (tasks.running.some((t) => t.status === "running")) {
    pushToast({ kind: "info", title: "A task is running", description: "Wait for (or cancel) running renders before wiping projects." });
    return;
  }
  const pr = await api.safeRequest("/v1/projects", { projects: [] });
  const list = pr?.projects || [];
  const pe = deletePersonasToo.value ? await api.safeRequest("/v1/personas", { personas: [] }) : { personas: [] };
  const ok = await confirmDialog({
    title: `Delete ALL ${list.length} projects?`,
    message: `Every project, chapter, block, and take goes — permanently.${deletePersonasToo.value ? ` Also deletes all ${pe.personas.length} personas.` : " Personas, voices, engines, lexicons, and settings stay."}`,
    danger: true,
    confirmLabel: "Delete everything listed",
  });
  if (!ok) return;
  wipeBusy.value = true;
  let failed = 0;
  try {
    for (const p of list) {
      try { await api.request(`/v1/projects/${p.id}`, { method: "DELETE" }); } catch { failed++; }
    }
    for (const per of pe.personas || []) {
      try { await api.request(`/v1/personas/${per.id}`, { method: "DELETE" }); } catch { failed++; }
    }
    try { window.localStorage?.removeItem("jv.activeProject"); } catch { /* ignore */ }
    pushToast({
      kind: failed ? "error" : "success",
      title: failed ? `Wipe finished with ${failed} failures` : "All projects deleted",
      description: "Fresh slate — walk the workflow from ＋ New project.",
    });
  } finally {
    wipeBusy.value = false;
  }
}

// ── Backup & restore (GET /v1/backup, POST /v1/restore) ─────────────
const aiUsage = ref(null);
async function loadAiUsage() {
  try { aiUsage.value = await api.request("/v1/ai-usage"); } catch { aiUsage.value = null; }
}
async function clearAiUsage() {
  try { await api.request("/v1/ai-usage", { method: "DELETE" }); await loadAiUsage(); } catch { /* toast not needed */ }
}

const backupBusy = ref(false);
const backupIncludeAudio = ref(true);
async function downloadBackup() {
  backupBusy.value = true;
  try {
    const blob = await api.requestBlob("GET", `/v1/backup?include_audio=${backupIncludeAudio.value}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `justvoice-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({ kind: "success", title: "Backup downloaded" });
  } catch (e) {
    pushToast({ kind: "error", title: "Backup failed", description: String(e?.message ?? e) });
  } finally {
    backupBusy.value = false;
  }
}
async function restoreBackup(ev) {
  const f = ev.target?.files?.[0];
  ev.target.value = "";
  if (!f) return;
  const ok = await confirmDialog({
    title: "Restore from backup?",
    message: `Restore "${f.name}"? This REPLACES the current settings and database. The server restarts its stores; a page reload follows.`,
    confirmLabel: "Replace & restore",
    danger: true,
  });
  if (!ok) return;
  try {
    await projectsService.restore(f, "replace", true);
    pushToast({ kind: "success", title: "Restored — reloading" });
    setTimeout(() => window.location.reload(), 1200);
  } catch (e) {
    pushToast({ kind: "error", title: "Restore failed", description: String(e?.message ?? e) });
  }
}
// Initialize with the same shape the API returns so the sub-nav + every
// field renders before /v1/settings comes back (or when the server is
// offline). refresh() overwrites with real values when the server is up.
const settings = ref({
  server:    { host: "127.0.0.1", port: 17494, docs_enabled: true },
  logging:   {},
  cache:     { enabled: true, max_memory_entries: 50, max_disk_bytes_per_scope: 2_000_000_000 },
  limits:    { text_max_chars: 100000, chapter_max_lines: 5000, reference_clip_max_bytes: 25_000_000, request_body_max_bytes: 100_000_000 },
  cors:      {},
  auth:      {},
  mastering: {},
  training:  {},
  models:    {},
  engines:   { kokoro: { model_dir_override: "" } },
  app:       { primary_use_case: "unset", secondary_use_cases: [], onboarding_shown: false },
  generation:{ max_chunk_chars: 800, crossfade_ms: 50, normalize_audio: true, autoplay_on_generate: true },
});
const serverReachable = ref(false);

// ─── External engine probe state ────────────────────────────────────────
const probe = ref(null);
const probeBusy = ref(false);
const probeModels = ref([]);
const probeVoices = ref([]);

const newExternal = ref({
  id: "",
  name: "",
  base_url: "",
  api_key: "",
  model: "",
  voicesText: "",
});
const addBusy = ref(false);

async function testExternalConnection() {
  if (!newExternal.value.base_url) return;
  probeBusy.value = true;
  probe.value = null;
  try {
    const result = await api.request("/v1/engines/external/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: newExternal.value.base_url,
        api_key: newExternal.value.api_key || null,
      }),
    });
    probe.value = result;
    probeModels.value = result.models || [];
    probeVoices.value = result.voices || [];
    if (result.recommended_model && !newExternal.value.model) {
      newExternal.value.model = result.recommended_model;
    }
    if (result.voices && result.voices.length > 0 && !newExternal.value.voicesText) {
      newExternal.value.voicesText = result.voices.join(", ");
    }
    if (!newExternal.value.id) {
      newExternal.value.id =
        result.server_hint === "unknown"
          ? "external-tts"
          : `external-${result.server_hint}`;
    }
    if (!newExternal.value.name) {
      const u = newExternal.value.base_url.replace(/^https?:\/\//, "");
      newExternal.value.name = `${result.server_hint} @ ${u}`;
    }
  } catch (e) {
    pushToast({ message: `Probe failed: ${e.message || e}`, kind: "error" });
  } finally {
    probeBusy.value = false;
  }
}

async function addExternalEngine() {
  if (!newExternal.value.id || !newExternal.value.base_url) return;
  addBusy.value = true;
  try {
    const voices = newExternal.value.voicesText
      ? newExternal.value.voicesText.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
    await api.request("/v1/engines/external", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: newExternal.value.id,
        name: newExternal.value.name || newExternal.value.id,
        base_url: newExternal.value.base_url,
        api_key: newExternal.value.api_key || null,
        model: newExternal.value.model || "kokoro",
        voices,
        response_format: "wav",
      }),
    });
    await refresh();
    pushToast({ message: `${newExternal.value.name || newExternal.value.id} registered.`, duration: 5000 });
    newExternal.value = { id: "", name: "", base_url: "", api_key: "", model: "", voicesText: "" };
    probe.value = null;
    probeModels.value = [];
    probeVoices.value = [];
  } catch (e) {
    pushToast({ message: `Add failed: ${e.message || e}`, kind: "error" });
  } finally {
    addBusy.value = false;
  }
}

async function removeExternalEngine(idx) {
  const ext = settings.value?.engines?.external?.[idx];
  if (!ext) return;
  const ok = await confirmDialog({
    title: `Remove ${ext.name}?`,
    message: `External engine "${ext.id}" will be unregistered. The remote server itself is not affected. Restart required.`,
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  settings.value.engines.external.splice(idx, 1);
  pushToast({ message: `${ext.name} removed — save to persist.` });
}

function voicesText(ext) {
  return (ext.voices || []).join(", ");
}
function setVoicesText(ext, raw) {
  ext.voices = raw.split(",").map((s) => s.trim()).filter(Boolean);
}

// ─── URL overrides ──────────────────────────────────────────────────────
const urlOverrideKeys = computed(() =>
  settings.value?.models?.url_overrides
    ? Object.keys(settings.value.models.url_overrides)
    : []
);
const newOverrideVariantId = ref("");
const newOverrideUrl = ref("");

function addUrlOverride() {
  if (!newOverrideVariantId.value || !newOverrideUrl.value) return;
  if (!settings.value.models) settings.value.models = { url_overrides: {} };
  if (!settings.value.models.url_overrides) settings.value.models.url_overrides = {};
  settings.value.models.url_overrides[newOverrideVariantId.value] = newOverrideUrl.value;
  newOverrideVariantId.value = "";
  newOverrideUrl.value = "";
}

function removeUrlOverride(key) {
  if (settings.value?.models?.url_overrides) {
    delete settings.value.models.url_overrides[key];
  }
}

const probeModelOptions = computed(() =>
  probeModels.value.map((m) => ({ label: m, value: m }))
);

// ─── Core settings load + save ──────────────────────────────────────────
async function refresh() {
  try {
    const live = await api.request("/v1/settings");
    if (live && typeof live === "object") {
      // Merge server values into the seeded defaults so partial responses
      // don't blank out fields the server didn't return.
      settings.value = { ...settings.value, ...live };
      serverReachable.value = true;
    }
  } catch {
    serverReachable.value = false;
  }
}

async function reload() {
  try {
    await refresh();
    pushToast({ message: "Reconnected.", duration: 2500 });
  } catch (e) {
    pushToast({ message: `Reconnect failed: ${e.message || e}`, kind: "error" });
  }
}

async function save() {
  try {
    const resp = await api.request("/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings.value),
    });
    settings.value = resp.settings || settings.value;
    pushToast({ message: "Settings saved. Some changes may need a server restart.", duration: 5000 });
  } catch (e) {
    pushToast({ message: `Save failed: ${e.message || e}`, kind: "error" });
  }
}

// ─── Debounced auto-save for slider / toggle changes ───────────────────
// Sliders fire onChange on every commit; toggles fire on flip. We batch
// the saves so dragging a slider doesn't issue 50 PATCH requests.
let _saveTimer = null;
function saveDebounced() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(async () => {
    try {
      await api.request("/v1/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings.value),
      });
    } catch {}
  }, 350);
}

// ─── Keep-server-running + Network access (preview parity, Tauri commands) ──
const keepServerRunning = ref(true);
const allowNetworkAccess = ref(false);
const KEEP_RUNNING_KEY = "justvoice:keep_server_running";
const NETWORK_ACCESS_KEY = "justvoice:allow_network_access";
try {
  const k = localStorage.getItem(KEEP_RUNNING_KEY);
  if (k !== null) keepServerRunning.value = k === "true";
  const n = localStorage.getItem(NETWORK_ACCESS_KEY);
  if (n !== null) allowNetworkAccess.value = n === "true";
} catch {}

async function onKeepServerRunningChange() {
  try { localStorage.setItem(KEEP_RUNNING_KEY, String(keepServerRunning.value)); } catch {}
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  if (tauri?.core?.invoke) {
    try {
      await tauri.core.invoke("set_keep_server_running", { enabled: keepServerRunning.value });
      pushToast({
        message: keepServerRunning.value
          ? "Server will stay running when the window closes."
          : "Server will quit when the window closes.",
        duration: 4000,
      });
    } catch (e) {
      pushToast({ message: `Couldn't sync setting to Tauri: ${e?.message || e}`, kind: "error" });
    }
  }
}

async function onNetworkAccessChange() {
  try { localStorage.setItem(NETWORK_ACCESS_KEY, String(allowNetworkAccess.value)); } catch {}
  // Flip the bind host immediately; restart required.
  if (settings.value?.server) {
    settings.value.server.host = allowNetworkAccess.value ? "0.0.0.0" : "127.0.0.1";
  }
  saveDebounced();
  pushToast({
    message: allowNetworkAccess.value
      ? "Network access ON — bind switched to 0.0.0.0. Restart the server for it to take effect."
      : "Network access OFF — bind switched to 127.0.0.1. Restart the server for it to take effect.",
    duration: 5500,
    kind: "warning",
  });
}

// ─── Inline connection status pill ─────────────────────────────────────
const connectionStatus = computed(() => {
  if (!serverReachable.value) return { kind: "offline", label: "Offline" };
  if (!settings.value?.server) return { kind: "connecting", label: "Connecting…" };
  return { kind: "online", label: "Online" };
});

onMounted(refresh);

// ── Sub-nav (matches preview HTML §13). ─────────────────────────────
const SUBS = [
  { id: "general",    label: "General" },
  { id: "ai",         label: "AI features" },
  { id: "mastering",  label: "Mastering" },
  { id: "generation", label: "Generation" },
  { id: "capture",    label: "Capture / Dictation" },
  { id: "mcp",        label: "MCP server" },
  { id: "gpu",        label: "GPU" },
  { id: "appearance", label: "Appearance" },
  { id: "cache",      label: "Cache" },
  { id: "channels",   label: "Channels" },
  { id: "webhooks",   label: "Webhooks" },
  { id: "logs",       label: "Logs" },
  { id: "changelog",  label: "Changelog" },
  { id: "about",      label: "About" },
];
const activeSub = ref("general");

// Deep links (#cache/#channels/#webhooks redirect here) hand the target
// sub-tab over via sessionStorage.
try {
  const sub = window.sessionStorage?.getItem("jv.settings.sub");
  if (sub) {
    window.sessionStorage.removeItem("jv.settings.sub");
    activeSub.value = sub;
  }
} catch { /* ignore */ }

// ── Model roles — Quick / Accuracy (engines redesign 2026-06-11) ─────
// Two plain-language roles; features inherit one unless pinned. The
// recommendations endpoint classifies registered providers' models so
// the user never answers "which model is fast?" cold.
const roleRecs = ref(null);
const roles = ref({ quick: null, accuracy: null });
async function loadRoles() {
  const [recs, st] = await Promise.all([
    api.safeRequest("/v1/llm-roles/recommendations", null),
    api.safeRequest("/v1/settings", null),
  ]);
  roleRecs.value = recs;
  roles.value = {
    quick: st?.engines?.llm_roles?.quick || null,
    accuracy: st?.engines?.llm_roles?.accuracy || null,
  };
}
function roleValue(role) {
  const t = roles.value[role];
  return t ? `${t.provider_id}::${t.model}` : "";
}
async function setRole(role, packed) {
  const [provider_id, model] = (packed || "::").split("::");
  const next = { ...roles.value, [role]: provider_id ? { provider_id, model } : null };
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engines: { llm_roles: next } }),
    });
    roles.value = next;
    pushToast({ message: `${role === "quick" ? "Quick" : "Accuracy"} model updated.`, duration: 2500 });
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}
function acceptRecommendedRoles() {
  const q = roleRecs.value?.recommended_quick;
  const a = roleRecs.value?.recommended_accuracy;
  if (q) setRole("quick", `${q.provider_id}::${q.model}`);
  if (a) setRole("accuracy", `${a.provider_id}::${a.model}`);
}

// ── Production configs (Speaker Lab promote → here) ─────────────────
const prodConfigs = ref([]);
async function loadProdConfigs() {
  const r = await api.safeRequest("/v1/production-configs", { configs: [] });
  prodConfigs.value = r?.configs || [];
}
function configFor(feature) {
  return prodConfigs.value.find((c) => c.feature === feature) || null;
}
function goHash(h) { window.location.hash = h; }
async function revertConfig(feature) {
  const ok = await confirmDialog({
    title: "Revert to Default?",
    message: "The feature goes back to the routing table + tier-resolved prompts. The Lab preset itself is untouched.",
    confirmLabel: "Revert",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/production-configs/${feature}`, { method: "DELETE" });
    await loadProdConfigs();
    pushToast({ message: "Reverted to Default (tier-resolved).", duration: 2500 });
  } catch (e) {
    pushToast({ message: `Revert failed: ${e?.message || e}`, kind: "error" });
  }
}

// ── Feature routing table (redesign) ────────────────────────────────
// Default role per feature mirrors dispatch.DEFAULT_FEATURE_ROLES.
const DEFAULT_ROLES = {
  compose: "quick", persona_rewrite: "quick", refine: "quick", voice_gender: "quick",
  speaker_attribution: "accuracy", smart_assign: "accuracy", show_notes: "accuracy",
  render_preset_suggest: "accuracy",
};
const EXTRA_FEATURES = [
  { key: "refine", label: "Dictation cleanup", description: "Captures: raw speech → clean text before paste (filler removal, self-corrections, punctuation)." },
  { key: "voice_gender", label: "Voice gender guess", description: "Voices: labels fetched voices the built-in dictionary doesn't recognise." },
];
const routeRows = computed(() => {
  const cat = aiCatalog.value.map((e) => ({ key: e.key, label: e.label, description: e.description }));
  const merged = [...cat, ...EXTRA_FEATURES.filter((x) => !cat.some((c) => c.key === x.key))];
  return merged.map((f) => ({ ...f, defaultRole: DEFAULT_ROLES[f.key] || "accuracy" }));
});
function routeValue(key) {
  const pin = pinForFeature(key);
  if (pin?.provider_id) return `prov::${pin.provider_id}`;
  if (pin?.role) return `inherit-${pin.role}`;
  return `inherit-${DEFAULT_ROLES[key] || "accuracy"}`;
}
async function setRoute(key, value) {
  let body;
  if (value.startsWith("prov::")) body = { feature: key, provider_id: value.slice(6), model: "" };
  else body = { feature: key, provider_id: "", model: "", role: value.replace("inherit-", "") };
  try {
    await api.request("/v1/feature-pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadAiPanel();
  } catch (e) {
    pushToast({ message: `Routing save failed: ${e?.message || e}`, kind: "error" });
  }
}
function resolveRoute(key) {
  const cfg = configFor(key);
  if (cfg) return `${cfg.model || "?"} · ${cfg.provider_id} (config)`;
  const pin = pinForFeature(key);
  if (pin?.provider_id) {
    const pr = aiProviders.value.find((x) => x.id === pin.provider_id);
    return `${pin.model || pr?.default_model || "default"} · ${pr?.name || pin.provider_id}`;
  }
  const role = pin?.role || DEFAULT_ROLES[key] || "accuracy";
  const t = roles.value[role];
  if (t?.provider_id) return `${t.model || "default"} · ${t.provider_id} (${role})`;
  const fb = fallbackProvider.value;
  return fb ? `${fb.default_model || "default"} · ${fb.name || fb.id} (fallback)` : "— set a role above";
}

// ── Nudge banner — provider saved on Engines hands off here ─────────
const nudge = ref(null);
function loadNudge() {
  try {
    const raw = window.sessionStorage?.getItem("jv.ai.nudge");
    if (raw) nudge.value = JSON.parse(raw);
  } catch { /* ignore */ }
}
function dismissNudge() {
  nudge.value = null;
  try { window.sessionStorage?.removeItem("jv.ai.nudge"); } catch { /* ignore */ }
}
async function acceptNudge(role) {
  if (!nudge.value) return;
  await setRole(role, `${nudge.value.provider_id}::${nudge.value.model || ""}`);
  dismissNudge();
}

// ── Usage strip (4-stat summary; detail panel below keeps the table) ──
const usageStats = computed(() => {
  const u = aiUsage.value;
  if (!u) return null;
  let tokens = 0; let busiest = null; let busiestCalls = 0;
  for (const [feat, agg] of Object.entries(u.by_feature || {})) {
    tokens += (agg.prompt_tokens || 0) + (agg.completion_tokens || 0);
    if (agg.calls > busiestCalls) { busiest = feat; busiestCalls = agg.calls; }
  }
  return { calls: u.total_calls || 0, tokens, busiest, busiestCalls };
});

// ── AI features panel (plan Q5 / Slice 1) ───────────────────────────
// Pin LLM features (compose / persona_rewrite / speaker_attribution /
// render_preset_suggest / smart_assign) to specific provider + model +
// tier. Backend at server/justvoice/api/feature_pins_api.py.
const aiCatalog = ref([]);
const aiPins = ref([]);
const aiProviders = ref([]);
const aiBusy = ref(false);

async function loadAiPanel() {
  try {
    const [pins, providers] = await Promise.all([
      api.safeRequest("/v1/feature-pins", { pins: [], catalog: [] }),
      api.safeRequest("/v1/llm-providers", { providers: [] }),
    ]);
    aiCatalog.value = pins?.catalog || [];
    aiPins.value = pins?.pins || [];
    aiProviders.value = providers?.providers || [];
  } catch (e) {
    pushToast({ message: `AI panel load failed: ${e?.message || e}`, kind: "error" });
  }
}

function pinForFeature(key) {
  return aiPins.value.find((p) => p.feature === key) || null;
}
function providerLabel(providerId) {
  return aiProviders.value.find((p) => p.id === providerId)?.name || providerId;
}

// Fallback provider — when no pin is set for a feature, the dispatch
// uses the first registered LLM. Surface its name in the "Inherit
// default" option so users know which provider their feature actually
// falls through to.
const fallbackProvider = computed(() => aiProviders.value[0] || null);

// Per-provider model cache. Lazy-fetched when the user clicks the
// 🔄 button next to a feature row, then offered as datalist options
// so the model input becomes a typing-combobox like ProviderForm.
const providerModels = ref({});  // { providerId: string[] }
const providerModelsBusy = ref({});  // { providerId: boolean }

async function fetchProviderModels(providerId) {
  if (!providerId) return;
  providerModelsBusy.value = { ...providerModelsBusy.value, [providerId]: true };
  try {
    const r = await api.request(`/v1/llm-providers/${providerId}/models`);
    providerModels.value = { ...providerModels.value, [providerId]: r?.models || [] };
    if (!(r?.models || []).length) {
      pushToast({ message: `${providerLabel(providerId)} returned no models.`, kind: "info" });
    }
  } catch (e) {
    pushToast({ message: `Couldn't list models for ${providerLabel(providerId)}: ${e?.message || e}`, kind: "error" });
  } finally {
    providerModelsBusy.value = { ...providerModelsBusy.value, [providerId]: false };
  }
}

// Lab destination per feature — speaker_attribution lands in Speaker Lab.
// Future: smart_assign → Smart-Assign Lab when it ships.
const LAB_PATHS = {
  speaker_attribution: { href: "#speakerlab", label: "Speaker Lab" },
};

async function savePin(feature, providerId, model, tier) {
  if (!providerId) {
    pushToast({ message: "Pick a provider first.", kind: "info" });
    return;
  }
  aiBusy.value = true;
  try {
    await api.request("/v1/feature-pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feature, provider_id: providerId, model: model || "", tier: tier || null }),
    });
    await loadAiPanel();
    pushToast({ message: `${feature} pinned to ${providerLabel(providerId)}.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Pin failed: ${e?.message || e}`, kind: "error" });
  } finally {
    aiBusy.value = false;
  }
}

async function clearPin(feature) {
  aiBusy.value = true;
  try {
    await api.request(`/v1/feature-pins/${feature}`, { method: "DELETE" });
    await loadAiPanel();
    pushToast({ message: `${feature} pin cleared — falls back to first registered LLM.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Clear failed: ${e?.message || e}`, kind: "error" });
  } finally {
    aiBusy.value = false;
  }
}

// ── Corrections badge (Phase 5 surfacing) ───────────────────────────
const correctionsCounts = ref({});   // {projectId: count}
const projectsForCorrections = ref([]);
async function loadCorrections() {
  try {
    const r = await api.safeRequest("/v1/projects", { projects: [] });
    projectsForCorrections.value = r?.projects || [];
    // Pull corrections per project. Cap at 30 to keep this cheap.
    const slice = projectsForCorrections.value.slice(0, 30);
    const counts = {};
    await Promise.all(
      slice.map(async (p) => {
        try {
          const c = await api.safeRequest(`/v1/projects/${p.id}/corrections/count`, { count: 0 });
          counts[p.id] = c?.count ?? 0;
        } catch {
          counts[p.id] = 0;
        }
      }),
    );
    correctionsCounts.value = counts;
  } catch { /* ignore */ }
}
async function clearProjectCorrections(projectId) {
  const ok = await confirmDialog({
    title: "Clear corrections?",
    message: "Clear all speaker corrections for this project? This cannot be undone.",
    danger: true,
    confirmLabel: "Clear all",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/projects/${projectId}/corrections`, { method: "DELETE" });
    correctionsCounts.value = { ...correctionsCounts.value, [projectId]: 0 };
    pushToast({ message: "Corrections cleared.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Clear failed: ${e?.message || e}`, kind: "error" });
  }
}

// ── GPU info (task #91) ──────────────────────────────────────────────
const gpuInfo = ref(null);
async function loadGpuInfo() {
  const r = await api.safeRequest("/v1/system", null);
  if (!r) return;
  const runtimes = Object.entries(r.runtimes || {})
    .filter(([, ok]) => ok)
    .map(([k]) => k);
  const active = runtimes.find((r2) => ["cuda", "metal", "coreml", "directml", "rocm", "mlx"].includes(r2)) || "cpu";
  gpuInfo.value = { active_backend: active, runtimes, gpus: r.gpus || [] };
}

// VRAM math for GpuInfoCard. used/total come from /v1/system; both null means
// no GPU detected or driver query failed — fall back to "—" in the UI.
const gpuVramTotalGB = computed(() => {
  const mb = gpuInfo.value?.gpus?.[0]?.vram_mb;
  return mb ? Math.round(mb / 1024) : "—";
});
const gpuVramUsedGB = computed(() => {
  const mb = gpuInfo.value?.gpus?.[0]?.vram_used_mb;
  return mb ? (mb / 1024).toFixed(1) : "—";
});
const gpuVramPct = computed(() => {
  const used = gpuInfo.value?.gpus?.[0]?.vram_used_mb || 0;
  const total = gpuInfo.value?.gpus?.[0]?.vram_mb || 0;
  return total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
});

// ── Auto-updater (task #90) ──────────────────────────────────────────
// UI shell only — the actual update check / download / install flow runs
// through Tauri's built-in updater plugin via window.__TAURI__.updater.
// When that's not available (web-only / headless dev), the buttons
// short-circuit to a no-op + diagnostic toast.
const UPDATER_CHANNEL_KEY = "justvoice:updater_channel";
const updater = ref({
  currentVersion: "0.1.0",
  channel: "stable",
  status: "idle", // idle | checking | available | downloading | ready | error | uptodate
  availableVersion: null,
  notes: null,
  lastChecked: null,
  progressPct: 0,
  error: null,
  busy: false,
});
try {
  const ch = localStorage.getItem(UPDATER_CHANNEL_KEY);
  if (ch) updater.value.channel = ch;
} catch {}
function persistUpdaterChannel() {
  try {
    localStorage.setItem(UPDATER_CHANNEL_KEY, updater.value.channel);
  } catch {}
}
async function checkForUpdates() {
  updater.value.busy = true;
  updater.value.status = "checking";
  updater.value.error = null;
  try {
    const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
    if (!tauri?.updater) {
      // Dev / web — pretend up-to-date.
      updater.value.status = "uptodate";
      updater.value.lastChecked = new Date().toLocaleString();
      return;
    }
    const result = await tauri.updater.check();
    updater.value.lastChecked = new Date().toLocaleString();
    if (result?.available) {
      updater.value.status = "available";
      updater.value.availableVersion = result.manifest?.version || "?";
      updater.value.notes = result.manifest?.body || "";
    } else {
      updater.value.status = "uptodate";
    }
  } catch (e) {
    updater.value.status = "error";
    updater.value.error = String(e?.message || e);
  } finally {
    updater.value.busy = false;
  }
}
async function downloadUpdate() {
  updater.value.busy = true;
  updater.value.status = "downloading";
  updater.value.progressPct = 0;
  try {
    const tauri = window.__TAURI__;
    if (!tauri?.updater) {
      updater.value.status = "error";
      updater.value.error = "Tauri updater unavailable in this build.";
      return;
    }
    await tauri.updater.downloadAndInstall((event) => {
      if (event?.event === "Progress") {
        const pct = Math.floor(((event.data?.chunkLength ?? 0) / (event.data?.contentLength || 1)) * 100);
        updater.value.progressPct = pct;
      }
    });
    updater.value.status = "ready";
  } catch (e) {
    updater.value.status = "error";
    updater.value.error = String(e?.message || e);
  } finally {
    updater.value.busy = false;
  }
}
async function restartAndInstall() {
  const tauri = window.__TAURI__;
  if (tauri?.process?.relaunch) await tauri.process.relaunch();
}

// ── Appearance (task #93) ────────────────────────────────────────────
const APPEARANCE_KEY = "justvoice:appearance";
const appearance = ref({
  theme: "auto",
  density: "default",
  accentHue: 158, // matches preview's green accent — hsl(158, 55%, 36%)
  locale: "en",
});

// ── Capture / Dictation settings (preview parity — preview Capture sub-tab) ──
// Mirrors the shape of settings.capture in the server-side Settings model.
// Persisted via PATCH /v1/settings when wired; for now uses localStorage so
// the UI is interactive immediately.
const CAPTURE_KEY = "justvoice:capture_settings";
const capture = ref({
  sttModel: "turbo",
  llmModel: "1.7B",
  refinementMode: "smart-cleanup",
  language: "auto",
  allowAutoPaste: true,
  defaultPlaybackVoice: "",
});
try {
  const raw = localStorage.getItem(CAPTURE_KEY);
  if (raw) Object.assign(capture.value, JSON.parse(raw));
} catch {}

// ── Mastering settings (preview parity — preview Mastering sub-tab) ─────
// Six knobs per preset (LUFS / peak / noise floor / head silence / tail
// silence / apply-effects-pre-master) + 5 named presets. Active preset
// drives the chapter render pipeline + the Audio Tools "Apply preset" flow.
const MASTER_PRESETS = [
  { id: "acx",     label: "ACX (audiobook)",     lufs: -20.0, peak: -3.5, noise: -60, head: 0.75, tail: 3.00 },
  { id: "inaudio", label: "iAudio",              lufs: -19.0, peak: -1.0, noise: -60, head: 0.50, tail: 2.00 },
  { id: "podcast", label: "Podcast",             lufs: -16.0, peak: -1.0, noise: -55, head: 0.25, tail: 1.00 },
  { id: "youtube", label: "YouTube",             lufs: -14.0, peak: -1.0, noise: -50, head: 0.10, tail: 0.50 },
  { id: "custom",  label: "Custom",              lufs: -20.0, peak: -3.5, noise: -60, head: 0.75, tail: 3.00 },
];
const mastering = ref({
  active: "acx",
  lufs: -20.0,
  peakDbfs: -3.5,
  noiseFloor: -60,
  headSilence: 0.75,
  tailSilence: 3.00,
  applyEffectsPreMaster: true,
});
function setMasterPreset(id) {
  const p = MASTER_PRESETS.find((x) => x.id === id);
  if (!p) return;
  mastering.value.active = id;
  if (id !== "custom") {
    mastering.value.lufs = p.lufs;
    mastering.value.peakDbfs = p.peak;
    mastering.value.noiseFloor = p.noise;
    mastering.value.headSilence = p.head;
    mastering.value.tailSilence = p.tail;
  }
  saveDebounced();
}
const masterPresetLabel = computed(
  () => MASTER_PRESETS.find((p) => p.id === mastering.value.active)?.label || "Custom"
);

// ── MCP server — bindings + default voice (server is always-on at /mcp) ──
const mcpBindings = ref([]);
const mcpPersonas = ref([]);
const mcpDefaultVoice = ref("");
const bindingDraft = ref({ client_id: "", label: "", persona_id: "" });
async function loadMcpBindings() {
  const [r, pers, s] = await Promise.all([
    api.safeRequest("/v1/mcp/bindings", { bindings: [] }),
    api.safeRequest("/v1/personas", { personas: [] }),
    api.safeRequest("/v1/settings", null),
  ]);
  mcpPersonas.value = pers?.personas || [];
  mcpDefaultVoice.value = s?.mcp?.default_voice || "";
  mcpBindings.value = (r?.bindings || []).map((b) => ({
    client_id: b.client_id,
    label: b.label,
    persona_id: b.persona_id || null,
    persona: mcpPersonas.value.find((p) => p.id === b.persona_id)?.name || b.persona_id || null,
    engine: b.default_engine || null,
    last_seen: b.last_seen_at ? new Date(b.last_seen_at).toLocaleString() : null,
  }));
}
async function saveBinding() {
  const d = bindingDraft.value;
  if (!d.client_id.trim()) return;
  try {
    await api.request("/v1/mcp/bindings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: d.client_id.trim(),
        label: d.label || null,
        persona_id: d.persona_id || null,
      }),
    });
    bindingDraft.value = { client_id: "", label: "", persona_id: "" };
    await loadMcpBindings();
  } catch (e) {
    pushToast({ message: `Binding save failed: ${e?.message || e}`, kind: "error" });
  }
}
function editBinding(b) {
  bindingDraft.value = { client_id: b.client_id, label: b.label || "", persona_id: b.persona_id || "" };
}
async function deleteBinding(b) {
  try {
    await api.request(`/v1/mcp/bindings/${encodeURIComponent(b.client_id)}`, { method: "DELETE" });
    await loadMcpBindings();
  } catch (e) {
    pushToast({ message: `Delete failed: ${e?.message || e}`, kind: "error" });
  }
}
async function saveMcpDefaultVoice() {
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mcp: { default_voice: mcpDefaultVoice.value || null } }),
    });
    pushToast({ message: "MCP default voice saved.", duration: 2000 });
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}

// Real connection snippets — the server speaks Streamable HTTP at /mcp;
// clients identify via the X-JustVoice-Client-Id header.
const MCP_SNIPPETS = computed(() => ({
  claude_desktop: `{
  "mcpServers": {
    "justvoice": {
      "url": "${api.serverUrl}/mcp",
      "headers": { "X-JustVoice-Client-Id": "claude-desktop" }
    }
  }
}`,
  claude_code: `claude mcp add justvoice --transport http --url ${api.serverUrl}/mcp --header "X-JustVoice-Client-Id: claude-code"`,
  curl: `curl -X POST ${api.serverUrl}/mcp -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -H 'X-JustVoice-Client-Id: my-script' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
}));

async function copySnippet(key) {
  const text = MCP_SNIPPETS.value[key];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ message: "Copied to clipboard.", duration: 2000 });
  } catch {
    pushToast({ message: "Couldn't access clipboard — copy manually.", kind: "warning", duration: 3000 });
  }
}

// ── Log viewer (preview parity — preview Logs sub-tab) ──────────────
const logsPreview = ref(`Loading recent log lines…`);
async function loadLogsPreview() {
  const r = await api.safeRequest("/v1/logs/tail?lines=80", null);
  if (r?.text) logsPreview.value = r.text;
  else logsPreview.value = "(no recent log lines — server may be offline or logging not yet wired)";
}
async function openLogFile() {
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  if (!tauri?.shell?.open) {
    pushToast({ message: "Open in OS file explorer requires Tauri.", kind: "warning" });
    return;
  }
  const r = await api.safeRequest("/v1/system", null);
  const logPath = r?.data_dir ? `${r.data_dir}/logs/justvoice.log` : null;
  if (!logPath) {
    pushToast({ message: "Couldn't locate log path. Check the server is running.", kind: "error" });
    return;
  }
  try {
    await tauri.shell.open(logPath);
  } catch (e) {
    pushToast({ message: `Couldn't open log: ${e?.message || e}`, kind: "error" });
  }
}
async function downloadRecentLogs() {
  try {
    const blob = await api.request("/v1/logs/download?hours=24");
    if (blob instanceof Blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `justvoice-logs-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (e) {
    pushToast({ message: `Log download failed: ${e?.message || e}`, kind: "error" });
  }
}
async function copyRecentLogs() {
  try {
    await navigator.clipboard.writeText(logsPreview.value || "");
    pushToast({ message: "Last 100 lines copied.", duration: 2000 });
  } catch {
    pushToast({ message: "Clipboard unavailable.", kind: "warning" });
  }
}
function loadAppearance() {
  try {
    const raw = localStorage.getItem(APPEARANCE_KEY);
    if (raw) Object.assign(appearance.value, JSON.parse(raw));
  } catch {}
  applyAppearance();
}
function applyAppearance() {
  const root = document.documentElement;
  // Theme — Light / Dark / Follow system. "auto" lets prefers-color-scheme drive it.
  const t = appearance.value.theme;
  if (t === "auto") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
  // Density — adjusts spacing-related CSS custom property.
  const densityScale = { compact: 0.85, default: 1.0, spacious: 1.2 }[appearance.value.density] || 1.0;
  root.style.setProperty("--density-scale", String(densityScale));
  // Accent hue — overrides the green accent across the app.
  root.style.setProperty("--accent-hue", String(appearance.value.accentHue));
  // Persist.
  try {
    localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance.value));
  } catch {}
}

onMounted(() => {
  loadAiUsage();
  loadAppearance();
  loadGpuInfo();
  loadMcpBindings();
  loadLogsPreview();
  loadAiPanel();
  loadRoles();
  loadProdConfigs();
  loadNudge();
  loadCorrections();
});
</script>

<template>
  <div>
    <p v-if="!serverReachable" class="jv-banner jv-banner--warn">
      <strong>Server offline.</strong> Showing default values; changes won't persist until the server is reachable.
      <span class="jv-spacer" />
      <a href="#" @click.prevent="reload">Retry</a>
    </p>

    <!-- ── Sub-nav (matches preview HTML §13). ────────────────────────── -->
    <div class="settings-subnav">
      <a
        v-for="s in SUBS"
        :key="s.id"
        class="settings-subnav__tab"
        :class="{ 'settings-subnav__tab--active': activeSub === s.id }"
        @click="activeSub = s.id"
      >{{ s.label }}</a>
    </div>

    <!-- ─── General · Workspace focus ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Workspace focus</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          What you mostly make here. Tunes the sidebar (hides tabs that don't apply),
          the vocabulary, and the launch tab. Pick "Not set" to show everything.
        </p>
        <div class="usecase-row">
          <button
            v-for="u in USE_CASES"
            :key="u.id"
            type="button"
            class="usecase-chip"
            :class="{ 'usecase-chip--active': onboarding.primaryUseCase === u.id }"
            :title="u.id === 'unset' ? 'Show every tab in the sidebar' : `Focus the sidebar and vocabulary on ${u.label.toLowerCase()}`"
            @click="setUseCase(u.id)"
          >{{ u.label }}</button>
        </div>
        <div style="margin-top: 12px; display: flex; align-items: center; gap: 10px">
          <JvButton
            variant="secondary"
            size="sm"
            label="⚙ Run Quick Setup again"
            title="Re-probe hardware, pick engines to install, reconnect local LLM/STT helpers"
            @click="rerunQuickSetup"
          />
          <span class="jv-muted" style="font-size: 11.5px">Hardware probe → recommended engines → helper connections.</span>
        </div>
      </div>
    </div>

    <!-- ─── General · Testing / danger zone ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Testing / danger zone</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          For walking the workflows from scratch. Tier 1 is safe; tier 2 deletes content.
          Full factory reset stays manual — restore a backup zip or delete the data directory.
        </p>
        <div style="display:flex; align-items:center; gap:10px; margin-top:10px">
          <JvButton variant="secondary" size="sm" label="↺ Reset UI state" title="Forget active project + re-arm welcome and Quick Setup. No data touched. Reloads." @click="resetUiState" />
          <span class="jv-muted" style="font-size:11.5px">fresh-install behavior, zero data loss</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-top:10px">
          <button type="button" class="jv-btn jv-btn--danger-outline jv-btn--sm" :disabled="wipeBusy" @click="deleteAllProjects">🗑 Delete ALL projects…</button>
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; cursor:pointer">
            <input type="checkbox" v-model="deletePersonasToo" style="accent-color:var(--accent)" /> also delete all personas
          </label>
        </div>
      </div>
    </div>

    <!-- ─── Cache / Channels / Webhooks (moved from the sidebar's Advanced lane) ─── -->
    <div v-show="activeSub === 'cache'" class="jv-section"><CacheView /></div>
    <div v-show="activeSub === 'channels'" class="jv-section"><AudioChannelsView /></div>
    <div v-show="activeSub === 'webhooks'" class="jv-section"><WebhooksView /></div>

    <!-- ─── General · Connection ─── -->
    <!-- ─── General · API reference (task #96) ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">API reference</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          JustVoice exposes a stable HTTP API. Use these endpoints from scripts, CI, or external tools.
          The full OpenAPI spec is at <a :href="api.serverUrl + '/docs'" target="_blank"><code class="jv-mono">{{ api.serverUrl }}/docs</code></a>.
        </p>
        <table class="jv-table" style="margin-top: 12px">
          <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code class="jv-mono">POST</code></td><td><code class="jv-mono">/v1/generate</code></td><td>Single-line synthesis → audio/wav. Auto-chunks long text.</td></tr>
            <tr><td><code class="jv-mono">POST</code></td><td><code class="jv-mono">/v1/chapters/render</code></td><td>Multi-line chapter render with mastering + cache.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/voices</code></td><td>List preset + stored voices.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/profiles</code></td><td>List voice profiles (with personality, effects chain, lexicon).</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/engines</code></td><td>Engine catalog + load state.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/engines/capabilities</code></td><td>Per-engine knob + inline-tag manifest (drives UI gating).</td></tr>
            <tr><td><code class="jv-mono">POST</code></td><td><code class="jv-mono">/v1/engines/{id}/load</code></td><td>Load an engine into memory.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/lexicons</code></td><td>Pronunciation dictionaries.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/takes/recent</code></td><td>Last N generations across the whole DB.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/settings</code></td><td>Operator-tunable settings (mastering target, paths, cache, etc.).</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/health</code></td><td>Server status + version.</td></tr>
          </tbody>
        </table>
        <p class="jv-muted" style="font-size: 11.5px; margin-top: 12px">
          Auth: set <code class="jv-mono">JUSTVOICE_BEARER_TOKEN</code> on the server + pass
          <code class="jv-mono">Authorization: Bearer &lt;token&gt;</code>. Loopback (127.0.0.1)
          requests skip auth by default.
        </p>
      </div>
    </div>

    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header" style="display: flex; align-items: center; gap: 10px">
          <h3 class="jv-card__title" style="margin: 0">Connection</h3>
          <span class="jv-spacer" />
          <span
            class="connection-status"
            :class="`connection-status--${connectionStatus.kind}`"
            :title="`Server URL: ${api.serverUrl}`"
          >
            <span class="connection-status__dot" />
            {{ connectionStatus.label }}
          </span>
        </div>
        <p class="jv-muted" style="font-size: 12px; margin-bottom: 14px;">Where this UI sends API requests. Persists in localStorage; not part of server settings.</p>
        <div class="settings-grid">
          <JvField label="Server URL" layout="block">
            <JvInput v-model="api.serverUrl" :spellcheck="false" width="url" @blur="reload" />
          </JvField>
          <JvField label="Bearer token (optional)" layout="block">
            <JvInput v-model="api.token" type="password" placeholder="optional" width="url" />
          </JvField>
        </div>
        <div class="jv-row" style="margin-top: 14px;">
          <JvButton variant="secondary" @click="reload">Reload from server</JvButton>
          <span class="jv-muted" style="font-size: 12px;">Re-fetches health + engines + voices against the new URL.</span>
        </div>
      </div>
    </div>

    <!-- ─── General · Lifecycle (preview parity — preview line 1564) ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Lifecycle</h3>
        </div>

        <!-- Keep server running on close — closes window to tray but keeps -->
        <!-- the Python sidecar alive so MCP agents, JustWrite, or external -->
        <!-- callers can keep hitting the API. -->
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Keep server running when window closes</div>
              <div class="setting-row__desc">
                Closing the window minimizes JustVoice to the system tray and keeps the Python
                server running in the background. MCP agents, JustWrite, and external scripts
                stay connected. Toggle off if you'd rather a true quit on close.
              </div>
            </div>
            <JvToggle v-model="keepServerRunning" @change="onKeepServerRunningChange" aria-label="Keep server running" />
          </div>
        </div>

        <!-- Allow network access — switches the bind host between loopback and 0.0.0.0. -->
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Allow network access</div>
              <div class="setting-row__desc">
                Bind the server to <code class="jv-mono">0.0.0.0</code> instead of
                <code class="jv-mono">127.0.0.1</code> so other devices on your LAN can reach the
                API (e.g. a phone hitting the MCP server, a desktop controlling a headless render
                box). Bearer auth is recommended when enabled. Restart required.
              </div>
            </div>
            <JvToggle v-model="allowNetworkAccess" @change="onNetworkAccessChange" aria-label="Allow network access" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── General · Server bind (preview parity) ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Backup & restore</h3>
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 14px">
          One zip: settings.json + the full SQLite database{{ backupIncludeAudio ? " + all audio blobs, voice embeddings, training adapters" : "" }}.
          Streamed from disk — large libraries don't load into RAM.
        </p>
        <div class="setting-row">
          <label style="display: inline-flex; align-items: center; gap: 8px; font-size: 12.5px">
            <input v-model="backupIncludeAudio" type="checkbox" />
            Include audio blobs (bigger, but a complete machine migration)
          </label>
        </div>
        <div class="setting-row" style="display: flex; gap: 10px; margin-top: 10px">
          <JvButton variant="primary" size="sm" :loading="backupBusy" label="⬇ Download backup" title="Stream a backup zip of this installation" @click="downloadBackup" />
          <label class="jv-btn jv-btn--secondary jv-btn--sm" style="cursor: pointer" title="Restore from a backup zip — REPLACES current data after confirmation">
            ⬆ Restore from zip…
            <input type="file" accept=".zip" style="display: none" @change="restoreBackup" />
          </label>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Server bind</h3>
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 14px">
          Low-level network settings. Most users don't need to touch these — the defaults
          (127.0.0.1:17494, docs enabled) work for local single-machine use. Restart required
          after changing.
        </p>
        <div class="settings-grid">
          <JvField label="Host" layout="block">
            <JvInput v-model="settings.server.host" width="id" />
          </JvField>
          <JvField label="Port" layout="block">
            <JvInput v-model.number="settings.server.port" type="number" width="token" />
          </JvField>
        </div>
        <div class="setting-row" style="margin-top: 14px">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Interactive API docs</div>
              <div class="setting-row__desc">
                Enable Swagger UI at <code class="jv-mono">/docs</code> and ReDoc at
                <code class="jv-mono">/redoc</code>. Useful for development and external
                integrations. Disable in production deployments behind public networks.
              </div>
            </div>
            <JvToggle v-model="settings.server.docs_enabled" aria-label="Enable API docs" />
          </div>
        </div>
      </div>
    </div>

    <!-- Appearance card removed from General — lives in its own sub-tab
         per preview line 1547 (showSubsection('appearance')). Theme +
         Density + Accent + Language all editable from Settings →
         Appearance sub-tab. -->


    <!-- ─── General · Updates ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header" style="display: flex; align-items: center; gap: 8px">
          <h3 class="jv-card__title" style="margin: 0">Updates</h3>
          <span class="jv-spacer" />
          <span class="jv-muted" style="font-size: 11.5px">Current: v{{ updater.currentVersion }}</span>
        </div>

        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Check for updates</div>
              <div class="setting-row__desc">
                <span v-if="updater.status === 'idle'">Last checked: {{ updater.lastChecked || 'never' }}</span>
                <span v-else-if="updater.status === 'checking'">Checking…</span>
                <span v-else-if="updater.status === 'available'">
                  <strong>v{{ updater.availableVersion }} available.</strong> {{ updater.notes || '' }}
                </span>
                <span v-else-if="updater.status === 'downloading'">Downloading… {{ updater.progressPct }}%</span>
                <span v-else-if="updater.status === 'ready'">Ready to install — restart to apply.</span>
                <span v-else-if="updater.status === 'error'" style="color: var(--danger)">{{ updater.error }}</span>
                <span v-else-if="updater.status === 'uptodate'">You're on the latest version.</span>
              </div>
            </div>
            <div class="jv-row" style="gap: 8px">
              <JvSelect
                v-model="updater.channel"
                width="id"
                :options="[
                  { label: 'Stable', value: 'stable' },
                  { label: 'Beta', value: 'beta' },
                  { label: 'Nightly', value: 'nightly' },
                ]"
                @change="persistUpdaterChannel"
              />
              <JvButton
                v-if="updater.status === 'idle' || updater.status === 'uptodate' || updater.status === 'error'"
                variant="secondary"
                size="sm"
                :disabled="updater.busy"
                label="Check now"
                @click="checkForUpdates"
              />
              <JvButton
                v-if="updater.status === 'available'"
                variant="primary"
                size="sm"
                :disabled="updater.busy"
                label="Download"
                @click="downloadUpdate"
              />
              <JvButton
                v-if="updater.status === 'ready'"
                variant="primary"
                size="sm"
                label="Restart and install"
                @click="restartAndInstall"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── AI features (Phase 2 / Slice 7 UI surface) ─── -->
    <!-- ─── AI · nudge banner (Engines provider-save hands off here) ─── -->
    <div v-show="activeSub === 'ai'" class="jv-section" v-if="nudge">
      <div class="ai-nudge">
        💡 You just connected <b>{{ nudge.name || nudge.provider_id }}</b><span v-if="nudge.model"> with <span class="jv-mono">{{ nudge.model }}</span></span>.
        Use it as one of your model roles?
        <span class="jv-spacer" />
        <JvButton variant="primary" size="sm" label="Use for Accuracy" title="Speaker extraction, smart-assign, show notes run on it" @click="acceptNudge('accuracy')" />
        <JvButton variant="secondary" size="sm" label="Use for Quick" title="Dictation cleanup, Compose, Rewrite run on it" @click="acceptNudge('quick')" />
        <JvButton variant="ghost" size="sm" label="Not now" @click="dismissNudge" />
      </div>
    </div>

    <!-- ─── AI · Model roles (engines redesign — full contract) ─── -->
    <div v-show="activeSub === 'ai'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header" style="display:flex;align-items:center;gap:10px">
          <h3 class="jv-card__title" style="margin:0">Model roles</h3>
          <span class="jv-spacer" />
          <JvButton v-if="roleRecs?.recommended_quick || roleRecs?.recommended_accuracy" variant="secondary" size="sm"
            label="Use recommended" title="Apply the app's hardware-aware picks for both roles" @click="acceptRecommendedRoles" />
          <a href="#engines" class="jv-muted" style="font-size:12px;text-decoration:underline" title="Connect providers / download local models">manage engines →</a>
        </div>
        <p class="jv-muted" style="font-size:12.5px">
          Two jobs, two models. Recommendations come from your hardware and what's installed — pick anything; the labels just explain the trade.
        </p>
        <div class="ai-roles">
          <div class="ai-role">
            <div class="ai-role__name"><span class="ai-rolechip quick">QUICK</span> Quick model</div>
            <div class="ai-role__desc">Answers in under a second. Used for: dictation cleanup · Compose · Rewrite · voice-gender guess.</div>
            <div class="ai-role__sel">
              <select class="jv-input" :value="roleValue('quick')" @change="setRole('quick', $event.target.value)">
                <option value="">(not set — features fall back to the first provider)</option>
                <option v-for="c in roleRecs?.candidates || []" :key="`q-${c.provider_id}-${c.model}`" :value="`${c.provider_id}::${c.model}`">{{ c.label }}</option>
              </select>
              <span v-if="roleRecs?.recommended_quick" class="ai-rec" :title="`Best speed of what's installed: ${roleRecs.recommended_quick.label}`">RECOMMENDED: {{ roleRecs.recommended_quick.model }}</span>
            </div>
            <div class="ai-role__hint">A local small model keeps dictation cleanup free and instant — cloud models here bill on every sentence you speak.</div>
          </div>
          <div class="ai-role">
            <div class="ai-role__name"><span class="ai-rolechip acc">ACCURACY</span> Accuracy model</div>
            <div class="ai-role__desc">Takes its time, gets it right. Used for: speaker extraction · smart-assign · show notes.</div>
            <div class="ai-role__sel">
              <select class="jv-input" :value="roleValue('accuracy')" @change="setRole('accuracy', $event.target.value)">
                <option value="">(not set — features fall back to the first provider)</option>
                <option v-for="c in roleRecs?.candidates || []" :key="`a-${c.provider_id}-${c.model}`" :value="`${c.provider_id}::${c.model}`">{{ c.label }}</option>
              </select>
              <span v-if="roleRecs?.recommended_accuracy" class="ai-rec" :title="`Biggest model you can run: ${roleRecs.recommended_accuracy.label}`">RECOMMENDED: {{ roleRecs.recommended_accuracy.model }}</span>
            </div>
            <div class="ai-role__hint">These features run inside async jobs — a few extra seconds buys attribution quality you'll hear in the casting.</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ─── AI · Production configs (Speaker Lab promote lands here) ─── -->
    <div v-show="activeSub === 'ai'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Production configs</h3></div>
        <p class="jv-muted" style="font-size:12.5px">
          A config freezes a feature exactly as tuned in its Lab — model <i>and</i> prompts. The active config
          beats the pins below. <b>Default (tier-resolved)</b> = routing decides the model; prompts auto-match its size.
          Precedence: <span class="jv-mono" style="font-size:11px">config → pin → role → tier</span>.
        </p>
        <div v-for="f in [{ key: 'speaker_attribution', label: 'Speaker extraction', lab: '#speakerlab', hasLab: true }, { key: 'smart_assign', label: 'Smart-assign voices', lab: '', hasLab: false }]" :key="f.key"
          style="display:flex;align-items:center;gap:10px;margin-top:10px;padding:11px 14px;border:1px solid var(--line);border-radius:8px;background:var(--surface-2)">
          <strong style="font-size:13.5px">{{ f.label }}</strong>
          <span class="jv-muted" style="font-size:12px">
            Active: <b style="color:var(--ink)">{{ configFor(f.key)?.name || 'Default (tier-resolved)' }}</b>
            <span v-if="configFor(f.key)" class="jv-pill jv-pill--violet" style="margin-left:6px">FROM SPEAKER LAB</span>
          </span>
          <span v-if="configFor(f.key)" class="jv-mono jv-muted" style="font-size:11px">
            {{ configFor(f.key).model }}<span v-if="configFor(f.key).temperature != null"> · temp {{ configFor(f.key).temperature }}</span><span v-if="configFor(f.key).system_prompt"> · custom prompts</span>
          </span>
          <span class="jv-spacer" />
          <JvButton v-if="f.hasLab" variant="ghost" size="sm" label="Open in Speaker Lab" title="Retune the prompts and re-promote" @click="goHash(f.lab)" />
          <span v-else class="jv-muted" style="font-size:11.5px">Lab coming later</span>
          <JvButton v-if="configFor(f.key)" variant="ghost" size="sm" label="Revert to Default" title="Back to the routing table + tier-resolved prompts" @click="revertConfig(f.key)" />
        </div>
        <div class="ai-ladder">
          <div class="ai-step"><span class="n">1</span><span class="w">Active production config</span><span class="who">exact model + prompts, promoted from a Lab — wins outright</span></div>
          <div class="ai-step"><span class="n">2</span><span class="w">Feature override</span><span class="who">a specific provider picked in the routing table</span></div>
          <div class="ai-step"><span class="n">3</span><span class="w">Role default</span><span class="who">Quick or Accuracy, from Model roles above</span></div>
          <div class="ai-step"><span class="n">4</span><span class="w">Tier-resolved prompts</span><span class="who">automatic — small models get guided prompts, big ones terse; never a setting</span></div>
        </div>
      </div>
    </div>

    <!-- ─── AI · usage strip (summary; the detail panel below keeps the table) ─── -->
    <div v-show="activeSub === 'ai'" class="jv-section" v-if="usageStats">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">AI usage</h3></div>
        <div class="ai-usage">
          <div class="u"><b>{{ usageStats.calls.toLocaleString() }}</b>calls recorded</div>
          <div class="u"><b>{{ usageStats.tokens.toLocaleString() }}</b>tokens total</div>
          <div class="u"><b>{{ usageStats.busiest || '—' }}</b>busiest feature <small v-if="usageStats.busiestCalls">· {{ usageStats.busiestCalls }} calls</small></div>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'ai'" class="jv-section">
      <!-- Feature routing — redesigned table (approved ai-features contract).
           Plain-English rows; each inherits a role or overrides to a
           provider; Resolves-to shows the actual model; CONFIG tag marks
           rows where a promoted Lab config wins. -->
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Feature routing</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          Every AI feature, in plain words, and what answers it. “Inherit” follows the Model roles above —
          override any row to a specific provider when you care. An active production config (purple tag) wins outright.
        </p>
        <table class="jv-table" style="margin-top: 12px">
          <thead><tr><th style="width:36%">Feature</th><th style="width:26%">Uses</th><th>Resolves to</th><th></th></tr></thead>
          <tbody>
            <tr v-for="f in routeRows" :key="f.key">
              <td>
                <div style="font-weight:600">{{ f.label }}</div>
                <div class="jv-muted" style="font-size:11.5px">{{ f.description }}</div>
              </td>
              <td>
                <select class="jv-input jv-input--sm" style="min-width:200px" :value="routeValue(f.key)" @change="setRoute(f.key, $event.target.value)">
                  <option value="inherit-quick">Inherit · Quick{{ f.defaultRole === 'quick' ? ' (default)' : '' }}</option>
                  <option value="inherit-accuracy">Inherit · Accuracy{{ f.defaultRole === 'accuracy' ? ' (default)' : '' }}</option>
                  <option v-for="pr in aiProviders" :key="pr.id" :value="`prov::${pr.id}`">{{ pr.name || pr.id }} · {{ pr.default_model || 'default model' }}</option>
                </select>
              </td>
              <td><span class="jv-mono" style="font-size:11.5px">{{ resolveRoute(f.key) }}</span></td>
              <td><span v-if="configFor(f.key)" class="jv-pill jv-pill--violet" :title="`Promoted Lab config '${configFor(f.key).name}' wins for this feature`">CONFIG</span></td>
            </tr>
          </tbody>
        </table>
      </div>


      <!-- ── Speaker corrections — Phase 5 surfacing ── -->
      <div class="jv-card" style="margin-top: 16px">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Speaker corrections</h3>
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin: 4px 0 12px">
          Manual fixes you make on the Studio Script tab become correction memory — the top 12 most recent corrections per project inject into the next Analyze run as worked examples. Clearing wipes the project's correction history.
        </p>
        <p v-if="!projectsForCorrections.length" class="jv-muted">No projects yet.</p>
        <table v-else class="jv-table" style="max-width: 720px">
          <thead>
            <tr><th>Project</th><th style="width: 120px; text-align: right">Corrections</th><th style="width: 120px" /></tr>
          </thead>
          <tbody>
            <tr v-for="p in projectsForCorrections" :key="p.id">
              <td>{{ p.name }}</td>
              <td style="text-align: right">
                <span :class="['jv-pill', correctionsCounts[p.id] ? 'jv-pill--solid' : '']">
                  {{ correctionsCounts[p.id] ?? 0 }}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  class="jv-btn jv-btn--ghost jv-btn--sm"
                  :disabled="!correctionsCounts[p.id]"
                  @click="clearProjectCorrections(p.id)"
                >Clear all</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ─── General · Cache ─── -->
    <div v-show="activeSub === 'ai'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">AI usage</h3>
          <span class="jv-spacer" />
          <JvButton variant="ghost" size="sm" label="↻" title="Refresh usage" @click="loadAiUsage" />
          <JvButton variant="ghost" size="sm" label="Clear" title="Clear the usage log" @click="clearAiUsage" />
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 10px">
          Tokens + wall time per feature, recorded for every LLM call (ported from JustWrite's usage ledger).
        </p>
        <table v-if="aiUsage && Object.keys(aiUsage.by_feature || {}).length" class="jv-table">
          <thead>
            <tr><th>Feature</th><th class="jv-right">Calls</th><th class="jv-right">Errors</th><th class="jv-right">Tokens in</th><th class="jv-right">Tokens out</th><th class="jv-right">Time</th></tr>
          </thead>
          <tbody>
            <tr v-for="(agg, feature) in aiUsage.by_feature" :key="feature">
              <td><code>{{ feature }}</code></td>
              <td class="jv-right jv-mono">{{ agg.calls }}</td>
              <td class="jv-right jv-mono" :style="agg.errors ? 'color: var(--danger)' : ''">{{ agg.errors }}</td>
              <td class="jv-right jv-mono">{{ agg.prompt_tokens.toLocaleString() }}</td>
              <td class="jv-right jv-mono">{{ agg.completion_tokens.toLocaleString() }}</td>
              <td class="jv-right jv-mono">{{ (agg.duration_ms / 1000).toFixed(1) }}s</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted" style="font-size: 12.5px">No AI calls recorded yet this session.</p>
      </div>
    </div>

    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Cache</h3>
        </div>
        <div class="settings-grid">
          <JvField label="Max memory entries" layout="block">
            <JvInput v-model.number="settings.cache.max_memory_entries" type="number" width="token" />
          </JvField>
          <JvField label="Max disk bytes per scope" layout="block">
            <JvInput v-model.number="settings.cache.max_disk_bytes_per_scope" type="number" width="token" />
          </JvField>
        </div>
        <div style="margin-top: 14px;">
          <JvCheckbox v-model="settings.cache.enabled" label="Cache enabled" />
        </div>
      </div>
    </div>

    <!-- ─── General · Limits ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Limits</h3>
        </div>
        <div class="settings-grid">
          <JvField label="Text max chars" layout="block">
            <JvInput v-model.number="settings.limits.text_max_chars" type="number" width="token" />
          </JvField>
          <JvField label="Chapter max lines" layout="block">
            <JvInput v-model.number="settings.limits.chapter_max_lines" type="number" width="token" />
          </JvField>
          <JvField label="Reference clip max bytes" layout="block">
            <JvInput v-model.number="settings.limits.reference_clip_max_bytes" type="number" width="token" />
          </JvField>
          <JvField label="Request body max bytes" layout="block">
            <JvInput v-model.number="settings.limits.request_body_max_bytes" type="number" width="token" />
          </JvField>
        </div>
      </div>
    </div>

    <!-- ─── GPU · Local model paths ─── -->
    <div v-show="activeSub === 'gpu'" class="jv-section" v-if="settings.engines">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Local model paths</h3>
        </div>
        <JvField label="Kokoro model directory (absolute path)" layout="block">
          <JvInput
            v-model="settings.engines.kokoro.model_dir_override"
            :spellcheck="false"
            width="path"
            placeholder="e.g. C:\Users\you\kokoro-multi-lang-v1_0"
          />
        </JvField>
        <p class="jv-muted" style="font-size: 12px; margin-top: 8px;">Restart required after changing.</p>
      </div>
    </div>

    <!-- ─── Generation · Pipeline knobs (preview parity) ─── -->
    <div v-show="activeSub === 'generation'" class="jv-section" v-if="settings.generation">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Generation pipeline</h3>
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 18px">
          How the chunked TTS pipeline handles long text. Short text (≤ chunk limit) takes the
          single-shot fast path with zero overhead — the chunker only kicks in when needed.
        </p>

        <!-- Max chunk chars slider -->
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Chunk limit</div>
              <div class="setting-row__desc">
                Maximum characters per generation chunk. Long text gets split at sentence
                boundaries; each chunk is rendered separately and stitched together. Smaller chunks
                = more model calls but lower per-chunk latency. Larger chunks risk truncation /
                hallucinated trailing noise on some engines.
              </div>
            </div>
            <span class="setting-row__value">{{ settings.generation.max_chunk_chars }} chars</span>
          </div>
          <input
            type="range"
            v-model.number="settings.generation.max_chunk_chars"
            min="100" max="5000" step="50"
            class="setting-row__slider"
            @change="saveDebounced"
          />
        </div>

        <!-- Crossfade ms slider -->
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Crossfade between chunks</div>
              <div class="setting-row__desc">
                Smooths the seam where two chunks join. 0 = hard cut (faster but audible clicks on
                some engines). 50 ms is the sweet spot for most engines. Higher values blur word
                boundaries.
              </div>
            </div>
            <span class="setting-row__value">{{ settings.generation.crossfade_ms === 0 ? "hard cut" : `${settings.generation.crossfade_ms} ms` }}</span>
          </div>
          <input
            type="range"
            v-model.number="settings.generation.crossfade_ms"
            min="0" max="200" step="10"
            class="setting-row__slider"
            @change="saveDebounced"
          />
        </div>

        <!-- Normalize audio -->
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Normalize per-chunk audio</div>
              <div class="setting-row__desc">
                Equalizes loudness across chunks before crossfade. Helps when an engine produces
                varying loudness per chunk on long renders. Disable if you'd rather control
                loudness purely via the Mastering target.
              </div>
            </div>
            <JvToggle v-model="settings.generation.normalize_audio" @change="saveDebounced" aria-label="Normalize audio" />
          </div>
        </div>

        <!-- Autoplay -->
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Autoplay on generate</div>
              <div class="setting-row__desc">
                Auto-play the result in the Generate tab as soon as a render completes. Disable
                if you'd rather queue renders silently and listen later.
              </div>
            </div>
            <JvToggle v-model="settings.generation.autoplay_on_generate" @change="saveDebounced" aria-label="Autoplay on generate" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Generation · Training ─── -->
    <div v-show="activeSub === 'generation'" class="jv-section" v-if="settings.training">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Training</h3>
        </div>
        <div class="settings-grid">
          <JvField label="Max concurrent jobs" layout="block">
            <JvInput v-model.number="settings.training.max_concurrent_jobs" type="number" width="token" />
          </JvField>
          <JvField label="Max samples per job" layout="block">
            <JvInput v-model.number="settings.training.max_samples_per_job" type="number" width="token" />
          </JvField>
          <JvField label="Sample loss every (steps)" layout="block">
            <JvInput v-model.number="settings.training.sample_loss_every" type="number" width="token" />
          </JvField>
          <JvField label="Default voice language (BCP-47)" layout="block">
            <JvInput v-model="settings.training.default_voice_language" width="token" />
          </JvField>
        </div>
        <div style="margin-top: 14px;">
          <JvCheckbox
            v-model="settings.training.enabled"
            label="Training enabled (master gate — off makes POST /v1/train return 501)"
          />
        </div>

        <template v-if="settings.training.validation">
          <div class="jv-divider"></div>
          <h4 style="margin-bottom: 12px; color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Validation thresholds</h4>
          <div class="settings-grid">
            <JvField label="Min sample duration (s)" layout="block">
              <JvInput v-model.number="settings.training.validation.min_sample_duration_secs" type="number" width="token" />
            </JvField>
            <JvField label="Max sample duration (s)" layout="block">
              <JvInput v-model.number="settings.training.validation.max_sample_duration_secs" type="number" width="token" />
            </JvField>
            <JvField label="Min SNR (dB)" layout="block">
              <JvInput v-model.number="settings.training.validation.min_snr_db" type="number" width="token" />
            </JvField>
            <JvField label="Max silence ratio" layout="block">
              <JvInput v-model.number="settings.training.validation.max_silence_ratio" type="number" width="token" />
            </JvField>
            <JvField label="Min accepted samples" layout="block">
              <JvInput v-model.number="settings.training.validation.min_accepted_samples" type="number" width="token" />
            </JvField>
          </div>
        </template>
      </div>
    </div>

    <!-- External TTS servers moved to Engines → Online providers
         (engines redesign 2026-06-11) — settings.engines.external data
         unchanged; this page no longer renders it. -->
    <!-- ─── General · Model URL overrides (was under External TTS) ─── -->
    <div v-show="activeSub === 'general'" class="jv-section" v-if="settings.models">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Model URL overrides</h3>
        </div>
        <p class="jv-muted" style="font-size: 12px; margin-bottom: 16px;">
          Override download URLs per variant. Useful when upstream artifacts move or when mirroring to an internal CDN.
          Keyed by variant id (e.g. <code class="jv-mono">kokoro-multi-lang-v1_0</code>).
        </p>

        <table v-if="urlOverrideKeys.length" class="jv-table" style="margin-bottom: 16px;">
          <thead>
            <tr>
              <th>Variant id</th>
              <th>Override URL</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="key in urlOverrideKeys" :key="key">
              <td><code class="jv-mono">{{ key }}</code></td>
              <td><JvInput v-model="settings.models.url_overrides[key]" :spellcheck="false" /></td>
              <td class="jv-table__actions">
                <JvButton variant="danger-outline" size="sm" @click="removeUrlOverride(key)">Remove</JvButton>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted" style="font-style: italic; margin-bottom: 14px;">No URL overrides set.</p>

        <div class="jv-row" style="margin-bottom: 8px;">
          <JvInput v-model="newOverrideVariantId" placeholder="variant id (e.g. kokoro-multi-lang-v1_0)" width="name" />
          <JvInput v-model="newOverrideUrl" placeholder="override URL" width="path" />
          <JvButton variant="secondary" :disabled="!newOverrideVariantId || !newOverrideUrl" @click="addUrlOverride">Add override</JvButton>
        </div>
        <p class="jv-muted" style="font-size: 12px;">Saved with Settings.</p>
      </div>
    </div>

    <!-- ─── Mastering · placeholder until #88 lands. ─── -->
    <!-- ─── Mastering (preview parity, preview lines 1599-1632) ─── -->
    <div v-show="activeSub === 'mastering'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header" style="display: flex; align-items: center; gap: 10px">
          <h3 class="jv-card__title" style="margin: 0">Active preset</h3>
          <span class="jv-spacer" />
          <span class="jv-pill jv-pill--green">{{ masterPresetLabel }}</span>
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 14px">
          The active mastering preset applies to every chapter render + standalone Audio Tools
          master. Switch presets by clicking a chip. Custom lets you override individual knobs
          below.
        </p>

        <!-- Preset chips -->
        <div class="jv-chips">
          <button
            v-for="p in MASTER_PRESETS"
            :key="p.id"
            class="jv-chip"
            :class="{ 'jv-chip--active': mastering.active === p.id }"
            @click="setMasterPreset(p.id)"
          >{{ p.label }}</button>
        </div>

        <div class="settings-grid" style="margin-top: 16px">
          <JvField label="Loudness target (LUFS)" layout="block">
            <JvInput v-model.number="mastering.lufs" type="number" step="0.5" width="token" />
          </JvField>
          <JvField label="True peak ceiling (dBFS)" layout="block">
            <JvInput v-model.number="mastering.peakDbfs" type="number" step="0.1" width="token" />
          </JvField>
          <JvField label="Noise floor (dBFS)" layout="block">
            <JvInput v-model.number="mastering.noiseFloor" type="number" step="1" width="token" />
          </JvField>
          <JvField label="Head silence (s)" layout="block">
            <JvInput v-model.number="mastering.headSilence" type="number" step="0.05" width="token" />
          </JvField>
          <JvField label="Tail silence (s)" layout="block">
            <JvInput v-model.number="mastering.tailSilence" type="number" step="0.25" width="token" />
          </JvField>
        </div>

        <div class="setting-row" style="margin-top: 14px">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Apply effects pre-master</div>
              <div class="setting-row__desc">
                Apply the profile's effects chain (reverb, EQ, compressor) BEFORE the mastering
                pass. Recommended ON — mastering then normalizes the effects-shaped signal.
                OFF skips effects entirely for this render.
              </div>
            </div>
            <JvToggle v-model="mastering.applyEffectsPreMaster" aria-label="Apply effects pre-master" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Capture / Dictation · placeholder. ─── -->
    <!-- ─── Capture / Dictation (preview parity, preview lines 1640-1662) ─── -->
    <div v-show="activeSub === 'capture'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Hotkeys (ChordPicker)</h3></div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 14px">
          Press-and-hold or toggle hotkeys for dictation. ChordPicker is a live keyboard combo editor —
          press the chord, peak-set is captured, Esc/Tab pass through.
        </p>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Push-to-talk</div>
              <div class="setting-row__desc">Hold the chord to record. Release to stop + transcribe.</div>
            </div>
            <div class="jv-row" style="gap: 6px">
              <span class="kbd">⌥</span><span class="kbd">⌘</span><span class="kbd">V</span>
              <JvButton variant="ghost" size="sm" label="Edit" />
              <JvButton variant="ghost" size="sm" label="Clear" />
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Toggle-to-talk</div>
              <div class="setting-row__desc">Press once to start, press again to stop. Useful for long passages.</div>
            </div>
            <div class="jv-row" style="gap: 6px">
              <span class="kbd">⌥</span><span class="kbd">⌘</span><span class="kbd">D</span>
              <JvButton variant="ghost" size="sm" label="Edit" />
              <JvButton variant="ghost" size="sm" label="Clear" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'capture'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Models</h3></div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">STT (Whisper)</div>
              <div class="setting-row__desc">Speech-to-text model. Larger = better accuracy + slower. Turbo is best balance.</div>
            </div>
            <JvSelect
              v-model="capture.sttModel"
              width="name"
              :options="[
                { label: 'faster-whisper-base.en (fast, recommended)', value: 'base.en' },
                { label: 'faster-whisper-small.en', value: 'small.en' },
                { label: 'faster-whisper-medium.en', value: 'medium.en' },
                { label: 'faster-whisper-large-v3', value: 'large-v3' },
                { label: 'faster-whisper-turbo (near-best, fast)', value: 'turbo' },
              ]"
            />
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">LLM refinement model</div>
              <div class="setting-row__desc">Cleans transcribed text — fixes punctuation, capitalization, optional self-correction.</div>
            </div>
            <JvSelect
              v-model="capture.llmModel"
              width="name"
              :options="[
                { label: 'Qwen 0.6B (fastest)', value: '0.6B' },
                { label: 'Qwen 1.7B (balanced)', value: '1.7B' },
                { label: 'Qwen 4B (best)', value: '4B' },
                { label: 'Off — raw transcription only', value: 'off' },
              ]"
            />
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Refinement mode</div>
              <div class="setting-row__desc">
                smart-cleanup = punctuation + capitalization only. self-correction = also fixes likely misheard words.
                preserve-technical = keep code-like tokens verbatim.
              </div>
            </div>
            <JvSelect
              v-model="capture.refinementMode"
              width="name"
              :options="[
                { label: 'smart-cleanup', value: 'smart-cleanup' },
                { label: 'self-correction', value: 'self-correction' },
                { label: 'preserve-technical', value: 'preserve-technical' },
              ]"
            />
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Capture language</div>
              <div class="setting-row__desc">Whisper language hint. "auto" detects per-recording.</div>
            </div>
            <JvSelect
              v-model="capture.language"
              width="name"
              :options="[
                { label: 'auto', value: 'auto' },
                { label: 'English (en)', value: 'en' },
                { label: 'Spanish (es)', value: 'es' },
                { label: 'French (fr)', value: 'fr' },
                { label: 'German (de)', value: 'de' },
                { label: 'Japanese (ja)', value: 'ja' },
              ]"
            />
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'capture'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Output</h3></div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Allow auto-paste</div>
              <div class="setting-row__desc">
                Paste transcription into the focused text field automatically. Requires Accessibility
                permission on macOS (Privacy → Accessibility) and Input Monitoring for the hotkey.
              </div>
            </div>
            <JvToggle v-model="capture.allowAutoPaste" aria-label="Allow auto-paste" />
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Default playback voice (MCP <code class="jv-mono">speak</code>)</div>
              <div class="setting-row__desc">
                Voice agents call <code class="jv-mono">justvoice.speak</code> with no voice arg. This is the
                fallback profile they get.
              </div>
            </div>
            <JvSelect v-model="capture.defaultPlaybackVoice" :options="[{ label: '(none — pick a profile)', value: '' }]" width="name" />
          </div>
        </div>
        <p class="jv-muted" style="font-size: 11.5px; margin-top: 8px">
          Captures live under <code class="jv-mono">~/.justvoice/captures/</code>. See the
          <a href="#captures">Captures tab</a> for the live recording list + 6-gate readiness checklist.
        </p>
      </div>
    </div>

    <!-- ─── MCP server — install snippets + tool listing (task #92) ─── -->
    <!-- ─── MCP server (preview parity, preview lines 1664-1715) ─── -->
    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header" style="display: flex; align-items: center; gap: 10px">
          <h3 class="jv-card__title" style="margin: 0">MCP server</h3>
          <span class="jv-spacer" />
          <span class="jv-pill jv-pill--green">on</span>
        </div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 12px">
          Exposes JustVoice tools to AI agents (Claude Desktop, claude-code, Unreal Editor, custom scripts).
          The server runs in-process on the JustVoice port; agents connect via the URL below.
        </p>
        <div class="settings-grid">
          <JvField label="Endpoint (Streamable HTTP)" layout="block">
            <JvInput :value="`${api.serverUrl}/mcp`" :readonly="true" width="url" title="Agents connect directly to this URL — no separate process" />
          </JvField>
          <JvField label="Default voice" layout="block">
            <div style="display: flex; gap: 8px; align-items: center">
              <JvInput
                v-model="mcpDefaultVoice"
                width="name"
                placeholder="voice id, e.g. af_heart"
                title="Used when an agent calls justvoice.speak with no voice/persona and no per-client binding"
              />
              <JvButton variant="secondary" size="sm" label="Save" @click="saveMcpDefaultVoice" />
            </div>
          </JvField>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Exposed tools</h3></div>
        <div class="jv-row" style="gap: 6px; flex-wrap: wrap; margin-top: 8px">
          <span class="jv-chip-card" title="Render text to speech; returns a generation id + audio URL"><strong>justvoice.speak</strong></span>
          <span class="jv-chip-card" title="Audio → text via the local Whisper engine"><strong>justvoice.transcribe</strong></span>
          <span class="jv-chip-card" title="All voices (presets + cloned + designed)"><strong>justvoice.list_voices</strong></span>
          <span class="jv-chip-card" title="Characters with their bound voice"><strong>justvoice.list_personas</strong></span>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Per-client bindings</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          Bind a default persona per client ID. Agents that send the
          <code class="jv-mono">X-JustVoice-Client-Id</code> header get the bound persona's voice
          when calling <code class="jv-mono">justvoice.speak</code> without arguments.
        </p>
        <table class="jv-table" style="margin-top: 12px">
          <thead>
            <tr>
              <th>Client ID</th><th>Label</th><th>Default persona</th><th>Default engine</th><th>Last seen</th><th class="right"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in mcpBindings" :key="b.client_id">
              <td><code class="jv-mono">{{ b.client_id }}</code></td>
              <td>{{ b.label || "—" }}</td>
              <td>{{ b.persona || "(none)" }}</td>
              <td>{{ b.engine || "(none)" }}</td>
              <td class="jv-muted">{{ b.last_seen || "never" }}</td>
              <td class="right">
                <JvButton variant="ghost" size="sm" label="Edit" title="Load this binding into the form below" @click="editBinding(b)" />
                <JvButton variant="ghost" size="sm" label="✕" title="Remove this binding" @click="deleteBinding(b)" />
              </td>
            </tr>
            <tr v-if="!mcpBindings.length">
              <td colspan="6" class="jv-muted" style="text-align: center; padding: 16px">
                No clients yet. Rows appear when an agent first calls a tool with its client ID — or add one below.
              </td>
            </tr>
          </tbody>
        </table>
        <div class="jv-row" style="gap: 8px; margin-top: 12px; align-items: center; flex-wrap: wrap">
          <JvInput v-model="bindingDraft.client_id" width="name" placeholder="client id (e.g. claude-code)" title="The X-JustVoice-Client-Id the agent sends" />
          <JvInput v-model="bindingDraft.label" width="name" placeholder="label (optional)" />
          <JvSelect
            v-model="bindingDraft.persona_id"
            width="name"
            :options="[{ label: '(no persona)', value: '' }, ...mcpPersonas.map(p => ({ label: p.name, value: p.id }))]"
          />
          <JvButton variant="primary" size="sm" label="Save binding" :disabled="!bindingDraft.client_id.trim()" @click="saveBinding" />
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Install snippets</h3></div>

        <h4 style="margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2)">Claude Desktop / any HTTP MCP client · <code class="jv-mono">mcp config JSON</code></h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{{ MCP_SNIPPETS.claude_desktop }}</pre>
          <JvButton variant="ghost" size="sm" label="Copy" title="Copy the JSON config" @click="copySnippet('claude_desktop')" />
        </div>

        <h4 style="margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2)">claude-code CLI</h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{{ MCP_SNIPPETS.claude_code }}</pre>
          <JvButton variant="ghost" size="sm" label="Copy" title="Copy the one-liner" @click="copySnippet('claude_code')" />
        </div>

        <h4 style="margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2)">curl smoke test</h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{{ MCP_SNIPPETS.curl }}</pre>
          <JvButton variant="ghost" size="sm" label="Copy" title="Copy the curl command" @click="copySnippet('curl')" />
        </div>
      </div>
    </div>

    <!-- ─── GPU — live info + CUDA wheel flow (task #91) ─── -->
    <!-- ─── GPU acceleration (preview parity, preview lines 1717-1741) ─── -->
    <div v-show="activeSub === 'gpu'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">GpuInfoCard</h3></div>
        <p v-if="!gpuInfo" class="jv-muted">Loading GPU info…</p>
        <template v-else>
          <div class="setting-row">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">Backend</div>
                <div class="setting-row__desc">Compute runtime PyTorch engines are using.</div>
              </div>
              <strong>{{ (gpuInfo.active_backend || "cpu").toUpperCase() }}</strong>
            </div>
          </div>
          <div class="setting-row" v-if="gpuInfo.gpus?.length">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">Device</div>
                <div class="setting-row__desc">{{ gpuInfo.gpus[0].vendor || "GPU" }} · driver {{ gpuInfo.gpus[0].driver || "(unknown)" }}</div>
              </div>
              <strong>{{ gpuInfo.gpus[0].name }}</strong>
            </div>
          </div>
          <div class="setting-row" v-if="gpuInfo.gpus?.[0]?.vram_mb">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">VRAM total / used</div>
                <div class="setting-row__desc">
                  Currently using <strong>{{ gpuVramUsedGB }} GB</strong> of <strong>{{ gpuVramTotalGB }} GB</strong>.
                  Unload engines via the Engines tab to free VRAM before loading larger models.
                </div>
              </div>
              <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px">
                <strong>{{ gpuVramUsedGB }} / {{ gpuVramTotalGB }} GB</strong>
                <div style="width: 200px; height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden">
                  <div :style="{ width: gpuVramPct + '%', height: '100%', background: 'var(--accent)' }" />
                </div>
              </div>
            </div>
          </div>
          <div class="setting-row">
            <div class="setting-row__head">
              <div>
                <div class="setting-row__title">Active</div>
                <div class="setting-row__desc">Engines currently using this device.</div>
              </div>
              <span v-if="gpuInfo.active_backend && gpuInfo.active_backend !== 'cpu'" class="jv-pill jv-pill--green">● in use</span>
              <span v-else class="jv-pill jv-pill--ghost">idle</span>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-show="activeSub === 'gpu'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">CUDA wheel download flow</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          PyTorch engines ship with the CPU wheel by default. Switching to CUDA reinstalls torch in
          the engine's venv with the matching CUDA build (~2 GB download). Per-engine — Chatterbox
          on CUDA and Kokoro on CPU is fine. Phases: <code class="jv-mono">idle → stopping engines →
          waiting for download → ready</code>.
        </p>
        <div class="jv-row" style="margin-top: 14px">
          <span class="jv-pill jv-pill--green">phase: ready</span>
          <span class="jv-muted" style="font-size: 12px">torch 2.4.1+cu124 · 2.1 GB</span>
          <span class="jv-spacer" />
          <JvButton variant="secondary" size="sm" label="Switch to CPU-only" />
          <JvButton variant="secondary" size="sm" label="Switch to ROCm (AMD)" />
          <JvButton variant="secondary" size="sm" label="Re-download" />
        </div>
        <p class="jv-muted" style="font-size: 11.5px; margin-top: 10px">
          The switch is per-engine. Use the Engines tab → engine row → "Install with CUDA" to enable
          per engine. On Apple Silicon, MPS / CoreML is auto-detected — no switch required.
        </p>
      </div>
    </div>

    <!-- ─── Appearance — Theme + accent (task #93) ─── -->
    <div v-show="activeSub === 'appearance'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Appearance</h3></div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 6px">
          Visual and locale preferences. Persisted in browser localStorage; no server round-trip.
        </p>

        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Theme</div>
              <div class="setting-row__desc">
                Light, Dark, or Follow system. Applied immediately via CSS custom properties.
              </div>
            </div>
            <JvSelect
              v-model="appearance.theme"
              width="name"
              :options="[
                { label: 'Follow system', value: 'auto' },
                { label: 'Light', value: 'light' },
                { label: 'Dark', value: 'dark' },
              ]"
              @change="applyAppearance"
            />
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Density</div>
              <div class="setting-row__desc">
                Compact reduces row spacing for power users. Spacious adds breathing room.
              </div>
            </div>
            <JvSelect
              v-model="appearance.density"
              width="name"
              :options="[
                { label: 'Default', value: 'default' },
                { label: 'Compact', value: 'compact' },
                { label: 'Spacious', value: 'spacious' },
              ]"
              @change="applyAppearance"
            />
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Accent hue · {{ appearance.accentHue }}°</div>
              <div class="setting-row__desc">
                Drag to pick a new accent color across the whole app. Default 158° = forest green.
              </div>
            </div>
            <span class="setting-row__value">
              <span class="accent-preview" :style="{ background: `hsl(${appearance.accentHue} 55% 36%)` }" />
            </span>
          </div>
          <input
            type="range"
            v-model.number="appearance.accentHue"
            min="0" max="360" step="1"
            class="setting-row__slider"
            @input="applyAppearance"
          />
        </div>

        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Language</div>
              <div class="setting-row__desc">
                UI language. Engine output language is configured per-voice in the Profile.
                Full i18next wiring lands with task <code>#97</code> — the picker persists your
                preference now and the locale will apply once translations ship.
              </div>
            </div>
            <JvSelect
              v-model="appearance.locale"
              width="name"
              :options="[
                { label: 'English (en)', value: 'en' },
                { label: 'Spanish (es)', value: 'es' },
                { label: 'French (fr)', value: 'fr' },
                { label: 'German (de)', value: 'de' },
                { label: 'Italian (it)', value: 'it' },
                { label: 'Portuguese (pt)', value: 'pt' },
                { label: 'Russian (ru)', value: 'ru' },
                { label: 'Japanese (ja)', value: 'ja' },
                { label: 'Korean (ko)', value: 'ko' },
                { label: 'Chinese (zh)', value: 'zh' },
              ]"
              @change="applyAppearance"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Logs (preview parity, preview lines 1771-1788) ─── -->
    <div v-show="activeSub === 'logs'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Logs</h3></div>
        <p class="jv-muted" style="font-size: 12.5px; margin-bottom: 14px">
          Server-side log file. Useful for debugging engine load failures, render errors, and
          inspecting auth attempts. Live tail is read from <code class="jv-mono">~/.justvoice/logs/</code>.
        </p>
        <div class="jv-row" style="gap: 8px; margin-bottom: 14px">
          <JvButton variant="secondary" size="sm" label="📂 Open log file" @click="openLogFile" />
          <JvButton variant="secondary" size="sm" label="📥 Download last 24h" @click="downloadRecentLogs" />
          <JvButton variant="secondary" size="sm" label="📋 Copy last 100 lines" @click="copyRecentLogs" />
        </div>
        <pre class="jv-code-block" style="max-height: 280px; overflow: auto; margin: 0">{{ logsPreview }}</pre>
      </div>
    </div>

    <!-- ─── Changelog + updater (task #90) ─── -->
    <div v-show="activeSub === 'changelog'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Updates</h3>
        </div>
        <div class="jv-row" style="align-items: center; gap: 14px">
          <div style="flex: 1">
            <strong>Current: v{{ updater.currentVersion }}</strong>
            <div class="jv-muted" style="font-size: 12.5px; margin-top: 4px">
              <span v-if="updater.status === 'idle'">Last checked: {{ updater.lastChecked || 'never' }}</span>
              <span v-else-if="updater.status === 'checking'">Checking for updates…</span>
              <span v-else-if="updater.status === 'available'">
                <strong>v{{ updater.availableVersion }} available</strong> · {{ updater.notes || '' }}
              </span>
              <span v-else-if="updater.status === 'downloading'">Downloading… {{ updater.progressPct }}%</span>
              <span v-else-if="updater.status === 'ready'">Ready to install — restart to apply.</span>
              <span v-else-if="updater.status === 'error'" style="color: var(--danger)">{{ updater.error }}</span>
              <span v-else-if="updater.status === 'uptodate'">You're on the latest version.</span>
            </div>
          </div>
          <JvField label="Channel" layout="block">
            <JvSelect
              v-model="updater.channel"
              width="id"
              :options="[
                { label: 'Stable', value: 'stable' },
                { label: 'Beta', value: 'beta' },
                { label: 'Nightly', value: 'nightly' },
              ]"
              @change="persistUpdaterChannel"
            />
          </JvField>
          <JvButton
            v-if="updater.status === 'idle' || updater.status === 'uptodate' || updater.status === 'error'"
            variant="secondary"
            :disabled="updater.busy"
            label="Check for updates"
            @click="checkForUpdates"
          />
          <JvButton
            v-if="updater.status === 'available'"
            variant="primary"
            :disabled="updater.busy"
            label="Download"
            @click="downloadUpdate"
          />
          <JvButton
            v-if="updater.status === 'ready'"
            variant="primary"
            label="Restart and install"
            @click="restartAndInstall"
          />
        </div>
        <p class="jv-muted" style="font-size: 11px; margin-top: 12px">
          Updates ship via the GitHub Releases feed signed with the project's update key.
          Verify the binary signature on every download (Tauri does this automatically).
        </p>
      </div>

      <div class="jv-card" style="margin-top: 16px">
        <div class="jv-card__header"><h3 class="jv-card__title">What's new in v0.1.0</h3></div>
        <ul class="jv-muted" style="margin-left: 18px; line-height: 1.7">
          <li>Multi-use Project model (audiobook / game_voicelines / podcast / custom)</li>
          <li>Per-engine venv isolation</li>
          <li>Take versioning with source-lineage</li>
          <li>HMAC-signed webhooks with exponential backoff</li>
          <li>Backup / restore via signed ZIP</li>
          <li>Audio output channels (multi-device routing)</li>
          <li>System tray with full lifecycle controls</li>
          <li>Multi-adapter import (JustWrite / CSV / SRT / Audacity labels / standard JSON)</li>
          <li>In-app help drawer with ~14 docs</li>
          <li>Multi-use first-run onboarding (5 audiences)</li>
        </ul>
      </div>
    </div>

    <!-- ─── About · placeholder. ─── -->
    <div v-show="activeSub === 'about'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">About JustVoice v0.1.0</h3></div>
        <p>JustVoice is a cross-platform open-source voice production studio for audiobook producers, game developers, podcasters, dictation users, and accessibility users. Built on Tauri 2 + Vue 3 + Python FastAPI.</p>
        <p class="jv-muted" style="font-size: 12px; margin-top: 10px">Licensed GPL-3.0-or-later. Portions ported from voicebox (MIT) and JustWrite (MIT) — see <code>NOTICE.md</code>.</p>
        <div class="jv-btn-group" style="margin-top: 14px">
          <JvButton variant="secondary" label="📋 Third-party licenses" />
          <JvButton variant="secondary" label="🐛 Report an issue" />
          <JvButton variant="secondary" label="🎬 Run welcome again" @click="$emit('reset-onboarding')" />
        </div>
      </div>
    </div>

    <!-- ─── Save ─── -->
    <div v-show="['general','mastering','generation','capture','external'].includes(activeSub)" class="jv-section">
      <JvButton variant="primary" size="lg" @click="save">Save settings</JvButton>
    </div>

  </div>
</template>

<style scoped>
/* Sub-nav — tab strip at top of Settings (matches preview HTML §13). */
.settings-subnav {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--line);
}
.settings-subnav__tab {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--ink-2);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  cursor: pointer;
  text-decoration: none;
  user-select: none;
}
.settings-subnav__tab:hover { color: var(--ink); }
.settings-subnav__tab--active {
  color: var(--ink);
  border-bottom-color: var(--accent);
  font-weight: 500;
}

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* AI features — redesign cards (nudge, role panels, ladder, usage strip) */
.ai-nudge{display:flex;gap:10px;align-items:center;padding:12px 16px;border:1px solid var(--accent-line,#b8d2c3);background:var(--accent-soft,#e8f0eb);border-radius:10px;font-size:13px}
.ai-roles{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}
.ai-role{border:1px solid var(--line);border-radius:10px;padding:14px 16px;background:var(--surface-2,#fbfaf7)}
.ai-role__name{font-weight:700;font-size:13.5px;display:flex;gap:8px;align-items:center}
.ai-role__desc{font-size:12px;color:var(--ink-2);margin:3px 0 10px}
.ai-role__sel{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ai-role__sel select{flex:1;min-width:220px}
.ai-role__hint{font-size:11px;color:var(--ink-3);margin-top:7px}
.ai-rolechip{font-size:10px;font-weight:700;letter-spacing:.04em;border-radius:999px;padding:2px 9px}
.ai-rolechip.quick{background:var(--accent-soft,#e8f0eb);color:var(--accent-ink,#2c6049);border:1px solid var(--accent-line,#b8d2c3)}
.ai-rolechip.acc{background:#f5edda;color:#b08a3e;border:1px solid #e2d2b0}
.ai-rec{font-size:10px;font-weight:700;letter-spacing:.05em;color:var(--accent-ink,#2c6049);background:var(--accent-soft,#e8f0eb);border:1px solid var(--accent-line,#b8d2c3);border-radius:999px;padding:2px 8px}
.ai-ladder{margin-top:14px;border-left:3px solid var(--accent-line,#b8d2c3);padding-left:14px}
.ai-step{display:flex;gap:10px;align-items:baseline;padding:4px 0;font-size:13px}
.ai-step .n{font-weight:700;color:var(--accent-ink,#2c6049);font-family:var(--font-mono);font-size:12px}
.ai-step .w{font-weight:600;min-width:200px}
.ai-step .who{color:var(--ink-3);font-size:12px}
.ai-usage{display:flex;gap:30px;margin-top:8px}
.ai-usage .u{font-size:13px;color:var(--ink-2)}
.ai-usage .u b{display:block;font-size:17px;color:var(--ink)}
.ai-usage .u small{color:var(--ink-3)}

/* Workspace-focus chips — same visual family as the welcome modal's
   use-case cards, compacted to a single selectable row. */
.usecase-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}
.usecase-chip {
  font: inherit;
  font-size: 12.5px;
  padding: 7px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.usecase-chip:hover { border-color: var(--accent); color: var(--ink); }
.usecase-chip--active {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
  font-weight: 600;
}
</style>
