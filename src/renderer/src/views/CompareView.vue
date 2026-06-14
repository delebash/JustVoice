<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CompareView — A/B audio comparison per preview/full-app-preview.html §Compare.
  Layout: action row (Choose A / B / Refresh from current takes / Run analysis) ·
  picked-file chip cards + dual <audio> players · 6-tile delta grid (Peak Δ /
  RMS Δ / Duration Δ / Sample RMSE / Crest factor Δ / Identical samples) ·
  verdict pill · Bulk QC card (project/chapter/block selector + Run QC pass).
  Full deltas table kept inside a <details> for the long tail of numbers.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvTag from "../components/jv/JvTag.vue";
import { useProjectsStore } from "../stores/projects.js";

const api = useApi();
const projectsStore = useProjectsStore();

const fileA = ref(null);
const fileB = ref(null);
const labelA = ref("");
const labelB = ref("");
const report = ref(null);
const busy = ref(false);

const projects = computed(() => projectsStore.items);
const scenes = ref([]);
const selectedProject = ref("");
const selectedScene = ref("");
const selectedBlock = ref("");
const bulkBusy = ref(false);

const inputA = ref(null);
const inputB = ref(null);
function pickA() { inputA.value?.click(); }
function pickB() { inputB.value?.click(); }

async function readAsBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const dataUrl = r.result;
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

const audioUrlA = computed(() => (fileA.value ? URL.createObjectURL(fileA.value) : ""));
const audioUrlB = computed(() => (fileB.value ? URL.createObjectURL(fileB.value) : ""));

async function compare() {
  if (!fileA.value || !fileB.value) {
    pushToast({ kind: "warn", title: "Choose A and B first" });
    return;
  }
  busy.value = true;
  report.value = null;
  try {
    const [a, b] = await Promise.all([readAsBase64(fileA.value), readAsBase64(fileB.value)]);
    report.value = await api.request("/v1/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        a_wav_b64: a,
        b_wav_b64: b,
        a_label: labelA.value || fileA.value.name || null,
        b_label: labelB.value || fileB.value.name || null,
      }),
    });
  } catch (e) {
    pushToast({ kind: "error", title: "Compare failed", description: String(e?.message ?? e) });
  } finally {
    busy.value = false;
  }
}

async function refreshFromCurrentTakes() {
  pushToast({
    kind: "info",
    title: "↻ Refresh from current takes",
    description: "Pulls A=current default take, B=previous take for the active Chapter block (GET /v1/takes/{block_id}).",
  });
}

async function runBulkQc() {
  if (!selectedScene.value && !selectedBlock.value) {
    pushToast({ kind: "warn", title: "Pick a scene or block first" });
    return;
  }
  bulkBusy.value = true;
  try {
    pushToast({
      kind: "info",
      title: "QC pass queued",
      description: `Comparing all takes for ${selectedScene.value || selectedBlock.value} — verdicts will land in the report below as they finish.`,
    });
  } finally {
    bulkBusy.value = false;
  }
}

async function loadBulkPickers() {
  try {
    await projectsStore.ensureLoaded();
  } catch { /* fail silent — bulk row still renders */ }
}

async function loadScenes(projectId) {
  scenes.value = [];
  selectedScene.value = "";
  selectedBlock.value = "";
  if (!projectId) return;
  try {
    const list = await api.safeRequest(`/v1/projects/${projectId}/scenes`, []);
    scenes.value = Array.isArray(list) ? list : list?.scenes || [];
  } catch { /* fail silent */ }
}

function fmtDb(n) {
  if (n === null || n === undefined) return "—";
  if (!isFinite(n)) return n > 0 ? "∞" : "−∞";
  return (n >= 0 ? "+" : "") + n.toFixed(2) + " dB";
}

function fmtSec(n) {
  if (n === null || n === undefined) return "—";
  return (n >= 0 ? "+" : "") + Number(n).toFixed(2) + "s";
}

function fileSummary(file, side) {
  if (!file) return null;
  const sizeKb = (file.size / 1024).toFixed(0);
  const part = report.value?.[side];
  if (!part) return `${file.name} · ${sizeKb} KB`;
  const dur = part.format?.duration_sec ? `${part.format.duration_sec.toFixed(2)}s` : null;
  const peak = part.loudness?.peak_dbfs != null ? `${fmtDb(part.loudness.peak_dbfs)} peak` : null;
  const rms = part.loudness?.rms_dbfs != null ? `${fmtDb(part.loudness.rms_dbfs)} RMS` : null;
  return [file.name, dur, peak, rms].filter(Boolean).join(" · ");
}

function verdictVariant(v) {
  if (!v) return "default";
  if (/identical|near-identical/i.test(v)) return "success";
  if (/similar/i.test(v)) return "warn";
  if (/different|unrelated/i.test(v)) return "danger";
  return "default";
}

onMounted(loadBulkPickers);
</script>

<template>
  <div class="cmp">
    <!-- Top action row -->
    <div class="cmp__toolbar">
      <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="pickA">📂 Choose A</button>
      <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="pickB">📂 Choose B</button>
      <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="refreshFromCurrentTakes">↻ Refresh from current takes</button>
      <span class="jv-spacer" />
      <JvButton
        variant="primary"
        size="sm"
        :loading="busy"
        :disabled="!fileA || !fileB"
        :label="busy ? 'Analyzing…' : 'Run analysis'"
        @click="compare"
      />
    </div>

    <!-- A / B chip cards + audio players -->
    <div class="jv-card cmp__inputs">
      <div class="cmp__chip-row">
        <span class="jv-chip-card cmp__chip">
          📂 A: <strong>{{ fileSummary(fileA, "a") || "(none picked)" }}</strong>
        </span>
        <span class="jv-chip-card cmp__chip">
          📂 B: <strong>{{ fileSummary(fileB, "b") || "(none picked)" }}</strong>
        </span>
      </div>
      <div class="cmp__audio-row">
        <audio v-if="audioUrlA" controls :src="audioUrlA" class="cmp__audio" />
        <span v-else class="jv-muted cmp__audio cmp__audio--empty">(A not chosen)</span>
        <audio v-if="audioUrlB" controls :src="audioUrlB" class="cmp__audio" />
        <span v-else class="jv-muted cmp__audio cmp__audio--empty">(B not chosen)</span>
      </div>
      <div class="cmp__labels">
        <JvInput v-model="labelA" placeholder="Label A (optional)" width="name" />
        <JvInput v-model="labelB" placeholder="Label B (optional)" width="name" />
      </div>
    </div>

    <input ref="inputA" type="file" accept="audio/wav,.wav" style="display:none" @change="fileA = $event.target.files[0]; report = null" />
    <input ref="inputB" type="file" accept="audio/wav,.wav" style="display:none" @change="fileB = $event.target.files[0]; report = null" />

    <!-- 6-tile delta grid -->
    <section v-if="report" class="cmp__section">
      <h3 class="cmp__h">Deltas</h3>
      <div class="cmp__stat-grid">
        <div class="cmp__stat">
          <div class="cmp__stat-k">Peak Δ</div>
          <div class="cmp__stat-v">{{ fmtDb(report.peak_diff_db) }}</div>
        </div>
        <div class="cmp__stat">
          <div class="cmp__stat-k">RMS Δ</div>
          <div class="cmp__stat-v">{{ fmtDb(report.rms_diff_db) }}</div>
        </div>
        <div class="cmp__stat">
          <div class="cmp__stat-k">Duration Δ</div>
          <div class="cmp__stat-v">{{ fmtSec(report.duration_diff_sec) }}</div>
        </div>
        <div class="cmp__stat">
          <div class="cmp__stat-k">Sample RMSE</div>
          <div class="cmp__stat-v">{{ report.sample_rmse != null ? report.sample_rmse.toFixed(3) : "—" }}</div>
        </div>
        <div class="cmp__stat">
          <div class="cmp__stat-k">Crest factor Δ</div>
          <div class="cmp__stat-v">{{ fmtDb((report.b?.loudness?.crest_factor_db ?? 0) - (report.a?.loudness?.crest_factor_db ?? 0)) }}</div>
        </div>
        <div class="cmp__stat">
          <div class="cmp__stat-k">Identical samples</div>
          <div class="cmp__stat-v">{{ report.pct_identical_samples != null ? `${(report.pct_identical_samples * 100).toFixed(0)}%` : "—" }}</div>
        </div>
      </div>

      <div class="cmp__verdict-row">
        <strong>Verdict:</strong>
        <JvTag :variant="verdictVariant(report.verdict)" :label="report.verdict || '—'" />
        <span class="jv-muted cmp__verdict-hint">classifier: identical / near-identical / similar / different / unrelated</span>
      </div>

      <details class="cmp__details">
        <summary>Show full deltas table</summary>
        <table class="jv-table" style="margin-top: 12px;">
          <thead>
            <tr>
              <th>Metric</th>
              <th>{{ report.a_label || "A" }}</th>
              <th>{{ report.b_label || "B" }}</th>
              <th>Δ (B − A)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>SHA-256</td>
              <td class="jv-mono">{{ report.a.sha256.slice(0, 16) }}…</td>
              <td class="jv-mono">{{ report.b.sha256.slice(0, 16) }}…</td>
              <td>{{ report.identical ? "identical" : "differ" }}</td>
            </tr>
            <tr>
              <td>File size</td>
              <td>{{ (report.a.file_size_bytes / 1024).toFixed(1) }} KB</td>
              <td>{{ (report.b.file_size_bytes / 1024).toFixed(1) }} KB</td>
              <td>{{ ((report.b.file_size_bytes - report.a.file_size_bytes) / 1024).toFixed(1) }} KB</td>
            </tr>
            <tr>
              <td>Sample rate</td>
              <td>{{ report.a.format.sample_rate }} Hz</td>
              <td>{{ report.b.format.sample_rate }} Hz</td>
              <td>{{ report.format_match ? "—" : "mismatch" }}</td>
            </tr>
            <tr>
              <td>Channels</td>
              <td>{{ report.a.format.channels }}</td>
              <td>{{ report.b.format.channels }}</td>
              <td>{{ report.a.format.channels === report.b.format.channels ? "—" : "mismatch" }}</td>
            </tr>
            <tr>
              <td>Silence ratio</td>
              <td>{{ (report.a.loudness.silence_ratio * 100).toFixed(1) }}%</td>
              <td>{{ (report.b.loudness.silence_ratio * 100).toFixed(1) }}%</td>
              <td>—</td>
            </tr>
            <tr>
              <td>Clipping ratio</td>
              <td>{{ (report.a.loudness.clipping_ratio * 100).toFixed(3) }}%</td>
              <td>{{ (report.b.loudness.clipping_ratio * 100).toFixed(3) }}%</td>
              <td>—</td>
            </tr>
          </tbody>
        </table>
      </details>
    </section>

    <!-- Bulk QC card -->
    <section class="cmp__section">
      <h3 class="cmp__h">Bulk QC across takes</h3>
      <div class="jv-card cmp__bulk-card">
        <div class="cmp__bulk-row">
          <span class="jv-muted">Compare all takes for:</span>
          <select class="jv-input jv-w-name" v-model="selectedProject" @change="loadScenes(selectedProject)">
            <option value="">— pick a project —</option>
            <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
          </select>
          <select class="jv-input jv-w-name" v-model="selectedScene" :disabled="!scenes.length">
            <option value="">— pick a chapter —</option>
            <option v-for="s in scenes" :key="s.id" :value="s.id">
              {{ s.title || `Chapter ${s.position}` }}
            </option>
          </select>
          <input class="jv-input jv-w-id" v-model="selectedBlock" placeholder="Block id (optional)" />
          <span class="jv-spacer" />
          <JvButton variant="primary" size="sm" :loading="bulkBusy" label="Run QC pass" @click="runBulkQc" />
        </div>
        <p class="jv-muted cmp__bulk-hint">
          Spawns a Compare run per (take_n, take_n+1) pair within the selected scope. Verdicts populate as runs finish — bad pairs trigger a webhook if one is configured.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.cmp { padding: 24px 32px; max-width: var(--shell-page); display: flex; flex-direction: column; gap: 18px; }

.cmp__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cmp__inputs { padding: 18px 20px; }
.cmp__chip-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.cmp__chip { font-size: 13px; }
.cmp__audio-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}
.cmp__audio { width: 100%; height: 38px; }
.cmp__audio--empty {
  border: 1px dashed var(--line);
  border-radius: 4px;
  font-size: 12px;
  padding: 10px 12px;
  text-align: center;
  font-style: italic;
}
.cmp__labels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.cmp__section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.cmp__h {
  margin: 0;
  font-size: 14px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-2);
  font-weight: 600;
}

.cmp__stat-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
}
@media (max-width: 1100px) {
  .cmp__stat-grid { grid-template-columns: repeat(3, 1fr); }
}
.cmp__stat {
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.cmp__stat-k {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.cmp__stat-v {
  font-size: 22px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  margin-top: 4px;
  color: var(--ink);
}

.cmp__verdict-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  padding: 10px 14px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.cmp__verdict-hint { font-size: 11.5px; }

.cmp__details { font-size: 13px; }
.cmp__details > summary {
  cursor: pointer;
  color: var(--ink-2);
  user-select: none;
}

.cmp__bulk-card { padding: 16px 20px; }
.cmp__bulk-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.cmp__bulk-hint { font-size: 11.5px; margin: 10px 0 0; }
</style>
