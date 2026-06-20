<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JvSelect — JustVoice select. Built on the native <select> with the
  jv-select styling. No headless library, no portal — Tauri webviews
  render native <select> consistently and the visual is simpler.

  options: array of strings OR { label, value } objects (mirrors the API
  of the old JwSelect so call-sites don't change much).
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { type: [String, Number, Boolean, null], default: null },
  options:    { type: Array, default: () => [] },
  optionLabel:{ type: String, default: "label" },
  optionValue:{ type: String, default: "value" },
  placeholder:{ type: String, default: "" },
  disabled:   { type: Boolean, default: false },
  id:         { type: String, default: undefined },
  inputId:    { type: String, default: undefined },
  // Content-typed width caps (plan Q6). One of:
  //   token / id / name / url / path / prose / edit / full
  // Default is empty (no cap; behaves as before).
  width:      { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const normalized = computed(() =>
  props.options.map((o) => {
    if (o == null) return { label: "", value: null };
    if (typeof o === "string" || typeof o === "number") return { label: String(o), value: o };
    return { label: o[props.optionLabel], value: o[props.optionValue] };
  })
);

function onChange(e) {
  const raw = e.target.value;
  // Restore the original (non-stringified) typed value.
  const match = normalized.value.find((o) => String(o.value) === raw);
  emit("update:modelValue", match ? match.value : raw);
}
</script>

<template>
  <select
    class="jv-select"
    :class="[width && `jv-w-${width}`, { 'is-empty': modelValue == null || modelValue === '' }]"
    :value="modelValue ?? ''"
    :disabled="disabled"
    :id="id || inputId"
    @change="onChange"
  >
    <option v-if="placeholder" value="" disabled hidden>{{ placeholder }}</option>
    <option v-for="opt in normalized" :key="String(opt.value)" :value="opt.value">{{ opt.label }}</option>
  </select>
</template>
