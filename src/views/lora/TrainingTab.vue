<!-- SPDX-License-Identifier: MIT -->
<script setup>
// Training — run the fine-tune, watch it work, hear what came out.
//
// Alexandria's LoRA Training screen, fit to JV (decision table,
// 2026-08-21): Dataset section first (Upload ZIP · the dataset list ·
// Build New Dataset · New Dataset from WAV Files), then Training
// Configuration with every knob visible and prefilled from the chosen
// base's verified recipe, Start Training, the settings explainer,
// Training Progress with a live log, Trained Adapters (built-ins
// included), and the Test Voice form.
//
// Labels are Alexandria's (Adapter Name, Dataset, Trained Adapters,
// Test Voice…). Copy is written from the user's side of the screen —
// what a thing does, never how it is stored.
import { ref, computed, onMounted, onActivated, onDeactivated, onUnmounted } from "vue";
import {
  UiButton, UiInput, UiField, UiSelect, UiTag,
  pushToast, postForm, requestBlob, confirmDialog, serverUrl as apiPath, UiTable,
} from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";
import { useEnginesStore } from "../../stores/engines.js";
import { capableRows, rowOptions } from "../../services/capabilities.js";
import {
  fileToB64, judgeClip, USABLE, GATE_TAG, gateSummary, TRAIN_LANGUAGES,
} from "../../services/trainingGates.js";

const emit = defineEmits(["build-dataset"]);
const api = useApi();
const enginesStore = useEnginesStore();

// ── Datasets ───────────────────────────────────────────────────────────
const datasets = ref([]);
const trainDataset = ref("");
const refOverride = ref("");
const datasetSamples = ref([]);
const uploadInput = ref(null);
const uploadBusy = ref(false);

async function loadDatasets() {
  const r = await api.safeRequest("/v1/train/datasets", { datasets: [] });
  datasets.value = r?.datasets || [];
}

const datasetOptions = computed(() => [
  { label: "-- Select dataset --", value: "" },
  ...datasets.value.map((d) => ({
    label: `${d.name} (${d.clip_count} clips · ${Math.round(d.total_seconds / 6) / 10} min)`,
    value: d.id,
  })),
]);
const selectedDataset = computed(
  () => datasets.value.find((d) => d.id === trainDataset.value) || null,
);

async function onDatasetChange(id) {
  trainDataset.value = id;
  refOverride.value = "";
  datasetSamples.value = [];
  if (!id) return;
  // A dataset remembers the language it was spoken in — adopt it. The
  // language decides the sound system the voice is taught in.
  const d = datasets.value.find((x) => x.id === id);
  if (d?.language) trainLanguage.value = d.language;
  try {
    const r = await api.request(`/v1/train/datasets/${id}/samples`);
    datasetSamples.value = r?.samples || [];
  } catch { /* the Reference Sample picker falls back to its default */ }
}

async function uploadZip(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  uploadBusy.value = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const d = await postForm("/v1/train/datasets/upload", fd);
    await loadDatasets();
    await onDatasetChange(d.id);
    pushToast({ message: `Dataset "${d.name}" uploaded — ${d.clip_count} clips.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Upload failed: ${e.message || e}`, kind: "error" });
  } finally {
    uploadBusy.value = false;
  }
}

async function deleteDataset(d) {
  const ok = await confirmDialog({
    title: `Delete dataset "${d.name}"?`,
    message: `${d.clip_count} clips and their transcripts are removed. Voices already trained from it keep working.`,
    danger: true,
    confirmLabel: "Delete dataset",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/train/datasets/${d.id}`, { method: "DELETE" });
    if (trainDataset.value === d.id) await onDatasetChange("");
    await loadDatasets();
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

// ── New Dataset from WAV Files — hand-picked clips become a dataset ────
// The gates + Whisper machinery built 2026-08-20, rehomed from the old
// run form: the run consumes datasets (Alexandria's flow); making one
// from loose clips is a dataset-side door.
const showClipsFlow = ref(false);
const clipFiles = ref([]); // [{ file, transcript, status, seconds, reason }]
const clipsName = ref("");
const clipsLanguage = ref("en");
const clipsRef = ref("");
const clipsSaving = ref(false);
const clipsInput = ref(null);
const transcribing = ref(false);

const valSettings = ref(null);
async function loadValidationSettings() {
  const s = await api.safeRequest("/v1/settings", null);
  valSettings.value = s?.training?.validation || null;
}

async function analyzeClip(s) {
  try {
    const analysis = await api.request("/v1/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wav_b64: await fileToB64(s.file) }),
    });
    Object.assign(s, judgeClip(analysis, valSettings.value));
  } catch {
    Object.assign(s, { status: "unchecked", seconds: null, reason: "" });
  }
}

function addClipFiles(event) {
  for (const file of Array.from(event.target.files || [])) {
    // Push first, then analyse the reactive element — mutating the raw
    // pre-push object updates state Vue never sees.
    clipFiles.value.push({ file, transcript: "", status: "checking", seconds: null, reason: "" });
    analyzeClip(clipFiles.value[clipFiles.value.length - 1]);
  }
  event.target.value = "";
}

const usableClips = computed(() => clipFiles.value.filter((s) => USABLE.has(s.status)));
const clipsGateLine = computed(() => gateSummary(clipFiles.value, valSettings.value));

async function transcribeClip(s) {
  s.transcribing = true;
  try {
    const fd = new FormData();
    fd.append("file", s.file);
    const r = await postForm("/v1/transcribe", fd);
    s.transcript = r?.text || s.transcript;
    s.confidence = r?.confidence ?? null;
    // /v1/transcribe auto-loads Whisper on first use — announce it.
    window.dispatchEvent(new Event("jv:health-refresh"));
  } catch (e) {
    pushToast({ message: `Couldn't transcribe ${s.file.name}: ${e.message || e}`, kind: "error" });
  } finally {
    s.transcribing = false;
  }
}
async function transcribeAllClips() {
  transcribing.value = true;
  try {
    // One at a time — Whisper loads once and every clip rides the warm model.
    for (const s of usableClips.value) {
      if (!s.transcript) await transcribeClip(s);
    }
  } finally {
    transcribing.value = false;
  }
}

const clipsRefOptions = computed(() => [
  { label: "Longest clip (chosen for you)", value: "" },
  ...usableClips.value.map((s, i) => ({
    label: `${i + 1}. ${s.file.name} — "${(s.transcript || "no transcript yet").slice(0, 40)}"`,
    value: String(i),
  })),
]);

async function saveClipsAsDataset() {
  if (!usableClips.value.length || !clipsName.value.trim() || clipsSaving.value) return;
  clipsSaving.value = true;
  try {
    const samplePayload = await Promise.all(
      usableClips.value.map(async ({ file, transcript }) => ({
        wav_b64: await fileToB64(file),
        transcript: transcript || "",
      })),
    );
    const d = await api.request("/v1/train/datasets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: clipsName.value.trim(),
        samples: samplePayload,
        language: clipsLanguage.value,
        ref_index: clipsRef.value === "" ? null : Number(clipsRef.value),
        origin: "clips",
      }),
    });
    await loadDatasets();
    await onDatasetChange(d.id);
    clipFiles.value = [];
    clipsName.value = "";
    clipsRef.value = "";
    showClipsFlow.value = false;
    pushToast({ message: `Dataset "${d.name}" saved — ${d.clip_count} clips.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Couldn't save the dataset: ${e.message || e}`, kind: "error" });
  } finally {
    clipsSaving.value = false;
  }
}

// ── Training Configuration ─────────────────────────────────────────────
const adapterName = ref("");
const trainEngine = ref("");
const trainVariant = ref("");
const trainLanguage = ref("en");
const trainBusy = ref(false);

const trainEpochs = ref("");
const trainLearningRate = ref("");
const trainBatchSize = ref("");
const trainGradAccum = ref("");
const trainLoraRank = ref("");
const trainLoraAlpha = ref("");

const capabilityRows = ref({});
async function loadCapabilities() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  capabilityRows.value = r?.engines || {};
  // Default the base so every knob is visible and correctly prefilled
  // from the first paint — a blank knob row was the old failure. Qwen3
  // Base first: it is the recipe the whole loop was verified on.
  if (!trainVariant.value) {
    const bases = trainableBases.value;
    const preferred =
      bases.find((b) => b.rowId.startsWith("qwen3-base")) || bases[0];
    if (preferred) onBaseChange(preferred.rowId);
  }
}
const trainableBases = computed(() =>
  capableRows(capabilityRows.value, enginesStore.items, "supports_training"),
);
// The shared builder — same load-state mechanism and a-z order as every
// other model dropdown (services/capabilities.js, 2026-08-21 ruling).
const baseOptions = computed(() =>
  rowOptions(capabilityRows.value, enginesStore.items, "supports_training"),
);

function onBaseChange(rowId) {
  trainVariant.value = rowId;
  const base = trainableBases.value.find((b) => b.rowId === rowId);
  if (!base) return;
  trainEngine.value = base.engine.id;
  const d = base.row.training_defaults;
  if (!d) return;
  trainEpochs.value = String(d.epochs);
  trainLearningRate.value = String(d.learning_rate);
  trainBatchSize.value = String(d.batch_size);
  trainGradAccum.value = String(d.grad_accum);
  trainLoraRank.value = String(d.lora_rank);
  trainLoraAlpha.value = String(d.lora_alpha);
}

const refOptions = computed(() => {
  const stored = selectedDataset.value?.ref_index;
  const base = stored != null
    ? `Clip ${stored + 1} — saved with this dataset`
    : "Longest clip (chosen for you)";
  return [
    { label: base, value: "" },
    ...datasetSamples.value.map((s, i) => ({
      label: `${i + 1}. "${(s.transcript || "no transcript").slice(0, 48)}"`,
      value: String(i),
    })),
  ];
});

const canSubmit = computed(
  () => trainVariant.value && adapterName.value.trim() && trainDataset.value,
);
const submitBlocker = computed(() => {
  if (!adapterName.value.trim()) return "Name the adapter first.";
  if (!trainVariant.value) return "Pick a base model.";
  if (!trainDataset.value) return "Pick a dataset — upload one, build one, or prepare a recording.";
  return "";
});

async function submitTrain() {
  if (!canSubmit.value) return;
  trainBusy.value = true;
  try {
    const body = {
      engine: trainEngine.value,
      variant: trainVariant.value,
      name: adapterName.value.trim(),
      language: trainLanguage.value,
      dataset_id: trainDataset.value,
      samples: [],
    };
    if (refOverride.value !== "") body.ref_index = Number(refOverride.value);
    if (trainEpochs.value) body.epochs = Number(trainEpochs.value);
    if (trainLearningRate.value) body.learning_rate = Number(trainLearningRate.value);
    if (trainBatchSize.value) body.batch_size = Number(trainBatchSize.value);
    if (trainGradAccum.value) body.grad_accum = Number(trainGradAccum.value);
    if (trainLoraRank.value) body.lora_rank = Number(trainLoraRank.value);
    if (trainLoraAlpha.value) body.lora_alpha = Number(trainLoraAlpha.value);

    await api.request("/v1/train", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    adapterName.value = "";
    await refreshJobs();
    startPolling();
  } catch (e) {
    pushToast({ message: `Couldn't start training: ${e.message || e}`, kind: "error" });
  } finally {
    trainBusy.value = false;
  }
}

// ── Jobs / progress ────────────────────────────────────────────────────
const trainJobs = ref([]);
// Kit grids in the JustVoice look (`jv-table-look`).
const DATASET_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Dataset", sortable: true },
  { id: "clip_count", accessorKey: "clip_count", header: "Clips", sortable: true,
    headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "length", accessorKey: "total_seconds", header: "Length", sortable: true,
    headerStyle: { width: "1%", whiteSpace: "nowrap" }, cellStyle: { width: "1%", whiteSpace: "nowrap" } },
  { id: "language", accessorKey: "language", header: "Language", sortable: true,
    headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "actions", header: "",
    headerStyle: { textAlign: "right", width: "1%" },
    cellStyle: { textAlign: "right", width: "1%", whiteSpace: "nowrap" } },
];
// The adapter list is TWO sources in one table — built-ins that ship with an
// engine, and adapters trained here. They were two `v-for`s in one <tbody>,
// which no data grid can take, so they merge into one array with a `__kind`
// flag and one shape. That flag is also what the Actions cell branches on.
const adapterRows = computed(() => [
  ...builtins.value.map((b) => ({
    __kind: "builtin", __key: `builtin-${b.id}`, src: b,
    name: b.name, base: b.variant || b.engine, dataset: "--",
    language: b.language || "--", epochs: b.epochs ?? "--",
    loss: b.final_loss ?? "--", samples: b.sample_count ?? "--",
  })),
  ...localAdapters.value.map((j) => ({
    __kind: "local", __key: j.job_id, src: j,
    name: j.voice_name, base: j.engine, dataset: j.dataset_name || "--",
    language: j.language || "--", epochs: j.epochs ?? "--",
    loss: lastLoss(j), samples: j.validation?.accepted ?? j.sample_count ?? "--",
  })),
]);
const ADAPTER_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Name", sortable: true },
  { id: "base", accessorKey: "base", header: "Base", sortable: true },
  { id: "dataset", accessorKey: "dataset", header: "Dataset", sortable: true },
  { id: "language", accessorKey: "language", header: "Language", sortable: true },
  { id: "epochs", accessorKey: "epochs", header: "Epochs", sortable: true },
  { id: "loss", accessorKey: "loss", header: "Final Loss", sortable: true },
  { id: "samples", accessorKey: "samples", header: "Samples", sortable: true },
  { id: "actions", header: "",
    headerStyle: { textAlign: "right", width: "1%" },
    cellStyle: { textAlign: "right", width: "1%", whiteSpace: "nowrap" } },
];

// Kit grid in the JustVoice look (`jv-table-look`) for the runs list.
const RUN_COLUMNS = [
  { id: "voice_name", accessorKey: "voice_name", header: "Adapter", sortable: true },
  { id: "engine", accessorKey: "engine", header: "Base", sortable: true },
  { id: "phase", accessorKey: "phase", header: "Phase", sortable: true },
  { id: "progress", accessorKey: "progress", header: "Progress", sortable: true },
  { id: "loss", header: "Final Loss" },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%", whiteSpace: "nowrap" } },
];

const ACTIVE_PHASES = new Set(["queued", "validating", "preparing", "running"]);
function phaseVariant(phase) {
  if (phase === "completed") return "success";
  if (phase === "failed") return "danger";
  if (ACTIVE_PHASES.has(phase)) return "accent2";
  return "secondary";
}

async function refreshJobs() {
  try {
    const t = await api.request("/v1/train");
    trainJobs.value = t.jobs || [];
  } catch (e) {
    pushToast({ message: `Couldn't load training runs: ${e.message || e}`, kind: "error" });
  }
}

async function cancelJob(id) {
  try {
    await api.request(`/v1/train/${id}`, { method: "DELETE" });
    await refreshJobs();
  } catch (e) {
    pushToast({ message: `Cancel failed: ${e.message || e}`, kind: "error" });
  }
}

let jobPoll = null;
function startPolling() {
  if (jobPoll) return;
  jobPoll = setInterval(async () => {
    await refreshJobs();
    if (!trainJobs.value.some((j) => ACTIVE_PHASES.has(j.phase))) stopPolling();
  }, 2000);
}
function stopPolling() {
  if (jobPoll) clearInterval(jobPoll);
  jobPoll = null;
}

const activeJob = computed(() => trainJobs.value.find((j) => ACTIVE_PHASES.has(j.phase)) || null);
const logJob = computed(
  () => activeJob.value || trainJobs.value.find((j) => (j.logs || []).length) || null,
);

function lastLoss(j) {
  return j.loss_curve?.length ? j.loss_curve[j.loss_curve.length - 1].toFixed(3) : "--";
}
function epochDisplay(j) {
  if (!j?.epochs) return "--";
  const now = Math.min(j.epochs, Math.max(0, Math.ceil((j.progress || 0) * j.epochs)));
  return `${now}/${j.epochs}`;
}

// ── Trained Adapters (local runs + built-ins) ──────────────────────────
const builtins = ref([]);
const builtinBusy = ref("");
async function loadBuiltins() {
  const r = await api.safeRequest("/v1/train/builtin", { adapters: [] });
  builtins.value = r?.adapters || [];
}

async function downloadBuiltin(b) {
  builtinBusy.value = b.id;
  try {
    const r = await api.request(`/v1/train/builtin/${b.id}/download`, { method: "POST" });
    await loadBuiltins();
    pushToast({ message: `${r.name} is ready — it's in your voice library now.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Download failed: ${e.message || e}`, kind: "error" });
  } finally {
    builtinBusy.value = "";
  }
}

const localAdapters = computed(() =>
  trainJobs.value.filter((j) => j.phase === "completed" && j.final_voice_id),
);
const adapterCount = computed(() => localAdapters.value.length + builtins.value.length);

// ── Test Voice ─────────────────────────────────────────────────────────
const testAdapter = ref("");
const testText = ref("The ancient library stood at the crossroads of two forgotten paths.");
const testInstruct = ref("");
const testBusy = ref(false);
const testAudio = ref("");

const testOptions = computed(() => [
  ...localAdapters.value.map((j) => ({ label: j.voice_name, value: j.final_voice_id })),
  ...builtins.value
    .filter((b) => b.downloaded && b.voice_id)
    .map((b) => ({ label: `${b.name} (built-in)`, value: b.voice_id })),
]);

async function runTest() {
  if (!testAdapter.value || testBusy.value) return;
  testBusy.value = true;
  try {
    const body = { text: testText.value.trim() };
    if (testInstruct.value.trim()) body.delivery = { instruct: testInstruct.value.trim() };
    const blob = await requestBlob(
      `/v1/voices/${testAdapter.value}/preview?auto_load=true`,
      { method: "POST", body },
    );
    if (testAudio.value) URL.revokeObjectURL(testAudio.value);
    testAudio.value = URL.createObjectURL(blob);
    // auto_load=true may have just loaded the engine server-side — every
    // other surface must hear about it (the jv:health-refresh contract).
    window.dispatchEvent(new Event("jv:health-refresh"));
  } catch (e) {
    pushToast({ message: `Couldn't generate the test line: ${e.message || e}`, kind: "error" });
  } finally {
    testBusy.value = false;
  }
}

function testThisAdapter(voiceId) {
  testAdapter.value = voiceId;
  runTest();
}

// ── Lifecycle ──────────────────────────────────────────────────────────
async function boot() {
  await Promise.all([
    enginesStore.ensureLoaded().catch(() => {}),
    loadCapabilities(),
    loadValidationSettings(),
    loadDatasets(),
    loadBuiltins(),
    refreshJobs(),
  ]);
  try {
    const want = window.sessionStorage?.getItem("jv.lora.pickDataset");
    if (want) {
      window.sessionStorage.removeItem("jv.lora.pickDataset");
      if (datasets.value.some((d) => d.id === want)) await onDatasetChange(want);
    }
  } catch { /* the operator picks from the list instead */ }
  if (trainJobs.value.some((j) => ACTIVE_PHASES.has(j.phase))) startPolling();
}

onMounted(boot);
onActivated(boot);
onDeactivated(stopPolling);
onUnmounted(() => {
  stopPolling();
  if (testAudio.value) URL.revokeObjectURL(testAudio.value);
});
</script>

<template>
  <!-- ── LoRA Training ─────────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">LoRA Training</h3>
      </div>
      <p class="jv-lede">
        Train a LoRA adapter on a base model to create a custom voice.
        Pick a dataset, configure the run, and train — the finished voice
        lands in your library and still follows written direction.
      </p>

      <!-- ── Dataset ──────────────────────────────────────────────────── -->
      <h4 class="lora-heading">Dataset</h4>
      <div class="lora-dataset-doors">
        <div class="lora-door">
          <input
            ref="uploadInput" type="file" accept=".zip,application/zip"
            style="display: none" @change="uploadZip"
          />
          <UiButton
            intent="secondary" :loading="uploadBusy"
            label="⬆ Upload ZIP"
            @click="uploadInput?.click()"
          />
          <p class="jv-hint">
            WAV clips with their transcripts, as one ZIP — the same file the
            Download button makes, and the same format Alexandria uses.
          </p>
        </div>
        <div class="lora-door">
          <UiButton
            intent="secondary" label="🧪 Build New Dataset"
            @click="emit('build-dataset')"
          />
          <p class="jv-hint">
            Open the Dataset Builder to create training datasets with
            per-line preview and generation.
          </p>
        </div>
        <div class="lora-door">
          <UiButton
            intent="secondary" label="＋ New Dataset from WAV Files"
            @click="showClipsFlow = !showClipsFlow"
          />
          <p class="jv-hint">
            Add clips you already have — each one is checked and
            transcribed, then saved as a dataset.
          </p>
        </div>
      </div>

      <!-- The dataset list — everything Training can train on. -->
      <UiTable class="jv-table-look lora-datasets jv-mt12" :data="datasets"
        :columns="DATASET_COLUMNS" data-key="id"
        :row-class="(row) => (row.id === trainDataset ? 'lora-row--selected' : '')">
        <template #length="{ row }">
          <span class="jv-muted">{{ Math.round(row.total_seconds / 6) / 10 }} min</span>
        </template>
        <template #language="{ row }"><span class="jv-muted">{{ row.language || "--" }}</span></template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <a
              class="ui-btn ui-btn--secondary ui-btn--small"
              :href="apiPath(`/v1/train/datasets/${row.id}/archive.zip`)"
              title="Download this dataset as a ZIP"
            >⬇ Download</a>
            <UiButton intent="danger-outline" size="small" label="Delete" @click="deleteDataset(row)" />
          </div>
        </template>
        <template #empty>
          No datasets yet — upload one, build one, or cut one from a recording
          on the Preparer tab.
        </template>
      </UiTable>

      <!-- New Dataset from WAV Files — the expanded flow -->
      <div v-if="showClipsFlow" class="jv-card jv-card--soft jv-mt12">
        <div class="jv-card__header"><h3 class="jv-card__title">New Dataset from WAV Files</h3></div>
        <p class="jv-lede">
          Pick the clips, check their transcripts, and save. Each clip is
          judged against your quality rules as it arrives; anything skipped
          says why.
        </p>
        <input
          ref="clipsInput" type="file" accept="audio/*" multiple
          style="display: none" @change="addClipFiles"
        />
        <div class="jv-inline-row">
          <UiButton intent="secondary" label="＋ Add WAV files" @click="clipsInput?.click()" />
          <UiButton
            v-if="usableClips.length"
            intent="secondary"
            :loading="transcribing"
            :label="transcribing ? 'Transcribing…' : '🎤 Transcribe All'"
            title="Fill every empty transcript with Whisper"
            @click="transcribeAllClips"
          />
          <span v-if="clipFiles.length" class="jv-note-xs">{{ clipsGateLine }}</span>
        </div>

        <table v-if="clipFiles.length" class="jv-table jv-mt12">
          <thead>
            <tr><th>File</th><th>Length</th><th>Check</th><th>Transcript</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="(s, idx) in clipFiles" :key="idx" :class="{ 'lora-row--skipped': !USABLE.has(s.status) }">
              <td><code class="jv-mono">{{ s.file.name }}</code></td>
              <td class="jv-muted">{{ s.seconds != null ? s.seconds.toFixed(1) + " s" : "--" }}</td>
              <td>
                <UiTag
                  :intent="GATE_TAG[s.status]?.intent || 'secondary'"
                  :value="GATE_TAG[s.status]?.label || s.status"
                  :title="s.reason || undefined"
                />
              </td>
              <td>
                <div class="lora-transcript">
                  <UiInput
                    v-model="s.transcript" width="full" :disabled="!USABLE.has(s.status)"
                    placeholder="What the speaker says in this clip"
                  />
                  <UiButton
                    intent="secondary" size="small" label="🎤"
                    :loading="!!s.transcribing" :disabled="!USABLE.has(s.status)"
                    title="Transcribe this clip with Whisper"
                    @click="transcribeClip(s)"
                  />
                </div>
                <span v-if="s.confidence != null" class="jv-note-xs">
                  transcriber was {{ Math.round(s.confidence * 100) }}% sure
                </span>
              </td>
              <td class="jv-table__actions">
                <UiButton intent="danger-outline" size="small" label="Remove" @click="clipFiles.splice(idx, 1)" />
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="usableClips.length" class="jv-field-row">
          <UiField label="Dataset Name" layout="block">
            <UiInput v-model="clipsName" width="name" placeholder="e.g. marius_session_1" />
          </UiField>
          <UiField label="Language" layout="block">
            <UiSelect v-model="clipsLanguage" :options="TRAIN_LANGUAGES" width="id" />
          </UiField>
          <UiField label="Reference Sample" layout="block">
            <UiSelect v-model="clipsRef" :options="clipsRefOptions" width="prose" />
          </UiField>
          <UiButton
            intent="primary" :disabled="!clipsName.trim() || clipsSaving" :loading="clipsSaving"
            label="Save as Training Dataset" @click="saveClipsAsDataset"
          />
        </div>
      </div>
    </div>
  </div>

  <!-- ── Training Configuration ────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header"><h3 class="jv-card__title">Training Configuration</h3></div>

      <div class="jv-field-row">
        <UiField label="Adapter Name" layout="block">
          <UiInput v-model="adapterName" placeholder="e.g. narrator_warm" width="name" />
        </UiField>
        <UiField label="Base Model" layout="block">
          <UiSelect
            :model-value="trainVariant" :options="baseOptions"
            width="name" @update:model-value="onBaseChange"
          />
        </UiField>
        <UiField label="Dataset" layout="block">
          <UiSelect
            :model-value="trainDataset" :options="datasetOptions" width="name"
            @update:model-value="onDatasetChange"
          />
        </UiField>
        <UiField label="Language" layout="block">
          <UiSelect v-model="trainLanguage" :options="TRAIN_LANGUAGES" width="id" />
        </UiField>
      </div>

      <div v-if="trainDataset" class="jv-field-row">
        <UiField label="Reference Sample" layout="block">
          <UiSelect v-model="refOverride" :options="refOptions" width="prose" />
        </UiField>
      </div>
      <p v-if="trainDataset" class="jv-hint">
        The voice's identity is taken from this one clip, and every line the
        finished voice speaks is prompted with it. Pick a clear,
        representative line.
      </p>

      <div class="jv-field-row">
        <UiField label="Epochs" layout="block">
          <UiInput v-model="trainEpochs" type="number" width="token" />
        </UiField>
        <UiField label="Learning Rate" layout="block">
          <!-- Text, not number: the recipe values are scientific notation
               (5e-6) and a number input renders them as 0.000005 — six
               zeros nobody can compare at a glance. Alexandria's is text
               for the same reason. -->
          <UiInput v-model="trainLearningRate" width="token" />
        </UiField>
        <UiField label="Batch Size" layout="block">
          <UiInput v-model="trainBatchSize" type="number" width="token" />
        </UiField>
        <UiField label="LoRA Rank" layout="block">
          <UiInput v-model="trainLoraRank" type="number" width="token" />
        </UiField>
        <UiField label="LoRA Alpha" layout="block">
          <UiInput v-model="trainLoraAlpha" type="number" width="token" />
        </UiField>
        <UiField label="Grad Accum Steps" layout="block">
          <UiInput v-model="trainGradAccum" type="number" width="token" />
        </UiField>
      </div>
      <p class="jv-hint">
        Filled in with the settings this base model is known to train well
        at. The language sets the sound system the voice is taught in —
        train one adapter per language.
      </p>

      <div class="jv-inline-row jv-mt12">
        <UiButton
          intent="primary" :disabled="trainBusy || !canSubmit" :loading="trainBusy"
          :label="trainBusy ? 'Starting…' : 'Start Training'"
          @click="submitTrain"
        />
        <span class="jv-note-xs">
          {{ submitBlocker || "Training takes the whole graphics card — every speech engine unloads while it runs." }}
        </span>
      </div>

      <details class="lora-explainer">
        <summary>How Settings Affect LoRA Voice Quality</summary>
        <ul>
          <li><strong>Epochs</strong> — passes over the dataset. More fits the voice closer; far past the default it overfits: the adapter parrots its samples, garbles new lines, and stops following direction.</li>
          <li><strong>Learning Rate</strong> — the size of each update step. Higher destabilises training; lower undertrains in the same number of epochs.</li>
          <li><strong>Batch Size × Grad Accum Steps</strong> — the effective batch. The defaults reproduce the recipe each base was verified with; changing one side changes the run materially.</li>
          <li><strong>LoRA Rank</strong> — the adapter's capacity. High rank captures the voice strongly but can drown out the model's ability to follow direction; low rank keeps it expressive but less exact.</li>
          <li><strong>LoRA Alpha</strong> — how strongly the adapter steers the base model. Effective strength is alpha ÷ rank; about double the rank is the usual starting point.</li>
          <li><strong>The dataset</strong> — 5–30 minutes of one clean speaker beats hours of noisy audio. Mix emotions and lengths: flat, neutral samples produce a flat voice that resists direction.</li>
        </ul>
      </details>
    </div>
  </div>

  <!-- ── Training Progress ─────────────────────────────────────────────── -->
  <div v-if="activeJob || logJob" class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Training Progress</h3>
        <UiButton intent="secondary" size="small" label="Refresh" @click="refreshJobs" />
      </div>
      <p v-if="!activeJob" class="jv-hint jv-mb14">
        The last run — "{{ logJob.voice_name }}" ({{ logJob.phase }}).
      </p>

      <div v-if="activeJob" class="lora-progress">
        <div class="jv-inline-row lora-progress__stats">
          <span>Epoch: <strong>{{ epochDisplay(activeJob) }}</strong></span>
          <span>Loss: <strong>{{ lastLoss(activeJob) }}</strong></span>
          <span class="jv-muted">{{ activeJob.voice_name }} · {{ activeJob.phase }}</span>
          <span class="jv-muted">{{ Math.round((activeJob.progress || 0) * 100) }}%</span>
        </div>
        <div class="jv-progress__track jv-progress__track--wide">
          <div class="jv-progress__bar" :style="{ width: Math.round((activeJob.progress || 0) * 100) + '%' }" />
        </div>
      </div>

      <div class="jv-logbox jv-mt12">
        <span v-for="(line, i) in (logJob?.logs || [])" :key="i" class="jv-logbox__line">{{ line }}</span>
        <span v-if="!(logJob?.logs || []).length" class="jv-logbox__empty">
          Waiting for the trainer to report…
        </span>
      </div>
    </div>
  </div>

  <!-- ── Trained Adapters ──────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Trained Adapters</h3>
        <UiButton
          intent="secondary" size="small" label="Refresh"
          @click="refreshJobs(); loadBuiltins()"
        />
      </div>

      <UiTable class="jv-table-look" :data="adapterRows" :columns="ADAPTER_COLUMNS" data-key="__key">
        <template #name="{ row }">
          <strong>{{ row.name }}</strong>
          <template v-if="row.__kind === 'builtin'">
            <UiTag intent="info" value="built-in" class="lora-badge" />
            <UiTag v-if="!row.src.downloaded" intent="accent2" value="not downloaded" class="lora-badge" />
            <span class="jv-hint lora-builtin-desc">{{ row.src.description }}</span>
          </template>
        </template>
        <template #base="{ row }"><span class="jv-mono jv-muted">{{ row.base }}</span></template>
        <template #language="{ row }"><span class="jv-muted">{{ row.language }}</span></template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <template v-if="row.__kind === 'builtin'">
              <UiButton
                v-if="!row.src.downloaded"
                intent="secondary" size="small"
                :loading="builtinBusy === row.src.id"
                label="⬇ Download"
                title="Fetch this voice's weights — it joins your library when done"
                @click="downloadBuiltin(row.src)"
              />
              <UiButton v-else intent="secondary" size="small" label="▶ Test" @click="testThisAdapter(row.src.voice_id)" />
            </template>
            <template v-else>
              <UiButton intent="secondary" size="small" label="▶ Test" @click="testThisAdapter(row.src.final_voice_id)" />
              <a
                class="ui-btn ui-btn--secondary ui-btn--small"
                :href="apiPath(`/v1/train/${row.src.job_id}/adapter.zip`)"
                title="Download the adapter weights as a ZIP"
              >⬇ Download</a>
            </template>
          </div>
        </template>
        <template #empty>No trained adapters yet.</template>
      </UiTable>
      <p v-if="adapterCount" class="jv-hint jv-mt12">
        Lower loss is not automatically the better likeness — past a point a
        voice garbles lines it has never seen. Hear it before committing.
      </p>
    </div>
  </div>

  <!-- ── Test Voice ────────────────────────────────────────────────────── -->
  <div v-if="testOptions.length" class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header"><h3 class="jv-card__title">Test Voice</h3></div>
      <div class="jv-field-row">
        <UiField label="Adapter" layout="block">
          <UiSelect v-model="testAdapter" :options="testOptions" width="name" placeholder="Pick one…" />
        </UiField>
        <UiField label="Text" layout="block">
          <UiInput v-model="testText" width="prose" />
        </UiField>
        <UiField label="Instruct" layout="block">
          <UiInput v-model="testInstruct" width="name" placeholder="e.g. Warm, gentle narration" />
        </UiField>
        <UiButton
          intent="primary"
          :disabled="!testAdapter || testBusy" :loading="testBusy"
          :label="testBusy ? 'Generating…' : '▶ Generate'"
          @click="runTest"
        />
      </div>
      <audio v-if="testAudio" :src="testAudio" controls autoplay class="jv-audio-inline jv-mt12" />
    </div>
  </div>

  <!-- ── Training Runs ─────────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ trainJobs.length }} Training Runs</h3>
        <UiButton intent="secondary" size="small" label="Refresh" @click="refreshJobs" />
      </div>
      <UiTable class="jv-table-look" :data="trainJobs" :columns="RUN_COLUMNS" data-key="job_id" row-hover>
        <template #engine="{ row }"><span class="jv-mono jv-muted">{{ row.engine }}</span></template>
        <template #phase="{ row }">
          <UiTag :intent="phaseVariant(row.phase)" :value="row.phase" />
          <span v-if="row.validation?.rejected" class="jv-note-xs lora-note">
            {{ row.validation.rejected }} clip{{ row.validation.rejected === 1 ? "" : "s" }} dropped by the trainer
          </span>
          <span v-if="row.error" class="jv-note-xs lora-note lora-note--bad">{{ row.error }}</span>
        </template>
        <template #progress="{ row }">
          <div class="jv-progress">
            <div class="jv-progress__track">
              <div
                class="jv-progress__bar"
                :class="{
                  'jv-progress__bar--done': row.phase === 'completed',
                  'jv-progress__bar--fail': row.phase === 'failed',
                }"
                :style="{ width: Math.round((row.progress || 0) * 100) + '%' }"
              />
            </div>
            <span class="jv-note-xs">{{ Math.round((row.progress || 0) * 100) }}%</span>
          </div>
        </template>
        <template #loss="{ row }"><span class="jv-muted">{{ lastLoss(row) }}</span></template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <UiButton
              v-if="ACTIVE_PHASES.has(row.phase)"
              intent="danger" size="small" label="Cancel" @click="cancelJob(row.job_id)"
            />
          </div>
        </template>
        <template #empty>No runs yet.</template>
      </UiTable>
    </div>
  </div>
</template>

<style scoped>
/* Section heading inside a card — Alexandria's "Dataset" / config split. */
.lora-heading {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
/* The three ways to get a dataset, side by side, each self-explanatory. */
.lora-dataset-doors { display: flex; gap: 24px; flex-wrap: wrap; }
.lora-door { max-width: 300px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
/* Both reach INTO the component: the class lands on the WRAP, not the <table>,
   and a scoped `td` selector never matches a cell the child renders (audit
   §19.1). */
.lora-datasets :deep(.ui-table) { width: auto; min-width: 640px; }
.lora-datasets :deep(.ui-table-row.lora-row--selected) td { background: var(--surface-2); }
.lora-row--skipped { opacity: 0.55; }
.lora-transcript { display: flex; align-items: center; gap: 6px; }
.lora-progress__stats { margin-bottom: 8px; font-size: 13px; }
.lora-badge { margin-left: 8px; }
.lora-builtin-desc { display: block; margin-top: 2px; }
.lora-note { display: block; margin-top: 2px; }
.lora-note--bad { color: var(--danger-ink); }
.lora-explainer { margin-top: 16px; }
.lora-explainer summary { cursor: pointer; font-size: 13px; color: var(--ink-2); }
.lora-explainer ul { margin: 10px 0 0; padding-left: 18px; }
.lora-explainer li { margin-bottom: 6px; font-size: 12.5px; color: var(--ink-2); line-height: 1.5; }
</style>
