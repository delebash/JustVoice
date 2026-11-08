<!-- SPDX-License-Identifier: MIT -->
<!--
  A model's best-pick mark and its commercial use, beside the model a picker has chosen
  (docs/plans/2026-11-08-latest-models.md D12): "Best voices you can sell · plays the characters" and
  "Commercial use: Yes" — the licence chip as the one-click card and AI Settings → Speech draw it
  (`.ev-lic`, services/engineFacts.js), the mark as `.ev-pick` (src/css/app.scss).
-->
<script setup>
import { computed } from "vue";

import { licClass, licTitle } from "../services/engineFacts.js";
import { markText } from "../services/modelPicks.js";

const props = defineProps({
  /** The model's pick (services/modelPicks.js `pickOf`), or null. */
  pick: { type: Object, default: null },
  /** The model's licence: its engine's `{name, commercial, summary, checked, …}` (GET /v1/engines) or a
   * voice's `{commercial, summary, url}` (GET /v1/voices), or null. */
  licence: { type: Object, default: null },
});

const commercial = computed(() => props.licence?.commercial || props.pick?.commercial || "");
// the engine's licence says whose reading it is (licTitle); a voice's carries its summary only
const title = computed(() => (props.licence?.name && props.licence?.checked ? licTitle(props.licence) : (props.licence?.summary ?? "")));
</script>

<template>
  <span v-if="pick || commercial" class="ev-caps">
    <span v-if="pick" class="ev-pick" :class="{ 'ev-pick--not-for-sale': !pick.sellable }">{{ markText(pick) }}</span>
    <span v-if="commercial" class="ev-lic" :class="licClass(commercial)" :title="title">Commercial use: {{ commercial }}</span>
  </span>
</template>
