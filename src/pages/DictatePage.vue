<!-- SPDX-License-Identifier: MIT -->
<!--
  The dictation window: a separate, transparent, always-on-top window that
  shows only the capture pill. App.vue (the root) renders this instead of the shell when the
  page is opened with ?view=dictate.

  Its one working cycle is an agent's speech. When the shell announces that an
  MCP agent's justvoice.speak made a generation (dictate:speak-start), the
  window waits for that generation on its status stream, plays its audio, and
  shows the pill while it plays (dictate:show / dictate:hide ask the shell to
  show and hide the window — hiding is the shell's job, not the page's). The
  pill never stays up: a generation that has not started playing 60 s after
  speak-start, or 15 s after speak-end, ends the cycle.

  The window is not created today: the Electron shell has no window-to-window
  channel yet, and services/native.js's dictateEmit / onDictateEvent are
  no-ops until it does. Recording from the hotkey is not built.
-->
<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { dictateEmit, onDictateEvent } from "../services/native.js";
import { useApi } from "../stores/api.js";
import CapturePill from "../components/CapturePill.vue";

const STUCK_MS = 60_000; // speak-start → audio must have started by then
const GRACE_MS = 15_000; // speak-end → audio must have started by then
const TICK_MS = 250; // the pill's timer

const api = useApi();
const state = ref("rest");
const elapsedMs = ref(0);
const errorMessage = ref("");

let active = false;
let playing = false;
let stream = null;
let player = null;
let stuckTimer = null;
let graceTimer = null;
let ticker = null;
const unsubscribes = [];

/** A shell payload — an object, or the same as JSON text. null when it is neither. */
function parse(payload) {
  let value = payload;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" ? value : null;
}

function closeStream() {
  if (stream) {
    stream.onmessage = null;
    stream.onerror = null;
    stream.close();
    stream = null;
  }
}

function clearTimers() {
  clearTimeout(stuckTimer);
  clearTimeout(graceTimer);
  clearInterval(ticker);
  stuckTimer = graceTimer = ticker = null;
}

/** Stop everything this cycle started and ask the shell to hide the window. */
function endCycle() {
  const wasActive = active;
  active = false;
  playing = false;
  closeStream();
  if (player) {
    player.onplaying = player.onended = player.onerror = null;
    player.pause();
    player.removeAttribute("src");
    player = null;
  }
  clearTimers();
  state.value = "rest";
  elapsedMs.value = 0;
  if (wasActive) dictateEmit("dictate:hide", {});
}

/** Play the generation's audio; the pill appears once sound actually starts. */
function play(generationId) {
  const audio = new Audio(`${api.serverUrl}/v1/generations/${encodeURIComponent(generationId)}/audio`);
  player = audio;
  const mine = () => player === audio;
  audio.onplaying = () => {
    if (!mine() || playing) return;
    playing = true;
    clearTimeout(graceTimer);
    dictateEmit("dictate:show", {});
    state.value = "speaking";
    const startedAt = Date.now();
    elapsedMs.value = 0;
    ticker = setInterval(() => {
      elapsedMs.value = Date.now() - startedAt;
    }, TICK_MS);
  };
  audio.onended = () => mine() && endCycle();
  audio.onerror = () => mine() && endCycle();
  let attempt;
  try {
    attempt = audio.play();
  } catch {
    endCycle();
    return;
  }
  if (attempt && typeof attempt.catch === "function") attempt.catch(() => mine() && endCycle());
}

function onSpeakStart(payload) {
  const generationId = parse(payload)?.generation_id;
  if (!generationId) return;
  endCycle(); // the latest speak wins
  active = true;
  state.value = "transcribing"; // a waiting cue while the window is still hidden
  elapsedMs.value = 0;

  const source = new EventSource(`${api.serverUrl}/v1/generate/${encodeURIComponent(generationId)}/status`);
  stream = source;
  source.onmessage = (event) => {
    let status;
    try {
      status = JSON.parse(event.data)?.status;
    } catch {
      return; // a heartbeat
    }
    if (status === "completed") {
      clearTimeout(stuckTimer);
      stuckTimer = null;
      closeStream();
      play(generationId);
    } else if (status === "failed" || status === "not_found") {
      endCycle();
    }
  };
  // The browser reconnects on its own; the stuck timer is the backstop.
  source.onerror = () => {};
  stuckTimer = setTimeout(() => {
    if (!playing) endCycle();
  }, STUCK_MS);
}

function onSpeakEnd(payload) {
  const message = parse(payload);
  if (message === null) return;
  if (message.status != null && message.status !== "completed") {
    endCycle();
    return;
  }
  clearTimeout(graceTimer);
  graceTimer = setTimeout(() => {
    if (!playing) endCycle();
  }, GRACE_MS);
}

// The window takes the pill's shape: no page background behind it.
const saved = { html: "", body: "" };

onMounted(() => {
  saved.html = document.documentElement.style.background;
  saved.body = document.body.style.background;
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  unsubscribes.push(onDictateEvent("dictate:speak-start", onSpeakStart));
  unsubscribes.push(onDictateEvent("dictate:speak-end", onSpeakEnd));
});

onBeforeUnmount(() => {
  for (const off of unsubscribes.splice(0)) {
    try {
      if (typeof off === "function") off();
    } catch {
      // A shell that is already gone has nothing left to unsubscribe.
    }
  }
  endCycle();
  document.documentElement.style.background = saved.html;
  document.body.style.background = saved.body;
});
</script>

<template>
  <div class="dictate-window">
    <CapturePill
      v-if="state !== 'rest'"
      :state="state"
      :elapsed-ms="elapsedMs"
      :error-message="errorMessage"
      @dismiss="endCycle"
    />
  </div>
</template>

<style scoped>
.dictate-window {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  background: transparent;
}
</style>
