<!-- SPDX-License-Identifier: MIT -->
<script setup>
// The LoRA tab — teaching an engine one voice properly.
//
// Three sub-tabs, matching Alexandria's three advanced screens
// (alexandria-audiobook/app/static/index.html nav, read 2026-08-21):
// Preparer (recordings you own → gated, transcribed clips), Dataset
// (generate a set line by line), Training (run the fine-tune, hear the
// result). They are steps of one job, which is why they are sub-tabs of
// one surface rather than three places to remember.
//
// Precedent (design-law §The rule): the sub-tab strip is the kit's
// SettingsShell, the same component SettingsView.vue:936 uses for
// General / Appearance / … — sections as data, top strip, full-width
// panel. The hand-rolled .jv-subnav died with the parity batch, so it is
// not the precedent to copy here.
import { ref, onMounted } from "vue";
import { SettingsShell } from "@delebash/llm-ui";
import PreparerTab from "./PreparerTab.vue";
import DatasetTab from "./DatasetTab.vue";
import TrainingTab from "./TrainingTab.vue";

// Named for what you DO on each, in the order the work happens.
const SECTIONS = [
  { id: "preparer", label: "Preparer" },
  { id: "dataset", label: "Dataset" },
  { id: "training", label: "Training" },
];

// Training is the destination, so it opens first: most visits are to
// start a run or check one, not to build a set from scratch.
const activeSub = ref("training");

// Deep links (and the Preparer/Dataset hand-offs) name a sub-tab through
// sessionStorage — the same mechanism SettingsView uses for #cache etc.
const HAND_OFF_KEY = "jv.lora.sub";
onMounted(() => {
  try {
    const want = window.sessionStorage?.getItem(HAND_OFF_KEY);
    if (want && SECTIONS.some((s) => s.id === want)) {
      activeSub.value = want;
      window.sessionStorage.removeItem(HAND_OFF_KEY);
    }
  } catch { /* private mode — the default sub-tab is fine */ }
});

/** Move to another sub-tab, carrying an optional payload for it. Used by
 *  "Build a set" (Training → Dataset) and "Use in a run" (Preparer /
 *  Dataset → Training), so the steps chain instead of dead-ending. */
function goTo(sub, payload) {
  if (payload?.datasetId) {
    try {
      window.sessionStorage?.setItem("jv.lora.pickDataset", payload.datasetId);
    } catch { /* the operator can pick it from the list instead */ }
  }
  activeSub.value = sub;
}
</script>

<template>
  <SettingsShell :sections="SECTIONS" v-model="activeSub">
    <!-- v-show, not v-if: a Preparer or Dataset run in flight must keep
         running while you look at another sub-tab. v-if would unmount the
         poller mid-run and lose the results. -->
    <div v-show="activeSub === 'preparer'">
      <PreparerTab @use-dataset="(id) => goTo('training', { datasetId: id })" />
    </div>
    <div v-show="activeSub === 'dataset'">
      <DatasetTab @use-dataset="(id) => goTo('training', { datasetId: id })" />
    </div>
    <div v-show="activeSub === 'training'">
      <TrainingTab @build-dataset="goTo('dataset')" />
    </div>
  </SettingsShell>
</template>
