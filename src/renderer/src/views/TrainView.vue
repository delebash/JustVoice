<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

const api = useApi();

// ── data ──────────────────────────────────────────────────────────────────────
const engines = ref([]);
const voices = ref([]);
const trainJobs = ref([]);

// ── form state ────────────────────────────────────────────────────────────────
const trainName = ref("");
const trainEngine = ref("");
const trainBaseVoice = ref("");
const trainEpochs = ref("");
const trainLearningRate = ref("");
const samples = ref([]); // [{ file, transcript }]
const trainBusy = ref(false);

// ── derived ───────────────────────────────────────────────────────────────────
const canSubmit = computed(
  () => trainEngine.value && trainName.value.trim() && samples.value.length > 0
);

const ACTIVE_PHASES = new Set(["queued", "validating", "preparing", "running"]);

function hasActive() {
  return trainJobs.value.some((j) => ACTIVE_PHASES.has(j.phase));
}

// ── phase → status class mapping ──────────────────────────────────────────────
function phaseStatus(phase) {
  if (phase === "completed") return "loaded";
  if (phase === "failed") return "warn";
  return "default";
}

// ── progress bar classes ───────────────────────────────────────────────────────
function progressClass(phase) {
  if (phase === "completed") return "phase-completed";
  if (phase === "failed") return "phase-failed";
  return "";
}

// ── base64 helper ─────────────────────────────────────────────────────────────
function fileToB64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ── API actions ───────────────────────────────────────────────────────────────
async function loadEngines() {
  try {
    const e = await api.request("/v1/engines");
    engines.value = e.engines || [];
  } catch (e) {
    pushToast({ message: `Failed to load engines: ${e.message || e}`, kind: "error" });
  }
}

async function loadVoices() {
  try {
    const v = await api.request("/v1/voices");
    voices.value = v.voices || [];
  } catch (_) {
    // voices are optional — silently ignore
  }
}

async function refreshTrainJobs() {
  try {
    const t = await api.request("/v1/train");
    trainJobs.value = t.jobs || [];
  } catch (e) {
    pushToast({ message: `Failed to load jobs: ${e.message || e}`, kind: "error" });
  }
}

function addTrainFile(event) {
  const files = Array.from(event.target.files || []);
  for (const file of files) {
    samples.value.push({ file, transcript: "" });
  }
  event.target.value = "";
}

function removeTrainFile(idx) {
  samples.value.splice(idx, 1);
}

async function submitTrain() {
  if (!canSubmit.value) return;
  trainBusy.value = true;
  try {
    const samplePayload = await Promise.all(
      samples.value.map(async ({ file, transcript }) => ({
        wav_b64: await fileToB64(file),
        transcript: transcript || "",
      }))
    );
    const body = {
      engine: trainEngine.value,
      name: trainName.value.trim(),
      samples: samplePayload,
    };
    if (trainEpochs.value) body.epochs = Number(trainEpochs.value);
    if (trainLearningRate.value) body.learning_rate = Number(trainLearningRate.value);
    if (trainBaseVoice.value) body.base_voice = trainBaseVoice.value;

    await api.request("/v1/train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    trainName.value = "";
    trainEngine.value = "";
    trainBaseVoice.value = "";
    trainEpochs.value = "";
    trainLearningRate.value = "";
    samples.value = [];

    await refreshTrainJobs();
    pushToast({ message: "Training job queued." });
  } catch (e) {
    pushToast({ message: `Failed to queue job: ${e.message || e}`, kind: "error" });
  } finally {
    trainBusy.value = false;
  }
}

async function cancelTrainJob(id) {
  const ok = await confirmDialog({
    title: "Cancel training job?",
    message: `Job ${id} will be stopped. Adapter weights trained so far are preserved.`,
    danger: true,
    confirmLabel: "Cancel job",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/train/${id}`, { method: "DELETE" });
    await refreshTrainJobs();
  } catch (e) {
    pushToast({ message: `Cancel failed: ${e.message || e}`, kind: "error" });
  }
}

// ── polling ───────────────────────────────────────────────────────────────────
let pollInterval = null;
let polling = false;

function startPolling() {
  if (pollInterval) return;
  pollInterval = setInterval(async () => {
    if (polling) return;
    if (!hasActive()) return;
    polling = true;
    try {
      await refreshTrainJobs();
    } finally {
      polling = false;
    }
  }, 2000);
}

onMounted(async () => {
  await Promise.all([loadEngines(), loadVoices(), refreshTrainJobs()]);
  startPolling();
});

onUnmounted(() => {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
});
</script>

<template>
  <!-- ── Queue a fine-tune ─────────────────────────────────────────────────── -->
  <section class="block stack">
    <h3>Queue a fine-tune</h3>
    <div class="grid-2">
      <label>
        <span>Voice name</span>
        <input v-model="trainName" placeholder="Sarah-trained" />
      </label>
      <label>
        <span>Engine</span>
        <select v-model="trainEngine">
          <option value="">Pick an engine…</option>
          <option v-for="e in engines" :key="e.id" :value="e.id">{{ e.name }}</option>
        </select>
      </label>
      <label>
        <span>Base voice (optional)</span>
        <select v-model="trainBaseVoice">
          <option value="">— none —</option>
          <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} ({{ v.engine }})</option>
        </select>
      </label>
      <label>
        <span>Epochs (optional override)</span>
        <input type="number" v-model="trainEpochs" placeholder="engine default" />
      </label>
      <label style="grid-column: 1 / -1;">
        <span>Learning rate (optional override)</span>
        <input type="number" step="0.00001" v-model="trainLearningRate" placeholder="engine default" />
      </label>
    </div>

    <div>
      <label>
        <span>Add reference samples (WAV + spoken transcript per sample)</span>
        <input type="file" accept="audio/*" multiple @change="addTrainFile" />
      </label>
      <table v-if="samples.length" style="margin-top: 10px;">
        <thead>
          <tr>
            <th>File</th>
            <th>Transcript</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(s, idx) in samples" :key="idx">
            <td><span class="mono">{{ s.file.name }}</span></td>
            <td>
              <input v-model="s.transcript" placeholder="What the speaker says in this clip" />
            </td>
            <td>
              <button class="bare danger" @click="removeTrainFile(idx)">Remove</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p class="endnote" style="margin-top: 8px;">
        5–30 min total works best. Transcripts strongly recommended (engines that accept them train faster). Server
        runs pre-flight QC — bad SNR / clipped / too-silent samples are rejected before training kicks off.
      </p>
    </div>

    <div class="row">
      <button
        class="primary"
        :disabled="trainBusy || !canSubmit"
        @click="submitTrain"
      >
        {{ trainBusy ? "Queueing…" : "Queue training job" }}
      </button>
      <span class="endnote">
        POST /v1/train → returns 202 with job_id. Engine must have <span class="mono">supports_training</span> = true.
      </span>
    </div>
  </section>

  <!-- ── Jobs ─────────────────────────────────────────────────────────────── -->
  <section class="block">
    <div class="row">
      <h3 style="margin: 0;">{{ trainJobs.length }} training jobs</h3>
      <button class="bare" @click="refreshTrainJobs">Refresh</button>
    </div>

    <table v-if="trainJobs.length">
      <thead>
        <tr>
          <th>Job</th>
          <th>Engine</th>
          <th>Voice</th>
          <th>Phase</th>
          <th>Progress</th>
          <th>Final loss</th>
          <th>Voice id</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="j in trainJobs" :key="j.job_id">
          <td><span class="mono">{{ j.job_id }}</span></td>
          <td><span class="tag">{{ j.engine }}</span></td>
          <td>{{ j.voice_name }}</td>
          <td>
            <span :class="['status', phaseStatus(j.phase)]">
              <span class="sq"></span>{{ j.phase }}
            </span>
            <span v-if="j.error" class="endnote error-text"> — {{ j.error }}</span>
          </td>
          <td>
            <div class="progress-track">
              <div
                class="progress-bar"
                :class="progressClass(j.phase)"
                :style="{ width: Math.round((j.progress || 0) * 100) + '%' }"
              ></div>
            </div>
            {{ Math.round((j.progress || 0) * 100) }}%
          </td>
          <td>
            {{ j.loss_curve && j.loss_curve.length
              ? j.loss_curve[j.loss_curve.length - 1].toFixed(3)
              : "—" }}
          </td>
          <td><span class="mono">{{ j.final_voice_id || "—" }}</span></td>
          <td>
            <button
              v-if="ACTIVE_PHASES.has(j.phase)"
              class="bare danger"
              @click="cancelTrainJob(j.job_id)"
            >Cancel</button>
          </td>
        </tr>
      </tbody>
    </table>

    <p v-else class="empty">No training jobs.</p>
  </section>
</template>

<style scoped>
.samples-table { width: 100%; margin-top: 8px; }
.samples-table input { width: 100%; box-sizing: border-box; }
.error-text { color: var(--warn, #e07b54); }
.progress-track { display: inline-block; width: 80px; height: 6px; vertical-align: middle; margin-right: 4px; }
</style>
