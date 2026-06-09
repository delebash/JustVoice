<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JvInput — JustVoice text input. Thin v-model wrapper around <input>;
  styling comes entirely from .jv-input in justvoice.css. Forward common
  attrs + events so callers can drop in placeholder/autocomplete/etc.
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  type:       { type: String, default: "text" },
  placeholder:{ type: String, default: "" },
  disabled:   { type: Boolean, default: false },
  readonly:   { type: Boolean, default: false },
  invalid:    { type: Boolean, default: false },
  id:         { type: String, default: undefined },
  name:       { type: String, default: undefined },
  autocomplete:{ type: String, default: undefined },
  autofocus:  { type: Boolean, default: false },
  size:       { type: String, default: "md" },   // sm | md
});
const emit = defineEmits(["update:modelValue", "blur", "focus", "keydown"]);

const classes = computed(() => [
  "jv-input",
  props.size === "sm" && "jv-input--sm",
  { "is-invalid": props.invalid },
]);
</script>

<template>
  <input
    :class="classes"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :autocomplete="autocomplete"
    :name="name"
    :id="id"
    :autofocus="autofocus"
    :aria-invalid="invalid ? 'true' : undefined"
    @input="emit('update:modelValue', $event.target.value)"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>
