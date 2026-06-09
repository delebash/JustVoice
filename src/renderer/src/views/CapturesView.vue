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
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
import JvInput from "../components/jv/JvInput.vue";

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
    <!-- ── List pane ────────────────────────────────────────────────── -->
    <div class="captures__list jv-card jv-card--flat">
      <div class="captures__list-header">
        <span class="jv-section__title" style="margin:0;">Captures</span>
        <JvButton
          :variant="isRecording ? 'danger' : 'primary'"
          size="sm"
          :label="isRecording ? 'Stop' : 'Record'"
          @click="isRecording ? stopRecording() : startRecording()"
        />
      </div>
      <div class="captures__search">
        <JvInput v-model="search" placeholder="Search transcripts…" size="sm" />
      </div>

      <!-- Readiness banner -->
      <div v-if="!allReady && readiness" class="jv-banner jv-banner--warn" style="margin:8px;">
        <strong>Dictation readiness</strong>
        <div class="captures__checklist">
          <div class="captures__check-row" :class="{ 'captures__check-row--ok': readiness.stt.ready }">
            <JvTag :variant="readiness.stt.ready ? 'success' : 'default'" :label="readiness.stt.ready ? '✓' : '○'" />
            <span>{{ readiness.stt.display_name }} {{ readiness.stt.ready ? "loaded" : "not loaded" }}</span>
          </div>
          <div class="captures__check-row" :class="{ 'captures__check-row--ok': readiness.llm.ready }">
            <JvTag :variant="readiness.llm.ready ? 'success' : 'default'" :label="readiness.llm.ready ? '✓' : '○'" />
            <span>{{ readiness.llm.display_name }} {{ readiness.llm.ready ? "loaded" : "not loaded" }}</span>
          </div>
        </div>
      </div>

      <p v-if="filtered.length === 0" class="captures__empty jv-muted">
        No captures yet. Hit "Record" or press your dictation hotkey.
      </p>

      <div
        v-for="c in filtered"
        :key="c.id"
        class="jv-pane-list__item"
        :class="{ 'jv-pane-list__item--active': c.id === selectedId }"
        @click="selectedId = c.id"
      >
        <div class="captures__item-row">
          <span class="captures__source">{{ c.source }}</span>
          <span class="jv-pane-list__meta" style="margin-left:auto;">{{ new Date(c.created_at).toLocaleString() }}</span>
        </div>
        <div class="jv-ellipsis captures__transcript">{{ c.transcript || "(no transcript)" }}</div>
      </div>
    </div>

    <!-- ── Detail pane ──────────────────────────────────────────────── -->
    <div class="captures__detail jv-card">
      <div class="captures__pill-row">
        <CapturePill :state="pillState" :elapsed-ms="elapsedMs" @stop="stopRecording" />
      </div>
      <div v-if="!selectedCapture" class="captures__detail-empty jv-muted">
        <p>Select a capture to inspect, or press the dictation hotkey to record.</p>
      </div>
      <template v-else>
        <h2>Capture <span class="jv-mono">{{ selectedCapture.id.slice(0, 8) }}</span></h2>

        <table class="jv-table captures__meta-table">
          <tbody>
            <tr>
              <td><span class="jv-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Source</span></td>
              <td>{{ selectedCapture.source }}</td>
              <td><span class="jv-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Language</span></td>
              <td>{{ selectedCapture.language ?? "auto" }}</td>
            </tr>
            <tr>
              <td><span class="jv-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Duration</span></td>
              <td>{{ fmtDuration(selectedCapture.duration_ms) }}</td>
              <td><span class="jv-muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;">Created</span></td>
              <td>{{ new Date(selectedCapture.created_at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>

        <h3 style="margin:20px 0 6px;">Refined transcript</h3>
        <p class="captures__body">{{ selectedCapture.transcript || "(empty)" }}</p>
        <h3 style="margin:16px 0 6px;">Raw (pre-refinement)</h3>
        <p class="captures__body captures__body--raw jv-mono">{{ selectedCapture.raw_transcript || "—" }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.captures {
  display: grid;
  grid-template-columns: 380px 1fr;
  height: 100%;
  gap: 16px;
  padding: 16px;
}

/* List pane */
.captures__list { display: flex; flex-direction: column; gap: 0; overflow-y: auto; padding: 0; }
.captures__list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}
.captures__search { padding: 8px 16px; }

.captures__source { font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 11px; }
.captures__item-row { display: flex; align-items: center; gap: 8px; }
.captures__transcript { font-size: 13px; margin-top: 3px; }

.captures__checklist { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.captures__check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3); }
.captures__check-row--ok { color: var(--accent); }

.captures__empty { padding: 24px 16px; text-align: center; }

/* Detail pane */
.captures__detail { padding: 28px; overflow-y: auto; }
.captures__pill-row { display: flex; justify-content: center; padding: 16px 0 20px; }
.captures__detail-empty { text-align: center; padding: 40px; }
.captures__meta-table { margin: 14px 0 20px; }
.captures__meta-table td { font-size: 13px; padding: 6px 12px 6px 0; border: none; }
.captures__meta-table tbody tr:hover td { background: transparent; }

.captures__body { white-space: pre-wrap; line-height: 1.6; color: var(--ink-2); margin-top: 4px; }
.captures__body--raw { color: var(--ink-3); font-size: 13px; }
</style>
