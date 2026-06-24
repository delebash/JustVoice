<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  PaneHeader — shared eyebrow + H1 at the top of each view / pane.
  Uses .jv-pane-header etc. classes from justvoice.css.
-->
<script setup>
import { HelpTrigger } from "@delebash/llm-ui";

defineProps({
  eyebrow: { type: String, default: "" },
  title:   { type: String, default: "" },
  helpKey: { type: String, default: "" },
});
</script>

<template>
  <header class="jv-pane-header">
    <div class="jv-pane-header__title">
      <span v-if="eyebrow" class="jv-pane-header__eyebrow">{{ eyebrow }}</span>
      <h1 class="jv-pane-header__h1">{{ title }}</h1>
    </div>
    <div class="jv-pane-header__actions" v-if="helpKey || $slots.default">
      <HelpTrigger v-if="helpKey" :slug="helpKey" :label="title" />
      <slot />
    </div>
  </header>
</template>
