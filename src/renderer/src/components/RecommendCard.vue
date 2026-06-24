<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  RecommendCard — "Recommended for your machine", the contextual
  replacement for the first-run QuickSetup wizard (user decision
  2026-06-12: work first, recommend in context). Shows at most two
  rows and only while they're actionable:

    · a GPU-worthy engine that isn't installed yet (→ Engines)
    · a detected-but-unconnected local LLM (one-click Connect)

  Dismiss persists; the full wizard stays available from Settings →
  General → Run Quick Setup.
-->
<script setup>
import { ref, computed, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { readPref, writePref } from "../services/prefs.js";
import { UiButton } from "@delebash/llm-ui";

const api = useApi();

const dismissed = ref(readPref("recommendDismissed", false) === true);
const gpu = ref(null);
const engines = ref([]);
const detectedLocal = ref([]);
const connecting = ref("");

onMounted(async () => {
  if (dismissed.value) return;
  try {
    const sys = await api.request("/v1/system/info");
    gpu.value = sys?.gpus?.[0] || null;
  } catch { /* card just shows less */ }
  try {
    const r = await api.request("/v1/engines");
    engines.value = r?.engines || [];
  } catch { /* ignore */ }
  try {
    const r = await api.request("/v1/llm-providers/detect-local");
    detectedLocal.value = (r?.detected || []).filter((d) => !d.alreadyRegistered);
  } catch { /* ignore */ }
});

// One engine suggestion: the cloning workhorse, only when a GPU exists
// and it isn't installed yet. CPU-only machines are already best served
// by the default Kokoro, so no row (no fake upsell).
const engineSuggestion = computed(() => {
  if (!gpu.value) return null;
  const cb = engines.value.find((e) => e.id === "chatterbox");
  if (cb?.status !== "not_installed") return null;
  return cb;
});

const visible = computed(() =>
  !dismissed.value && (engineSuggestion.value || detectedLocal.value.length),
);

function dismiss() {
  dismissed.value = true;
  writePref("recommendDismissed", true);
}

async function connect(d) {
  connecting.value = d.baseUrl;
  try {
    await api.request("/v1/llm-providers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: d.providerType === "ollama" ? "ollama-local" : "lmstudio-local",
        name: d.name,
        providerType: d.providerType,
        baseUrl: d.baseUrl,
        apiKey: null,
        defaultModel: d.models?.[0] || "",
      }),
    });
    detectedLocal.value = detectedLocal.value.filter((x) => x.baseUrl !== d.baseUrl);
    pushToast({ kind: "success", title: `${d.name} connected`, description: "Script attribution, Smart-assign, and Compose are now live." });
  } catch (e) {
    pushToast({ kind: "error", title: "Connect failed", description: String(e?.message ?? e) });
  } finally {
    connecting.value = "";
  }
}

function openEngines() {
  window.location.hash = "#engines";
}
</script>

<template>
  <div v-if="visible" class="jv-card recommend">
    <div class="recommend__head">
      <span class="recommend__eyebrow">Recommended for your machine</span>
      <span class="jv-spacer" />
      <button type="button" class="recommend__x" title="Dismiss — re-run any time from Settings → Run Quick Setup" @click="dismiss">✕</button>
    </div>
    <div v-if="engineSuggestion" class="recommend__row">
      <span class="recommend__ic">🎙️</span>
      <span class="recommend__text">
        <strong>{{ gpu.name }}</strong> can run <strong>{{ engineSuggestion.name }}</strong> —
        voice cloning + paralinguistic tags. The default engine works today; this one sounds better.
      </span>
      <UiButton intent="secondary" size="small" label="Open Engines ➜" title="Install from the Engines page — size and progress shown there" @click="openEngines" />
    </div>
    <div v-for="d in detectedLocal" :key="d.baseUrl" class="recommend__row">
      <span class="recommend__ic">🧠</span>
      <span class="recommend__text">
        <strong>{{ d.name }} detected</strong>
        <template v-if="d.models?.length"> · {{ d.models[0] }}{{ d.models.length > 1 ? ` +${d.models.length - 1}` : "" }}</template>
        — connect it and Script attributes speakers automatically.
      </span>
      <UiButton intent="secondary" size="small" label="Connect" :loading="connecting === d.baseUrl" @click="connect(d)" />
    </div>
  </div>
</template>

<style scoped>
.recommend { padding: 12px 16px; margin: 0 0 12px; }
.recommend__head { display: flex; align-items: center; margin-bottom: 6px; }
.recommend__eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--ink-3);
}
.recommend__x {
  appearance: none; border: 0; background: transparent;
  color: var(--ink-3); cursor: pointer; font-size: 12px; padding: 2px 6px;
}
.recommend__x:hover { color: var(--ink); }
.recommend__row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.recommend__ic { flex: none; }
.recommend__text { flex: 1; min-width: 0; font-size: 12.5px; }
</style>
