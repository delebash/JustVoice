<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// Canonical attribute is `intent` (shared kit). Values stay JV's pill vocab
// (default|success|warn|danger|accent|solid|violet) until this fork is
// replaced by UiTag in the Tag slice.
defineProps({
  intent: { type: String, default: "default" },
  label:   { type: String, default: "" },
});
</script>

<template>
  <span class="jv-pill" :class="`jv-pill--${intent === 'default' ? 'ghost' : intent === 'success' ? 'green' : intent}`">
    <slot>{{ label }}</slot>
  </span>
</template>
