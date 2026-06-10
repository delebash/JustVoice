<!-- SPDX-License-Identifier: MIT AND GPL-3.0-or-later -->
<!--
  HelpTrigger — the small "?" button. Opens JvHelpDrawer scoped to the
  given doc slug via the uiStore. Embed inline next to any control, or
  PaneHeader auto-renders one when its `helpKey` prop is set.

  Lifted with adaptation from JustWrite's HelpTrigger.vue. MIT notice
  for upstream-derived portions; JustVoice changes GPL-3.0-or-later.
-->
<script setup>
import { computed } from "vue";
import { useUIStore } from "../stores/ui.js";
import { titleForSlug } from "../services/helpDocs.js";

const props = defineProps({
  slug:  { type: String, required: true },
  label: { type: String, default: "" },
});

const ui = useUIStore();

const tooltipText = computed(() => {
  const surface = props.label || titleForSlug(props.slug);
  return `Help — ${surface}`;
});

function open() {
  ui.openHelp(props.slug);
}
</script>

<template>
  <button
    type="button"
    class="help-trigger"
    :aria-label="tooltipText"
    :title="tooltipText"
    @click="open"
  >
    <span aria-hidden="true">?</span>
  </button>
</template>

<style scoped>
.help-trigger {
  appearance: none;
  border: 1px solid var(--accent-line, var(--accent));
  background: var(--accent-soft, rgba(58, 125, 99, 0.12));
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  border-radius: var(--r-pill, 999px);
  cursor: pointer;
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
  transition: background 0.12s, color 0.12s, transform 0.05s, box-shadow 0.12s;
  font-family: var(--font-ui, inherit);
  box-shadow: 0 0 0 0 var(--accent-soft);
}
.help-trigger:hover {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 0 0 3px var(--accent-soft);
}
.help-trigger:active { transform: scale(0.94); }
.help-trigger:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
