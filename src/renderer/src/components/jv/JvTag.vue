<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
defineProps({
  variant: { type: String, default: "default" },  // default | success | warn | danger | accent
  label:   { type: String, default: "" },
});
</script>

<template>
  <span class="jv-pill" :class="`jv-pill--${variant === 'default' ? 'ghost' : variant === 'success' ? 'green' : variant}`">
    <slot>{{ label }}</slot>
  </span>
</template>
