<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
const props = defineProps({
  modelValue: { type: Boolean, default: false },
  label:      { type: String, default: "" },
  disabled:   { type: Boolean, default: false },
  id:         { type: String, default: undefined },
});
const emit = defineEmits(["update:modelValue"]);
</script>

<template>
  <label class="jv-checkbox" :class="{ 'is-disabled': disabled }">
    <input
      type="checkbox"
      :checked="modelValue"
      :disabled="disabled"
      :id="id"
      @change="emit('update:modelValue', $event.target.checked)"
    />
    <span v-if="label || $slots.default">
      <slot>{{ label }}</slot>
    </span>
  </label>
</template>

<style scoped>
.jv-checkbox.is-disabled { opacity: 0.5; cursor: not-allowed; }
</style>
