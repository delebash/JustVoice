<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  RenderLabView — A/B matrix harness for voice parameter tuning.

  Phase 7 / Slice 1. Tools-lane view ported in shape from JustWrite's
  RenderLabPanel.vue. Pick a voice + 1-3 sample sentences + 1-2 param
  axes; renders up to 16 cells in parallel (cap 2 concurrent to protect
  local engine subprocesses); per-cell Save-as-Preset / Save-to-Voice.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { promptDialog } from "../services/dialog.js";
import { UiButton, UiInput, UiTextarea, UiToggle, UiTag } from "@delebash/llm-ui";
import { useVoicesStore } from "../stores/voices.js";

const api = useApi();
const voicesStore = useVoicesStore();

const voices = computed(() => voicesStore.items);
const selectedVoiceId = ref("");
const sampleText = ref(
  "The night was thick with fog, and the lanterns barely caught the cobblestones."
);
const axes = ref([
  { key: "speed", values: "0.95,1.0,1.05", enabled: true },
  { key: "exaggeration", values: "0.8,1.2,1.5", enabled: false },
]);
const cells = ref([]);  // [{key, params, status, audioUrl, error}]
const running = ref(false);

const MAX_CONCURRENCY = 2;
const MAX_CELLS = 16;

const matrixSize = computed(() => {
  return axes.value
    .filter((a) => a.enabled)
    .reduce((acc, a) => acc * Math.max(1, a.values.split(",").map((s) => s.trim()).filter(Boolean).length), 1);
});

function parseValues(str) {
  return (str || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (Number.isNaN(Number(s)) ? s : Number(s)));
}

async function loadVoices() {
  await voicesStore.ensureLoaded();
  if (!selectedVoiceId.value && voices.value.length) {
    selectedVoiceId.value = voices.value[0].id;
  }
}

function buildMatrix() {
  const active = axes.value.filter((a) => a.enabled);
  if (!active.length) return [{ params: {}, key: "default" }];
  if (active.length === 1) {
    const a = active[0];
    return parseValues(a.values).map((v) => ({
      params: { [a.key]: v },
      key: `${a.key}=${v}`,
    }));
  }
  const [a, b] = active;
  const out = [];
  for (const av of parseValues(a.values)) {
    for (const bv of parseValues(b.values)) {
      out.push({
        params: { [a.key]: av, [b.key]: bv },
        key: `${a.key}=${av};${b.key}=${bv}`,
      });
    }
  }
  return out;
}

async function renderCell(cell) {
  cell.status = "rendering";
  cell.audioUrl = null;
  cell.error = null;
  try {
    const body = {
      voice: selectedVoiceId.value,
      text: sampleText.value,
      delivery: cell.params,
      cache: false,
    };
    const blob = await api.request("/v1/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    cell.audioUrl = URL.createObjectURL(blob);
    cell.status = "done";
  } catch (e) {
    cell.status = "failed";
    cell.error = String(e?.message || e);
  }
}

async function runAll() {
  if (!selectedVoiceId.value) {
    pushToast({ message: "Pick a voice first.", kind: "info" });
    return;
  }
  if (matrixSize.value > MAX_CELLS) {
    pushToast({
      message: `Matrix has ${matrixSize.value} cells — exceeds ${MAX_CELLS}-cell cap. Reduce axis values.`,
      kind: "warning",
      duration: 5000,
    });
    return;
  }
  // Revoke any prior object URLs to avoid memory leaks.
  for (const c of cells.value) {
    if (c.audioUrl) URL.revokeObjectURL(c.audioUrl);
  }
  cells.value = buildMatrix().map((c) => ({ ...c, status: "queued", audioUrl: null, error: null }));

  running.value = true;
  try {
    // Concurrency-limited worker pool (cap 2 to protect local engines).
    let cursor = 0;
    async function worker() {
      while (cursor < cells.value.length) {
        const idx = cursor++;
        await renderCell(cells.value[idx]);
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENCY }, worker));
  } finally {
    running.value = false;
  }
}

async function saveAsPreset(cell) {
  // Was triple-broken: native prompt() (banned — null in the Tauri
  // webview), `delivery_json`/`lexicons_json` (the API takes `delivery`
  // dicts), and a VOICE id in voice_id (which is a persona FK). Saves a
  // delivery-only preset now — the lab tunes delivery, not casting.
  const name = (await promptDialog({
    title: "Save as render preset",
    message: `Name the preset for ${cell.key}:`,
    placeholder: "e.g. Narration — slow + warm",
  }))?.trim();
  if (!name) return;
  try {
    await api.request("/v1/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        voice_id: null,
        delivery: cell.params || {},
        lexicons: [],
      }),
    });
    pushToast({ message: `Saved "${name}" as render preset.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Save preset failed: ${e?.message || e}`, kind: "error" });
  }
}

onMounted(loadVoices);
</script>

<template>
  <div class="renderlab">
    <!-- Tab title + explainer lede live in LabsView (one mechanism for
         all five labs) — no per-view header here. -->

    <!-- Source — canonical .jv-pane-card (Speaker tab precedent) -->
    <section class="jv-card jv-pane-card">
      <div class="jv-pane-card__h">
        <span class="jv-eyebrow">Source</span>
      </div>
      <div class="renderlab__form">
        <label class="renderlab__field">
          <span class="jv-eyebrow">Voice</span>
          <select v-model="selectedVoiceId" class="jv-input jv-w-name">
            <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} ({{ v.engine }})</option>
          </select>
        </label>
        <label class="renderlab__field">
          <span class="jv-eyebrow">Sample sentence</span>
          <UiTextarea v-model="sampleText" class="renderlab__text" :rows="3" />
        </label>
      </div>
    </section>

    <!-- Axes — eyebrow header carries the cells count + Run (actions right) -->
    <section class="jv-card jv-pane-card">
      <div class="jv-pane-card__h">
        <span class="jv-eyebrow">Axes</span>
        <UiTag intent="ghost">{{ matrixSize }} cells</UiTag>
        <span class="jv-spacer" />
        <UiButton
          intent="primary"
          size="small"
          :loading="running"
          :disabled="running"
          :label="`▶ Render matrix (${matrixSize} cells)`"
          @click="runAll"
        />
      </div>
      <p class="jv-muted jv-pane-card__hint">
        Toggle an axis on and list its values — every combination renders as one cell
        (cap {{ MAX_CELLS }}, {{ MAX_CONCURRENCY }} at a time to protect local engines).
      </p>
      <div class="renderlab__axes">
        <div v-for="(a, i) in axes" :key="i" class="renderlab__axis">
          <span class="renderlab__axis-enable" :title="a.enabled ? `Vary ${a.key} across the matrix` : `${a.key} stays at the engine default`">
            <UiToggle v-model="a.enabled" :aria-label="`Vary ${a.key}`" />
            <span>{{ a.key }}</span>
          </span>
          <UiInput
            size="small"
            width="name"
            v-model="a.values"
            :disabled="!a.enabled"
            placeholder="comma-separated values"
          />
        </div>
      </div>
    </section>

    <section v-if="cells.length" class="jv-card jv-pane-card">
      <div class="jv-pane-card__h">
        <span class="jv-eyebrow">Results</span>
      </div>
      <div class="renderlab__grid">
        <article v-for="c in cells" :key="c.key" class="jv-card renderlab__cell">
          <header class="renderlab__cell-h">
            <strong class="jv-mono">{{ c.key }}</strong>
            <UiTag intent="ghost">{{ c.status }}</UiTag>
          </header>
          <audio v-if="c.audioUrl" :src="c.audioUrl" controls class="renderlab__cell-audio" />
          <p v-else-if="c.status === 'failed'" class="renderlab__cell-error">{{ c.error }}</p>
          <p v-else class="jv-muted renderlab__cell-pending">— pending —</p>
          <footer class="renderlab__cell-actions" v-if="c.status === 'done'">
            <UiButton intent="ghost" size="small" label="Save as preset" @click="saveAsPreset(c)" />
          </footer>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.renderlab { padding: 0; display: flex; flex-direction: column; gap: 18px; }

.renderlab__form {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 12px 16px;
}
.renderlab__field { display: flex; flex-direction: column; gap: 4px; }
.renderlab__text { font-family: inherit; resize: vertical; }

.renderlab__axes { display: flex; flex-wrap: wrap; gap: 10px 26px; }
.renderlab__axis { display: flex; align-items: center; gap: 8px; }
.renderlab__axis-enable {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.renderlab__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.renderlab__cell {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px;
}
.renderlab__cell-h {
  display: flex;
  align-items: center;
  gap: 6px;
}
.renderlab__cell-audio { width: 100%; }
.renderlab__cell-pending { margin: 8px 0; font-size: 11.5px; }
.renderlab__cell-error { margin: 8px 0; font-size: 11.5px; color: var(--danger); }
.renderlab__cell-actions {
  display: flex;
  padding-top: 6px;
  border-top: 1px solid var(--border-soft);
}
</style>
