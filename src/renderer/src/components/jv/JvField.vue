<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  JvField — labelled form row. Two layouts:
    inline (default) — 140px label / 1fr control, like the preview's
                       .field-row.
    block            — uppercase eyebrow label above control.
-->
<script setup>
defineProps({
  label:  { type: String, default: "" },
  hint:   { type: String, default: "" },
  layout: { type: String, default: "inline" },   // inline | block
  for:    { type: String, default: undefined },
});
</script>

<template>
  <div class="jv-field" :class="layout === 'block' ? 'jv-field--block' : ''">
    <!-- Named `label` slot lets callers put a pill or button next to the
         label text (matches preview's "Delivery direction [free-form]"
         pattern). Falls through to the `label` prop when no slot used. -->
    <label v-if="$slots.label || label" :for="$attrs.for ?? undefined">
      <slot name="label">{{ label }}</slot>
    </label>
    <div>
      <slot />
      <span v-if="hint" class="jv-field__hint">{{ hint }}</span>
    </div>
  </div>
</template>
