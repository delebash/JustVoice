<!-- SPDX-License-Identifier: MIT -->
<!--
  AI Settings → Speech's own filters — the kit's audio.cpp tab, its `filters` slot beside the
  kit's kind picker and search (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5,
  G6): Cloning, Built-in voices, Commercial use, Tested by JustVoice, Takes direction and, on a
  computer with a graphics card of its own, Fits this card — then the sort (the engine list's, decided
  2026-10-11). It edits the tab's `filters`; services/speechTab.js `modelShown` reads them, and its
  `groupOrder` / `modelOrder` the sort (`filters.sort`, the tab's `groupSort` / `sort` in AiPage.vue).
-->
<script setup>
import { onMounted, ref } from "vue";
import { UiChip, UiSelect } from "@delebash/ui";
import { useApi } from "../stores/api.js";
import { COMMERCIAL_OPTIONS, SORTS } from "../services/engineFacts.js";

const props = defineProps({
  // the tab's filters object (the kit's), edited here
  filters: { type: Object, required: true },
});

// A discrete card, as the kit's memory reading has it: shared memory has no card to fit.
const hasCard = ref(false);
const api = useApi();
onMounted(async () => {
  const r = await api.safeRequest("/v1/llm-runner/resident", null);
  hasCard.value = !!r?.vramTotalMb && r.memArch === "discrete";
});
const toggle = (key) => {
  props.filters[key] = !props.filters[key];
};
</script>

<template>
  <span class="ev-chips">
    <UiChip :selected="!!filters.cloning" @click="toggle('cloning')">Cloning</UiChip>
    <UiChip :selected="!!filters.presets" @click="toggle('presets')">Built-in voices</UiChip>
  </span>
  <UiSelect :model-value="filters.commercial || 'all'" :options="COMMERCIAL_OPTIONS" width="name" aria-label="Commercial use"
    @update:model-value="(v) => (filters.commercial = v)" />
  <span class="ev-chips">
    <UiChip :selected="!!filters.tested" @click="toggle('tested')">Tested by JustVoice</UiChip>
    <UiChip :selected="!!filters.directed" @click="toggle('directed')">Takes direction</UiChip>
    <UiChip v-if="hasCard" :selected="!!filters.fits" @click="toggle('fits')">Fits this card</UiChip>
  </span>
  <UiSelect :model-value="filters.sort || 'name'" :options="SORTS" width="name" aria-label="Sort"
    @update:model-value="(v) => (filters.sort = v)" />
</template>
