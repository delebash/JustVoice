<!-- SPDX-License-Identifier: MIT -->
<script setup>
import { ref, computed, onActivated, onMounted, watch } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog } from "@delebash/llm-ui";
import { AppearancePanel, DataManagement, FAMILY_LABELS, LogsPanel, SettingsShell, UiButton, UiInput, UiToggle, UiField, UiCheckbox, UiTag, UiSelect, UpdatesPanel, fmtBytes, refreshRunnerModels, renderHelpMarkdown, serverUrl, useAiTasksStore } from "@delebash/llm-ui";
import { loadDoc } from "../services/helpDocs.js";
import { useOnboarding } from "../stores/onboarding.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useUiStore } from "../stores/ui.js";
import { useServerStore } from "../stores/server.js";
import { SETTINGS_SECTION_IDS } from "./settingsSections.js";
import CacheView from "./CacheView.vue";
import AudioChannelsView from "./AudioChannelsView.vue";
import WebhooksView from "./WebhooksView.vue";

// Appearance — the shared rows are the kit AppearancePanel; the Language
// options are JV app content (docgen has no i18n) so they live here.
const LOCALES = [
  { label: "English (en)", value: "en" },
  { label: "Spanish (es)", value: "es" },
  { label: "French (fr)", value: "fr" },
  { label: "German (de)", value: "de" },
  { label: "Italian (it)", value: "it" },
  { label: "Portuguese (pt)", value: "pt" },
  { label: "Russian (ru)", value: "ru" },
  { label: "Japanese (ja)", value: "ja" },
  { label: "Korean (ko)", value: "ko" },
  { label: "Chinese (zh)", value: "zh" },
];

const api = useApi();
const ui = useUiStore();
const projectsStore = useProjectsStore();
const personasStore = usePersonasStore();
const activeProjectStore = useActiveProject();
const tasks = useAiTasksStore();

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
  // Hash-free reload — same reason as factoryReset: a fragment would
  // outrank the first-run kind picker in resolveInitialTab.
  window.location.replace(window.location.pathname + window.location.search);
}

// (Tier 3 — the factory reset — is the kit DataManagement's Reset now, under
// Settings → Backups over the shared POST /v1/data/reset; the bespoke button
// and /v1/admin/factory-reset died in the parity batch, 2026-08-06.)

// Tier 2: wipe every project (and optionally the personas) — the
// workflow-testing reset. Voices, engines, providers, lexicons survive.
const deletePersonasToo = ref(false);
const wipeBusy = ref(false);
async function deleteAllProjects() {
  // DATA-LOSS GUARD: never wipe while anything is actually running.
  // runningCount counts connecting/streaming only — a finished task
  // lingering on screen does not block the wipe (same as the fork's
  // status === "running" check).
  if (tasks.runningCount > 0) {
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
    activeProjectStore.clear();
    // Reload the shared stores so every view reflects the wipe.
    await projectsStore.reload();
    if (deletePersonasToo.value) await personasStore.reload();
    pushToast({
      kind: failed ? "error" : "success",
      title: failed ? `Wipe finished with ${failed} failures` : "All projects deleted",
      description: "Fresh slate — walk the workflow from ＋ New project.",
    });
  } finally {
    wipeBusy.value = false;
  }
}

// ── Backups — the kit DataManagement over the shared /v1/data router
// (parity batch 2026-08-06; the bespoke /v1/backup + /v1/restore died with
// backup_api). The include-audio choice rides the kit's per-app options seam:
// unchecked, the backup request carries ?exclude=generations,captures and the
// shared route skips those dirs. (The old UI sent `include_audio` to a route
// that read `include_generations` — the toggle was silently ignored.)
const BACKUP_OPTIONS = [{
  id: "audio",
  label: "Include generated audio",
  sub: "renders and dictation recordings — bigger, but a complete machine migration",
  excludes: ["generations", "captures"],
  default: true,
}];
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
  engines:   { kokoro: { model_dir_override: "" }, default_tts_engine: "kokoro" },
  app:       { primary_use_case: "unset", secondary_use_cases: [], onboarding_shown: false },
  generation:{ max_chunk_chars: 800, crossfade_ms: 50, normalize_audio: true, autoplay_on_generate: true },
});
const serverReachable = ref(false);

// (The TTS-engine catalog loader left with the default-engine dropdown —
// parity batch 2026-08-06; the default is a Speech-engines row action now.)

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
      // The network-access toggle is derived from the server's bind host
      // (the source of truth), not a separate client-side flag.
      allowNetworkAccess.value = settings.value?.server?.host === "0.0.0.0";
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
// ONE source of truth: the server store (persisted in its `justvoice-server`
// doc, default FALSE — the family headless ruling 2026-08-04). The view's own
// `justvoice:keep_server_running` key + `{ enabled }` invoke died 2026-08-05:
// the Rust command's arg is `keepRunning`, so that invoke NEVER worked — the
// store's setter is the call that does.
const serverStore = useServerStore();
const keepServerRunning = computed({
  get: () => serverStore.keepServerRunningOnClose,
  set: (v) => serverStore.setKeepServerRunningOnClose(v),
});
const allowNetworkAccess = ref(false);
// allowNetworkAccess is derived from settings.server.host in refresh().

function onKeepServerRunningChange() {
  pushToast({
    message: keepServerRunning.value
      ? "Server will stay running when the window closes."
      : "Server will quit when the window closes.",
    duration: 4000,
  });
}

async function onNetworkAccessChange() {
  // Flip the bind host immediately (the source of truth); restart required.
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

// ── Sections (family parity batch 2026-08-06): the canon shared sections in
// their fixed relative order — words from the FAMILY CONTRACT, enforced by
// construction — then JV's own lane. "Changelog" died for the canon "Updates".
// The ORDER lives in settingsSections.js so the canon contract test asserts
// exactly what renders (slice 11); labels stay here.
const SEC = FAMILY_LABELS.settingsSections;
const APP_SECTION_LABELS = {
  general: "General",
  mastering: "Mastering",
  generation: "Generation",
  capture: "Capture / Dictation",
  mcp: "MCP server",
  gpu: "GPU",
  cache: "Cache",
  channels: "Channels",
  webhooks: "Webhooks",
};
const SUBS = SETTINGS_SECTION_IDS.map((id) => ({
  id,
  label: SEC[id] || APP_SECTION_LABELS[id] || id,
}));
const activeSub = ref("general");

// Deep links (#cache/#channels/#webhooks redirect here) hand the target
// sub-tab over via sessionStorage — ids stay stable; the retired "changelog"
// id keeps landing on the section that replaced it. Consumed on EVERY entry:
// this view is kept alive (App.vue), so a setup-time read fires once per
// session and later deep links would land on whatever sub was left open.
onActivated(() => {
  try {
    const sub = window.sessionStorage?.getItem("jv.settings.sub");
    if (sub) {
      window.sessionStorage.removeItem("jv.settings.sub");
      activeSub.value = sub === "changelog" ? "updates" : sub;
    }
  } catch { /* ignore */ }
});

// ── GPU info (task #91) ──────────────────────────────────────────────
const gpuInfo = ref(null);
async function loadGpuInfo() {
  const r = await api.safeRequest("/v1/system/info", null);
  if (!r) return;
  const runtimes = Object.entries(r.runtimes || {})
    .filter(([, ok]) => ok)
    .map(([k]) => k);
  const active = runtimes.find((r2) => ["cuda", "metal", "coreml", "directml", "rocm", "mlx"].includes(r2)) || "cpu";
  gpuInfo.value = { active_backend: active, runtimes, gpus: r.gpus || [] };
}

// VRAM math for GpuInfoCard. used/total come from /v1/system/info; both null means
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

// ── Updates — release notes for the kit UpdatesPanel (JW's pattern: the
// changelog source + renderer stay app-side, the presentation is shared).
// Loaded lazily the first time the Updates section opens.
const changelogHtml = ref("");
watch(activeSub, async (a) => {
  if (a === "updates" && !changelogHtml.value) {
    changelogHtml.value = renderHelpMarkdown((await loadDoc("whats-new")) || "");
  }
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

// ── Appearance ───────────────────────────────────────────────────────
// The appearance config + theming now live in the shared engine via the ui
// store (ui.appearance + ui.setAppearance, @delebash/llm-ui applyAppearance).
// The Settings controls below bind straight to ui.appearance.

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

// ── Storage (family section): data root via the shell + disk usage ──
const storageRoot = ref(null); // { root, default, portable } from the shell
const isDesktop = ref(false);
const relocating = ref(false);
const storageErr = ref("");
const diskUsage = ref(null);
const diskBusy = ref("");
const diskErr = ref("");

async function loadStorageRoot() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    storageRoot.value = await invoke("storage_get_root");
    isDesktop.value = true;
  } catch {
    isDesktop.value = false;
  }
}
async function loadDiskUsage() {
  diskUsage.value = await api.safeRequest("/v1/disk/usage", null);
}
// Loading state = an em-dash per row; a real 0 formats as "0 MB" (the kit's
// fmtBytes returns "" for 0). fmtBytes stays the ONE source for the number.
function diskSize(n) {
  if (diskUsage.value == null) return "—";
  return fmtBytes(n) || "0 MB";
}
async function changeFolder() {
  storageErr.value = "";
  const { open } = await import("@tauri-apps/plugin-dialog");
  const picked = await open({ directory: true, title: "Choose a data folder",
    defaultPath: storageRoot.value?.root || undefined });
  if (!picked) return;
  const yes = await confirmDialog({
    title: "Move all app data?",
    message: `Everything JustVoice saves — projects, voices, the database, the AI engine and models, and logs — moves to ${picked}. The app restarts when the move finishes.`,
    confirmLabel: "Move & restart",
  });
  if (!yes) return;
  relocating.value = true;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("storage_relocate", { newRoot: picked });
    window.location.reload();
  } catch (e) {
    storageErr.value = String(e || "Move failed.");
    relocating.value = false;
  }
}
async function clearModelsCache() {
  const size = fmtBytes(diskUsage.value?.modelsCache) || "0 MB";
  const yes = await confirmDialog({
    title: "Clear downloaded models?",
    message: `This frees ${size} of downloaded model files. Your models stay in the catalog and re-download on demand.`,
    confirmLabel: "Clear models cache",
  });
  if (!yes) return;
  diskBusy.value = "models";
  diskErr.value = "";
  try {
    const res = await api.request("/v1/llm-runner/models-cache/clear", { method: "POST" });
    if (res?.ok === false) {
      diskErr.value = res.detail === "unload models first"
        ? "A model is loaded — unload it first (AI Settings → Unload), then try again."
        : res.detail || "Couldn't clear the models cache.";
    }
  } catch {
    diskErr.value = "Couldn't clear the models cache.";
  } finally {
    diskBusy.value = "";
    await loadDiskUsage();
    // Re-stat the shared catalog so cleared models flip to "Download".
    refreshRunnerModels();
  }
}
async function clearSpawnLogs() {
  diskBusy.value = "spawn";
  diskErr.value = "";
  try {
    await api.request("/v1/llm-runner/spawn-logs/clear", { method: "POST" });
  } catch {
    diskErr.value = "Couldn't clear the engine logs.";
  } finally {
    diskBusy.value = "";
    await loadDiskUsage();
  }
}

// ── Server (family section): headless access + bearer tokens ────────
const auth = ref({ tokens: [], requireForLoopback: false });
const tokenDraft = ref("");
const headlessUrl = computed(() => serverUrl("") || api.serverUrl);
async function loadAuth() {
  const a = await api.safeRequest("/v1/server-auth", null);
  if (a) auth.value = a;
}
async function saveAuth(patch) {
  const next = { ...auth.value, ...patch };
  try {
    auth.value = await api.request("/v1/server-auth", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
  } catch (e) {
    pushToast({ message: `Could not save: ${e?.message || e}`, kind: "error" });
  }
}
function addToken() {
  const t = tokenDraft.value.trim();
  if (!t) return;
  tokenDraft.value = "";
  saveAuth({ tokens: [...auth.value.tokens, t] });
}
function dropToken(t) {
  saveAuth({ tokens: auth.value.tokens.filter((x) => x !== t) });
}

// ── Log viewer (preview parity — preview Logs sub-tab) ──────────────
// "Open log file" opens the on-disk rotating log (user decision
// 2026-06-13, W4 revision: the ring dies with the process — a crash or
// boot hang is exactly when logs are needed, so the server now writes
// {data_dir}/logs/justvoice.log and exposes data_dir in system info).
async function openLogFile() {
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  if (!tauri?.shell?.open) {
    pushToast({ message: "Open in OS file explorer requires the desktop app.", kind: "warning" });
    return;
  }
  const r = await api.safeRequest("/v1/system/info", null);
  const logPath = r?.data_dir ? `${r.data_dir}/logs/justvoice.log` : null;
  if (!logPath) {
    pushToast({ message: "Couldn't locate the log file — check the server is running.", kind: "error" });
    return;
  }
  try {
    await tauri.shell.open(logPath);
  } catch (e) {
    pushToast({ message: `Couldn't open log: ${e?.message || e}`, kind: "error" });
  }
}
onMounted(() => {
  loadGpuInfo();
  loadMcpBindings();
  loadAuth();
  loadStorageRoot();
  loadDiskUsage();
});
</script>

<template>
  <div>
    <p v-if="!serverReachable" class="jv-banner jv-banner--warn">
      <strong>Server offline.</strong> Showing default values; changes won't persist until the server is reachable.
      <span class="jv-spacer" />
      <a href="#" @click.prevent="reload">Retry</a>
    </p>

    <!-- The family Settings chrome (kit SettingsShell — JW's donor strip; the
         hand-rolled jv-subnav died with the parity batch). -->
    <SettingsShell :sections="SUBS" v-model="activeSub">

    <!-- ─── General · Workspace focus ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Workspace focus</h3></div>
        <p class="jv-muted jv-hint">
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
        <div class="jv-inline-row jv-mt12">
          <UiButton
            intent="secondary"
            size="small"
            label="⚙ Run Quick Setup again"
            title="Re-probe hardware, pick engines to install, reconnect local LLM/STT helpers"
            @click="rerunQuickSetup"
          />
          <span class="jv-muted jv-note-xs">Hardware probe → recommended engines → helper connections.</span>
        </div>
      </div>
    </div>

    <!-- ─── General · Testing / danger zone ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Testing / danger zone</h3></div>
        <p class="jv-muted jv-hint">
          For walking the workflows from scratch. Tier 1 is safe; tier 2 deletes content.
          The full factory reset lives under Backups (Reset JustVoice).
        </p>
        <div class="jv-inline-row jv-mt10">
          <UiButton intent="secondary" size="small" label="↺ Reset UI state" title="Forget active project + re-arm welcome and Quick Setup. No data touched. Reloads." @click="resetUiState" />
          <span class="jv-muted jv-note-xs">fresh-install behavior, zero data loss</span>
        </div>
        <div class="jv-inline-row jv-mt10">
          <UiButton intent="danger-outline" size="small" label="🗑 Delete ALL projects…" :disabled="wipeBusy" @click="deleteAllProjects" />
          <UiCheckbox v-model="deletePersonasToo">also delete all personas</UiCheckbox>
        </div>
      </div>
    </div>

    <!-- ─── Cache / Channels / Webhooks (moved from the sidebar's Advanced lane) ─── -->
    <div v-show="activeSub === 'cache'" class="jv-section"><CacheView /></div>
    <div v-show="activeSub === 'channels'" class="jv-section"><AudioChannelsView /></div>
    <div v-show="activeSub === 'webhooks'" class="jv-section"><WebhooksView /></div>

    <!-- ─── Server · API reference (task #96; re-homed from General in the
         parity batch — it documents the server's HTTP surface + auth) ─── -->
    <div v-show="activeSub === 'server'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">API reference</h3></div>
        <p class="jv-muted jv-hint">
          JustVoice exposes a stable HTTP API. Use these endpoints from scripts, CI, or external tools.
          The full OpenAPI spec is at <a :href="api.serverUrl + '/docs'" target="_blank"><code class="jv-mono">{{ api.serverUrl }}/docs</code></a>.
        </p>
        <table class="jv-table jv-mt12">
          <thead><tr><th>Method</th><th>Path</th><th>Purpose</th></tr></thead>
          <tbody>
            <tr><td><code class="jv-mono">POST</code></td><td><code class="jv-mono">/v1/generate</code></td><td>Single-line synthesis → audio/wav. Auto-chunks long text.</td></tr>
            <tr><td><code class="jv-mono">POST</code></td><td><code class="jv-mono">/v1/render_chapter</code></td><td>Multi-line chapter render with mastering + cache.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/voices</code></td><td>List preset + stored voices.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/personas</code></td><td>List personas (voice binding, personality, effects chain, lexicon).</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/engines</code></td><td>Engine catalog + load state.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/engines/capabilities</code></td><td>Per-engine knob + inline-tag manifest (drives UI gating).</td></tr>
            <tr><td><code class="jv-mono">POST</code></td><td><code class="jv-mono">/v1/engines/{id}/load</code></td><td>Load an engine into memory.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/lexicons</code></td><td>Pronunciation dictionaries.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/takes/recent</code></td><td>Last N generations across the whole DB.</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/settings</code></td><td>Operator-tunable settings (mastering target, paths, cache, etc.).</td></tr>
            <tr><td><code class="jv-mono">GET</code></td><td><code class="jv-mono">/v1/health</code></td><td>Server status + version.</td></tr>
          </tbody>
        </table>
        <p class="jv-muted jv-note-xs jv-mt12">
          Auth: set <code class="jv-mono">JUSTVOICE_BEARER_TOKEN</code> on the server + pass
          <code class="jv-mono">Authorization: Bearer &lt;token&gt;</code>. Loopback (127.0.0.1)
          requests skip auth by default.
        </p>
      </div>
    </div>

    <div v-show="activeSub === 'server'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header jv-inline-row">
          <h3 class="jv-card__title jv-m0">Connection</h3>
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
        <p class="jv-muted jv-note jv-mb14">Where this UI sends API requests. Persists in localStorage; not part of server settings.</p>
        <div class="settings-grid">
          <UiField label="Server URL" layout="block">
            <UiInput v-model="api.serverUrl" :spellcheck="false" width="url" @blur="reload" />
          </UiField>
          <UiField label="Bearer token (optional)" layout="block">
            <UiInput v-model="api.token" type="password" placeholder="optional" width="url" />
          </UiField>
        </div>
        <div class="jv-row jv-mt14">
          <UiButton intent="secondary" @click="reload">Reload from server</UiButton>
          <span class="jv-muted jv-note">Re-fetches health + engines + voices against the new URL.</span>
        </div>
      </div>
    </div>

    <!-- ─── Server · Headless access + bearer tokens (family section) ─── -->
    <div v-show="activeSub === 'server'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Headless access</h3></div>
        <p class="jv-muted jv-hint">
          The server hosts the UI itself — <code class="jv-mono">justvoice-server serve</code>
          plus a browser gives the full app without the desktop shell.
        </p>
        <div class="settings-grid jv-mt8">
          <UiField label="URL" layout="block"><span class="jv-mono jv-note">{{ headlessUrl }}</span></UiField>
        </div>
      </div>

      <div class="jv-card jv-mt16">
        <div class="jv-card__header"><h3 class="jv-card__title">Access tokens</h3></div>
        <p class="jv-muted jv-hint">
          Off by default. Add a token to require an
          <code class="jv-mono">Authorization: Bearer</code> header on every
          <code class="jv-mono">/v1</code> API call — for when you run the server
          exposed beyond this machine. Thin clients paste the token under Connection.
        </p>
        <table class="jv-table jv-w560" v-if="auth.tokens.length">
          <tbody>
            <tr v-for="t in auth.tokens" :key="t">
              <td class="jv-mono jv-note">{{ t }}</td>
              <td class="jv-w90"><UiButton intent="ghost" size="small" label="Remove" @click="dropToken(t)" /></td>
            </tr>
          </tbody>
        </table>
        <div class="jv-row jv-mt10 jv-gap8">
          <UiInput v-model="tokenDraft" width="name" placeholder="new token…" @keydown.enter="addToken" />
          <UiButton intent="secondary" label="Add token" :disabled="!tokenDraft.trim()" @click="addToken" />
        </div>
        <div class="jv-row jv-row--mid jv-mt12">
          <UiToggle :model-value="auth.requireForLoopback"
            @update:model-value="(v) => saveAuth({ requireForLoopback: v })" aria-label="Require a token on localhost" />
          <span class="jv-hint">Require a token even on localhost</span>
        </div>
      </div>
    </div>

    <!-- ─── Server · Lifecycle (the family headless/tray ruling) ─── -->
    <div v-show="activeSub === 'server'" class="jv-section">
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
            <UiToggle v-model="keepServerRunning" @change="onKeepServerRunningChange" aria-label="Keep server running" />
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
            <UiToggle v-model="allowNetworkAccess" @change="onNetworkAccessChange" aria-label="Allow network access" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Storage · Data location + disk usage (family section) ─── -->
    <div v-show="activeSub === 'storage'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Data location</h3></div>
        <p class="jv-muted jv-hint">
          One folder holds everything JustVoice saves — projects, voices, the database,
          the AI engine and models, and logs. Delete the folder, delete it all.
        </p>
        <div class="settings-grid jv-mt10">
          <UiField label="Folder" layout="block">
            <span class="jv-mono jv-note">{{ isDesktop ? (storageRoot?.root || "—") : "headless — set by JUSTVOICE_DATA_DIR" }}</span>
          </UiField>
          <UiField v-if="isDesktop" label="Type" layout="block">
            <span class="jv-hint">{{ storageRoot?.portable ? "Portable — beside the app" : "User folder" }}</span>
          </UiField>
        </div>
        <div class="jv-row jv-mt12" v-if="isDesktop">
          <UiButton intent="secondary"
            :label="relocating ? 'Moving your data — the app will restart…' : 'Change folder…'"
            :disabled="relocating" @click="changeFolder" />
        </div>
        <p v-else class="jv-muted jv-note jv-tight-top">Changing the folder is available in the desktop app.</p>
        <p v-if="storageErr" class="jv-mono jv-danger-note">{{ storageErr }}</p>
      </div>

      <div class="jv-card jv-mt16">
        <div class="jv-card__header"><h3 class="jv-card__title">Disk usage</h3></div>
        <p class="jv-muted jv-hint">Where the data folder's space goes — and what can be reclaimed.</p>
        <table class="jv-table jv-w560 jv-mt10">
          <tbody>
            <tr><td>Models cache</td><td>{{ diskSize(diskUsage?.modelsCache) }}</td>
              <td class="jv-w130"><UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                :label="diskBusy === 'models' ? 'Clearing…' : 'Clear'" @click="clearModelsCache" /></td></tr>
            <tr><td>Engine spawn logs</td><td>{{ diskSize(diskUsage?.spawnLogs) }}</td>
              <td><UiButton intent="secondary" size="small" :disabled="!!diskBusy"
                :label="diskBusy === 'spawn' ? 'Clearing…' : 'Clear'" @click="clearSpawnLogs" /></td></tr>
            <tr><td>Engine builds</td><td>{{ diskSize(diskUsage?.engineBuilds) }}</td><td /></tr>
            <tr><td>Database</td><td>{{ diskSize(diskUsage?.database) }}</td><td /></tr>
            <tr><td>Server logs</td><td>{{ diskSize(diskUsage?.appLogs) }}</td><td /></tr>
            <tr><td><b>Total</b></td><td><b>{{ diskSize(diskUsage?.total) }}</b></td><td /></tr>
            <tr><td>Free disk space</td><td>{{ diskSize(diskUsage?.diskFree) }}</td><td /></tr>
          </tbody>
        </table>
        <p v-if="diskErr" class="jv-mono jv-danger-note">{{ diskErr }}</p>
      </div>
    </div>

    <!-- ─── Backups — the family surface (kit DataManagement over /v1/data;
         backup/restore left Storage per the canon: Storage = data location +
         disk only). The include-audio choice is the kit's per-app options
         seam — decision ① — covering renders AND dictation recordings. ─── -->
    <div v-show="activeSub === 'backups'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">{{ SEC.backups }}</h3></div>
        <DataManagement app-name="JustVoice" :options="BACKUP_OPTIONS" />
      </div>
    </div>

    <div v-show="activeSub === 'server'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Server bind</h3>
        </div>
        <p class="jv-muted jv-hint jv-mb14">
          Low-level network settings. Most users don't need to touch these — the defaults
          (127.0.0.1:17494, docs enabled) work for local single-machine use. Restart required
          after changing.
        </p>
        <div class="settings-grid">
          <UiField label="Host" layout="block">
            <UiInput v-model="settings.server.host" width="id" />
          </UiField>
          <UiField label="Port" layout="block">
            <UiInput v-model.number="settings.server.port" type="number" width="token" />
          </UiField>
        </div>
        <div class="setting-row jv-mt14">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Interactive API docs</div>
              <div class="setting-row__desc">
                Enable Swagger UI at <code class="jv-mono">/docs</code> and ReDoc at
                <code class="jv-mono">/redoc</code>. Useful for development and external
                integrations. Disable in production deployments behind public networks.
              </div>
            </div>
            <UiToggle v-model="settings.server.docs_enabled" aria-label="Enable API docs" />
          </div>
        </div>
      </div>
    </div>

    <!-- Appearance card removed from General — lives in its own sub-tab
         per preview line 1547 (showSubsection('appearance')). Theme +
         Density + Accent + Language all editable from Settings →
         Appearance sub-tab. -->


    <!-- (The General · Updates card died in the parity batch — the ONE Updates
         surface is the kit UpdatesPanel under the Updates section below.) -->

    <!-- ─── Cache · Server-side cache tunables (re-homed from General in the
         parity batch — they sit beside the cache browser they govern) ─── -->
    <div v-show="activeSub === 'cache'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Cache</h3>
        </div>
        <div class="settings-grid">
          <UiField label="Max memory entries" layout="block">
            <UiInput v-model.number="settings.cache.max_memory_entries" type="number" width="token" />
          </UiField>
          <UiField label="Max disk bytes per scope" layout="block">
            <UiInput v-model.number="settings.cache.max_disk_bytes_per_scope" type="number" width="token" />
          </UiField>
        </div>
        <div class="jv-mt14">
          <UiCheckbox v-model="settings.cache.enabled" label="Cache enabled" />
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
          <UiField label="Text max chars" layout="block">
            <UiInput v-model.number="settings.limits.text_max_chars" type="number" width="token" />
          </UiField>
          <UiField label="Chapter max lines" layout="block">
            <UiInput v-model.number="settings.limits.chapter_max_lines" type="number" width="token" />
          </UiField>
          <UiField label="Reference clip max bytes" layout="block">
            <UiInput v-model.number="settings.limits.reference_clip_max_bytes" type="number" width="token" />
          </UiField>
          <UiField label="Request body max bytes" layout="block">
            <UiInput v-model.number="settings.limits.request_body_max_bytes" type="number" width="token" />
          </UiField>
        </div>
      </div>
    </div>

    <!-- ─── GPU · Local model paths ─── -->
    <div v-show="activeSub === 'gpu'" class="jv-section" v-if="settings.engines">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Local model paths</h3>
        </div>
        <UiField label="Kokoro model directory (absolute path)" layout="block">
          <UiInput
            v-model="settings.engines.kokoro.model_dir_override"
            :spellcheck="false"
            width="path"
            placeholder="e.g. C:\Users\you\kokoro-multi-lang-v1_0"
          />
        </UiField>
        <p class="jv-muted jv-note jv-mt8">Restart required after changing.</p>
      </div>
    </div>

    <!-- ─── Generation · Pipeline knobs (preview parity) ─── -->
    <div v-show="activeSub === 'generation'" class="jv-section" v-if="settings.generation">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Generation pipeline</h3>
        </div>
        <p class="jv-muted jv-hint jv-mb18">
          How the chunked TTS pipeline handles long text. Short text (≤ chunk limit) takes the
          single-shot fast path with zero overhead — the chunker only kicks in when needed.
        </p>

        <!-- (The Default TTS engine dropdown died in the parity batch,
             2026-08-06 — "Set as default" is a row action on the AI console's
             Speech engines tab now; one source.) -->

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
            <UiToggle v-model="settings.generation.normalize_audio" @change="saveDebounced" aria-label="Normalize audio" />
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
            <UiToggle v-model="settings.generation.autoplay_on_generate" @change="saveDebounced" aria-label="Autoplay on generate" />
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
          <UiField label="Max concurrent jobs" layout="block">
            <UiInput v-model.number="settings.training.max_concurrent_jobs" type="number" width="token" />
          </UiField>
          <UiField label="Max samples per job" layout="block">
            <UiInput v-model.number="settings.training.max_samples_per_job" type="number" width="token" />
          </UiField>
          <UiField label="Sample loss every (steps)" layout="block">
            <UiInput v-model.number="settings.training.sample_loss_every" type="number" width="token" />
          </UiField>
          <UiField label="Default voice language (BCP-47)" layout="block">
            <UiInput v-model="settings.training.default_voice_language" width="token" />
          </UiField>
        </div>
        <div class="jv-mt14">
          <UiCheckbox
            v-model="settings.training.enabled"
            label="Training enabled (master gate — off makes POST /v1/train return 501)"
          />
        </div>

        <template v-if="settings.training.validation">
          <div class="jv-divider"></div>
          <h4 class="jv-eyebrow-h">Validation thresholds</h4>
          <div class="settings-grid">
            <UiField label="Min sample duration (s)" layout="block">
              <UiInput v-model.number="settings.training.validation.min_sample_duration_secs" type="number" width="token" />
            </UiField>
            <UiField label="Max sample duration (s)" layout="block">
              <UiInput v-model.number="settings.training.validation.max_sample_duration_secs" type="number" width="token" />
            </UiField>
            <UiField label="Min SNR (dB)" layout="block">
              <UiInput v-model.number="settings.training.validation.min_snr_db" type="number" width="token" />
            </UiField>
            <UiField label="Max silence ratio" layout="block">
              <UiInput v-model.number="settings.training.validation.max_silence_ratio" type="number" width="token" />
            </UiField>
            <UiField label="Min accepted samples" layout="block">
              <UiInput v-model.number="settings.training.validation.min_accepted_samples" type="number" width="token" />
            </UiField>
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
        <p class="jv-muted jv-note jv-mb16">
          Override download URLs per variant. Useful when upstream artifacts move or when mirroring to an internal CDN.
          Keyed by variant id (e.g. <code class="jv-mono">kokoro-multi-lang-v1_0</code>).
        </p>

        <table v-if="urlOverrideKeys.length" class="jv-table jv-mb16">
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
              <td><UiInput v-model="settings.models.url_overrides[key]" :spellcheck="false" /></td>
              <td class="jv-table__actions">
                <UiButton intent="danger-outline" size="small" @click="removeUrlOverride(key)">Remove</UiButton>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted jv-italic jv-mb14">No URL overrides set.</p>

        <div class="jv-row jv-mb8">
          <UiInput v-model="newOverrideVariantId" placeholder="variant id (e.g. kokoro-multi-lang-v1_0)" width="name" />
          <UiInput v-model="newOverrideUrl" placeholder="override URL" width="url" />
          <UiButton intent="secondary" :disabled="!newOverrideVariantId || !newOverrideUrl" @click="addUrlOverride">Add override</UiButton>
        </div>
        <p class="jv-muted jv-note">Saved with Settings.</p>
      </div>
    </div>

    <!-- ─── Mastering · placeholder until #88 lands. ─── -->
    <!-- ─── Mastering (preview parity, preview lines 1599-1632) ─── -->
    <div v-show="activeSub === 'mastering'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header jv-inline-row">
          <!-- "Target", not "preset" — CONCEPTS §7: three things were
               called preset; loudness/peak/format specs are TARGETS
               (ACX target, podcast target). "Preset" stays with the
               render-preset library. -->
          <h3 class="jv-card__title jv-m0">Active target</h3>
          <span class="jv-spacer" />
          <UiTag intent="success">{{ masterPresetLabel }}</UiTag>
        </div>
        <p class="jv-muted jv-hint jv-mb14">
          The active mastering target applies to every chapter render + standalone Audio Tools
          master. Switch targets by clicking a chip. Custom lets you override individual knobs
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

        <div class="settings-grid jv-mt16">
          <UiField label="Loudness target (LUFS)" layout="block">
            <UiInput v-model.number="mastering.lufs" type="number" step="0.5" width="token" />
          </UiField>
          <UiField label="True peak ceiling (dBFS)" layout="block">
            <UiInput v-model.number="mastering.peakDbfs" type="number" step="0.1" width="token" />
          </UiField>
          <UiField label="Noise floor (dBFS)" layout="block">
            <UiInput v-model.number="mastering.noiseFloor" type="number" step="1" width="token" />
          </UiField>
          <UiField label="Head silence (s)" layout="block">
            <UiInput v-model.number="mastering.headSilence" type="number" step="0.05" width="token" />
          </UiField>
          <UiField label="Tail silence (s)" layout="block">
            <UiInput v-model.number="mastering.tailSilence" type="number" step="0.25" width="token" />
          </UiField>
        </div>

        <div class="setting-row jv-mt14">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Apply effects pre-master</div>
              <div class="setting-row__desc">
                Apply the profile's effects chain (reverb, EQ, compressor) BEFORE the mastering
                pass. Recommended ON — mastering then normalizes the effects-shaped signal.
                OFF skips effects entirely for this render.
              </div>
            </div>
            <UiToggle v-model="mastering.applyEffectsPreMaster" aria-label="Apply effects pre-master" />
          </div>
        </div>
      </div>
    </div>

    <!-- ─── Capture / Dictation · placeholder. ─── -->
    <!-- ─── Capture / Dictation (preview parity, preview lines 1640-1662) ─── -->
    <div v-show="activeSub === 'capture'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Hotkeys (ChordPicker)</h3></div>
        <p class="jv-muted jv-hint jv-mb14">
          Press-and-hold or toggle hotkeys for dictation. ChordPicker is a live keyboard combo editor —
          press the chord, peak-set is captured, Esc/Tab pass through.
        </p>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Push-to-talk</div>
              <div class="setting-row__desc">Hold the chord to record. Release to stop + transcribe.</div>
            </div>
            <div class="jv-row jv-gap6">
              <span class="kbd">⌥</span><span class="kbd">⌘</span><span class="kbd">V</span>
              <UiButton intent="ghost" size="small" label="Edit" />
              <UiButton intent="ghost" size="small" label="Clear" />
            </div>
          </div>
        </div>
        <div class="setting-row">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Toggle-to-talk</div>
              <div class="setting-row__desc">Press once to start, press again to stop. Useful for long passages.</div>
            </div>
            <div class="jv-row jv-gap6">
              <span class="kbd">⌥</span><span class="kbd">⌘</span><span class="kbd">D</span>
              <UiButton intent="ghost" size="small" label="Edit" />
              <UiButton intent="ghost" size="small" label="Clear" />
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
            <UiSelect
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
              <div class="setting-row__desc">
                Cleans transcribed text — the model comes from
                <a href="#/ai">AI Settings → Routing by feature</a> (the "Dictation
                cleanup" row), like every AI feature.
              </div>
            </div>
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
            <UiSelect
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
            <UiSelect
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
            <UiToggle v-model="capture.allowAutoPaste" aria-label="Allow auto-paste" />
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
            <UiSelect v-model="capture.defaultPlaybackVoice" :options="[{ label: '(none — pick a profile)', value: '' }]" width="name" />
          </div>
        </div>
        <p class="jv-muted jv-note-xs jv-mt8">
          Captures live under <code class="jv-mono">~/.justvoice/captures/</code>. See the
          <a href="#captures">Captures tab</a> for the live recording list + 6-gate readiness checklist.
        </p>
      </div>
    </div>

    <!-- ─── MCP server — install snippets + tool listing (task #92) ─── -->
    <!-- ─── MCP server (preview parity, preview lines 1664-1715) ─── -->
    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header jv-inline-row">
          <h3 class="jv-card__title jv-m0">MCP server</h3>
          <span class="jv-spacer" />
          <UiTag intent="success">on</UiTag>
        </div>
        <p class="jv-muted jv-hint jv-mb12">
          Exposes JustVoice tools to AI agents (Claude Desktop, claude-code, Unreal Editor, custom scripts).
          The server runs in-process on the JustVoice port; agents connect via the URL below.
        </p>
        <div class="settings-grid">
          <UiField label="Endpoint (Streamable HTTP)" layout="block">
            <UiInput :value="`${api.serverUrl}/mcp`" :readonly="true" width="url" title="Agents connect directly to this URL — no separate process" />
          </UiField>
          <UiField label="Default voice" layout="block">
            <div class="jv-inline-row jv-gap8">
              <UiInput
                v-model="mcpDefaultVoice"
                width="name"
                placeholder="voice id, e.g. af_heart"
                title="Used when an agent calls justvoice.speak with no voice/persona and no per-client binding"
              />
              <UiButton intent="secondary" size="small" label="Save" @click="saveMcpDefaultVoice" />
            </div>
          </UiField>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Exposed tools</h3></div>
        <div class="jv-row jv-gap6 jv-wrap jv-mt8">
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
        <p class="jv-muted jv-hint">
          Bind a default persona per client ID. Agents that send the
          <code class="jv-mono">X-JustVoice-Client-Id</code> header get the bound persona's voice
          when calling <code class="jv-mono">justvoice.speak</code> without arguments.
        </p>
        <table class="jv-table jv-mt12">
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
                <UiButton intent="ghost" size="small" label="Edit" title="Load this binding into the form below" @click="editBinding(b)" />
                <UiButton intent="ghost" size="small" label="✕" title="Remove this binding" @click="deleteBinding(b)" />
              </td>
            </tr>
            <tr v-if="!mcpBindings.length">
              <td colspan="6" class="jv-muted jv-center-pad">
                No clients yet. Rows appear when an agent first calls a tool with its client ID — or add one below.
              </td>
            </tr>
          </tbody>
        </table>
        <div class="jv-row jv-row--mid jv-gap8 jv-mt12 jv-wrap">
          <UiInput v-model="bindingDraft.client_id" width="name" placeholder="client id (e.g. claude-code)" title="The X-JustVoice-Client-Id the agent sends" />
          <UiInput v-model="bindingDraft.label" width="name" placeholder="label (optional)" />
          <UiSelect
            v-model="bindingDraft.persona_id"
            width="name"
            :options="[{ label: '(no persona)', value: '' }, ...mcpPersonas.map(p => ({ label: p.name, value: p.id }))]"
          />
          <UiButton intent="primary" size="small" label="Save binding" :disabled="!bindingDraft.client_id.trim()" @click="saveBinding" />
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Install snippets</h3></div>

        <h4 class="jv-subhead">Claude Desktop / any HTTP MCP client · <code class="jv-mono">mcp config JSON</code></h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{{ MCP_SNIPPETS.claude_desktop }}</pre>
          <UiButton intent="ghost" size="small" label="Copy" title="Copy the JSON config" @click="copySnippet('claude_desktop')" />
        </div>

        <h4 class="jv-subhead">claude-code CLI</h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{{ MCP_SNIPPETS.claude_code }}</pre>
          <UiButton intent="ghost" size="small" label="Copy" title="Copy the one-liner" @click="copySnippet('claude_code')" />
        </div>

        <h4 class="jv-subhead">curl smoke test</h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{{ MCP_SNIPPETS.curl }}</pre>
          <UiButton intent="ghost" size="small" label="Copy" title="Copy the curl command" @click="copySnippet('curl')" />
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
              <div class="jv-col-end">
                <strong>{{ gpuVramUsedGB }} / {{ gpuVramTotalGB }} GB</strong>
                <div class="jv-meter">
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
              <UiTag intent="success" v-if="gpuInfo.active_backend && gpuInfo.active_backend !== 'cpu'">● in use</UiTag>
              <UiTag intent="ghost" v-else>idle</UiTag>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-show="activeSub === 'gpu'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">CUDA wheel download flow</h3></div>
        <p class="jv-muted jv-hint">
          PyTorch engines ship with the CPU wheel by default. Switching to CUDA reinstalls torch in
          the engine's venv with the matching CUDA build (~2 GB download). Per-engine — Chatterbox
          on CUDA and Kokoro on CPU is fine. Phases: <code class="jv-mono">idle → stopping engines →
          waiting for download → ready</code>.
        </p>
        <div class="jv-row jv-mt14">
          <UiTag intent="success">phase: ready</UiTag>
          <span class="jv-muted jv-note">torch 2.4.1+cu124 · 2.1 GB</span>
          <span class="jv-spacer" />
          <UiButton intent="secondary" size="small" label="Switch to CPU-only" />
          <UiButton intent="secondary" size="small" label="Switch to ROCm (AMD)" />
          <UiButton intent="secondary" size="small" label="Re-download" />
        </div>
        <p class="jv-muted jv-note-xs jv-mt10">
          The switch is per-engine. Use the Engines tab → engine row → "Install with CUDA" to enable
          per engine. On Apple Silicon, MPS / CoreML is auto-detected — no switch required.
        </p>
      </div>
    </div>

    <!-- ─── Appearance — Theme + accent (task #93) ─── -->
    <div v-show="activeSub === 'appearance'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Appearance</h3></div>
        <p class="jv-muted jv-hint jv-mb6">
          Visual and locale preferences. Saved to this server (renderer prefs), so they follow you to any client.
        </p>

        <AppearancePanel
          :appearance="ui.appearance"
          :accent-chroma="0.08"
          accent-note="Default 166° = forest green."
          :locales="LOCALES"
          locale-desc="UI language. Engine output language is configured per-voice in the Profile. Full i18next wiring lands with task #97 — the picker persists your preference now and the locale will apply once translations ship."
          @patch="(p) => ui.setAppearance(p)"
        />
      </div>
    </div>

    <!-- ─── Logs (preview parity, preview lines 1771-1788) ─── -->
    <div v-show="activeSub === 'logs'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Logs</h3></div>
        <p class="jv-muted jv-hint jv-mb14">
          Server-side log file. Useful for debugging engine load failures, render errors, and
          inspecting auth attempts. Live tail is read from <code class="jv-mono">~/.justvoice/logs/</code>.
        </p>
        <div class="jv-row jv-gap8 jv-mb14">
          <UiButton intent="secondary" size="small" label="📂 Open log file" @click="openLogFile" />
        </div>
        <!-- The kit panel over the shared /v1/logs routes: live ring tail +
             per-day files + download (replaced JV's private ring preview). -->
        <LogsPanel />
      </div>
    </div>

    <!-- ─── Updates — the kit UpdatesPanel is THE surface (no-valve commitment;
         the "Changelog" name died with the parity batch). Release notes come
         from docs/whats-new.md (JW's pattern: source + renderer app-side,
         presentation shared); JV's Tauri auto-updater rides the panel's
         designed #actions slot. ─── -->
    <div v-show="activeSub === 'updates'" class="jv-section">
      <div class="jv-card">
        <UpdatesPanel :app-version="updater.currentVersion" :changelog-html="changelogHtml">
          <template #actions>
            <div class="jv-row jv-updater-actions">
              <span class="jv-muted jv-updater-status">
                <span v-if="updater.status === 'idle'">Last checked: {{ updater.lastChecked || 'never' }}</span>
                <span v-else-if="updater.status === 'checking'">Checking for updates…</span>
                <span v-else-if="updater.status === 'available'">
                  <strong>v{{ updater.availableVersion }} available</strong> · {{ updater.notes || '' }}
                </span>
                <span v-else-if="updater.status === 'downloading'">Downloading… {{ updater.progressPct }}%</span>
                <span v-else-if="updater.status === 'ready'">Ready to install — restart to apply.</span>
                <span v-else-if="updater.status === 'error'" class="jv-updater-error">{{ updater.error }}</span>
                <span v-else-if="updater.status === 'uptodate'">You're on the latest version.</span>
              </span>
              <UiSelect
                v-model="updater.channel"
                width="id"
                :options="[
                  { label: 'Stable', value: 'stable' },
                  { label: 'Beta', value: 'beta' },
                  { label: 'Nightly', value: 'nightly' },
                ]"
                @change="persistUpdaterChannel"
              />
              <UiButton
                v-if="updater.status === 'idle' || updater.status === 'uptodate' || updater.status === 'error'"
                intent="secondary"
                size="small"
                :disabled="updater.busy"
                label="Check for updates"
                @click="checkForUpdates"
              />
              <UiButton
                v-if="updater.status === 'available'"
                intent="primary"
                size="small"
                :disabled="updater.busy"
                label="Download"
                @click="downloadUpdate"
              />
              <UiButton
                v-if="updater.status === 'ready'"
                intent="primary"
                size="small"
                label="Restart and install"
                @click="restartAndInstall"
              />
            </div>
          </template>
        </UpdatesPanel>
        <p class="jv-muted jv-updater-note">
          Updates ship via the GitHub Releases feed signed with the project's update key.
          Verify the binary signature on every download (Tauri does this automatically).
        </p>
      </div>
    </div>

    <!-- ─── About · placeholder. ─── -->
    <div v-show="activeSub === 'about'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">About JustVoice v0.1.0</h3></div>
        <p>JustVoice is a cross-platform open-source voice production studio for audiobook producers, game developers, podcasters, dictation users, and accessibility users. Built on Tauri 2 + Vue 3 + Python FastAPI.</p>
        <p class="jv-muted jv-note jv-mt10">Licensed MIT. Portions ported from voicebox (MIT) and JustWrite (MIT) — see <code>NOTICE.md</code>.</p>
        <div class="jv-btn-group jv-mt14">
          <UiButton intent="secondary" label="📋 Third-party licenses" />
          <UiButton intent="secondary" label="🐛 Report an issue" />
          <UiButton intent="secondary" label="🎬 Run welcome again" @click="$emit('reset-onboarding')" />
        </div>
      </div>
    </div>

    <!-- ─── Save ─── -->
    <div v-show="['general','mastering','generation','capture','external','cache'].includes(activeSub)" class="jv-section">
      <UiButton intent="primary" size="lg" @click="save">Save settings</UiButton>
    </div>

    </SettingsShell>
  </div>
</template>

<style scoped>
/* ── Inline-style purge (parity batch 2026-08-06): the repeated inline literals
   became these utilities; values stay the exact ones the view used. ── */
.jv-hint { font-size: 12.5px; }
.jv-note { font-size: 12px; }
.jv-note-xs { font-size: 11.5px; }
.jv-note-2xs { font-size: 11px; }
.jv-subhead { margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2); }
.jv-danger-note { color: var(--danger); font-size: 12px; }
.jv-inline-row { display: flex; align-items: center; gap: 10px; }
.jv-row--mid { align-items: center; gap: 10px; }
.jv-tight-top { margin: 8px 0 0; }
.jv-m0 { margin: 0; }
.jv-mt8 { margin-top: 8px; }
.jv-mt10 { margin-top: 10px; }
.jv-mt12 { margin-top: 12px; }
.jv-mt14 { margin-top: 14px; }
.jv-mt16 { margin-top: 16px; }
.jv-mb8 { margin-bottom: 8px; }
.jv-mb14 { margin-bottom: 14px; }
.jv-mb16 { margin-bottom: 16px; }
.jv-mb18 { margin-bottom: 18px; }
.jv-gap6 { gap: 6px; }
.jv-gap8 { gap: 8px; }
.jv-w560 { max-width: 560px; }
.jv-w90 { width: 90px; }
.jv-w130 { width: 130px; }
.jv-center-pad { text-align: center; padding: 16px; }
.jv-eyebrow-h { margin-bottom: 12px; color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.jv-italic { font-style: italic; }
.jv-wrap { flex-wrap: wrap; }
.jv-col-end { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.jv-meter { width: 200px; height: 6px; background: var(--surface-2); border-radius: 3px; overflow: hidden; }
.jv-mb6 { margin-bottom: 6px; }
.jv-mb12 { margin-bottom: 12px; }

/* The updater controls riding the kit UpdatesPanel's #actions slot. */
.jv-updater-actions { align-items: center; gap: 8px; flex-wrap: wrap; }
.jv-updater-status { font-size: 12.5px; }
.jv-updater-error { color: var(--danger); }
.jv-updater-note { font-size: 11px; margin-top: 12px; }

.settings-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}


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
