<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  placeholder:{ type: String, default: "" },
  disabled:   { type: Boolean, default: false },
  readonly:   { type: Boolean, default: false },
  rows:       { type: [Number, String], default: 4 },
  invalid:    { type: Boolean, default: false },
  id:         { type: String, default: undefined },
});
const emit = defineEmits(["update:modelValue", "blur", "focus", "keydown"]);
</script>

<template>
  <textarea
    class="jv-textarea"
    :class="{ 'is-invalid': invalid }"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :rows="rows"
    :id="id"
    :aria-invalid="invalid ? 'true' : undefined"
    @input="emit('update:modelValue', $event.target.value)"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>
