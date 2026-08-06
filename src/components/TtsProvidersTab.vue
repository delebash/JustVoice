<!-- SPDX-License-Identifier: MIT -->
<!--
  TTS providers — the external speech-provider CRUD, a HOST TAB inside the AI
  console since the family parity batch (2026-08-06). This is the old
  EnginesView's ONLINE half with the LLM residue gone: LLM providers live on
  the LLM providers tab (the kit surface), so the dual-kind capability
  checkboxes, the /v1/llm-providers merging, and the old ProviderForm died.
  What remains is exactly this app's own store: settings.engines.external
  (ExternalEngineConfig — snake_case on the wire; the snake↔camel boundary
  lives at this tab's read + write edges, as before).
-->
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { UiButton, confirmDialog, pushToast } from "@delebash/llm-ui";
import TtsProviderForm from "./TtsProviderForm.vue";

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
    self_hosted: false,
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

onMounted(loadProviders);
</script>

<template>
  <div>
    <div class="ev-toprow">
      <div class="jv-searchbar">🔍 <input v-model="qp" placeholder="Search providers…"></div>
      <span class="jv-spacer" />
      <UiButton intent="primary" size="small" label="+ Add provider" title="Connect a speech API — no install, no downloads, no VRAM" @click="startNewProvider" />
    </div>

    <div class="ev-costnote">
      💳 These call external speech APIs with your keys — usage is billed by the provider, and your text leaves this machine.
      Self-hosted servers (localhost/LAN) are free and private. Local engines live on the Speech engines tab.
    </div>

    <div v-if="editingKey === 'new' && draft" class="ev-prov">
      <div class="ev-prow">
        <span class="ev-dot off"></span>
        <div class="pmain"><span class="nm nm--placeholder">New provider</span></div>
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
    <p v-if="!visibleProviders.length && editingKey !== 'new'" class="jv-muted tp-empty">No speech providers yet — click "+ Add provider".</p>
  </div>
</template>
