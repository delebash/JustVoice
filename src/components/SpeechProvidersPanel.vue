<!-- SPDX-License-Identifier: MIT -->
<!--
  SpeechProvidersPanel — the external speech-provider CRUD, mounted INSIDE the
  Speech engines tab (user QC ruling 2026-08-06: the standalone "TTS providers"
  tab made no sense — one speech surface with the normal Local/Online pair,
  like the LLM providers tab one tab over). Two mounts, one save path:
    scope="selfhosted" → the Local half's "servers you run" rows
    scope="cloud"      → the Online half (cloud speech APIs)
  The store is exactly this app's own: settings.engines.external
  (ExternalEngineConfig — snake_case on the wire; the snake↔camel boundary
  lives at this panel's read + write edges). The LLM residue died with the old
  EnginesView in the parity batch.
-->
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { UiButton, confirmDialog, pushToast } from "@delebash/llm-ui";
import TtsProviderForm from "./TtsProviderForm.vue";

const props = defineProps({
  // Which half of the Local/Online pair this mount serves.
  scope: { type: String, required: true, validator: (v) => ["cloud", "selfhosted"].includes(v) },
});

const api = useApi();

const ttsProviders = ref([]);
const editingKey = ref("");  // "" | "new" | "<provider-id>"
const draft = ref(null);
const qp = ref("");

async function loadProviders() {
  const s = await api.safeRequest("/v1/settings", null);
  const list = s?.engines?.external || [];
  ttsProviders.value = list.map((p) => ({
    id: p.id,
    name: p.name || p.id,
    providerType: p.provider_type || "openai-compat",
    baseUrl: p.base_url || "",
    apiKey: "",  // never echoed back; empty == "leave existing"
    hasApiKey: !!p.api_key,
    tts_model: p.model || "",
    voices: Array.isArray(p.voices) ? [...p.voices] : [],
    response_format: p.response_format || "wav",
    self_hosted: !!p.self_hosted,
  }));
}

const visibleProviders = computed(() => {
  return ttsProviders.value.filter((p) => {
    // Each mount shows its half only — a saved row lists under whichever half
    // its self_hosted flag matches (the form's URL auto-detect can flip it).
    if ((props.scope === "selfhosted") !== !!p.self_hosted) return false;
    const blob = `${p.name} ${p.id} ${p.baseUrl || ""} ${p.tts_model || ""}`.toLowerCase();
    return !qp.value.trim() || blob.includes(qp.value.trim().toLowerCase());
  });
});

function summaryFor(p) {
  const bits = [`tts: ${p.tts_model || "—"}`];
  if (Array.isArray(p.voices) && p.voices.length) bits.push(`${p.voices.length} voices`);
  const local = /localhost|127\.0\.0\.1/.test(p.baseUrl || "");
  bits.push(p.hasApiKey ? "key set" : (local ? "no key — self-hosted, free" : "no key"));
  return bits.join(" · ");
}

function defaultDraft() {
  return {
    id: "",
    name: "",
    providerType: "openai-compat",
    baseUrl: "",
    apiKey: "",
    tts_model: "",
    voices: [],
    response_format: "wav",
    self_hosted: props.scope === "selfhosted",
  };
}
function startNewProvider() {
  draft.value = defaultDraft();
  editingKey.value = "new";
}
function startEditProvider(p) {
  draft.value = { ...p, voices: [...(p.voices || [])] };
  editingKey.value = p.id;
}
function cancelEdit() {
  editingKey.value = "";
  draft.value = null;
}

async function saveProvider(payload) {
  try {
    // Read current settings, splice/replace, PATCH back — the snake↔camel
    // translation lives only at this write boundary (and loadProviders' read).
    const current = await api.request("/v1/settings");
    const externals = [...(current?.engines?.external || [])];
    const filtered = externals.filter((e) => e.id !== payload.id);
    // Blank key on an existing entry preserves the stored one.
    let apiKey = payload.apiKey || null;
    if (!payload.apiKey) {
      const prev = externals.find((e) => e.id === payload.id);
      if (prev?.api_key) apiKey = prev.api_key;
    }
    filtered.push({
      id: payload.id,
      name: payload.name || payload.id,
      provider_type: payload.providerType === "openai" ? "openai-compat" : (payload.providerType || "openai-compat"),
      base_url: payload.baseUrl || "",
      api_key: apiKey,
      model: payload.tts_model || "",
      voices: Array.isArray(payload.voices) ? payload.voices : [],
      response_format: payload.response_format || "wav",
      self_hosted: !!payload.self_hosted,
    });
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engines: { external: filtered } }),
    });
    pushToast({ message: `${payload.name || payload.id} saved.`, kind: "success" });
    cancelEdit();
    await loadProviders();
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  }
}

async function deleteProvider() {
  if (!draft.value) return;
  const ok = await confirmDialog({
    title: `Delete ${draft.value.name || draft.value.id}?`,
    message: "The provider will be unregistered. The server itself is not affected.",
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
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

// Row-level Test — probes the server and re-colors the status dot.
const rowTest = reactive({});
async function testProviderRow(pr) {
  rowTest[pr.id] = { busy: true };
  const t0 = performance.now();
  const ms = () => Math.max(1, Math.round(performance.now() - t0));
  try {
    const r = await api.request("/v1/engines/external/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ base_url: pr.baseUrl, api_key: null }),
    });
    rowTest[pr.id] = r ? { ok: true, ms: ms() } : { ok: false, message: "probe failed" };
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
  return (pr.hasApiKey || /localhost|127\.0\.0\.1/.test(pr.baseUrl || "")) ? "" : "off";
}

// The half's words — outcomes in user language, per scope.
const COPY = {
  cloud: {
    add: "+ Add provider",
    addTitle: "Connect a speech API — no install, no downloads, no VRAM",
    note: "💳 These call external speech APIs with your keys — usage is billed by the provider, and your text leaves this machine.",
    empty: 'No speech providers yet — click "+ Add provider".',
  },
  selfhosted: {
    add: "+ Add self-hosted server",
    addTitle: "An OpenAI-compatible speech server you run yourself — localhost or LAN, free and private",
    note: "🖥️ Servers you run yourself — free, private, nothing leaves your network. JustVoice just needs the URL.",
    empty: 'No self-hosted servers yet — click "+ Add self-hosted server".',
  },
};
const words = computed(() => COPY[props.scope]);

onMounted(loadProviders);
</script>

<template>
  <div>
    <div class="ev-toprow">
      <div class="jv-searchbar">🔍 <input v-model="qp" placeholder="Search providers…"></div>
      <span class="jv-spacer" />
      <UiButton intent="primary" size="small" :label="words.add" :title="words.addTitle" @click="startNewProvider" />
    </div>

    <div class="ev-costnote">{{ words.note }}</div>

    <div v-if="editingKey === 'new' && draft" class="ev-prov">
      <div class="ev-prow">
        <span class="ev-dot off"></span>
        <div class="pmain"><span class="nm nm--placeholder">{{ scope === 'selfhosted' ? 'New self-hosted server' : 'New provider' }}</span></div>
        <span class="right">
          <UiButton intent="ghost" size="small" label="Cancel" @click="cancelEdit" />
        </span>
      </div>
      <TtsProviderForm :draft="draft" editing-key="new" @save="saveProvider" @cancel="cancelEdit" />
    </div>

    <div v-for="pr in visibleProviders" :key="pr.id" class="ev-prov" :class="{ 'ev-prov--selfhosted': pr.self_hosted }">
      <div class="ev-prow">
        <span class="ev-dot" :class="rowDotClass(pr)" :title="rowTest[pr.id]?.ok ? `Reachable · ${rowTest[pr.id].ms} ms` : (rowTest[pr.id]?.message || 'Click Test to check reachability')"></span>
        <div class="pmain">
          <span class="nm">{{ pr.name || pr.id }}</span>
          <span class="ev-caps ev-caps--inline">
            <span class="ev-cap tts">TTS</span>
            <span v-if="pr.self_hosted" class="ev-cap iso">SELF-HOSTED</span>
          </span>
          <span class="url">{{ pr.baseUrl || '—' }}</span>
          <span class="msum">{{ summaryFor(pr) }}</span>
        </div>
        <span class="right">
          <UiButton intent="ghost" size="small" label="Test" :loading="!!rowTest[pr.id]?.busy"
            title="Ping the server and re-color the status dot" @click="testProviderRow(pr)" />
          <UiButton intent="ghost" size="small" label="Edit" title="Edit inline — URL, key, model, voices"
            @click="editingKey === pr.id ? cancelEdit() : startEditProvider(pr)" />
        </span>
      </div>
      <TtsProviderForm v-if="editingKey === pr.id && draft" :draft="draft" :editing-key="pr.id"
        @save="saveProvider" @cancel="cancelEdit" @delete="deleteProvider" />
    </div>
    <p v-if="!visibleProviders.length && editingKey !== 'new'" class="jv-muted tp-empty">{{ words.empty }}</p>
  </div>
</template>
