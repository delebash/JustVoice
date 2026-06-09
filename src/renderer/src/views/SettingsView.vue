<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, computed, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvCheckbox from "../components/jv/JvCheckbox.vue";
import JvToggle from "../components/jv/JvToggle.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();
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

// ─── Keep-server-running + Network access (voicebox parity, Tauri commands) ──
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
  { id: "mastering",  label: "Mastering" },
  { id: "generation", label: "Generation" },
  { id: "capture",    label: "Capture / Dictation" },
  { id: "mcp",        label: "MCP server" },
  { id: "gpu",        label: "GPU" },
  { id: "external",   label: "External TTS" },
  { id: "appearance", label: "Appearance" },
  { id: "logs",       label: "Logs" },
  { id: "changelog",  label: "Changelog" },
  { id: "about",      label: "About" },
];
const activeSub = ref("general");

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

// ── Capture / Dictation settings (voicebox parity — preview Capture sub-tab) ──
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

// ── Mastering settings (voicebox parity — preview Mastering sub-tab) ─────
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

// ── MCP server settings + bindings (voicebox parity — preview MCP sub-tab) ──
const mcp = ref({
  enabled: true,
  transport: "http",
});
const mcpBindings = ref([]);
async function loadMcpBindings() {
  const r = await api.safeRequest("/v1/mcp/bindings", { bindings: [] });
  mcpBindings.value = (r?.bindings || []).map((b) => ({
    client_id: b.client_id,
    label: b.label,
    persona: b.persona_id || null,
    engine: b.engine || null,
    last_seen: b.last_seen_at ? new Date(b.last_seen_at).toLocaleString() : null,
  }));
}

const MCP_SNIPPETS = {
  claude_desktop: `{
  "mcpServers": {
    "justvoice": {
      "command": "justtts-server",
      "args": ["mcp"],
      "env": { "JV_CLIENT_ID": "claude_desktop_main" }
    }
  }
}`,
  claude_code: "claude mcp add justvoice -- justtts-server mcp --client-id claude_code_v1",
  stdio: `"C:\\\\Program Files\\\\JustVoice\\\\mcp-shim.exe" --endpoint http://localhost:17494/mcp --client-id custom_demo`,
};

async function copySnippet(key) {
  const text = MCP_SNIPPETS[key];
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    pushToast({ message: "Copied to clipboard.", duration: 2000 });
  } catch {
    pushToast({ message: "Couldn't access clipboard — copy manually.", kind: "warning", duration: 3000 });
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
  loadAppearance();
  loadGpuInfo();
  loadMcpBindings();
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
          Auth: set <code class="jv-mono">JUSTTTS_BEARER_TOKEN</code> on the server + pass
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
            <JvInput v-model="api.serverUrl" :spellcheck="false" @blur="reload" />
          </JvField>
          <JvField label="Bearer token (optional)" layout="block">
            <JvInput v-model="api.token" type="password" placeholder="optional" />
          </JvField>
        </div>
        <div class="jv-row" style="margin-top: 14px;">
          <JvButton variant="secondary" @click="reload">Reload from server</JvButton>
          <span class="jv-muted" style="font-size: 12px;">Re-fetches health + engines + voices against the new URL.</span>
        </div>
      </div>
    </div>

    <!-- ─── General · Lifecycle (voicebox parity — preview line 1564) ─── -->
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

    <!-- ─── General · Server bind (voicebox parity) ─── -->
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
            <JvInput v-model="settings.server.host" />
          </JvField>
          <JvField label="Port" layout="block">
            <JvInput v-model.number="settings.server.port" type="number" />
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

    <!-- ─── General · Cache ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Cache</h3>
        </div>
        <div class="settings-grid">
          <JvField label="Max memory entries" layout="block">
            <JvInput v-model.number="settings.cache.max_memory_entries" type="number" />
          </JvField>
          <JvField label="Max disk bytes per scope" layout="block">
            <JvInput v-model.number="settings.cache.max_disk_bytes_per_scope" type="number" />
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
            <JvInput v-model.number="settings.limits.text_max_chars" type="number" />
          </JvField>
          <JvField label="Chapter max lines" layout="block">
            <JvInput v-model.number="settings.limits.chapter_max_lines" type="number" />
          </JvField>
          <JvField label="Reference clip max bytes" layout="block">
            <JvInput v-model.number="settings.limits.reference_clip_max_bytes" type="number" />
          </JvField>
          <JvField label="Request body max bytes" layout="block">
            <JvInput v-model.number="settings.limits.request_body_max_bytes" type="number" />
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
            placeholder="e.g. C:\Users\you\kokoro-multi-lang-v1_0"
          />
        </JvField>
        <p class="jv-muted" style="font-size: 12px; margin-top: 8px;">Restart required after changing.</p>
      </div>
    </div>

    <!-- ─── Generation · Pipeline knobs (voicebox parity) ─── -->
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
            <JvInput v-model.number="settings.training.max_concurrent_jobs" type="number" />
          </JvField>
          <JvField label="Max samples per job" layout="block">
            <JvInput v-model.number="settings.training.max_samples_per_job" type="number" />
          </JvField>
          <JvField label="Sample loss every (steps)" layout="block">
            <JvInput v-model.number="settings.training.sample_loss_every" type="number" />
          </JvField>
          <JvField label="Default voice language (BCP-47)" layout="block">
            <JvInput v-model="settings.training.default_voice_language" />
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
              <JvInput v-model.number="settings.training.validation.min_sample_duration_secs" type="number" />
            </JvField>
            <JvField label="Max sample duration (s)" layout="block">
              <JvInput v-model.number="settings.training.validation.max_sample_duration_secs" type="number" />
            </JvField>
            <JvField label="Min SNR (dB)" layout="block">
              <JvInput v-model.number="settings.training.validation.min_snr_db" type="number" />
            </JvField>
            <JvField label="Max silence ratio" layout="block">
              <JvInput v-model.number="settings.training.validation.max_silence_ratio" type="number" />
            </JvField>
            <JvField label="Min accepted samples" layout="block">
              <JvInput v-model.number="settings.training.validation.min_accepted_samples" type="number" />
            </JvField>
          </div>
        </template>
      </div>
    </div>

    <!-- ─── External TTS · servers ─── -->
    <div v-show="activeSub === 'external'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">External TTS servers (OpenAI-compatible)</h3>
        </div>
        <p class="jv-muted" style="font-size: 12px; margin-bottom: 16px;">
          Register an external server that implements the OpenAI TTS API (<code class="jv-mono">POST /v1/audio/speech</code>) as a JustVoice engine.
          Compatible with kokoro-fastapi, openai-edge-tts, OpenAI itself, or any custom server.
        </p>

        <table v-if="settings.engines && settings.engines.external && settings.engines.external.length" class="jv-table" style="margin-bottom: 20px;">
          <thead>
            <tr>
              <th>id</th>
              <th>name</th>
              <th>base_url</th>
              <th>model</th>
              <th>voices</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(ext, idx) in settings.engines.external" :key="ext.id">
              <td><code class="jv-mono">{{ ext.id }}</code></td>
              <td><JvInput v-model="ext.name" /></td>
              <td><JvInput v-model="ext.base_url" :spellcheck="false" /></td>
              <td><JvInput v-model="ext.model" /></td>
              <td>
                <JvInput
                  :modelValue="voicesText(ext)"
                  @update:modelValue="setVoicesText(ext, $event)"
                  placeholder="comma-separated"
                />
              </td>
              <td class="jv-table__actions">
                <JvButton variant="danger-outline" size="sm" @click="removeExternalEngine(idx)">Remove</JvButton>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted" style="font-style: italic; margin-bottom: 16px;">No external engines configured.</p>

        <div class="jv-divider"></div>
        <h4 style="margin-bottom: 14px; color: var(--ink-3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em;">Add a server</h4>

        <div class="settings-grid" style="margin-bottom: 14px;">
          <div style="grid-column: 1 / -1;">
            <JvField label="Base URL" layout="block">
              <JvInput v-model="newExternal.base_url" placeholder="http://127.0.0.1:8880" :spellcheck="false" />
            </JvField>
          </div>
          <div style="grid-column: 1 / -1;">
            <JvField label="API key (optional — required for OpenAI itself)" layout="block">
              <JvInput v-model="newExternal.api_key" type="password" placeholder="leave blank for self-hosted servers" />
            </JvField>
          </div>
        </div>

        <div class="jv-row" style="margin-bottom: 14px;">
          <JvButton variant="secondary" :loading="probeBusy" :disabled="probeBusy || !newExternal.base_url" @click="testExternalConnection">
            {{ probeBusy ? "Probing…" : "Test connection" }}
          </JvButton>
          <span class="jv-muted" style="font-size: 12px;">Pings the server and lists its models + voices.</span>
        </div>

        <div
          v-if="probe"
          class="jv-banner"
          :class="probe.reachable ? '' : 'jv-banner--danger'"
          style="margin-bottom: 14px;"
        >
          <strong>{{ probe.reachable ? "Reachable" : "Unreachable" }}</strong>
          <template v-if="probe.server_hint && probe.server_hint !== 'unknown'"> · <code class="jv-mono">{{ probe.server_hint }}</code></template>
          <span v-if="probeModels.length"> · {{ probeModels.length }} model{{ probeModels.length !== 1 ? "s" : "" }}</span>
          <span v-if="probeVoices.length"> · {{ probeVoices.length }} voice{{ probeVoices.length !== 1 ? "s" : "" }}</span>
          <span v-if="probe.error"> · {{ probe.error }}</span>
        </div>

        <div class="settings-grid" style="margin-bottom: 14px;">
          <JvField label="id (e.g. external-kokoro)" layout="block">
            <JvInput v-model="newExternal.id" placeholder="external-kokoro-local" :spellcheck="false" />
          </JvField>
          <JvField label="Name" layout="block">
            <JvInput v-model="newExternal.name" placeholder="Local Kokoro FastAPI" />
          </JvField>
          <JvField label="Model" layout="block">
            <JvSelect
              v-if="probeModels.length"
              v-model="newExternal.model"
              :options="probeModelOptions"
            />
            <JvInput v-else v-model="newExternal.model" placeholder="kokoro" />
          </JvField>
          <div style="grid-column: 1 / -1;">
            <JvField label="Voices (comma-separated)" layout="block">
              <JvInput v-model="newExternal.voicesText" placeholder="af_heart, af_bella, am_michael" :spellcheck="false" />
              <p v-if="probeVoices.length" class="jv-muted" style="font-size: 11px; margin-top: 4px;">
                Discovered: <code class="jv-mono">{{ probeVoices.join(", ") }}</code>
              </p>
            </JvField>
          </div>
        </div>

        <JvButton
          variant="primary"
          :loading="addBusy"
          :disabled="addBusy || !newExternal.id || !newExternal.base_url"
          @click="addExternalEngine"
        >
          {{ addBusy ? "Adding…" : "Add external server" }}
        </JvButton>
      </div>
    </div>

    <!-- ─── External TTS · Model URL overrides ─── -->
    <div v-show="activeSub === 'external'" class="jv-section" v-if="settings.models">
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
          <JvInput v-model="newOverrideVariantId" placeholder="variant id (e.g. kokoro-multi-lang-v1_0)" style="flex: 1;" />
          <JvInput v-model="newOverrideUrl" placeholder="override URL" style="flex: 2;" />
          <JvButton variant="secondary" :disabled="!newOverrideVariantId || !newOverrideUrl" @click="addUrlOverride">Add override</JvButton>
        </div>
        <p class="jv-muted" style="font-size: 12px;">Saved with Settings.</p>
      </div>
    </div>

    <!-- ─── Mastering · placeholder until #88 lands. ─── -->
    <!-- ─── Mastering (voicebox parity, preview lines 1599-1632) ─── -->
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
            <JvInput v-model.number="mastering.lufs" type="number" step="0.5" />
          </JvField>
          <JvField label="True peak ceiling (dBFS)" layout="block">
            <JvInput v-model.number="mastering.peakDbfs" type="number" step="0.1" />
          </JvField>
          <JvField label="Noise floor (dBFS)" layout="block">
            <JvInput v-model.number="mastering.noiseFloor" type="number" step="1" />
          </JvField>
          <JvField label="Head silence (s)" layout="block">
            <JvInput v-model.number="mastering.headSilence" type="number" step="0.05" />
          </JvField>
          <JvField label="Tail silence (s)" layout="block">
            <JvInput v-model.number="mastering.tailSilence" type="number" step="0.25" />
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
    <!-- ─── Capture / Dictation (voicebox parity, preview lines 1640-1662) ─── -->
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
            <JvSelect v-model="capture.defaultPlaybackVoice" :options="[{ label: '(none — pick a profile)', value: '' }]" />
          </div>
        </div>
        <p class="jv-muted" style="font-size: 11.5px; margin-top: 8px">
          Captures live under <code class="jv-mono">~/.justvoice/captures/</code>. See the
          <a href="#captures">Captures tab</a> for the live recording list + 6-gate readiness checklist.
        </p>
      </div>
    </div>

    <!-- ─── MCP server — install snippets + tool listing (task #92) ─── -->
    <!-- ─── MCP server (voicebox parity, preview lines 1664-1715) ─── -->
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
          <JvField label="Endpoint" layout="block">
            <JvInput :value="`${api.serverUrl}/mcp`" :readonly="true" />
          </JvField>
          <JvField label="Transport" layout="block">
            <JvSelect
              v-model="mcp.transport"
              :options="[
                { label: 'HTTP + SSE', value: 'http' },
                { label: 'stdio (via shim)', value: 'stdio' },
              ]"
            />
          </JvField>
        </div>
        <div class="setting-row" style="margin-top: 14px">
          <div class="setting-row__head">
            <div>
              <div class="setting-row__title">Enabled</div>
              <div class="setting-row__desc">Toggle off to block agent connections without uninstalling.</div>
            </div>
            <JvToggle v-model="mcp.enabled" aria-label="MCP server enabled" />
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Exposed tools</h3></div>
        <div class="jv-row" style="gap: 6px; flex-wrap: wrap; margin-top: 8px">
          <span class="jv-chip-card"><strong>speak</strong> · synth + play</span>
          <span class="jv-chip-card"><strong>transcribe</strong> · WAV → text</span>
          <span class="jv-chip-card"><strong>list_captures</strong></span>
          <span class="jv-chip-card"><strong>list_profiles</strong></span>
          <span class="jv-chip-card"><strong>list_personas</strong></span>
          <span class="jv-chip-card"><strong>render_chapter</strong></span>
          <span class="jv-chip-card"><strong>refine</strong></span>
        </div>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Per-client bindings</h3></div>
        <p class="jv-muted" style="font-size: 12.5px">
          Bind a default voice and engine per client ID. Agents that send their <code class="jv-mono">JV_CLIENT_ID</code>
          get the bound voice when calling <code class="jv-mono">speak</code> without arguments.
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
                <JvButton variant="ghost" size="sm" label="Edit" />
                <JvButton variant="ghost" size="sm" label="✕" />
              </td>
            </tr>
            <tr v-if="!mcpBindings.length">
              <td colspan="6" class="jv-muted" style="text-align: center; padding: 16px">
                No clients connected yet. Bindings appear here when an agent first calls a tool with its client ID.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Install snippets</h3></div>

        <h4 style="margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2)">Claude Desktop · <code class="jv-mono">claude_desktop_config.json</code></h4>
        <div class="snippet-row">
          <pre class="jv-code-block">{
  "mcpServers": {
    "justvoice": {
      "command": "justtts-server",
      "args": ["mcp"],
      "env": { "JV_CLIENT_ID": "claude_desktop_main" }
    }
  }
}</pre>
          <JvButton variant="ghost" size="sm" label="Copy" @click="copySnippet('claude_desktop')" />
        </div>

        <h4 style="margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2)">claude-code CLI</h4>
        <div class="snippet-row">
          <pre class="jv-code-block">claude mcp add justvoice -- justtts-server mcp --client-id claude_code_v1</pre>
          <JvButton variant="ghost" size="sm" label="Copy" @click="copySnippet('claude_code')" />
        </div>

        <h4 style="margin: 14px 0 6px; font-size: 12.5px; color: var(--ink-2)">stdio shim (Unreal / custom)</h4>
        <div class="snippet-row">
          <pre class="jv-code-block">"C:\\Program Files\\JustVoice\\mcp-shim.exe" --endpoint http://localhost:17494/mcp --client-id custom_demo</pre>
          <JvButton variant="ghost" size="sm" label="Copy" @click="copySnippet('stdio')" />
        </div>
      </div>
    </div>

    <!-- ─── GPU — live info + CUDA wheel flow (task #91) ─── -->
    <!-- ─── GPU acceleration (voicebox parity, preview lines 1717-1741) ─── -->
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

    <!-- ─── Logs · placeholder. ─── -->
    <div v-show="activeSub === 'logs'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Logs</h3></div>
        <p class="jv-muted">Live log tail viewer + Open-log-file / Download-last-24h / Copy-last-100-lines actions are pending. For now use the tray menu's "📜 Open log file" action — that opens the log in your OS default editor.</p>
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
</style>
