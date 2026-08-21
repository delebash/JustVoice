<!-- SPDX-License-Identifier: MIT -->
<script setup>
// Preparer — recordings you own become training datasets.
//
// Alexandria's Preparer screen, fit to JV (decision table 2026-08-21):
// Batch Mode, the file picker, Configuration (Output Name · Language ·
// Confidence · Min SNR — the thresholds editable per run, prefilled from
// Settings → Training), Start Preparation, the Processing Queue, and the
// Execution Logs window. One difference from Alexandria, by design: the
// result lands straight in the Dataset list (with a ZIP download), so
// there is no save-then-re-upload step.
import { ref, computed, onUnmounted } from "vue";
import {
  UiButton, UiInput, UiField, UiSelect, UiTag, UiToggle,
  pushToast, postForm, serverUrl as apiPath,
} from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";
import { chunkStatus, GATE_TAG, TRAIN_LANGUAGES } from "../../services/trainingGates.js";

const emit = defineEmits(["use-dataset"]);
const api = useApi();

const batchMode = ref(false);
const files = ref([]);
const outputName = ref("");
const language = ref("en");
const confidence = ref("");
const minSnr = ref("");
const fileInput = ref(null);

const running = ref(false);
const status = ref("idle");
const progress = ref("");
const logs = ref([]);
const queue = ref([]);
const results = ref([]);
const logBox = ref(null);
let poll = null;

// Prefill Confidence / Min SNR from the operator's thresholds — the
// fields override them for one run, Settings stays the durable default.
async function loadDefaults() {
  const s = await api.safeRequest("/v1/settings", null);
  const v = s?.training?.validation;
  if (v) {
    if (confidence.value === "" && v.min_transcript_confidence != null) {
      confidence.value = String(v.min_transcript_confidence);
    }
    if (minSnr.value === "" && v.min_snr_db != null) {
      minSnr.value = String(v.min_snr_db);
    }
  }
}
loadDefaults();

// ── Choosing recordings ────────────────────────────────────────────────
function pickFiles(event) {
  const chosen = Array.from(event.target.files || []);
  event.target.value = "";
  if (!chosen.length) return;
  files.value = batchMode.value ? chosen : chosen.slice(0, 1);
  if (!batchMode.value && !outputName.value.trim()) {
    outputName.value = chosen[0].name.replace(/\.[^.]+$/, "");
  }
}

function onModeChange(on) {
  batchMode.value = on;
  // A selection that no longer fits the mode is dropped rather than
  // silently preparing different recordings than the ones shown.
  if (!on && files.value.length > 1) files.value = files.value.slice(0, 1);
}

const canStart = computed(() => files.value.length > 0 && !running.value);
const startBlocker = computed(() => {
  if (running.value) return "A preparation is already running.";
  if (!files.value.length) return "Choose a recording first.";
  return "";
});

// ── The run ────────────────────────────────────────────────────────────
async function start() {
  if (!canStart.value) return;
  running.value = true;
  status.value = "starting";
  progress.value = "Uploading…";
  logs.value = [];
  results.value = [];
  queue.value = files.value.map((f) => ({ name: f.name, status: "pending" }));
  try {
    const fd = new FormData();
    for (const f of files.value) fd.append("files", f);
    if (language.value) fd.append("language", language.value);
    fd.append("save_datasets", "true");
    if (!batchMode.value && outputName.value.trim()) {
      fd.append("dataset_names", outputName.value.trim());
    }
    if (confidence.value !== "") fd.append("min_confidence", confidence.value);
    if (minSnr.value !== "") fd.append("min_snr_db", minSnr.value);
    await postForm("/v1/train/prepare", fd);
    poll = setInterval(pollStatus, 1000);
  } catch (e) {
    running.value = false;
    status.value = "failed";
    pushToast({ message: `Couldn't start the preparation: ${e.message || e}`, kind: "error" });
  }
}

async function pollStatus() {
  let s;
  try {
    s = await api.request("/v1/train/prepare/status");
  } catch {
    return; // transient — keep polling
  }
  status.value = s.status;
  progress.value = s.progress || s.status;
  logs.value = s.logs || [];
  queue.value = s.queue || [];
  scrollLog();
  if (s.running) return;

  clearInterval(poll);
  poll = null;
  running.value = false;
  // The run may have auto-loaded Whisper server-side — announce it.
  window.dispatchEvent(new Event("jv:health-refresh"));
  if (s.status === "failed") {
    pushToast({ message: `Preparation failed: ${s.error || "unknown error"}`, kind: "error" });
    return;
  }
  await fetchResult();
}

async function fetchResult() {
  try {
    const r = await api.request("/v1/train/prepare/result");
    results.value = r?.files || [];
    logs.value = r?.logs || logs.value;
    scrollLog();
    const saved = results.value.filter((f) => f.dataset_id).length;
    const kept = results.value.reduce((n, f) => n + (f.kept || 0), 0);
    pushToast({
      message: saved
        ? `${kept} clip${kept === 1 ? "" : "s"} kept · ${saved} dataset${saved === 1 ? "" : "s"} created.`
        : "No clips passed the checks — nothing was saved. The log says why each one was dropped.",
      kind: saved ? "success" : "error",
    });
    if (r?.transcribe_error) {
      pushToast({
        message: `Clips were cut, but transcription failed: ${r.transcribe_error}. Load Whisper on the Engines tab and run the preparation again.`,
        kind: "error",
      });
    }
    files.value = [];
  } catch (e) {
    pushToast({ message: `Couldn't fetch the result: ${e.message || e}`, kind: "error" });
  }
}

async function cancel() {
  try {
    await api.request("/v1/train/prepare/cancel", { method: "POST" });
  } catch (e) {
    pushToast({ message: `Cancel failed: ${e.message || e}`, kind: "error" });
  }
}

function scrollLog() {
  requestAnimationFrame(() => {
    if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight;
  });
}

const QUEUE_TAG = {
  pending: { intent: "secondary", label: "waiting" },
  running: { intent: "accent2", label: "working" },
  done: { intent: "success", label: "done" },
  failed: { intent: "danger", label: "failed" },
  cancelled: { intent: "secondary", label: "cancelled" },
};

onUnmounted(() => {
  if (poll) clearInterval(poll);
});
</script>

<template>
  <!-- ── Voice Training Dataset Preparer ───────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Voice Training Dataset Preparer</h3>
        <!-- Toggle + label span: UiToggle takes ariaLabel, not label
             (SettingsView.vue:1091 is the shape). Right-aligned as in
             Alexandria. -->
        <div class="jv-inline-row">
          <UiToggle
            :model-value="batchMode"
            aria-label="Batch Mode"
            @update:model-value="onModeChange"
          />
          <span class="prep-toggle-label">Batch Mode</span>
        </div>
      </div>
      <p class="jv-lede">
        Turn recordings you own into training datasets — your own
        recordings, or narration you have the rights to use. Each recording
        is split at its silences, every clip is checked and transcribed,
        and the keepers are saved as a dataset ready for training.
      </p>
      <p v-if="batchMode" class="jv-banner">
        <strong>Batch Mode:</strong> queue several recordings — each one
        becomes its own dataset, named after its file.
      </p>

      <UiField
        :label="batchMode ? 'Select Audio Files (WAV/MP3)' : 'Select Audio File (WAV/MP3)'"
        layout="block"
      >
        <input
          ref="fileInput" type="file" accept="audio/wav,audio/mpeg,.wav,.mp3"
          :multiple="batchMode" style="display: none" @change="pickFiles"
        />
        <div class="jv-inline-row">
          <UiButton
            intent="secondary"
            :label="batchMode ? '＋ Choose recordings' : '＋ Choose a recording'"
            :disabled="running"
            @click="fileInput?.click()"
          />
          <span v-if="files.length" class="jv-note-xs">
            {{ files.length === 1 ? files[0].name : files.length + " recordings chosen" }}
          </span>
        </div>
      </UiField>

      <!-- Chosen, not yet started -->
      <table v-if="files.length > 1 && !running" class="jv-table prep-files jv-mt12">
        <thead><tr><th>Recording</th><th></th></tr></thead>
        <tbody>
          <tr v-for="(f, i) in files" :key="i">
            <td><code class="jv-mono">{{ f.name }}</code></td>
            <td class="jv-table__actions">
              <UiButton intent="danger-outline" size="small" label="Remove" @click="files.splice(i, 1)" />
            </td>
          </tr>
        </tbody>
      </table>

      <h4 class="prep-heading">Configuration</h4>
      <div class="jv-field-row">
        <UiField v-if="!batchMode" label="Output Name" layout="block">
          <UiInput v-model="outputName" width="name" placeholder="my narrator" :disabled="running" />
        </UiField>
        <UiField label="Language" layout="block">
          <UiSelect v-model="language" :options="TRAIN_LANGUAGES" width="id" :disabled="running" />
        </UiField>
        <UiField label="Confidence" layout="block">
          <UiInput
            v-model="confidence" type="number" width="token" step="0.01" min="0" max="1"
            :disabled="running"
            title="How sure the transcriber must be about a clip's words, 0–1. A clip below this is dropped — an unsure transcript is probably a wrong one."
          />
        </UiField>
        <UiField label="Min SNR" layout="block">
          <UiInput
            v-model="minSnr" type="number" width="token" min="0"
            :disabled="running"
            title="The least signal-over-noise a clip may have, in dB. Noisier clips are dropped."
          />
        </UiField>
      </div>
      <p class="jv-hint">
        Confidence and Min SNR start at your defaults from Settings →
        Training; changing them here affects this run only.
      </p>

      <div class="jv-inline-row jv-mt12">
        <UiButton
          intent="primary"
          :disabled="!canStart"
          :loading="running"
          :label="running ? 'Preparing…' : 'Start Preparation'"
          @click="start"
        />
        <UiButton
          v-if="running"
          intent="danger-outline" size="small" label="Cancel" @click="cancel"
        />
        <span class="jv-note-xs">{{ startBlocker || progress }}</span>
      </div>
    </div>
  </div>

  <!-- ── Processing Queue ──────────────────────────────────────────────── -->
  <div v-if="queue.length" class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header"><h3 class="jv-card__title">Processing Queue</h3></div>
      <table class="jv-table">
        <thead>
          <tr><th>Audio File</th><th>Status</th><th>Clips Kept</th><th>Dataset</th></tr>
        </thead>
        <tbody>
          <tr v-for="(row, i) in queue" :key="i">
            <td><code class="jv-mono">{{ row.name }}</code></td>
            <td>
              <UiTag
                :intent="QUEUE_TAG[row.status]?.intent || 'secondary'"
                :value="QUEUE_TAG[row.status]?.label || row.status"
              />
              <span v-if="row.error" class="jv-note-xs prep-error">{{ row.error }}</span>
            </td>
            <td class="jv-muted">
              {{ row.kept != null ? `${row.kept} of ${row.chunk_count ?? "?"}` : "--" }}
            </td>
            <td>
              <span v-if="row.dataset_name">{{ row.dataset_name }}</span>
              <span v-else class="jv-muted">--</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>

  <!-- ── Execution Logs ────────────────────────────────────────────────── -->
  <div v-if="logs.length" class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header"><h3 class="jv-card__title">Execution Logs</h3></div>
      <div ref="logBox" class="jv-logbox">
        <span v-for="(line, i) in logs" :key="i" class="jv-logbox__line">{{ line }}</span>
      </div>
      <p class="jv-hint">
        Every clip that was dropped says why here — too short, too noisy, or
        a transcript the transcriber wasn't sure about.
      </p>
    </div>
  </div>

  <!-- ── What came out ─────────────────────────────────────────────────── -->
  <div v-for="(file, fi) in results" :key="fi" class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ file.name }} — {{ file.kept || 0 }} of {{ file.chunks?.length || 0 }} clips kept</h3>
        <div class="jv-inline-row">
          <a
            v-if="file.dataset_id"
            class="ui-btn ui-btn--secondary ui-btn--small"
            :href="apiPath(`/v1/train/datasets/${file.dataset_id}/archive.zip`)"
            title="Download this dataset as a ZIP"
          >⬇ Download ZIP</a>
          <UiButton
            v-if="file.dataset_id"
            intent="secondary" size="small" label="Use in Training →"
            title="Open Training with this dataset selected"
            @click="emit('use-dataset', file.dataset_id)"
          />
        </div>
      </div>
      <p v-if="file.error" class="jv-banner jv-banner--warn">{{ file.error }}</p>
      <table v-if="file.chunks?.length" class="jv-table">
        <thead>
          <tr><th>#</th><th>Length</th><th>Check</th><th>Transcript</th></tr>
        </thead>
        <tbody>
          <tr v-for="(c, i) in file.chunks" :key="i" :class="{ 'prep-row--dropped': !c.accepted }">
            <td class="jv-muted">{{ i + 1 }}</td>
            <td class="jv-muted">{{ c.seconds != null ? c.seconds.toFixed(1) + " s" : "--" }}</td>
            <td>
              <UiTag
                :intent="GATE_TAG[chunkStatus(c)]?.intent || 'secondary'"
                :value="GATE_TAG[chunkStatus(c)]?.label || 'ok'"
                :title="c.reason || undefined"
              />
            </td>
            <td>{{ c.transcript || "--" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.prep-heading {
  margin: 16px 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.prep-toggle-label { font-size: 13px; font-weight: 500; color: var(--ink-2); }
.prep-files { width: auto; min-width: 380px; }
.prep-error { display: block; margin-top: 2px; }
/* Dropped clips stay VISIBLE and dimmed — hiding them would hide the
   reason, and the reason is the point of showing the table at all. */
.prep-row--dropped { opacity: 0.55; }
</style>
