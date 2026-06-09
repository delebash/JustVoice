<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JvButton — JustVoice button primitive. Built fresh against the preview
  aesthetic. `variant` encodes both role and visuals:
    primary    solid forest-green
    secondary  white card with hairline
    ghost      no fill, no border, only on hover
    danger     solid oxblood
    danger-outline
    warn       solid gold
    accent-soft accent-tinted soft fill
-->
<script setup>
import { computed } from "vue";

const props = defineProps({
  variant: { type: String, default: "primary" },
  size:    { type: String, default: "md" },          // sm | md | lg | icon
  loading: { type: Boolean, default: false },
  disabled:{ type: Boolean, default: false },
  type:    { type: String, default: "button" },
  label:   { type: String, default: "" },
  as:      { type: String, default: "button" },
});

defineEmits(["click"]);

const classes = computed(() => [
  "jv-btn",
  `jv-btn--${props.variant}`,
  props.size !== "md" && `jv-btn--${props.size}`,
  { "is-loading": props.loading },
]);
</script>

<template>
  <component
    :is="as"
    :class="classes"
    :type="as === 'button' ? type : undefined"
    :disabled="as === 'button' ? (disabled || loading) : undefined"
    :aria-disabled="as !== 'button' && (disabled || loading) ? 'true' : undefined"
    :aria-busy="loading ? 'true' : undefined"
    @click="(e) => !disabled && !loading && $emit('click', e)"
  >
    <span v-if="loading" class="jv-btn__spinner" aria-hidden="true" />
    <slot v-else name="icon" />
    <span v-if="label || $slots.default" class="jv-btn__label">
      <slot>{{ label }}</slot>
    </span>
  </component>
</template>

<style scoped>
@keyframes jv-btn-spin { to { transform: rotate(360deg); } }
.jv-btn__spinner {
  width: 12px; height: 12px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: jv-btn-spin 0.7s linear infinite;
  display: inline-block;
}
.jv-btn__label { display: inline-flex; align-items: center; }
</style>
