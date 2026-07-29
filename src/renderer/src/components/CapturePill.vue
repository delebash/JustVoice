<!--
  SPDX-License-Identifier: MIT
  SPDX-FileCopyrightText: 2024 Jamie Pine and voicebox contributors
  SPDX-FileCopyrightText: 2026 JustVoice contributors

  Originally from https://github.com/jamiepine/voicebox/blob/b35b90961d5bc83a8b4e96e8b6ccde2a03152ff9/app/src/components/CapturePill/CapturePill.tsx
  (commit pinned in voicebox-pin.txt at repo root).
  Translated React -> Vue on 2026-06-08. Modifications by JustVoice contributors
  are licensed under MIT. MIT permission notice continues to apply
  to upstream-derived portions.

  Animated dictation pill — 7 states (recording / transcribing / refining /
  speaking / completed / rest / error). Used inside the floating DictateWindow
  and inline previews on Settings → Captures.
-->
<script setup>
import { computed } from 'vue';

const props = defineProps({
  state: {
    type: String,
    default: 'rest',
    validator: (v) =>
      ['recording', 'transcribing', 'refining', 'speaking', 'completed', 'rest', 'error'].includes(v),
  },
  elapsedMs: { type: Number, default: 0 },
  errorMessage: { type: String, default: '' },
});

const emit = defineEmits(['dismiss', 'stop']);

const labelMap = {
  recording: 'Listening…',
  transcribing: 'Transcribing…',
  refining: 'Refining…',
  speaking: 'Speaking…',
  completed: 'Done',
  rest: '',
  error: 'Error',
};

const barMode = computed(() => {
  if (props.state === 'recording' || props.state === 'speaking') return 'playing';
  if (props.state === 'completed' || props.state === 'rest') return 'idle';
  return 'generating';
});

const elapsed = computed(() => {
  const total = Math.max(0, Math.floor(props.elapsedMs / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

const isError = computed(() => props.state === 'error');

const copyError = async () => {
  if (!isError.value || !props.errorMessage) return;
  try {
    await navigator.clipboard.writeText(props.errorMessage);
  } catch {
    /* clipboard unavailable */
  }
  emit('dismiss');
};
</script>

<template>
  <div
    :class="['pill', isError ? 'pill--error' : `pill--${state}`]"
    @click="isError ? copyError() : undefined"
    :role="isError ? 'button' : undefined"
    :tabindex="isError ? 0 : undefined"
  >
    <div class="pill__bars" :data-mode="barMode">
      <span class="pill__bar" v-for="i in 5" :key="i" />
    </div>
    <span class="pill__label">{{ isError ? errorMessage || 'Error' : labelMap[state] }}</span>
    <span v-if="!isError && state !== 'rest'" class="pill__elapsed">{{ elapsed }}</span>
    <button
      v-if="!isError && state === 'recording'"
      class="pill__stop"
      @click.stop="emit('stop')"
      aria-label="Stop recording"
    >
      ⏹
    </button>
  </div>
</template>

<style scoped>
.pill {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.8);
  color: #fff;
  font-size: 13px;
  font-family: inherit;
  user-select: none;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
}
.pill--error {
  background: var(--danger, #a8442e);
  cursor: pointer;
}
.pill__bars {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 20px;
}
.pill__bar {
  width: 3px;
  border-radius: 999px;
  background: var(--accent, #3a7d63);
  display: inline-block;
}
.pill__bars[data-mode="idle"] .pill__bar {
  height: 8px;
  background: rgba(255, 255, 255, 0.35);
}
.pill__bars[data-mode="generating"] .pill__bar {
  animation: pill-generating 0.6s ease-in-out infinite;
}
.pill__bars[data-mode="generating"] .pill__bar:nth-child(2) {
  animation-delay: 0.08s;
}
.pill__bars[data-mode="generating"] .pill__bar:nth-child(3) {
  animation-delay: 0.16s;
}
.pill__bars[data-mode="generating"] .pill__bar:nth-child(4) {
  animation-delay: 0.24s;
}
.pill__bars[data-mode="generating"] .pill__bar:nth-child(5) {
  animation-delay: 0.32s;
}
.pill__bars[data-mode="playing"] .pill__bar {
  animation: pill-playing 1.2s ease-in-out infinite;
}
.pill__bars[data-mode="playing"] .pill__bar:nth-child(2) {
  animation-delay: 0.15s;
}
.pill__bars[data-mode="playing"] .pill__bar:nth-child(3) {
  animation-delay: 0.3s;
}
.pill__bars[data-mode="playing"] .pill__bar:nth-child(4) {
  animation-delay: 0.45s;
}
.pill__bars[data-mode="playing"] .pill__bar:nth-child(5) {
  animation-delay: 0.6s;
}
@keyframes pill-generating {
  0%, 100% { height: 6px; }
  50% { height: 16px; }
}
@keyframes pill-playing {
  0% { height: 8px; }
  20% { height: 14px; }
  40% { height: 4px; }
  60% { height: 12px; }
  100% { height: 8px; }
}
.pill__label {
  font-weight: 500;
}
.pill__elapsed {
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
  font-size: 12px;
}
.pill__stop {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 999px;
  color: #fff;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 11px;
}
</style>
