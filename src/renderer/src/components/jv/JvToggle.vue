<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JvToggle — switch-style boolean control. Voicebox-parity Toggle:
  visually distinct from a checkbox, sized to fit a SettingRow's action
  slot, animates the thumb on flip.
-->
<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  disabled:   { type: Boolean, default: false },
  id:         { type: String, default: undefined },
  ariaLabel:  { type: String, default: undefined },
});
const emit = defineEmits(["update:modelValue", "change"]);

function flip() {
  if (props.disabled) return;
  const next = !props.modelValue;
  emit("update:modelValue", next);
  emit("change", next);
}
</script>

<template>
  <button
    type="button"
    role="switch"
    :id="id"
    :aria-checked="modelValue ? 'true' : 'false'"
    :aria-label="ariaLabel"
    :disabled="disabled"
    class="jv-toggle"
    :class="{ 'jv-toggle--on': modelValue, 'jv-toggle--disabled': disabled }"
    @click="flip"
  >
    <span class="jv-toggle__thumb" />
  </button>
</template>

<style scoped>
.jv-toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 38px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
  flex-shrink: 0;
}
.jv-toggle:hover:not(.jv-toggle--disabled) {
  border-color: var(--ink-3);
}
.jv-toggle__thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--surface);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.15);
  transition: transform 0.18s cubic-bezier(0.4, 0, 0.2, 1), background 0.15s ease;
}
.jv-toggle--on {
  background: var(--accent);
  border-color: var(--accent);
}
.jv-toggle--on:hover:not(.jv-toggle--disabled) {
  background: hsl(var(--accent-hue, 158) 55% 32%);
  border-color: hsl(var(--accent-hue, 158) 55% 32%);
}
.jv-toggle--on .jv-toggle__thumb {
  transform: translateX(16px);
  background: #fff;
}
.jv-toggle--disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.jv-toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
