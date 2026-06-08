<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";

const api = useApi();
const settings = ref(null);

async function refresh() {
  settings.value = await api.request("/v1/settings");
}

async function save() {
  try {
    const resp = await api.request("/v1/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings.value),
    });
    settings.value = resp.settings || settings.value;
    pushToast({ message: "Settings saved.", duration: 3000 });
  } catch (e) {
    pushToast({ message: `Save failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
</script>

<template>
  <div v-if="settings">
    <section class="block">
      <h3>Server</h3>
      <div class="grid">
        <label><span>Host (restart required)</span><input v-model="settings.server.host" /></label>
        <label><span>Port (restart required)</span><input type="number" v-model.number="settings.server.port" /></label>
        <label class="check"><input type="checkbox" v-model="settings.server.docs_enabled" /><span>Docs enabled (Swagger + Redoc)</span></label>
      </div>
    </section>

    <section class="block">
      <h3>Cache</h3>
      <div class="grid">
        <label><span>Max memory entries</span><input type="number" v-model.number="settings.cache.max_memory_entries" /></label>
        <label><span>Max disk bytes per scope</span><input type="number" v-model.number="settings.cache.max_disk_bytes_per_scope" /></label>
        <label class="check"><input type="checkbox" v-model="settings.cache.enabled" /><span>Cache enabled</span></label>
      </div>
    </section>

    <section class="block">
      <h3>Limits</h3>
      <div class="grid">
        <label><span>Text max chars</span><input type="number" v-model.number="settings.limits.text_max_chars" /></label>
        <label><span>Chapter max lines</span><input type="number" v-model.number="settings.limits.chapter_max_lines" /></label>
        <label><span>Reference clip max bytes</span><input type="number" v-model.number="settings.limits.reference_clip_max_bytes" /></label>
        <label><span>Request body max bytes</span><input type="number" v-model.number="settings.limits.request_body_max_bytes" /></label>
      </div>
    </section>

    <section class="block" v-if="settings.engines">
      <h3>Local model paths</h3>
      <label>
        <span>Kokoro model directory (absolute path)</span>
        <input v-model="settings.engines.kokoro.model_dir_override" spellcheck="false" placeholder="e.g. C:\Users\you\kokoro-multi-lang-v1_0" />
      </label>
      <p class="endnote">Restart required after changing.</p>
    </section>

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
input[type="text"], input[type="number"], input:not([type]) { width: 100%; padding: 6px 10px; border: 1px solid var(--border-strong); background: var(--surface); color: var(--ink); font-size: 13px; }
button.primary { background: var(--ink); color: var(--surface); border: 1px solid var(--ink); padding: 8px 16px; cursor: pointer; font-size: 13px; }
.endnote { font-size: 11px; color: var(--muted); margin-top: 6px; }
</style>
