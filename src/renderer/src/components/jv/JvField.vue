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
    <label v-if="label" :for="$attrs.for ?? undefined">{{ label }}</label>
    <div>
      <slot />
      <span v-if="hint" class="jv-field__hint">{{ hint }}</span>
    </div>
  </div>
</template>
