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
  generation:{ max_chunk_chars: 800, crossfade_ms: 50 },
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
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Connection</h3>
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

    <!-- ─── General · Server ─── -->
    <div v-show="activeSub === 'general'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Server</h3>
        </div>
        <div class="settings-grid">
          <JvField label="Host (restart required)" layout="block">
            <JvInput v-model="settings.server.host" />
          </JvField>
          <JvField label="Port (restart required)" layout="block">
            <JvInput v-model.number="settings.server.port" type="number" />
          </JvField>
        </div>
        <div style="margin-top: 14px;">
          <JvCheckbox v-model="settings.server.docs_enabled" label="Docs enabled (Swagger + Redoc)" />
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
          Register an external server that implements the OpenAI TTS API (<code class="jv-mono">POST /v1/audio/speech</code>) as a JustTTS engine.
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
    <div v-show="activeSub === 'mastering'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Mastering</h3></div>
        <p class="jv-muted">Per-preset mastering knobs (ACX -20 LUFS / -3.5 dB peak / -60 dB noise floor, iAudio, Podcast, YouTube, Custom) land with task <code>#88</code>. The active preset still applies on every render — see <code>POST /v1/settings/mastering</code>.</p>
      </div>
    </div>

    <!-- ─── Capture / Dictation · placeholder. ─── -->
    <div v-show="activeSub === 'capture'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Capture / Dictation</h3></div>
        <p class="jv-muted">ChordPicker for push-to-talk + toggle hotkeys, Whisper STT model + LLM refinement model + capture language + auto-paste + 6-gate readiness checklist + speaker-correction-memory clear-all panel land with tasks <code>#84</code> and <code>#94</code>. See <a href="#captures">Captures tab</a> for the live readiness view.</p>
      </div>
    </div>

    <!-- ─── MCP server · placeholder. ─── -->
    <div v-show="activeSub === 'mcp'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">MCP server</h3></div>
        <p class="jv-muted">Per-client bindings table + Claude Desktop / claude-code / stdio install snippets + exposed tools list land with task <code>#92</code>.</p>
      </div>
    </div>

    <!-- ─── GPU · placeholder, augments Local model paths above. ─── -->
    <div v-show="activeSub === 'gpu'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">GpuInfoCard + CUDA wheel flow</h3></div>
        <p class="jv-muted">Live GPU backend (CUDA / MPS / Metal / XPU / DirectML / ROCm) + VRAM total/used + compute capability + HSA override + Force-CPU-on-Mac toggle + CUDA wheel switch flow (idle → stopping → waiting → ready) land with task <code>#91</code>. For now the Engines tab shows the basics.</p>
      </div>
    </div>

    <!-- ─── Appearance · placeholder. ─── -->
    <div v-show="activeSub === 'appearance'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Appearance</h3></div>
        <p class="jv-muted">Theme (Light / Dark / Follow system) + Accent hue slider + Density (Compact / Default / Spacious) + Language locale picker land with task <code>#93</code> (paired with task <code>#97</code> for the i18next wiring).</p>
      </div>
    </div>

    <!-- ─── Logs · placeholder. ─── -->
    <div v-show="activeSub === 'logs'" class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Logs</h3></div>
        <p class="jv-muted">Live log tail viewer + Open-log-file / Download-last-24h / Copy-last-100-lines actions are pending. For now use the tray menu's "📜 Open log file" action — that opens the log in your OS default editor.</p>
      </div>
    </div>

    <!-- ─── Changelog · placeholder. ─── -->
    <div v-show="activeSub === 'changelog'" class="jv-section">
      <div class="jv-card">
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
