<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CapturesView — dictation + voice-sample capture list. Lifts the voicebox
  CapturesTab pattern translated to Vue. The animated CapturePill component
  surfaces live state; the table lists past captures with their transcripts.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { captureReadinessService } from "../services/projects.js";
import { pushToast } from "../services/toastBridge.js";
import CapturePill from "../components/CapturePill.vue";
import ListPane from "../components/ListPane.vue";

const api = useApi();

const captures = ref([]);
const search = ref("");
const selectedId = ref(null);
const readiness = ref(null);
const pillState = ref("rest");
const elapsedMs = ref(0);
const isRecording = ref(false);

const filtered = computed(() => {
  if (!search.value) return captures.value;
  const q = search.value.toLowerCase();
  return captures.value.filter(
    (c) => (c.transcript || "").toLowerCase().includes(q) ||
           (c.audio_path || "").toLowerCase().includes(q),
  );
});

const selectedCapture = computed(() =>
  captures.value.find((c) => c.id === selectedId.value),
);

const allReady = computed(() => readiness.value?.stt?.ready && readiness.value?.llm?.ready);

async function refresh() {
  try {
    const res = await api.request("/v1/captures");
    captures.value = res.captures ?? res ?? [];
    if (!selectedId.value && captures.value.length > 0) selectedId.value = captures.value[0].id;
  } catch (e) {
    pushToast({ kind: "error", title: "Couldn't load captures", description: String(e?.message ?? e) });
  }
}

async function refreshReadiness() {
  try {
    readiness.value = await captureReadinessService.get();
  } catch {
    // Server may not be reachable; non-blocking.
  }
}

function startRecording() {
  // The full record-transcribe-refine cycle is owned by useCaptureRecordingSession
  // (a Phase 4c follow-on). For v1 this surfaces the state machine via the pill;
  // the Tauri shell dictate window does the actual audio capture.
  isRecording.value = true;
  pillState.value = "recording";
  elapsedMs.value = 0;
  const start = performance.now();
  const tick = () => {
    if (!isRecording.value) return;
    elapsedMs.value = performance.now() - start;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function stopRecording() {
  isRecording.value = false;
  pillState.value = "transcribing";
  setTimeout(() => (pillState.value = "refining"), 1500);
  setTimeout(() => {
    pillState.value = "completed";
    refresh();
  }, 3000);
  setTimeout(() => (pillState.value = "rest"), 5000);
}

function fmtDuration(ms) {
  if (!ms) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

onMounted(() => {
  refresh();
  refreshReadiness();
});
</script>

<template>
  <div class="captures">
    <ListPane v-model:search-value="search" title="Captures" search-placeholder="Search transcripts…">
      <template #actions>
        <button class="btn btn--primary" @click="isRecording ? stopRecording() : startRecording()">
          {{ isRecording ? "Stop" : "Record" }}
        </button>
      </template>

      <div v-if="!allReady && readiness" class="captures__readiness">
        <h4>Dictation readiness</h4>
        <div class="checklist">
          <div class="check-row" :class="{ ready: readiness.stt.ready }">
            <span class="check-row__icon">{{ readiness.stt.ready ? "✓" : "○" }}</span>
            <span>{{ readiness.stt.display_name }} {{ readiness.stt.ready ? "loaded" : "not loaded" }}</span>
          </div>
          <div class="check-row" :class="{ ready: readiness.llm.ready }">
            <span class="check-row__icon">{{ readiness.llm.ready ? "✓" : "○" }}</span>
            <span>{{ readiness.llm.display_name }} {{ readiness.llm.ready ? "loaded" : "not loaded" }}</span>
          </div>
        </div>
      </div>

      <div v-if="filtered.length === 0" class="captures__empty">
        <p>No captures yet. Hit "Record" or press your dictation hotkey.</p>
      </div>
      <div
        v-for="c in filtered"
        :key="c.id"
        class="captures__item"
        :class="{ 'captures__item--active': c.id === selectedId }"
        @click="selectedId = c.id"
      >
        <div class="captures__item-row">
          <span class="captures__source">{{ c.source }}</span>
          <span class="captures__date">{{ new Date(c.created_at).toLocaleString() }}</span>
        </div>
        <div class="captures__transcript">{{ c.transcript || "(no transcript)" }}</div>
      </div>
    </ListPane>

    <div class="captures__detail">
      <div class="captures__pill-row">
        <CapturePill :state="pillState" :elapsed-ms="elapsedMs" @stop="stopRecording" />
      </div>
      <div v-if="!selectedCapture" class="captures__detail-empty">
        <p>Select a capture to inspect, or press the dictation hotkey to record.</p>
      </div>
      <template v-else>
        <h2>Capture {{ selectedCapture.id.slice(0, 8) }}</h2>
        <dl class="captures__meta">
          <div><dt>Source</dt><dd>{{ selectedCapture.source }}</dd></div>
          <div><dt>Language</dt><dd>{{ selectedCapture.language ?? "auto" }}</dd></div>
          <div><dt>Duration</dt><dd>{{ fmtDuration(selectedCapture.duration_ms) }}</dd></div>
          <div><dt>Created</dt><dd>{{ new Date(selectedCapture.created_at).toLocaleString() }}</dd></div>
        </dl>
        <h3>Refined transcript</h3>
        <p class="captures__body">{{ selectedCapture.transcript || "(empty)" }}</p>
        <h3>Raw (pre-refinement)</h3>
        <p class="captures__body captures__body--raw">{{ selectedCapture.raw_transcript || "—" }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.captures { display: grid; grid-template-columns: 380px 1fr; height: 100%; gap: 0; }
.captures__readiness { padding: 12px 16px; background: var(--surface-2, #fbfaf7); border-radius: 6px; margin: 0 8px 12px; }
.captures__readiness h4 { margin: 0 0 8px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
.checklist { display: flex; flex-direction: column; gap: 4px; }
.check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3, #888); }
.check-row.ready { color: var(--accent, #3a7d63); }
.check-row__icon { width: 16px; text-align: center; }
.captures__item { padding: 10px 16px; cursor: pointer; border-radius: 6px; margin: 0 8px 2px; }
.captures__item:hover { background: var(--surface-2, #fbfaf7); }
.captures__item--active { background: var(--accent, #3a7d63); color: #fff; }
.captures__item-row { display: flex; gap: 8px; align-items: center; font-size: 11px; opacity: 0.7; }
.captures__source { font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
.captures__date { margin-left: auto; }
.captures__transcript { font-size: 13px; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.captures__detail { padding: 32px; overflow-y: auto; }
.captures__pill-row { display: flex; justify-content: center; padding: 16px 0; }
.captures__detail-empty { text-align: center; color: var(--ink-2, #4a4a4a); padding: 40px; }
.captures__meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 24px; margin: 16px 0 24px; }
.captures__meta div { display: flex; flex-direction: column; }
.captures__meta dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
.captures__meta dd { margin: 0; font-size: 14px; }
.captures__body { white-space: pre-wrap; line-height: 1.6; }
.captures__body--raw { color: var(--ink-3, #888); font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 13px; }
.captures__empty { padding: 32px; text-align: center; color: var(--ink-3, #888); }
.btn { height: 32px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong, #cfccc4); background: var(--surface-2, #fbfaf7); color: inherit; }
.btn--primary { background: var(--accent, #3a7d63); color: #fff; border-color: var(--accent, #3a7d63); }
</style>
