<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, onUnmounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvTag from "../components/jv/JvTag.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();

// ── data ──────────────────────────────────────────────────────────────────────
const engines = ref([]);
const voices = ref([]);
const trainJobs = ref([]);

// ── form state ────────────────────────────────────────────────────────────────
// 8 fields matching preview/full-app-preview.html §Train New training job:
//   Voice profile / Base engine / Method / Steps / SNR threshold (dB) /
//   Max clipping ratio / Max silence ratio / Concurrent jobs limit
const trainName = ref("");          // 1) Voice profile (output name)
const trainEngine = ref("");        // 2) Base engine
const trainBaseVoice = ref("");
const trainMethod = ref("lora_r16_a32"); // 3) Method
const trainSteps = ref(5000);       // 4) Steps
const trainSnrThreshold = ref(30);  // 5) SNR threshold (dB)
const trainClipRatio = ref(0.002);  // 6) Max clipping ratio
const trainSilenceRatio = ref(0.35);// 7) Max silence ratio
const trainConcurrency = ref(1);    // 8) Concurrent jobs limit
const trainEpochs = ref("");
const trainLearningRate = ref("");
const samples = ref([]); // [{ file, transcript }]
const trainBusy = ref(false);

const TRAIN_METHODS = [
  { id: "lora_r16_a32", label: "LoRA (r=16, α=32)" },
  { id: "lora_r8_a16",  label: "LoRA (r=8, α=16)" },
  { id: "full_finetune", label: "Full fine-tune" },
];

// ── derived ───────────────────────────────────────────────────────────────────
const canSubmit = computed(
  () => trainEngine.value && trainName.value.trim() && samples.value.length > 0
);

const ACTIVE_PHASES = new Set(["queued", "validating", "preparing", "running"]);

function hasActive() {
  return trainJobs.value.some((j) => ACTIVE_PHASES.has(j.phase));
}

// ── phase → JvTag variant mapping ─────────────────────────────────────────────
function phaseVariant(phase) {
  if (phase === "completed") return "success";
  if (phase === "failed") return "danger";
  if (ACTIVE_PHASES.has(phase)) return "warn";
  return "default";
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
      method: trainMethod.value,
      steps: trainSteps.value || undefined,
      qc: {
        snr_threshold_db: trainSnrThreshold.value,
        max_clipping_ratio: trainClipRatio.value,
        max_silence_ratio: trainSilenceRatio.value,
      },
      concurrent_jobs_limit: trainConcurrency.value,
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

const engineOptions = computed(() =>
  engines.value.map((e) => ({ label: e.name, value: e.id }))
);

const voiceOptions = computed(() =>
  voices.value.map((v) => ({ label: `${v.name} (${v.engine})`, value: v.id }))
);

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
  // Voice-inspector "Train LoRA" handoff (jv.generate.prefill precedent):
  // preselect the base voice + its engine, then consume the key.
  try {
    const raw = window.sessionStorage?.getItem("jv.train.prefill");
    if (raw) {
      window.sessionStorage.removeItem("jv.train.prefill");
      const prefill = JSON.parse(raw);
      const v = voices.value.find((x) => x.id === prefill?.base_voice);
      if (v) {
        trainBaseVoice.value = v.id;
        if (!trainEngine.value) trainEngine.value = v.engine;
        if (!trainName.value) trainName.value = `${v.name}-trained`;
      }
    }
  } catch { /* ignore */ }
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
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Queue a fine-tune</h3>
      </div>

      <div class="train-grid">
        <JvField label="Voice profile (output name)" layout="block">
          <JvInput v-model="trainName" placeholder="Old Crow-trained" width="name" />
        </JvField>
        <JvField label="Base engine" layout="block">
          <JvSelect v-model="trainEngine" :options="engineOptions" placeholder="Pick an engine…" width="name" />
        </JvField>
        <JvField label="Method" layout="block">
          <JvSelect v-model="trainMethod" :options="TRAIN_METHODS.map((m) => ({ label: m.label, value: m.id }))" width="name" />
        </JvField>
        <JvField label="Steps" layout="block">
          <JvInput v-model.number="trainSteps" type="number" placeholder="5000" width="token" />
        </JvField>
        <JvField label="SNR threshold (dB)" layout="block">
          <JvInput v-model.number="trainSnrThreshold" type="number" placeholder="30" width="token" />
        </JvField>
        <JvField label="Max clipping ratio" layout="block">
          <JvInput v-model.number="trainClipRatio" type="number" step="0.001" placeholder="0.002" width="token" />
        </JvField>
        <JvField label="Max silence ratio" layout="block">
          <JvInput v-model.number="trainSilenceRatio" type="number" step="0.01" placeholder="0.35" width="token" />
        </JvField>
        <JvField label="Concurrent jobs limit" layout="block">
          <JvInput v-model.number="trainConcurrency" type="number" placeholder="1" width="token" />
        </JvField>
        <JvField label="Base voice (optional)" layout="block">
          <JvSelect
            v-model="trainBaseVoice"
            :options="[{ label: '— none —', value: '' }, ...voiceOptions]"
            width="name"
          />
        </JvField>
        <JvField label="Learning rate (optional override)" layout="block">
          <JvInput v-model="trainLearningRate" type="number" placeholder="engine default" width="token" />
        </JvField>
      </div>

      <div class="jv-divider"></div>

      <div>
        <JvField label="Add reference samples (WAV + spoken transcript per sample)" layout="block">
          <input type="file" accept="audio/*" multiple class="jv-file-input" @change="addTrainFile" />
        </JvField>

        <table v-if="samples.length" class="jv-table" style="margin-top: 12px;">
          <thead>
            <tr>
              <th>File</th>
              <th>Transcript</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, idx) in samples" :key="idx">
              <td><code class="jv-mono">{{ s.file.name }}</code></td>
              <td>
                <JvInput v-model="s.transcript" placeholder="What the speaker says in this clip" />
              </td>
              <td class="jv-table__actions">
                <JvButton variant="danger-outline" size="sm" @click="removeTrainFile(idx)">Remove</JvButton>
              </td>
            </tr>
          </tbody>
        </table>

        <p class="jv-muted" style="font-size: 12px; margin-top: 10px;">
          5–30 min total works best. Transcripts strongly recommended (engines that accept them train faster). Server
          runs pre-flight QC — bad SNR / clipped / too-silent samples are rejected before training kicks off.
        </p>
      </div>

      <div class="jv-row" style="margin-top: 16px;">
        <JvButton
          variant="primary"
          :disabled="trainBusy || !canSubmit"
          :loading="trainBusy"
          @click="submitTrain"
        >
          {{ trainBusy ? "Queueing…" : "Queue training job" }}
        </JvButton>
        <span class="jv-muted" style="font-size: 12px;">
          POST /v1/train → returns 202 with job_id. Engine must have <code class="jv-mono">supports_training</code> = true.
        </span>
      </div>
    </div>
  </div>

  <!-- ── Jobs ─────────────────────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ trainJobs.length }} training jobs</h3>
        <JvButton variant="ghost" size="sm" @click="refreshTrainJobs">Refresh</JvButton>
      </div>

      <table v-if="trainJobs.length" class="jv-table">
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
            <td><code class="jv-mono">{{ j.job_id }}</code></td>
            <td><span class="jv-mono jv-muted">{{ j.engine }}</span></td>
            <td>{{ j.voice_name }}</td>
            <td>
              <JvTag :variant="phaseVariant(j.phase)" :label="j.phase" />
              <span v-if="j.error" class="jv-muted" style="font-size: 11px; display: block; margin-top: 2px; color: var(--danger-ink);">{{ j.error }}</span>
            </td>
            <td>
              <div class="progress-wrap">
                <div class="progress-track">
                  <div
                    class="progress-bar"
                    :class="{
                      'progress-bar--done': j.phase === 'completed',
                      'progress-bar--fail': j.phase === 'failed',
                    }"
                    :style="{ width: Math.round((j.progress || 0) * 100) + '%' }"
                  ></div>
                </div>
                <span class="jv-muted" style="font-size: 11px;">{{ Math.round((j.progress || 0) * 100) }}%</span>
              </div>
            </td>
            <td class="jv-muted">
              {{ j.loss_curve && j.loss_curve.length
                ? j.loss_curve[j.loss_curve.length - 1].toFixed(3)
                : "—" }}
            </td>
            <td><code class="jv-mono">{{ j.final_voice_id || "—" }}</code></td>
            <td class="jv-table__actions">
              <JvButton
                v-if="ACTIVE_PHASES.has(j.phase)"
                variant="danger"
                size="sm"
                @click="cancelTrainJob(j.job_id)"
              >Cancel</JvButton>
            </td>
          </tr>
        </tbody>
      </table>

      <p v-else class="jv-muted" style="padding: 16px 0; font-style: italic;">No training jobs.</p>
    </div>
  </div>
</template>

<style scoped>
.train-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-bottom: 4px;
}

.jv-file-input {
  display: block;
  font-size: 13px;
  color: var(--ink-2);
  margin-top: 4px;
}

.progress-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}
.progress-track {
  width: 80px;
  height: 6px;
  background: var(--surface-3);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.progress-bar {
  height: 100%;
  background: var(--accent);
  border-radius: var(--r-pill);
  transition: width 0.3s;
}
.progress-bar--done { background: var(--success); }
.progress-bar--fail { background: var(--danger); }
</style>
