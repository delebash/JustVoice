<!-- SPDX-License-Identifier: MIT -->
<!--
  Captures — dictation recorded here, and every capture with its transcripts.
  ● Record (decided 2026-11-06, the finish run's item 2) records the default
  microphone with the kit's recordMicrophone, makes it a WAV (toWav) and sends
  it to POST /v1/captures as the microphone's: the server transcribes it,
  cleans it when Settings → Capture says so, and keeps both texts. Global
  hotkeys and pasting into another app are not in this release; the cards
  that showed their keys, an auto-paste switch and the pill's window went with
  that decision.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { captureReadinessService } from "../services/projects.js";
import { captureLanguageWord } from "../services/captureLanguage.js";
import { AiTaskStrips, pageFlow, pushToast, recordMicrophone, reportError, toWav, withAiTask } from "@delebash/ui";
import { UiButton, UiInput, UiTag, UiChip } from "@delebash/ui";

const api = useApi();

const captures = ref([]);
const search = ref("");
const selectedId = ref(null);
const readiness = ref(null);

// All / Pinned / Today chips (parity: journeys mock) + search.
const FILTERS = ["all", "pinned", "today"];
const filter = ref("all");
const filtered = computed(() => {
  let list = captures.value;
  if (filter.value === "pinned") list = list.filter((c) => c.pinned);
  if (filter.value === "today") {
    const today = new Date().toDateString();
    list = list.filter((c) => new Date(c.created_at).toDateString() === today);
  }
  if (search.value) {
    const q = search.value.toLowerCase();
    list = list.filter(
      (c) => (c.transcript || "").toLowerCase().includes(q) ||
             (c.audio_path || "").toLowerCase().includes(q),
    );
  }
  // Pinned first, newest within each group.
  return [...list].sort((a, b) => (b.pinned - a.pinned) || (new Date(b.created_at) - new Date(a.created_at)));
});

async function togglePin(c) {
  try {
    const updated = await api.request(`/v1/captures/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !c.pinned }),
    });
    const idx = captures.value.findIndex((x) => x.id === c.id);
    if (idx >= 0) captures.value[idx] = updated;
  } catch (e) {
    reportError(e, { title: "Pin failed" });
  }
}

// "Speak again" — re-say the transcript: Voices, with it in the test line,
// where any voice can say it (decided 2026-10-05, when Generate went).
function speakAgain(c) {
  if (!c?.transcript) {
    pushToast({ kind: "info", message: "No transcript on this capture." });
    return;
  }
  try { window.sessionStorage?.setItem("jv.voices.testLine", c.transcript); } catch { /* ignore */ }
  window.location.hash = "#voices";
}

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
    reportError(e, { title: "Couldn't load captures" });
  }
}

async function refreshReadiness() {
  try {
    readiness.value = await captureReadinessService.get();
  } catch {
    // Server may not be reachable; non-blocking.
  }
}

// ● Record: the microphone until ■ Stop, then the recording, as WAV, to the
// server — its transcription a task on the page's strip (Cancel, Retry).
const recording = ref(false);
const recordStart = ref(0);
const now = ref(0);
let recorder = null;
let ticker = null;
async function toggleRecord() {
  if (recording.value) return finishRecording();
  try {
    recorder = await recordMicrophone();
  } catch (e) {
    reportError(e, { title: "Microphone unavailable" });
    return;
  }
  recordStart.value = now.value = Date.now();
  ticker = setInterval(() => { now.value = Date.now(); }, 250);
  recording.value = true;
}
async function finishRecording() {
  const rec = recorder;
  recorder = null;
  recording.value = false;
  clearInterval(ticker);
  let wav;
  try {
    wav = await toWav(await rec.stop());
  } catch (e) {
    reportError(e, { title: "The recording failed" });
    return;
  }
  await sendCapture(wav);
}
async function sendCapture(wav) {
  try {
    const capture = await withAiTask({ feature: "transcription", label: "Transcribing a recording", onRetry: () => sendCapture(wav) },
      (task) => {
        const form = new FormData();
        form.append("file", new File([wav], "recording.wav", { type: "audio/wav" }));
        form.append("source", "mic");
        return api.postForm("/v1/captures", form, { signal: task.signal });
      });
    await refresh();
    selectedId.value = capture.id;
  } catch (e) {
    reportError(e, { title: "Couldn't transcribe the recording" });
  }
}
onBeforeUnmount(() => {
  clearInterval(ticker);
  recorder?.stop().catch(() => {}); // leaving the page lets the microphone go; the recording is dropped
});

function fmtDuration(ms) {
  if (!ms) return "0:00";
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// What Settings → Captures holds, shown as it is (C3 — this said "auto" always).
const captureLanguage = ref("auto");
async function loadCaptureLanguage() {
  const s = await api.safeRequest("/v1/settings", null);
  captureLanguage.value = s?.captures?.language || "auto";
}

onMounted(() => {
  refresh();
  refreshReadiness();
  loadCaptureLanguage();
});
</script>

<template>
  <q-page :style-fn="pageFlow" class="captures jv-fill">
    <!-- ── Top band: where a recording comes from and the language it's heard in ── -->
    <div class="captures__top">
      <section class="jv-card captures__setup">
        <h3 class="jv-eyebrow captures__band-h">Recording</h3>
        <div class="captures__setup-row">
          <span class="jv-chip-card">🔉 Source: <strong>Default mic</strong></span>
          <span class="jv-chip-card">
            🌐 Capture language: <strong>{{ captureLanguageWord(captureLanguage) }}</strong>
          </span>
        </div>
        <p class="jv-muted captures__hint">
          ● Record dictates here: what you say is transcribed, cleaned up and listed below.
          Settings → Capture sets the language and the cleanup.
        </p>
      </section>
    </div>

    <!-- ── List pane ────────────────────────────────────────────────── -->
    <div class="captures__list jv-card jv-card--flat">
      <div class="captures__list-header">
        <span class="jv-section__title" style="margin:0;">Captures</span>
        <UiButton
          :intent="recording ? 'danger-outline' : 'primary'"
          size="small"
          :label="recording ? `■ Stop · ${fmtDuration(now - recordStart)}` : '● Record'"
          :title="recording ? 'Stop, and transcribe what you said' : 'Dictate with your microphone'"
          @click="toggleRecord"
        />
      </div>
      <AiTaskStrips :features="['transcription']" />
      <div class="captures__search">
        <UiInput v-model="search" placeholder="Search transcripts…" size="small" width="name" />
        <div class="captures__filters">
          <UiChip
            v-for="f in FILTERS"
            :key="f"
            :selected="filter === f"
            @click="filter = f"
          >{{ f.charAt(0).toUpperCase() + f.slice(1) }}</UiChip>
        </div>
      </div>

      <!-- Readiness banner -->
      <div v-if="!allReady && readiness" class="jv-banner jv-banner--warn" style="margin:8px;">
        <strong>Dictation readiness</strong>
        <div class="captures__checklist">
          <div class="captures__check-row" :class="{ 'captures__check-row--ok': readiness.stt.ready }">
            <UiTag :intent="readiness.stt.ready ? 'success' : 'secondary'" :value="readiness.stt.ready ? '✓' : '○'" />
            <span>{{ readiness.stt.display_name }} {{ readiness.stt.ready ? "loaded" : "not loaded" }}</span>
          </div>
          <div class="captures__check-row" :class="{ 'captures__check-row--ok': readiness.llm.ready }">
            <UiTag :intent="readiness.llm.ready ? 'success' : 'secondary'" :value="readiness.llm.ready ? '✓' : '○'" />
            <span>{{ readiness.llm.display_name }} {{ readiness.llm.ready ? "loaded" : "not loaded" }}</span>
          </div>
        </div>
      </div>

      <p v-if="filtered.length === 0" class="captures__empty jv-muted">
        No captures yet. Press ● Record to dictate.
      </p>

      <div
        v-for="c in filtered"
        :key="c.id"
        class="jv-pane-list__item"
        :class="{ 'jv-pane-list__item--active': c.id === selectedId }"
        @click="selectedId = c.id"
      >
        <div class="captures__item-row">
          <button
            type="button"
            class="captures__pin"
            :class="{ 'captures__pin--on': c.pinned }"
            :title="c.pinned ? 'Unpin' : 'Pin — repeated phrases sort first'"
            @click.stop="togglePin(c)"
          >📌</button>
          <span class="captures__source">{{ c.source }}</span>
          <span class="jv-pane-list__meta" style="margin-left:auto;">{{ new Date(c.created_at).toLocaleString() }}</span>
          <button
            type="button"
            class="captures__pin"
            title="Speak again — opens Voices with this transcript in the test line"
            @click.stop="speakAgain(c)"
          >↺</button>
        </div>
        <div class="jv-ellipsis captures__transcript">{{ c.transcript || "(no transcript)" }}</div>
      </div>
    </div>

    <!-- ── Detail pane ──────────────────────────────────────────────── -->
    <div class="captures__detail jv-card">
      <div v-if="!selectedCapture" class="captures__detail-empty jv-muted">
        <p>Select a capture to read its transcript, or press ● Record to dictate.</p>
      </div>
      <template v-else>
        <h2>Capture <span class="jv-mono">{{ selectedCapture.id.slice(0, 8) }}</span></h2>

        <table class="jv-table captures__meta-table">
          <tbody>
            <tr>
              <td><span class="jv-eyebrow">Source</span></td>
              <td>{{ selectedCapture.source }}</td>
              <td><span class="jv-eyebrow">Language</span></td>
              <td>{{ captureLanguageWord(selectedCapture.language) }}</td>
            </tr>
            <tr>
              <td><span class="jv-eyebrow">Duration</span></td>
              <td>{{ fmtDuration(selectedCapture.duration_ms) }}</td>
              <td><span class="jv-eyebrow">Created</span></td>
              <td>{{ new Date(selectedCapture.created_at).toLocaleString() }}</td>
            </tr>
          </tbody>
        </table>

        <h4 class="jv-eyebrow captures__sub-h">Refined transcript</h4>
        <p class="captures__body">{{ selectedCapture.transcript || "(empty)" }}</p>
        <h4 class="jv-eyebrow captures__sub-h">Raw (pre-refinement)</h4>
        <p class="captures__body captures__body--raw jv-mono">{{ selectedCapture.raw_transcript || "—" }}</p>
      </template>
    </div>
  </q-page>
</template>

<style scoped>
.captures {
  display: grid;
  grid-template-columns: 380px 1fr;
  grid-template-rows: auto 1fr;
  gap: 16px;
}

/* the one card as wide as what it holds (the layout rule: nothing stretches to the page's width) */
.captures__top { grid-column: 1 / -1; display: flex; min-width: 0; }
.captures__top > .jv-card { max-width: 100%; }
/* At phone width (Quasar's xs) the list sits over the capture it opens, each as tall as what it
   holds, and the page scrolls: the list's 380 px column ran 106 px past a 390 px window and the
   page scrolled sideways (2026-10-15). Stacked inside the pane's fixed height, the list's row
   was left no height at all. */
@media (max-width: 599.98px) {
  .captures { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; flex: none; }
}
.captures__setup { padding: 14px 18px; }
.captures__band-h,
.captures__sub-h { margin: 0 0 10px; }
.captures__sub-h:not(:first-of-type) { margin-top: 16px; }
.captures__setup-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.captures__hint { font-size: 12.5px; margin: 10px 0 0; }

/* List pane */
.captures__list { display: flex; flex-direction: column; gap: 0; overflow-y: auto; padding: 0; }
.captures__list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}
.captures__search { padding: 8px 16px; display: flex; flex-direction: column; gap: 8px; }
.captures__filters { display: flex; gap: 6px; }
.captures__pin {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  padding: 0 2px;
  opacity: 0.35;
  filter: grayscale(1);
}
.captures__pin:hover { opacity: 0.8; }
.captures__pin--on { opacity: 1; filter: none; }

.captures__source { font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; font-size: 12.5px; }
.captures__item-row { display: flex; align-items: center; gap: 8px; }
.captures__transcript { font-size: 13px; margin-top: 3px; }

.captures__checklist { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
.captures__check-row { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-3); }
.captures__check-row--ok { color: var(--accent); }

.captures__empty { padding: 24px 16px; text-align: center; }

/* Detail pane */
.captures__detail { padding: 28px; overflow-y: auto; }
.captures__detail-empty { text-align: center; padding: 40px; }
.captures__meta-table { margin: 14px 0 20px; }
.captures__meta-table td { font-size: 13px; padding: 6px 12px 6px 0; border: none; }
.captures__meta-table tbody tr:hover td { background: transparent; }

.captures__body { white-space: pre-wrap; line-height: 1.6; color: var(--ink-2); margin-top: 4px; }
.captures__body--raw { color: var(--ink-3); font-size: 13px; }
</style>
