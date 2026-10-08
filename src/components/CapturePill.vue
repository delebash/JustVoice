<!-- SPDX-License-Identifier: MIT -->
<!--
  The floating dictation pill: what dictation (or an agent's speech) is doing
  right now — listening, transcribing, refining, speaking, done, idle or
  failed — with a row of five bars, a running timer, and a stop button while
  recording. Rendered by the dictation window (DictateWindow.vue).

  In the error state the whole pill is a button: clicking it — or Enter or
  Space while it has focus — copies the error to the clipboard and emits
  `dismiss`. An error with no message does nothing.
-->
<script setup>
import { computed } from "vue";
import { Icon, UiButton } from "@delebash/llm-ui";

const props = defineProps({
  state: {
    type: String,
    default: "rest",
    validator: (v) => ["recording", "transcribing", "refining", "speaking", "completed", "rest", "error"].includes(v),
  },
  elapsedMs: { type: Number, default: 0 },
  errorMessage: { type: String, default: "" },
});
const emit = defineEmits(["stop", "dismiss"]);

const LABELS = {
  recording: "Listening…",
  transcribing: "Transcribing…",
  refining: "Refining…",
  speaking: "Speaking…",
  completed: "Done",
  rest: "",
};

const isError = computed(() => props.state === "error");
const label = computed(() => (isError.value ? props.errorMessage || "Error" : LABELS[props.state]));

// How the bars move: "playing" while sound flows, "working" while waiting on
// the machine, "idle" when nothing happens.
const barMode = computed(() => {
  if (props.state === "recording" || props.state === "speaking") return "playing";
  if (props.state === "completed" || props.state === "rest") return "idle";
  return "working";
});

const showTimer = computed(() => !isError.value && props.state !== "rest");
const timer = computed(() => {
  const total = Math.max(0, Math.floor(props.elapsedMs / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
});

async function copyAndDismiss() {
  if (!isError.value || !props.errorMessage) return;
  try {
    await navigator.clipboard.writeText(props.errorMessage);
  } catch {
    // No clipboard (permissions, an unfocused window) — dismissing still works.
  }
  emit("dismiss");
}

// Enter and Space press the error pill like a click. Only then: the stop
// button inside the recording pill keeps its own keys.
function onKey(event) {
  if (!isError.value) return;
  event.preventDefault();
  copyAndDismiss();
}
</script>

<template>
  <div
    class="capture-pill"
    :class="[`capture-pill--${state}`, { 'capture-pill--error': isError }]"
    :role="isError ? 'button' : 'status'"
    :tabindex="isError ? 0 : undefined"
    :title="isError && errorMessage ? 'Copy the error and close' : undefined"
    @click="copyAndDismiss"
    @keydown.enter="onKey"
    @keydown.space="onKey"
  >
    <span class="capture-pill__bars" :class="`capture-pill__bars--${barMode}`" aria-hidden="true">
      <span v-for="n in 5" :key="n" />
    </span>
    <span v-if="label" class="capture-pill__label">{{ label }}</span>
    <span v-if="showTimer" class="capture-pill__timer">{{ timer }}</span>
    <UiButton
      v-if="state === 'recording'"
      class="capture-pill__stop"
      intent="ghost"
      size="icon"
      aria-label="Stop recording"
      title="Stop recording"
      @click.stop="emit('stop')"
    >
      <template #icon><Icon name="Stop" :size="12" fill /></template>
    </UiButton>
  </div>
</template>

<style scoped>
.capture-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  background: rgba(24, 24, 27, 0.82);
  color: #fff;
  font-family: var(--font-ui);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  box-shadow: var(--shadow-3);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  user-select: none;
}
.capture-pill--error {
  background: var(--danger);
  cursor: pointer;
}
.capture-pill--error:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.capture-pill__label {
  max-width: 48ch;
  overflow: hidden;
  text-overflow: ellipsis;
}
.capture-pill__timer {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.capture-pill__stop {
  color: #fff;
  margin-right: -6px;
}

.capture-pill__bars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 14px;
}
.capture-pill__bars > span {
  width: 3px;
  height: 100%;
  border-radius: 2px;
  background: var(--accent);
  transform-origin: center;
}
.capture-pill--error .capture-pill__bars > span {
  background: #fff;
}
.capture-pill__bars--playing > span {
  animation: capture-pill-bounce 0.8s ease-in-out infinite;
}
.capture-pill__bars--playing > span:nth-child(2) { animation-duration: 0.65s; animation-delay: -0.2s; }
.capture-pill__bars--playing > span:nth-child(3) { animation-duration: 0.9s; animation-delay: -0.45s; }
.capture-pill__bars--playing > span:nth-child(4) { animation-duration: 0.7s; animation-delay: -0.1s; }
.capture-pill__bars--playing > span:nth-child(5) { animation-duration: 0.85s; animation-delay: -0.3s; }
.capture-pill__bars--working > span {
  animation: capture-pill-pulse 1.2s ease-in-out infinite;
}
.capture-pill__bars--working > span:nth-child(2) { animation-delay: 0.12s; }
.capture-pill__bars--working > span:nth-child(3) { animation-delay: 0.24s; }
.capture-pill__bars--working > span:nth-child(4) { animation-delay: 0.36s; }
.capture-pill__bars--working > span:nth-child(5) { animation-delay: 0.48s; }
.capture-pill__bars--idle > span {
  transform: scaleY(0.25);
  opacity: 0.45;
}

@keyframes capture-pill-bounce {
  0%, 100% { transform: scaleY(0.3); }
  35% { transform: scaleY(1); }
  60% { transform: scaleY(0.55); }
}
@keyframes capture-pill-pulse {
  0%, 100% { transform: scaleY(0.35); opacity: 0.55; }
  50% { transform: scaleY(0.75); opacity: 1; }
}
</style>
