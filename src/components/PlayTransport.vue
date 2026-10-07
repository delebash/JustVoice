<!-- SPDX-License-Identifier: MIT -->
<!--
  A page player's controls, shown in the row whose ▶ started it: a seek bar
  and "0:02 / 0:05". `toggle` adds its own ▶/⏸ — for a row whose ▶ means
  something else (Render's ▶ Play chapter assembles the chapter first).
-->
<script setup>
import { UiButton, UiSlider } from "@delebash/llm-ui";
import { fmtTime } from "../composables/usePagePlayer.js";

defineProps({
  player: { type: Object, required: true },
  width: { type: String, default: "short" },   // UiSlider's: short 120px · long 320px
  toggle: { type: Boolean, default: false },
});
</script>

<template>
  <span class="jv-transport">
    <UiButton v-if="toggle" intent="ghost" size="small" :label="player.paused ? '▶' : '⏸'"
      :title="player.paused ? 'Play' : 'Pause'" @click="player.toggle()" />
    <UiSlider :model-value="player.time" :min="0" :max="player.duration || 0" :step="0.01" :width="width"
      :show-number="false" aria-label="Seek" @update:model-value="player.seek($event)" />
    <span class="jv-mono jv-transport__time">{{ player.duration
      ? `${fmtTime(player.time)} / ${fmtTime(player.duration, { round: true })}` : fmtTime(player.time) }}</span>
  </span>
</template>
