<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, watch, onMounted, nextTick } from "vue";

const props = defineProps({
  modelValue: { type: [String, Number], default: "" },
  placeholder:{ type: String, default: "" },
  disabled:   { type: Boolean, default: false },
  readonly:   { type: Boolean, default: false },
  rows:       { type: [Number, String], default: 4 },
  invalid:    { type: Boolean, default: false },
  id:         { type: String, default: undefined },
  // Auto-resize the textarea to fit its content, between minHeightPx and
  // maxHeightPx. Default off — opt-in per usage so
  // existing fixed-rows textareas aren't disturbed.
  autosize:   { type: Boolean, default: false },
  minHeightPx:{ type: Number, default: 100 },
  maxHeightPx:{ type: Number, default: 300 },
});
const emit = defineEmits(["update:modelValue", "blur", "focus", "keydown", "input"]);

const textareaEl = ref(null);

function resize() {
  if (!props.autosize) return;
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  const target = Math.max(props.minHeightPx, Math.min(el.scrollHeight, props.maxHeightPx));
  el.style.height = `${target}px`;
  el.style.overflowY = el.scrollHeight > props.maxHeightPx ? "auto" : "hidden";
}

onMounted(() => nextTick(resize));
watch(() => props.modelValue, () => nextTick(resize));
</script>

<template>
  <textarea
    ref="textareaEl"
    class="jv-textarea jv-textarea--full"
    :class="{ 'is-invalid': invalid }"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :readonly="readonly"
    :rows="autosize ? undefined : rows"
    :id="id"
    :aria-invalid="invalid ? 'true' : undefined"
    :style="autosize ? { minHeight: `${minHeightPx}px`, maxHeight: `${maxHeightPx}px`, resize: 'none' } : undefined"
    @input="emit('update:modelValue', $event.target.value); resize(); emit('input', $event)"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
    @keydown="emit('keydown', $event)"
  />
</template>
