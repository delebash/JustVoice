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
import { withEngineSwap } from "../services/engineSwap.js";
import VoicePicker from "../components/VoicePicker.vue";
import JvButton from "../components/jv/JvButton.vue";

const api = useApi();

const voices = ref([]);
const engines = ref([]);  // VoicePicker not-installed badges
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
    .map((s) => (isNaN(Number(s)) ? s : Number(s)));
}

async function loadVoices() {
  const [r, eng] = await Promise.all([
    api.safeRequest("/v1/voices", { voices: [] }),
    api.safeRequest("/v1/engines", { engines: [] }),
  ]);
  voices.value = r?.voices || [];
  engines.value = eng?.engines || [];
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

function requestCell(cell, allowSwap) {
  return api.request("/v1/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      voice: selectedVoiceId.value,
      text: sampleText.value,
      delivery: cell.params,
      cache: false,
      allow_engine_swap: allowSwap,
    }),
  });
}

async function renderCell(cell, allowSwap = true) {
  cell.status = "rendering";
  cell.audioUrl = null;
  cell.error = null;
  try {
    const blob = await requestCell(cell, allowSwap);
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
    // The first cell runs alone through the shared swap prompt — ONE
    // prompt covers the whole matrix (single voice, single engine). The
    // remaining cells reuse the now-loaded engine.
    const first = cells.value[0];
    first.status = "rendering";
    try {
      const blob = await withEngineSwap((allow) => requestCell(first, allow));
      if (blob === null) {
        // User declined the engine swap — abandon the run.
        first.status = "queued";
        return;
      }
      first.audioUrl = URL.createObjectURL(blob);
      first.status = "done";
    } catch (e) {
      first.status = "failed";
      first.error = String(e?.message || e);
    }

    // Concurrency-limited worker pool (cap 2 to protect local engines).
    let cursor = 1;
    async function worker() {
      while (cursor < cells.value.length) {
        const idx = cursor++;
        await renderCell(cells.value[idx], true);
      }
    }
    await Promise.all(Array.from({ length: MAX_CONCURRENCY }, worker));
  } finally {
    running.value = false;
  }
}

async function saveAsPreset(cell) {
  const name = await promptDialog({ title: "Save as render preset", label: `Preset name for ${cell.key}`, confirmLabel: "Save" });
  if (!name) return;
  try {
    await api.request("/v1/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        voice_id: selectedVoiceId.value,
        delivery_json: JSON.stringify(cell.params),
        lexicons_json: "[]",
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
    <header class="renderlab__header">
      <h2 class="renderlab__title">Render Lab</h2>
      <p class="jv-muted renderlab__lede">
        A/B matrix harness for voice tuning. Pick a voice, 1-3 sample
        sentences, and 1-2 parameter axes. Up to {{ MAX_CELLS }} cells,
        capped at {{ MAX_CONCURRENCY }} concurrent renders.
      </p>
    </header>

    <section class="jv-section">
      <h3 class="jv-section__title">Source</h3>
      <div class="renderlab__form">
        <label class="renderlab__field">
          <span>Voice</span>
          <VoicePicker
            v-model="selectedVoiceId"
            :voices="voices"
            :engines="engines"
            select-class="jv-input"
          />
        </label>
        <label class="renderlab__field">
          <span>Sample sentence</span>
          <textarea v-model="sampleText" class="jv-input jv-input--full renderlab__text" rows="3" />
        </label>
      </div>
    </section>

    <section class="jv-section">
      <h3 class="jv-section__title">
        Axes
        <span class="jv-pill jv-pill--ghost">{{ matrixSize }} cells</span>
      </h3>
      <div class="renderlab__axes">
        <div v-for="(a, i) in axes" :key="i" class="renderlab__axis">
          <label class="renderlab__axis-enable">
            <input type="checkbox" v-model="a.enabled" />
            <span>{{ a.key }}</span>
          </label>
          <input
            class="jv-input"
            v-model="a.values"
            :disabled="!a.enabled"
            placeholder="comma-separated values"
          />
        </div>
      </div>
      <div class="renderlab__run">
        <JvButton
          variant="primary"
          size="sm"
          :loading="running"
          :disabled="running"
          :label="`▶ Render matrix (${matrixSize} cells)`"
          @click="runAll"
        />
      </div>
    </section>

    <section v-if="cells.length" class="jv-section">
      <h3 class="jv-section__title">Results</h3>
      <div class="renderlab__grid">
        <article v-for="c in cells" :key="c.key" class="jv-card renderlab__cell">
          <header class="renderlab__cell-h">
            <strong class="jv-mono">{{ c.key }}</strong>
            <span class="jv-pill jv-pill--ghost">{{ c.status }}</span>
          </header>
          <audio v-if="c.audioUrl" :src="c.audioUrl" controls class="renderlab__cell-audio" />
          <p v-else-if="c.status === 'failed'" class="renderlab__cell-error">{{ c.error }}</p>
          <p v-else class="jv-muted renderlab__cell-pending">— pending —</p>
          <footer class="renderlab__cell-actions" v-if="c.status === 'done'">
            <JvButton variant="ghost" size="sm" label="Save as preset" @click="saveAsPreset(c)" />
          </footer>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.renderlab { padding: 0; display: flex; flex-direction: column; gap: 18px; }
.renderlab__header { margin-bottom: 4px; }
.renderlab__title { margin: 0; font-size: 22px; }
.renderlab__lede { margin: 6px 0 0; font-size: 13px; max-width: 760px; }

.renderlab__form {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 12px 16px;
}
.renderlab__field { display: flex; flex-direction: column; gap: 4px; }
.renderlab__field > span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.renderlab__text { font-family: inherit; resize: vertical; }

.renderlab__axes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.renderlab__axis {
  display: grid;
  grid-template-columns: 1fr 2fr;
  gap: 8px;
  align-items: center;
}
.renderlab__axis-enable {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: var(--font-mono);
  font-size: 12px;
}

.renderlab__run { margin-top: 10px; }

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
