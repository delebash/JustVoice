<!--
  SPDX-License-Identifier: MIT
  SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
  SPDX-FileCopyrightText: 2026 JustVoice contributors

  Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/app/src/components/DictateWindow/DictateWindow.tsx
  (commit pinned in voicebox-pin.txt at repo root).
  Translated React -> Vue on 2026-06-08. Modifications by JustVoice contributors
  are licensed under MIT. MIT permission notice continues to apply
  to upstream-derived portions.

  Floating dictate surface shown in a separate transparent Tauri window.
  Mounted when the URL contains `?view=dictate`. Surfaces the CapturePill
  for two independent cycles:
    1. User dictation - driven by `dictate:start` / `dictate:stop` from the
       Rust hotkey monitor (DEFERRED — the full hotkey + paste injection
       impl is in Phase 6).
    2. Agent speech - driven by `dictate:speak-start` / `dictate:speak-end`
       from the Rust `speak_monitor` (which owns the backend SSE stream).
       On speak-start we subscribe to this single generation's status SSE,
       then play `/audio/{id}` via a plain HTMLAudioElement when it lands.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import CapturePill from "./CapturePill.vue";
import { useApi } from "../stores/api.js";

const api = useApi();

// Pill state machine — speaking / recording / transcribing / refining / etc.
const pillState = ref("rest");
const elapsedMs = ref(0);
const errorMessage = ref("");

// Force the host document chrome transparent so the Tauri window takes
// on the pill's own shape.
onMounted(() => {
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
});
onBeforeUnmount(() => {
  document.documentElement.style.background = "";
  document.body.style.background = "";
});

// ── Agent-speak cycle ──────────────────────────────────────────────────
let statusSource = null;
let audioEl = null;
let speakStartedAt = null;
let elapsedTimer = null;
let stuckTimeout = null;
let endGraceTimeout = null;

function clearTimers() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
  if (stuckTimeout) {
    clearTimeout(stuckTimeout);
    stuckTimeout = null;
  }
  if (endGraceTimeout) {
    clearTimeout(endGraceTimeout);
    endGraceTimeout = null;
  }
}

function dismissSpeak() {
  if (statusSource) {
    statusSource.close();
    statusSource = null;
  }
  if (audioEl) {
    audioEl.pause();
    audioEl.src = "";
    audioEl = null;
  }
  clearTimers();
  pillState.value = "rest";
  elapsedMs.value = 0;
  speakStartedAt = null;
  // Tell Rust to tuck the window away. Rust owns the hide+park+click-through
  // dance because calling hide() directly from JS has been unreliable for
  // transparent always-on-top windows on macOS.
  emitTauri("dictate:hide", {});
}

async function emitTauri(event, payload) {
  try {
    const { emit } = await import("@tauri-apps/api/event");
    await emit(event, payload);
  } catch {
    /* not running inside Tauri */
  }
}

function startSpeakPlayback(generationId) {
  const url = `${api.serverUrl}/audio/${generationId}`;
  const audio = new Audio(url);
  audio.onended = () => dismissSpeak();
  audio.onerror = () => dismissSpeak();
  audio.onplaying = () => {
    // Surface the window the moment audio starts (we kept it hidden through
    // the ~1s generation wait so the user doesn't see a silent pill).
    emitTauri("dictate:show", {});
    speakStartedAt = Date.now();
    pillState.value = "speaking";
    elapsedMs.value = 0;
    elapsedTimer = setInterval(() => {
      if (speakStartedAt) elapsedMs.value = Date.now() - speakStartedAt;
    }, 250);
  };
  audioEl = audio;
  audio.play().catch(() => dismissSpeak());
}

async function onSpeakStart(eventPayload) {
  // Rust emits the SSE payload as a JSON STRING (not parsed). Handle both.
  let parsed = {};
  try {
    parsed = typeof eventPayload === "string" ? JSON.parse(eventPayload) : eventPayload || {};
  } catch {
    return;
  }
  const id = parsed.generation_id;
  if (!id) return;

  // Tear down any previous cycle — last speak wins.
  dismissSpeak();

  pillState.value = "transcribing"; // visual cue while we wait for completion
  elapsedMs.value = 0;

  // Subscribe to this one generation's status. When it completes, the
  // /audio/{id} endpoint will serve the WAV we need to play.
  const source = new EventSource(`${api.serverUrl}/v1/generate/${id}/status`);
  statusSource = source;

  // Stuck-cap: 60s without ever hearing back from the backend.
  stuckTimeout = setTimeout(() => {
    if (!audioEl) dismissSpeak();
  }, 60000);

  source.onmessage = (msg) => {
    try {
      const data = JSON.parse(msg.data);
      if (data.status === "completed") {
        if (stuckTimeout) clearTimeout(stuckTimeout);
        stuckTimeout = null;
        source.close();
        if (statusSource === source) statusSource = null;
        startSpeakPlayback(id);
      } else if (data.status === "failed" || data.status === "not_found") {
        source.close();
        dismissSpeak();
      }
    } catch {
      // heartbeats / junk - ignore
    }
  };
  source.onerror = () => {
    // EventSource auto-reconnects on transient drops; the stuckTimeout
    // is the backstop for the case where it never recovers.
  };
}

function onSpeakEnd(eventPayload) {
  let parsed = {};
  try {
    parsed = typeof eventPayload === "string" ? JSON.parse(eventPayload) : eventPayload || {};
  } catch {
    return;
  }
  if (parsed.status && parsed.status !== "completed") {
    // Failed / cancelled - dismiss immediately.
    dismissSpeak();
    return;
  }
  // Completed: if audio never started (shouldn't happen, but guard),
  // auto-dismiss after 15s so the pill never stays forever.
  endGraceTimeout = setTimeout(() => {
    if (!audioEl) dismissSpeak();
  }, 15000);
}

const unlistens = [];

onMounted(async () => {
  try {
    const { listen } = await import("@tauri-apps/api/event");
    unlistens.push(await listen("dictate:speak-start", (e) => onSpeakStart(e.payload)));
    unlistens.push(await listen("dictate:speak-end", (e) => onSpeakEnd(e.payload)));
  } catch {
    /* not running inside Tauri */
  }
});

onBeforeUnmount(() => {
  for (const fn of unlistens) {
    try {
      fn();
    } catch {
      /* unlisten failed; not fatal */
    }
  }
  dismissSpeak();
});

const showPill = computed(() => pillState.value !== "rest");
</script>

<template>
  <div class="dictate-window">
    <CapturePill
      v-if="showPill"
      :state="pillState"
      :elapsed-ms="elapsedMs"
      :error-message="errorMessage"
      @dismiss="dismissSpeak"
    />
  </div>
</template>

<style scoped>
.dictate-window {
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  padding: 12px;
}
</style>
