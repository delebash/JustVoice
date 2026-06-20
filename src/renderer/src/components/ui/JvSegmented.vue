<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JvSegmented — segmented control. Used for small N-of-3 view toggles.
  options: array of { label, value } OR plain strings.
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { type: [String, Number, Boolean, null], default: null },
  options:    { type: Array, default: () => [] },
  size:       { type: String, default: "md" },
});
const emit = defineEmits(["update:modelValue"]);

const normalized = computed(() =>
  props.options.map((o) => {
    if (typeof o === "string" || typeof o === "number") return { label: String(o), value: o };
    return { label: o.label, value: o.value };
  })
);
</script>

<template>
  <div class="jv-segmented" :class="`jv-segmented--${size}`" role="tablist">
    <button
      v-for="opt in normalized"
      :key="String(opt.value)"
      type="button"
      class="jv-segmented__btn"
      :class="{ 'jv-segmented__btn--active': modelValue === opt.value }"
      :aria-pressed="modelValue === opt.value ? 'true' : 'false'"
      @click="emit('update:modelValue', opt.value)"
    >{{ opt.label }}</button>
  </div>
</template>

<style scoped>
.jv-segmented {
  display: inline-flex;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  padding: 2px;
  gap: 2px;
}
.jv-segmented__btn {
  height: 26px;
  padding: 0 12px;
  background: transparent;
  border: 0;
  border-radius: calc(var(--r-control) - 2px);
  color: var(--ink-2);
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.1s, color 0.1s;
}
.jv-segmented__btn:hover { color: var(--ink); }
.jv-segmented__btn--active {
  background: var(--surface);
  color: var(--ink);
  box-shadow: var(--shadow-1);
}
.jv-segmented--sm .jv-segmented__btn { height: 22px; padding: 0 9px; font-size: 11px; }
</style>
