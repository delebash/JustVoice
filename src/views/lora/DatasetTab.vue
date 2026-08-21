<!-- SPDX-License-Identifier: MIT -->
<script setup>
// Dataset Builder — a training dataset generated line by line.
//
// Alexandria's Dataset tab, fit to JV (decision table 2026-08-21):
// project select · New Dataset · Root Voice Description · Global Seed ·
// Add Row / Import JSON / Export JSON / Generate Pending / Regen All ·
// the row table (Emotion / Style · Text · Seed · Status · Audio) ·
// Save as Training Dataset with the Reference Sample picker. JV adds
// Model and Language — we have more than one voice-design model.
//
// Rows and their audio live on the server; a refresh costs nothing.
// The JSON files Import/Export use are Alexandria's own format (a bare
// array of {emotion, text, seed}), so scripts move between the two apps.
import { ref, computed, watch } from "vue";
import {
  UiButton, UiInput, UiTextarea, UiField, UiSelect, UiTag,
  pushToast, promptDialog, confirmDialog, serverUrl,
} from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";
import { useEnginesStore } from "../../stores/engines.js";
import { engineOptionsFor } from "../../services/capabilities.js";
import { TRAIN_LANGUAGES } from "../../services/trainingGates.js";

const emit = defineEmits(["use-dataset"]);
const api = useApi();
const enginesStore = useEnginesStore();

const projects = ref([]);
const projectId = ref("");
const project = ref(null);
const rows = ref([]);
const busyRow = ref(null);
const batchRunning = ref(false);
const cancelRequested = ref(false);
const saving = ref(false);
// Bumped after each generation so the <audio> src changes and the browser
// refetches — a regenerated take keeps the same URL otherwise.
const audioNonce = ref(0);
const importInput = ref(null);

// ── Which models can design a voice ────────────────────────────────────
// The picker shows the capability rows (what the person recognises), but
// the stored value is the ENGINE id — the render door resolves engines,
// not capability rows (VoicesView.vue:524 is the working precedent; the
// first build stored the row id and every generate would have 404'd).
const capabilityRows = ref({});
async function loadCapabilities() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  capabilityRows.value = r?.engines || {};
}
// The shared builder — engine-valued (the render door resolves engine
// ids), load-state suffixed, a-z (services/capabilities.js).
const designEngines = computed(() =>
  engineOptionsFor(capabilityRows.value, enginesStore.items, "supports_voice_design"),
);

// ── Projects ───────────────────────────────────────────────────────────
async function loadProjects() {
  const r = await api.safeRequest("/v1/train/builder", { projects: [] });
  projects.value = r?.projects || [];
}

const projectOptions = computed(() => [
  { label: "-- Select project --", value: "" },
  ...projects.value.map((p) => ({ label: p.name, value: p.id })),
]);

async function openProject(id) {
  projectId.value = id;
  if (!id) {
    project.value = null;
    rows.value = [];
    return;
  }
  try {
    const p = await api.request(`/v1/train/builder/${id}`);
    project.value = p;
    rows.value = (p.rows || []).map((r) => ({ ...r }));
  } catch (e) {
    pushToast({ message: `Couldn't open that project: ${e.message || e}`, kind: "error" });
  }
}

async function newProject() {
  const name = await promptDialog({
    title: "New Dataset",
    label: "Name",
    placeholder: "e.g. warm narrator",
  });
  if (!name?.trim()) return;
  try {
    const p = await api.request("/v1/train/builder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim() }),
    });
    await loadProjects();
    await openProject(p.id);
  } catch (e) {
    pushToast({ message: `Couldn't create it: ${e.message || e}`, kind: "error" });
  }
}

async function deleteProject() {
  if (!project.value) return;
  const ok = await confirmDialog({
    title: `Delete "${project.value.name}"?`,
    message: "The project and every clip generated in it are deleted. Training datasets already saved from it are not affected.",
    confirmLabel: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await api.request(`/v1/train/builder/${projectId.value}`, { method: "DELETE" });
    await loadProjects();
    await openProject("");
  } catch (e) {
    pushToast({ message: `Couldn't delete: ${e.message || e}`, kind: "error" });
  }
}

// ── Saving (debounced — every keystroke should not hit the server) ─────
let saveTimer = null;
function queueSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 500);
}

async function persist() {
  if (!projectId.value || !project.value) return;
  try {
    const p = await api.request(`/v1/train/builder/${projectId.value}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: project.value.description || "",
        engine: project.value.engine || null,
        language: project.value.language || "en",
        global_seed: normaliseSeed(project.value.global_seed),
        rows: rows.value.map((r) => ({
          emotion: r.emotion || "",
          text: r.text || "",
          seed: normaliseSeed(r.seed),
          status: r.status || "pending",
        })),
      }),
    });
    project.value = { ...project.value, ...p };
    rows.value = (p.rows || []).map((r) => ({ ...r }));
  } catch (e) {
    pushToast({ message: `Couldn't save: ${e.message || e}`, kind: "error" });
  }
}

function normaliseSeed(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// ── Rows ───────────────────────────────────────────────────────────────
function addRow() {
  rows.value.push({ emotion: "", text: "", seed: null, status: "pending", has_audio: false });
  queueSave();
}

async function removeRow(i) {
  rows.value.splice(i, 1);
  await persist();
}

function sampleUrl(i) {
  return serverUrl(`/v1/train/builder/${projectId.value}/sample/${i}?v=${audioNonce.value}`);
}

async function generateRow(i) {
  if (busyRow.value != null) return;
  busyRow.value = i;
  rows.value[i].status = "generating";
  try {
    await persist();
    await api.request(`/v1/train/builder/${projectId.value}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row_index: i }),
    });
    rows.value[i].status = "done";
    rows.value[i].has_audio = true;
    audioNonce.value += 1;
    // Generation loads the design engine server-side on first use —
    // announce it so the topbar pill and every list stay honest.
    window.dispatchEvent(new Event("jv:health-refresh"));
  } catch (e) {
    rows.value[i].status = "error";
    pushToast({ message: `Row ${i + 1} failed: ${e.message || e}`, kind: "error" });
  } finally {
    busyRow.value = null;
  }
}

/** Sequential on purpose: the model holds the whole graphics card, so
 *  parallel requests would queue behind each other anyway while making
 *  Cancel meaningless. */
async function generateAll(all) {
  if (batchRunning.value) return;
  batchRunning.value = true;
  cancelRequested.value = false;
  try {
    for (let i = 0; i < rows.value.length; i++) {
      if (cancelRequested.value) break;
      const r = rows.value[i];
      if (!(r.text || "").trim()) continue;
      if (!all && r.has_audio) continue;
      await generateRow(i);
    }
  } finally {
    batchRunning.value = false;
    cancelRequested.value = false;
  }
}

const doneCount = computed(() => rows.value.filter((r) => r.has_audio).length);
const withText = computed(() => rows.value.filter((r) => (r.text || "").trim()).length);
const progressPct = computed(() =>
  withText.value ? Math.round((doneCount.value / withText.value) * 100) : 0,
);

// ── Import / Export JSON — Alexandria's script format ──────────────────
function importJson(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(String(e.target.result));
      if (!Array.isArray(data)) throw new Error("expected a JSON array of rows");
      rows.value = data.map((item) => ({
        // `instruct` accepted as an emotion alias — Alexandria's importer
        // does the same, so either app's export loads in either.
        emotion: item.emotion || item.instruct || "",
        text: item.text || "",
        seed: item.seed ?? null,
        status: "pending",
        has_audio: false,
      }));
      await persist();
      pushToast({ message: `${rows.value.length} rows imported.`, kind: "success" });
    } catch (err) {
      pushToast({ message: `Import failed: ${err.message || err}`, kind: "error" });
    }
  };
  reader.readAsText(file);
}

function exportJson() {
  const data = rows.value.map((r) => {
    const entry = { emotion: r.emotion || "", text: r.text || "" };
    const seed = normaliseSeed(r.seed);
    if (seed != null) entry.seed = seed;
    return entry;
  });
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${project.value?.name || "dataset"}_script.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Reference Sample + save ────────────────────────────────────────────
const refRow = ref("");
const refOptions = computed(() => {
  const done = rows.value.map((r, i) => ({ r, i })).filter((x) => x.r.has_audio);
  if (!done.length) return [{ label: "First completed sample", value: "" }];
  return [
    { label: "First completed sample", value: "" },
    ...done.map((x) => ({
      label: `${x.i + 1}. ${(x.r.emotion || "neutral").slice(0, 24)} — "${(x.r.text || "").slice(0, 40)}"`,
      value: String(x.i),
    })),
  ];
});

async function saveAsDataset() {
  if (!doneCount.value || saving.value) return;
  const name = await promptDialog({
    title: "Save as Training Dataset",
    label: "Name",
    defaultValue: project.value?.name || "",
  });
  if (!name?.trim()) return;
  saving.value = true;
  try {
    // "First completed sample" resolves to the first generated row.
    let refIndex = refRow.value === "" ? null : Number(refRow.value);
    if (refIndex === null) {
      const first = rows.value.findIndex((r) => r.has_audio);
      refIndex = first >= 0 ? first : null;
    }
    const ds = await api.request(`/v1/train/builder/${projectId.value}/dataset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), ref_row_index: refIndex }),
    });
    pushToast({ message: `Dataset "${ds.name}" saved — ${ds.clip_count} clips.`, kind: "success" });
    emit("use-dataset", ds.id);
  } catch (e) {
    pushToast({ message: `Couldn't save: ${e.message || e}`, kind: "error" });
  } finally {
    saving.value = false;
  }
}

const ROW_TAG = {
  pending: { intent: "secondary", label: "pending" },
  generating: { intent: "accent2", label: "generating" },
  done: { intent: "success", label: "done" },
  error: { intent: "danger", label: "error" },
};

const saveBlocker = computed(() => {
  if (!project.value) return "";
  if (!doneCount.value) return "Generate at least one row before saving.";
  return "";
});

watch(() => project.value?.description, queueSave);
enginesStore.ensureLoaded().catch(() => {});
loadCapabilities();
loadProjects();
</script>

<template>
  <!-- ── Dataset Builder ───────────────────────────────────────────────── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header"><h3 class="jv-card__title">Dataset Builder</h3></div>
      <p class="jv-lede">
        Build a training dataset line by line — describe the voice once,
        write what it should say, generate each sample, listen, and
        re-generate any line until it's right. Because you wrote each
        line, every transcript is exact.
      </p>
      <div class="jv-field-row">
        <UiField label="Project" layout="block">
          <UiSelect
            :model-value="projectId" :options="projectOptions" width="name"
            @update:model-value="openProject"
          />
        </UiField>
        <UiButton intent="secondary" label="＋ New Dataset" @click="newProject" />
        <UiButton
          v-if="project" intent="danger-outline" size="small" label="Delete"
          @click="deleteProject"
        />
      </div>
    </div>
  </div>

  <template v-if="project">
    <!-- ── The voice every row is spoken in ───────────────────────────── -->
    <div class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">The Voice</h3></div>
        <UiField label="Root Voice Description" layout="block">
          <UiTextarea
            v-model="project.description" width="prose" :rows="2"
            placeholder="e.g. A male tenor with a steady, clean tone, light nasal resonance, and even delivery"
          />
        </UiField>
        <div class="jv-field-row">
          <UiField label="Model" layout="block">
            <UiSelect
              v-model="project.engine" :options="designEngines" width="name"
              placeholder="Pick a model…" @update:model-value="persist"
            />
          </UiField>
          <UiField label="Language" layout="block">
            <UiSelect
              v-model="project.language" :options="TRAIN_LANGUAGES" width="id"
              @update:model-value="persist"
            />
          </UiField>
          <UiField label="Global Seed" layout="block">
            <UiInput
              v-model="project.global_seed" type="number" width="token"
              placeholder="random" @change="persist"
            />
          </UiField>
        </div>
        <p class="jv-hint">
          Empty = random. Same seed = same voice — set one, or every row is
          a slightly different person. A row's own Seed overrides it.
        </p>
      </div>
    </div>

    <!-- ── The rows ───────────────────────────────────────────────────── -->
    <div class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">{{ rows.length }} rows · {{ doneCount }} generated</h3>
        </div>

        <div class="jv-inline-row dsb-toolbar">
          <UiButton intent="secondary" size="small" label="＋ Add Row" @click="addRow" />
          <input
            ref="importInput" type="file" accept=".json,application/json"
            style="display: none" @change="importJson"
          />
          <UiButton
            intent="secondary" size="small" label="⇤ Import JSON"
            title="Load rows from a script file — Alexandria's dataset scripts load unchanged"
            @click="importInput?.click()"
          />
          <UiButton
            intent="secondary" size="small" label="⇥ Export JSON"
            :disabled="!rows.length" @click="exportJson"
          />
          <span class="jv-spacer" />
          <UiButton
            intent="primary" size="small"
            :disabled="batchRunning || !withText"
            :loading="batchRunning"
            label="▶ Generate Pending"
            @click="generateAll(false)"
          />
          <UiButton
            intent="secondary" size="small"
            :disabled="batchRunning || !withText"
            label="↻ Regen All"
            @click="generateAll(true)"
          />
          <UiButton
            v-if="batchRunning"
            intent="danger-outline" size="small" label="Cancel"
            @click="cancelRequested = true"
          />
          <span v-if="withText" class="jv-note-xs">
            {{ doneCount }} of {{ withText }} ({{ progressPct }}%)
          </span>
        </div>

        <div v-if="batchRunning || doneCount" class="jv-progress__track jv-progress__track--wide dsb-progress">
          <div class="jv-progress__bar" :style="{ width: progressPct + '%' }" />
        </div>

        <table v-if="rows.length" class="jv-table dsb-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Emotion / Style</th>
              <th>Text</th>
              <th>Seed</th>
              <th>Status</th>
              <th>Audio</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(r, i) in rows" :key="i">
              <td class="jv-muted">{{ i + 1 }}</td>
              <td>
                <UiInput
                  v-model="r.emotion" width="name" placeholder="e.g. Savagely sarcastic"
                  @change="queueSave"
                />
              </td>
              <td>
                <UiTextarea
                  v-model="r.text" width="prose" :rows="2"
                  placeholder="Sample text…" @change="queueSave"
                />
              </td>
              <td>
                <UiInput
                  v-model="r.seed" type="number" width="token" placeholder="--"
                  @change="queueSave"
                />
              </td>
              <td>
                <UiTag
                  :intent="ROW_TAG[r.status]?.intent || 'secondary'"
                  :value="ROW_TAG[r.status]?.label || 'pending'"
                />
              </td>
              <td>
                <audio v-if="r.has_audio" :src="sampleUrl(i)" controls class="jv-audio-inline" />
                <span v-else class="jv-muted">--</span>
              </td>
              <td class="jv-table__actions">
                <UiButton
                  intent="secondary" size="small"
                  :disabled="busyRow != null || !(r.text || '').trim()"
                  :loading="busyRow === i"
                  :label="r.has_audio ? '↻' : '▶'"
                  :title="r.has_audio ? 'Regenerate this line' : 'Generate this line'"
                  @click="generateRow(i)"
                />
                <UiButton
                  intent="danger-outline" size="small" label="Remove"
                  :disabled="batchRunning" @click="removeRow(i)"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-hint">
          No rows yet. Add some — mix emotions, lengths and pacing, and
          include a few short lines like "Oh!" or "Right." so the voice
          learns to stop cleanly. End with a long, calm passage and make it
          the Reference Sample.
        </p>
      </div>
    </div>

    <!-- ── Save as Training Dataset ───────────────────────────────────── -->
    <div class="jv-section">
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Save as Training Dataset</h3></div>
        <div class="jv-field-row">
          <UiField label="Reference Sample" layout="block">
            <UiSelect v-model="refRow" :options="refOptions" width="prose" />
          </UiField>
          <UiButton
            intent="primary"
            :disabled="!!saveBlocker || saving"
            :loading="saving"
            label="Save as Training Dataset"
            @click="saveAsDataset"
          />
        </div>
        <p class="jv-hint">
          The reference sample becomes the voice's identity: training takes
          its fingerprint from that one clip, and every line the finished
          voice speaks is prompted with it. Pick a clear, representative
          line.
        </p>
        <p v-if="saveBlocker" class="jv-note-xs">{{ saveBlocker }}</p>
      </div>
    </div>
  </template>
</template>

<style scoped>
.dsb-toolbar { margin-bottom: 12px; }
.dsb-progress { margin-bottom: 12px; }
/* Sized to what it holds — the Text column wants the room; the table
   ends where its content ends. */
.dsb-table { width: auto; min-width: 960px; }
</style>
