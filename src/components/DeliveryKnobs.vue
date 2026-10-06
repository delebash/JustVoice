<!-- SPDX-License-Identifier: MIT -->
<!--
  Pace · Pitch · Gain and the pauses — ONE set of controls for the persona
  page's How it speaks and Render's "Render overrides" (decided 2026-10-06: "the
  controls should work the same as persona … render overrides should work look
  and act the same"). The kit slider (drag, or type in its number box), the
  ranges and units of `SHAPE_KNOBS`, a ↺ per knob, the pause boxes.

  `knobs` is the list (default SHAPE_KNOBS; Render's Sampling passes the
  model's own, 2026-10-06). `values` holds what is set (null = not set); an unset knob shows `fallback`'s
  value (else the knob's neutral). Events: `input` on every step of a drag or
  keystroke (the persona page's draft follows it), `commit` when the slider is
  let go or the pause box is left (Render saves then), `reset` from a ↺.
-->
<script setup>
import { reactive, watch } from "vue";
import { UiButton, UiNumber, UiSlider } from "@delebash/llm-ui";
import { SHAPE_KNOBS } from "../services/personaFacts.js";

const props = defineProps({
  // [{key, label, min, max, step, neutral, unit, hint?, reset?}]
  knobs: { type: Array, default: () => SHAPE_KNOBS },
  values: { type: Object, default: () => ({}) },
  fallback: { type: Object, default: () => ({}) },
  // Which pause boxes to show: ["pause_before", "pause_after"] or ["pause_after"].
  pauses: { type: Array, default: () => ["pause_before", "pause_after"] },
  // A ↺ on the pause too (Render, where the box shows the persona's pause).
  pauseReset: { type: Boolean, default: false },
  // (key, knob) → the ↺'s title.
  resetTitle: { type: Function, default: (_key, k) => k?.reset || "Back to the default" },
  pausePlaceholder: { type: String, default: "—" },
});
const emit = defineEmits(["input", "commit", "reset"]);

const PAUSE_WORD = { pause_before: "Pause before", pause_after: "Pause after" };
// What a knob shows while it moves, before the parent's value catches up.
const live = reactive({});
watch(() => props.values, () => { for (const k of Object.keys(live)) delete live[k]; }, { deep: true });

const isSet = (key) => props.values?.[key] !== null && props.values?.[key] !== undefined;
function shown(key, neutral = null) {
  if (live[key] !== undefined) return live[key];
  if (isSet(key)) return Number(props.values[key]);
  const f = props.fallback?.[key];
  return f === null || f === undefined ? neutral : Number(f);
}
function onInput(key, v) {
  live[key] = v;
  emit("input", key, v);
}
function onCommit(key, v) {
  const value = v !== undefined ? v : live[key];
  if (value === undefined) return;
  emit("commit", key, value);
}
</script>

<template>
  <div class="jv-knob-grid">
    <div v-for="k in knobs" :key="k.key" class="jv-knob-grid__knob">
      <div class="jv-knob-grid__head">
        <label class="jv-knob-grid__label" :title="k.hint">{{ k.label }}</label>
        <UiButton intent="ghost" size="small" label="↺" :disabled="!isSet(k.key)"
          :title="resetTitle(k.key, k)" @click="emit('reset', k.key)" />
      </div>
      <div class="jv-knob-grid__row">
        <UiSlider :model-value="shown(k.key, k.neutral)" :min="k.min" :max="k.max" :step="k.step"
          width="full" :aria-label="k.label"
          @update:model-value="(v) => onInput(k.key, v)" @change="(v) => onCommit(k.key, v)" />
        <span v-if="k.unit" class="jv-knob-grid__unit">{{ k.unit }}</span>
      </div>
    </div>
    <div v-if="pauses.length" class="jv-knob-grid__knob">
      <div class="jv-knob-grid__head">
        <label class="jv-knob-grid__label">{{ pauses.map((p) => PAUSE_WORD[p]).join(" → ").replace(" → Pause", " →") }}</label>
        <UiButton v-if="pauseReset" intent="ghost" size="small" label="↺" :disabled="!pauses.some(isSet)"
          :title="resetTitle(pauses[pauses.length - 1], null)"
          @click="pauses.forEach((p) => isSet(p) && emit('reset', p))" />
      </div>
      <div class="jv-knob-grid__row">
        <template v-for="(p, i) in pauses" :key="p">
          <span v-if="i" class="jv-knob-grid__unit">→</span>
          <UiNumber :model-value="shown(p)" :min="0" :max="10000" :step="50"
            width="num" size="small" :placeholder="pausePlaceholder" :aria-label="PAUSE_WORD[p]"
            @update:model-value="(v) => onInput(p, v)" @blur="onCommit(p)" />
        </template>
        <span class="jv-knob-grid__unit">ms</span>
      </div>
    </div>
  </div>
</template>
