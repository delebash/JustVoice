<script setup>
import { ref, computed, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

const api = useApi();
const settings = ref(null);

// External engines edited inline against settings.engines.external (the
// PUT-saved config list); /v1/engines is the live catalog but isn't where
// the operator-visible config lives.

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

// ─── Core settings load + save ──────────────────────────────────────────
async function refresh() {
  settings.value = await api.request("/v1/settings");
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
</script>

<template>
  <div v-if="settings">
    <!-- ─── Connection — UI-side endpoint + auth (moved here from the colophon footer) ─── -->
    <section class="block stack">
      <h3>Connection</h3>
      <p class="endnote">Where this UI sends API requests. Persists in localStorage; not part of server settings.</p>
      <div class="grid">
        <label>
          <span>Server URL</span>
          <input v-model="api.serverUrl" spellcheck="false" @blur="reload" />
        </label>
        <label>
          <span>Bearer token (optional)</span>
          <input v-model="api.token" type="password" placeholder="optional" />
        </label>
      </div>
      <div class="row">
        <button @click="reload">Reload from server</button>
        <span class="endnote">Re-fetches health + engines + voices against the new URL.</span>
      </div>
    </section>

    <!-- ─── Server (saved on the server itself; restart-sensitive) ─── -->
    <section class="block">
      <h3>Server</h3>
      <div class="grid">
        <label><span>Host (restart required)</span><input v-model="settings.server.host" /></label>
        <label><span>Port (restart required)</span><input type="number" v-model.number="settings.server.port" /></label>
        <label class="check"><input type="checkbox" v-model="settings.server.docs_enabled" /><span>Docs enabled (Swagger + Redoc)</span></label>
      </div>
    </section>

    <!-- ─── Cache ─── -->
    <section class="block">
      <h3>Cache</h3>
      <div class="grid">
        <label><span>Max memory entries</span><input type="number" v-model.number="settings.cache.max_memory_entries" /></label>
        <label><span>Max disk bytes per scope</span><input type="number" v-model.number="settings.cache.max_disk_bytes_per_scope" /></label>
        <label class="check"><input type="checkbox" v-model="settings.cache.enabled" /><span>Cache enabled</span></label>
      </div>
    </section>

    <!-- ─── Limits ─── -->
    <section class="block">
      <h3>Limits</h3>
      <div class="grid">
        <label><span>Text max chars</span><input type="number" v-model.number="settings.limits.text_max_chars" /></label>
        <label><span>Chapter max lines</span><input type="number" v-model.number="settings.limits.chapter_max_lines" /></label>
        <label><span>Reference clip max bytes</span><input type="number" v-model.number="settings.limits.reference_clip_max_bytes" /></label>
        <label><span>Request body max bytes</span><input type="number" v-model.number="settings.limits.request_body_max_bytes" /></label>
      </div>
    </section>

    <!-- ─── Local model paths ─── -->
    <section class="block" v-if="settings.engines">
      <h3>Local model paths</h3>
      <label>
        <span>Kokoro model directory (absolute path)</span>
        <input v-model="settings.engines.kokoro.model_dir_override" spellcheck="false" placeholder="e.g. C:\Users\you\kokoro-multi-lang-v1_0" />
      </label>
      <p class="endnote">Restart required after changing.</p>
    </section>

    <!-- ─── Training ─── -->
    <section class="block" v-if="settings.training">
      <h3>Training</h3>
      <div class="grid">
        <label><span>Max concurrent jobs</span><input type="number" v-model.number="settings.training.max_concurrent_jobs" /></label>
        <label><span>Max samples per job</span><input type="number" v-model.number="settings.training.max_samples_per_job" /></label>
        <label><span>Sample loss every (steps)</span><input type="number" v-model.number="settings.training.sample_loss_every" /></label>
        <label><span>Default voice language (BCP-47)</span><input type="text" v-model="settings.training.default_voice_language" /></label>
      </div>
      <label class="check" style="margin-top: 14px;">
        <input type="checkbox" v-model="settings.training.enabled" />
        <span>Training enabled (master gate — off makes POST /v1/train return 501)</span>
      </label>

      <template v-if="settings.training.validation">
        <h4 class="subsection-heading">Validation thresholds</h4>
        <div class="grid">
          <label><span>Min sample duration (s)</span><input type="number" step="0.1" v-model.number="settings.training.validation.min_sample_duration_secs" /></label>
          <label><span>Max sample duration (s)</span><input type="number" step="0.1" v-model.number="settings.training.validation.max_sample_duration_secs" /></label>
          <label><span>Min SNR (dB)</span><input type="number" step="0.5" v-model.number="settings.training.validation.min_snr_db" /></label>
          <label><span>Max silence ratio</span><input type="number" step="0.05" v-model.number="settings.training.validation.max_silence_ratio" /></label>
          <label><span>Min accepted samples</span><input type="number" v-model.number="settings.training.validation.min_accepted_samples" /></label>
        </div>
      </template>
    </section>

    <!-- ─── External TTS servers ─── -->
    <section class="block">
      <h3>External TTS servers (OpenAI-compatible)</h3>
      <p class="endnote" style="margin-bottom: 14px;">
        Register an external server that implements the OpenAI TTS API (<span class="mono">POST /v1/audio/speech</span>) as a JustTTS engine.
        Compatible with kokoro-fastapi, openai-edge-tts, OpenAI itself, or any custom server.
      </p>

      <table v-if="settings.engines && settings.engines.external && settings.engines.external.length">
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
            <td><span class="mono">{{ ext.id }}</span></td>
            <td><input type="text" v-model="ext.name" /></td>
            <td><input type="text" v-model="ext.base_url" spellcheck="false" /></td>
            <td><input type="text" v-model="ext.model" /></td>
            <td>
              <input
                type="text"
                :value="voicesText(ext)"
                @change="setVoicesText(ext, $event.target.value)"
                placeholder="comma-separated" />
            </td>
            <td><button class="bare danger" @click="removeExternalEngine(idx)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">No external engines configured.</p>

      <h4 class="subsection-heading">Add a server</h4>
      <div class="grid">
        <label style="grid-column: 1 / -1;"><span>Base URL</span><input type="text" v-model="newExternal.base_url" placeholder="http://127.0.0.1:8880" spellcheck="false" /></label>
        <label style="grid-column: 1 / -1;"><span>API key (optional — required for OpenAI itself)</span><input type="password" v-model="newExternal.api_key" placeholder="leave blank for self-hosted servers" /></label>
      </div>
      <div class="row" style="margin-top: 12px; align-items: center; gap: 12px;">
        <button class="secondary" @click="testExternalConnection" :disabled="probeBusy || !newExternal.base_url">
          {{ probeBusy ? "Probing…" : "Test connection" }}
        </button>
        <span class="endnote">Pings the server and lists its models + voices.</span>
      </div>

      <div v-if="probe" class="probe-result" :class="probe.reachable ? 'probe-ok' : 'probe-fail'" style="margin-top: 12px;">
        <strong>{{ probe.reachable ? "Reachable" : "Unreachable" }}</strong>
        <template v-if="probe.server_hint && probe.server_hint !== 'unknown'"> · <span class="mono">{{ probe.server_hint }}</span></template>
        <span v-if="probeModels.length"> · {{ probeModels.length }} model{{ probeModels.length !== 1 ? "s" : "" }}</span>
        <span v-if="probeVoices.length"> · {{ probeVoices.length }} voice{{ probeVoices.length !== 1 ? "s" : "" }}</span>
        <span v-if="probe.error" style="color: var(--danger, #b00020);"> · {{ probe.error }}</span>
      </div>

      <div class="grid" style="margin-top: 12px;">
        <label><span>id (e.g. <span class="mono">external-kokoro</span>)</span><input type="text" v-model="newExternal.id" placeholder="external-kokoro-local" spellcheck="false" /></label>
        <label><span>Name</span><input type="text" v-model="newExternal.name" placeholder="Local Kokoro FastAPI" /></label>
        <label>
          <span>Model</span>
          <select v-if="probeModels.length" v-model="newExternal.model">
            <option v-for="m in probeModels" :key="m" :value="m">{{ m }}</option>
          </select>
          <input v-else type="text" v-model="newExternal.model" placeholder="kokoro" />
        </label>
        <label style="grid-column: 1 / -1;">
          <span>Voices (comma-separated)</span>
          <input type="text" v-model="newExternal.voicesText" placeholder="af_heart, af_bella, am_michael" spellcheck="false" />
          <p v-if="probeVoices.length" class="endnote" style="margin-top: 4px;">
            Discovered: <span class="mono">{{ probeVoices.join(", ") }}</span>
          </p>
        </label>
      </div>
      <div style="margin-top: 12px;">
        <button class="primary" @click="addExternalEngine" :disabled="addBusy || !newExternal.id || !newExternal.base_url">
          {{ addBusy ? "Adding…" : "Add external server" }}
        </button>
      </div>
    </section>

    <!-- ─── Model URL overrides ─── -->
    <section class="block" v-if="settings.models">
      <h3>Model URL overrides</h3>
      <p class="endnote" style="margin-bottom: 14px;">
        Override download URLs per variant. Useful when upstream artifacts move or when mirroring to an internal CDN.
        Keyed by variant id (e.g. <span class="mono">kokoro-multi-lang-v1_0</span>).
      </p>

      <table v-if="urlOverrideKeys.length">
        <thead>
          <tr>
            <th>Variant id</th>
            <th>Override URL</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="key in urlOverrideKeys" :key="key">
            <td><span class="mono">{{ key }}</span></td>
            <td><input type="text" v-model="settings.models.url_overrides[key]" spellcheck="false" /></td>
            <td><button class="bare danger" @click="removeUrlOverride(key)">Remove</button></td>
          </tr>
        </tbody>
      </table>
      <p v-else class="endnote">No URL overrides set.</p>

      <div class="row" style="margin-top: 12px; gap: 8px;">
        <input type="text" v-model="newOverrideVariantId" placeholder="variant id (e.g. kokoro-multi-lang-v1_0)" style="flex: 1;" />
        <input type="text" v-model="newOverrideUrl" placeholder="override URL" style="flex: 2;" />
        <button class="secondary" @click="addUrlOverride" :disabled="!newOverrideVariantId || !newOverrideUrl">Add override</button>
      </div>
      <p class="endnote">Saved with Settings.</p>
    </section>

    <!-- ─── Save ─── -->
    <section class="block">
      <button class="primary" @click="save">Save settings</button>
    </section>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
label { display: block; }
label.check { display: flex; align-items: center; gap: 8px; }
label > span { display: block; font-size: 11px; text-transform: uppercase; color: var(--muted); margin-bottom: 4px; }
.subsection-heading { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin-top: 20px; margin-bottom: 12px; }
.row { display: flex; flex-wrap: wrap; }
.probe-result { font-size: 13px; padding: 8px 12px; border-radius: 6px; }
.probe-ok { background: color-mix(in srgb, var(--accent, #1a6b3c) 10%, transparent); border: 1px solid color-mix(in srgb, var(--accent, #1a6b3c) 30%, transparent); }
.probe-fail { background: color-mix(in srgb, var(--danger, #b00020) 10%, transparent); border: 1px solid color-mix(in srgb, var(--danger, #b00020) 30%, transparent); }
</style>
